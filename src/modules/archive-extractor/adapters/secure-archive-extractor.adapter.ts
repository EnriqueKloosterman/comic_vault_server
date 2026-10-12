import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { createExtractorFromData, createExtractorFromFile } from 'node-unrar-js';
import * as yauzl from 'yauzl';
import sharp from 'sharp';
import {
  ArchiveManifest,
  IArchiveExtractor,
  ParsedComicMetadata,
} from '../../../core/interfaces/archive-extractor.interface';
import { assertSafePath, isSafeImageEntry, MAX_UNCOMPRESSED_PAGE_SIZE, ZipBombException, ZipSlipException } from '../../../core/utils/archive-safety.util';
import { naturalSortPages } from '../../../core/utils/natural-sort.util';
import { parseComicInfo } from '../utils/metadata-parser.util';

export class PageOutOfBoundsException extends NotFoundException {
  constructor(pageIndex: number, pageCount: number) {
    super({
      message: `Page index ${pageIndex} out of bounds (0..${pageCount - 1})`,
      error: 'NotFound',
      code: 'PAGE_INDEX_OUT_OF_BOUNDS',
    });
  }
}

export class CoverExtractionFailedException extends UnprocessableEntityException {
  constructor() {
    super({
      message: 'No readable cover found inside archive',
      error: 'UnprocessableEntity',
      code: 'COVER_EXTRACTION_FAILED',
    });
  }
}

type ArchiveType = 'zip' | 'rar';

const MAX_PAGE_BYTES = MAX_UNCOMPRESSED_PAGE_SIZE;

interface Entry {
  name: string;
  size: number;
}

/**
 * Extractor seguro ZIP/RAR (D6: detección por magic bytes, nunca por extensión).
 * - Zip Slip: `assertSafePath` aborta todo el manifiesto ante `../`.
 * - Zip Bomb: entradas >50MB se saltean en manifiesto/cover; `extractPage` lanza 413.
 * - RAR vía `node-unrar-js` (RAR4+RAR5). El contenido se carga entero en memoria;
 *   `rarLoads` comparte UNA carga entre lecturas concurrentes del mismo archivo
 *   (galería + prefetch piden N/N+1/N+2 a la vez) para no multiplicar el pico de RAM.
 */
@Injectable()
export class SecureArchiveExtractorAdapter implements IArchiveExtractor {
  private readonly logger = new Logger(SecureArchiveExtractorAdapter.name);
  private readonly rarLoads = new Map<string, Promise<Buffer>>();

  async getManifest(filePath: string): Promise<ArchiveManifest> {
    const type = await SecureArchiveExtractorAdapter.detectArchiveType(filePath);
    const entries = await this.listEntries(filePath, type);

    const pages: string[] = [];
    let oversizedSkipped = 0;
    for (const entry of entries) {
      assertSafePath(path.dirname(filePath), entry.name);
      try {
        if (isSafeImageEntry(entry.name, entry.size)) pages.push(entry.name);
      } catch (err) {
        if (err instanceof ZipBombException) {
          oversizedSkipped++;
          continue;
        }
        throw err;
      }
    }
    if (pages.length === 0 && oversizedSkipped > 0) {
      throw new ZipBombException('All pages exceed 50 MB, archive marked incompatible');
    }

    const internalPages = naturalSortPages(pages);
    const comicInfo = await this.readComicInfo(filePath, type, entries);
    return {
      pageCount: internalPages.length,
      internalPages,
      metadata: comicInfo ?? undefined,
    };
  }

  async extractPage(filePath: string, pageIndex: number): Promise<Readable> {
    const manifest = await this.getManifest(filePath);
    const entryName = manifest.internalPages[pageIndex];
    if (!entryName) throw new PageOutOfBoundsException(pageIndex, manifest.pageCount);
    return this.readEntryStream(filePath, entryName, pageIndex, manifest.pageCount);
  }

