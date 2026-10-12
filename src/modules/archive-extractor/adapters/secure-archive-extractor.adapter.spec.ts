import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import {
  CoverExtractionFailedException,
  PageOutOfBoundsException,
  SecureArchiveExtractorAdapter,
} from './secure-archive-extractor.adapter';
import { ZipBombException, ZipSlipException } from '../../../core/utils/archive-safety.util';
import { ZipEntryInput, buildStoredZip, makeTestPng } from '../../../../test/zip-fixtures';

jest.mock('node-unrar-js', () => ({ createExtractorFromFile: jest.fn(), createExtractorFromData: jest.fn() }));
import { createExtractorFromData, createExtractorFromFile } from 'node-unrar-js';

const mockedCreateExtractor = createExtractorFromFile as unknown as jest.Mock;
const mockedCreateExtractorFromData = createExtractorFromData as unknown as jest.Mock;

// ---------- fixtures ----------

let dir: string;
let imgPng: Buffer;
const adapter = new SecureArchiveExtractorAdapter();

beforeAll(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cvx-'));
  imgPng = await makeTestPng();
});

async function writeZip(name: string, entries: ZipEntryInput[]): Promise<string> {
  const p = path.join(dir, name);
  await fs.promises.writeFile(p, buildStoredZip(entries));
  return p;
}

describe('SecureArchiveExtractorAdapter (ZIP)', () => {
  it('manifiesto ordena natural y filtra basura', async () => {
    const p = await writeZip('basic.cbz', [
      { name: 'p10.jpg', data: imgPng },
      { name: 'notes.txt', data: Buffer.from('hi') },
      { name: '__MACOSX/._p1.jpg', data: imgPng },
      { name: 'p2.jpg', data: imgPng },
      { name: 'p1.jpg', data: imgPng },
    ]);
    const m = await adapter.getManifest(p);
    expect(m.pageCount).toBe(3);
    expect(m.internalPages).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
    expect(m.metadata).toBeUndefined();
  });

  it('lee ComicInfo.xml de la raíz', async () => {
    const p = await writeZip('meta.cbz', [
      {
        name: 'ComicInfo.xml',
        data: Buffer.from('<ComicInfo><Series>Saga</Series><Number>7</Number></ComicInfo>'),
      },
      { name: 'a.jpg', data: imgPng },
    ]);
    const m = await adapter.getManifest(p);
    expect(m.metadata).toEqual({ series: 'Saga', issueNumber: 7 });
  });

  it('Zip Slip aborta con SECURITY_ZIP_SLIP_DETECTED', async () => {
    const p = await writeZip('slip.cbz', [
      { name: 'ok.jpg', data: imgPng },
      { name: '../evil.jpg', data: imgPng },
    ]);
    const err = await adapter.getManifest(p).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZipSlipException);
    expect((err as ZipSlipException).getResponse()).toMatchObject({ code: 'SECURITY_ZIP_SLIP_DETECTED' });
    expect(await fs.promises.readdir(path.dirname(dir)).catch(() => [])).not.toContain('evil.jpg');
  });

  it('entradas >50MB se saltean; si son todas → ZIP_BOMB_DETECTED', async () => {
    const mixed = await writeZip('mixed.cbz', [
      { name: 'ok.jpg', data: imgPng },
      { name: 'huge.jpg', data: imgPng, declaredSize: 51 * 1024 * 1024 },
    ]);
    expect((await adapter.getManifest(mixed)).internalPages).toEqual(['ok.jpg']);

    const allHuge = await writeZip('huge.cbz', [
      { name: 'huge.jpg', data: imgPng, declaredSize: 51 * 1024 * 1024 },
    ]);
    const err = await adapter.getManifest(allHuge).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZipBombException);
    expect((err as ZipBombException).getResponse()).toMatchObject({ code: 'ZIP_BOMB_DETECTED' });
  });

  it('extractPage devuelve bytes y OOB → PAGE_INDEX_OUT_OF_BOUNDS', async () => {
    const p = await writeZip('pages.cbz', [
      { name: 'p1.jpg', data: imgPng },
      { name: 'p2.jpg', data: imgPng },
    ]);
    const chunks: Buffer[] = [];
    for await (const c of await adapter.extractPage(p, 0)) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).equals(imgPng)).toBe(true);

    const err = await adapter.extractPage(p, 7).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageOutOfBoundsException);
    expect((err as PageOutOfBoundsException).getResponse()).toMatchObject({
      code: 'PAGE_INDEX_OUT_OF_BOUNDS',
    });
  });

  it('generateCoverThumbnail escribe WebP ≤480px', async () => {
    const p = await writeZip('cover.cbz', [{ name: 'p1.jpg', data: imgPng }]);
    const dest = path.join(dir, 'nested', 'deep', 'cover.webp');
    await adapter.generateCoverThumbnail(p, dest);
    const meta = await sharp(dest).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(480);
  });

  it('cover sin páginas válidas → COVER_EXTRACTION_FAILED', async () => {
    const p = await writeZip('nocover.cbz', [{ name: 'notes.txt', data: Buffer.from('x') }]);
    const err = await adapter
      .generateCoverThumbnail(p, path.join(dir, 'c.webp'))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoverExtractionFailedException);
  });

  it('archivo no ZIP/RAR → UNSUPPORTED_ARCHIVE', async () => {
    const p = path.join(dir, 'plain.bin');
    await fs.promises.writeFile(p, Buffer.from('not an archive at all....padding'));
    const err = await adapter.getManifest(p).catch((e: unknown) => e);
    expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({ code: 'UNSUPPORTED_ARCHIVE' });
  });
});