  async generateCoverThumbnail(filePath: string, destinationPath: string): Promise<void> {
    const manifest = await this.getManifest(filePath);
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    for (const entryName of manifest.internalPages) {
      try {
        const bytes = await this.readEntryBytes(filePath, entryName);
        await sharp(bytes).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 80 }).toFile(destinationPath);
        return;
      } catch (err) {
        this.logger.warn(`Cover candidate failed (${entryName}): ${(err as Error).message}`);
      }
    }
    throw new CoverExtractionFailedException();
  }

  // ---------- detección ----------

  static async detectArchiveType(filePath: string): Promise<ArchiveType> {
    const fh = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(8);
      await fh.read(buf, 0, 8, 0);
      // ZIP: PK\x03\x04 (file), PK\x05\x06 (empty), PK\x07\x08 (spanned)
      if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] >= 0x03 && buf[2] <= 0x07 && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)) {
        return 'zip';
      }
      // RAR4: Rar!\x1A\x07\x00 — RAR5: Rar!\x1A\x07\x01\x00
      if (buf.toString('binary', 0, 4) === 'Rar!' && buf[4] === 0x1a && buf[5] === 0x07) return 'rar';
    } finally {
      await fh.close();
    }
    throw new BadRequestException({
      message: 'Unsupported archive format (not ZIP nor RAR)',
      error: 'BadRequest',
      code: 'UNSUPPORTED_ARCHIVE',
    });
  }

  // ---------- listado ----------

  private async listEntries(filePath: string, type: ArchiveType): Promise<Entry[]> {
    if (type === 'rar') {
      // node-unrar-js (unrar oficial 6.x): soporta RAR4 y RAR5.
      const ext = await createExtractorFromFile({ filepath: filePath });
      const out: Entry[] = [];
      for (const h of ext.getFileList().fileHeaders) {
        if (h.flags.directory || h.name.endsWith('/')) continue;
        out.push({ name: h.name.replace(/\\/g, '/'), size: h.unpSize });
      }
      return out;
    }
    const zip = await openZip(filePath);
    try {
      const raw = await readZipEntries(zip);
      return raw
        .filter((e) => !e.fileName.endsWith('/'))
        .map((e) => ({ name: e.fileName, size: e.uncompressedSize }));
    } catch (err) {
      // yauzl rechaza `../`, paths absolutos y backslashes con Error plano:
      // se traduce al código canónico 400 del dominio.
      if (err instanceof Error && /invalid relative path|absolute path|invalid characters/.test(err.message)) {
        throw new ZipSlipException(`Intento de Zip Slip detectado: ${err.message}`);
      }
      throw err;
    } finally {
      safeClose(zip);
    }
  }

  private async readComicInfo(filePath: string, type: ArchiveType, entries: Entry[]): Promise<ParsedComicMetadata | null> {
    const found = entries.find(
      (e) => !e.name.includes('/') && e.name.toLowerCase() === 'comicinfo.xml',
    );
    if (!found) return null;
    try {
      const bytes = await this.readEntryBytes(filePath, found.name);
      return parseComicInfo(bytes.toString('utf8'));
    } catch (err) {
      this.logger.warn(`ComicInfo.xml unreadable: ${(err as Error).message}`);
      return null;
    }
  }

  // ---------- lectura ----------

  private async readEntryStream(filePath: string, entryName: string, pageIndex: number, pageCount: number): Promise<Readable> {
    const type = await SecureArchiveExtractorAdapter.detectArchiveType(filePath);
    if (type === 'rar') {
      const bytes = await this.readRarEntry(filePath, entryName, pageIndex, pageCount);
      return Readable.from(bytes);
    }
    // Single-pass: yauzl cierra el fd al agotar las entradas, así que el stream
    // se abre durante el listado, sin segunda pasada.
    const zip = await openZip(filePath);
    try {
      return await openZipEntryStream(zip, entryName, pageIndex, pageCount);
    } catch (err) {
      safeClose(zip);
      throw err;
    }
  }

  /**
   * Lectura cruda por nombre (para ComicInfo.xml y candidatos de cover ya validados
   * en el manifiesto). Aplica ZipSlip + límite de tamaño, sin filtro de extensión.
   */
  private async readEntryBytes(filePath: string, entryName: string): Promise<Buffer> {
    assertSafePath(path.dirname(filePath), entryName);
    const type = await SecureArchiveExtractorAdapter.detectArchiveType(filePath);
    if (type === 'rar') {
      // FromFile solo lista/escribe a disco; el contenido en memoria requiere FromData.
      const raw = await this.readRarFileBytes(filePath);
      const data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      const ext = await createExtractorFromData({ data });
      const headers = [...ext.getFileList().fileHeaders];
      const header = headers.find((h) => h.name.replace(/\\/g, '/') === entryName);
      if (!header || header.flags.directory) throw new PageOutOfBoundsException(0, 0);
      if (header.flags.encrypted) throw new Error(`RAR entry encrypted, password required: ${entryName}`);
      if (header.unpSize > MAX_PAGE_BYTES) throw new ZipBombException();
      const extracted = ext.extract({ files: [header.name] });
      for (const f of extracted.files) {
        if (f.extraction) return Buffer.from(f.extraction);
      }
      throw new PageOutOfBoundsException(0, 0);
    }
    const zip = await openZip(filePath);
    try {
      return await bufferZipEntry(zip, entryName, MAX_PAGE_BYTES);
    } catch (err) {
      safeClose(zip);
      throw err;
    }
  }

  private async readRarEntry(filePath: string, entryName: string, pageIndex: number, pageCount: number): Promise<Buffer> {
    const bytes = await this.readEntryBytes(filePath, entryName).catch((err) => {
      if (err instanceof PageOutOfBoundsException) throw new PageOutOfBoundsException(pageIndex, pageCount);
      throw err;
    });
    if (!isSafeImageEntry(entryName, bytes.length)) {
      throw new PageOutOfBoundsException(pageIndex, pageCount);
    }
    return bytes;
  }

  /**
   * Carga completa del RAR compartida entre lecturas concurrentes del mismo
   * archivo (galería pide N y el prefetch N+1/N+2 a la vez). Sin esto, cada
   * página duplica el archivo en RAM y voltea el proceso en tomos grandes.
   */
  private readRarFileBytes(filePath: string): Promise<Buffer> {
    const ongoing = this.rarLoads.get(filePath);
    if (ongoing) return ongoing;
    const load = fs.promises.readFile(filePath).finally(() => {
      this.rarLoads.delete(filePath);
    });
    this.rarLoads.set(filePath, load);
    return load;
  }
}

export function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => (err || !zip ? reject(err) : resolve(zip))),
  );
}

export function readZipEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const out: yauzl.Entry[] = [];
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      out.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(out));
    zip.on('error', reject);
  });
}

export function safeClose(zip: yauzl.ZipFile): void {
  try {
    zip.close();
  } catch {
    /* ya cerrado por yauzl tras 'end' */
  }
}

/**
 * Abre el stream de una entrada durante el listado (single-pass): yauzl cierra
 * el fd al agotar las entradas, así que no se puede listar primero y leer después.
 * El zip se cierra al terminar o fallar el stream.
 */
export function openZipEntryStream(
  zip: yauzl.ZipFile,
  entryName: string,
  pageIndex: number,
  pageCount: number,
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    let settled = false;
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      if (!settled && entry.fileName === entryName) {
        settled = true;
        let safety: boolean;
        try {
          safety = isSafeImageEntry(entry.fileName, entry.uncompressedSize);
        } catch (err) {
          safeClose(zip);
          reject(err); // ZipBomb (413) ante oversize
          return;
        }
        if (!safety) {
          safeClose(zip);
          reject(new PageOutOfBoundsException(pageIndex, pageCount));
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            safeClose(zip);
            reject(err ?? new PageOutOfBoundsException(pageIndex, pageCount));
            return;
          }
          stream.on('end', () => safeClose(zip));
          stream.on('error', () => safeClose(zip));
          resolve(stream);
        });
      } else if (!settled) {
        zip.readEntry();
      }
    });
    zip.on('end', () => {
      if (!settled) {
        settled = true;
        reject(new PageOutOfBoundsException(pageIndex, pageCount));
      }
    });
    zip.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

export function bufferZipEntry(zip: yauzl.ZipFile, entryName: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    zip.readEntry();
    zip.on('entry', (entry: yauzl.Entry) => {
      if (!settled && entry.fileName === entryName) {
        settled = true;
        if (entry.uncompressedSize > maxBytes) {
          safeClose(zip);
          reject(new ZipBombException());
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            safeClose(zip);
            reject(err ?? new PageOutOfBoundsException(0, 0));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(Buffer.from(c)));
          stream.on('end', () => {
            safeClose(zip);
            resolve(Buffer.concat(chunks));
          });
          stream.on('error', (e: Error) => {
            safeClose(zip);
            reject(e);
          });
        });
      } else if (!settled) {
        zip.readEntry();
      }
    });
    zip.on('end', () => {
      if (!settled) {
        settled = true;
        reject(new PageOutOfBoundsException(0, 0));
      }
    });
    zip.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