describe('SecureArchiveExtractorAdapter (RAR, mock)', () => {
  function rarExtractor(entries: { name: string; data: Uint8Array; unpSize?: number }[]) {
    const headers = entries.map((e) => ({
      name: e.name,
      flags: { encrypted: false, solid: false, directory: false },
      packSize: e.data.length,
      unpSize: e.unpSize ?? e.data.length,
    }));
    const canned = {
      getFileList: () => ({ fileHeaders: (function* () { yield* headers; })() }),
      extract: ({ files }: { files: string[] }) => ({
        files: (function* () {
          for (const name of files) {
            const found = entries.find((e) => e.name === name);
            if (found) yield { fileHeader: headers.find((h) => h.name === name), extraction: found.data };
          }
        })(),
      }),
    };
    mockedCreateExtractor.mockResolvedValue(canned);
    mockedCreateExtractorFromData.mockResolvedValue(canned);
    return canned;
  }

  it('manifiesto RAR ordena natural y lee ComicInfo', async () => {
    const rarPath = path.join(dir, 'fake.cbr');
    await fs.promises.writeFile(
      rarPath,
      Buffer.concat([Buffer.from('Rar!\x1A\x07\x01\x00'), Buffer.alloc(64)]),
    );
    const xml = new TextEncoder().encode('<ComicInfo><Series>Rar Saga</Series></ComicInfo>');
    rarExtractor([
      { name: 'p2.jpg', data: new Uint8Array(imgPng) },
      { name: 'ComicInfo.xml', data: xml },
      { name: 'p1.jpg', data: new Uint8Array(imgPng) },
    ]);
    const m = await adapter.getManifest(rarPath);
    expect(m.internalPages).toEqual(['p1.jpg', 'p2.jpg']);
    expect(m.metadata).toEqual({ series: 'Rar Saga' });
  });

  it('extractPage RAR devuelve bytes', async () => {
    const rarPath = path.join(dir, 'fake2.cbr');
    await fs.promises.writeFile(
      rarPath,
      Buffer.concat([Buffer.from('Rar!\x1A\x07\x01\x00'), Buffer.alloc(64)]),
    );
    mockedCreateExtractor.mockClear();
    mockedCreateExtractorFromData.mockClear();
    rarExtractor([{ name: 'p1.jpg', data: new Uint8Array(imgPng) }]);
    const chunks: Buffer[] = [];
    for await (const c of await adapter.extractPage(rarPath, 0)) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).equals(imgPng)).toBe(true);
  });

  it('lecturas RAR concurrentes del mismo archivo comparten una sola carga', async () => {
    const rarPath = path.join(dir, 'fake3.cbr');
    await fs.promises.writeFile(
      rarPath,
      Buffer.concat([Buffer.from('Rar!\x1A\x07\x01\x00'), Buffer.alloc(64)]),
    );
    rarExtractor([
      { name: 'p1.jpg', data: new Uint8Array(imgPng) },
      { name: 'p2.jpg', data: new Uint8Array(imgPng) },
    ]);
    const spy = jest.spyOn(fs.promises, 'readFile');
    spy.mockClear();
    const readBytes = (entry: string) =>
      (adapter as unknown as { readEntryBytes: (f: string, e: string) => Promise<Buffer> }).readEntryBytes(
        rarPath,
        entry,
      );
    const [b1, b2] = await Promise.all([readBytes('p1.jpg'), readBytes('p2.jpg')]);
    expect(b1.equals(imgPng)).toBe(true);
    expect(b2.equals(imgPng)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
