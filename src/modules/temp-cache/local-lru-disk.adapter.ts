import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { ICacheManager } from '../../core/interfaces/cache-manager.interface';

interface CacheNode {
  fileId: string;
  absolutePath: string;
  sizeBytes: number;
  /** D1: el archivo se guarda como `${fileId}.bin`; el tipo real va acá. */
  archiveType: string;
}

/**
 * Caché LRU en disco (RF-07, RNF-03). Orden de inserción de `Map` = recencia:
 * el primero es el más viejo → expulsión O(1). `activeLocks` comparte la misma
 * descarga entre peticiones concurrentes y protege archivos en vuelo de la expulsión.
 */
@Injectable()
export class LocalLRUDiskAdapter implements ICacheManager, OnApplicationBootstrap {
  private readonly logger = new Logger(LocalLRUDiskAdapter.name);
  private readonly cache = new Map<string, CacheNode>();
  private readonly activeLocks = new Map<string, Promise<string>>();
  private currentSizeBytes = 0;

  private tempDir: string;
  private maxFiles: number;
  private maxSizeBytes: number;

  constructor(private readonly config: ConfigService) {
    this.tempDir = config.get<string>('TEMP_DIR') ?? '/temp/comics';
    this.maxFiles = config.get<number>('MAX_CACHE_FILES') ?? 15;
    this.maxSizeBytes = config.get<number>('MAX_CACHE_SIZE_BYTES') ?? 150 * 1024 * 1024;
  }

  async onApplicationBootstrap(): Promise<void> {
    await fs.promises.mkdir(this.tempDir, { recursive: true });
    const files = await fs.promises.readdir(this.tempDir);

    const stats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(this.tempDir, file);
        const stat = await fs.promises.stat(filePath);
        return { file, filePath, size: stat.size, mtime: stat.mtimeMs, isFile: stat.isFile() };
      }),
    );
    stats
      .filter((s) => s.isFile)
      .sort((a, b) => a.mtime - b.mtime)
      .forEach((item) => {
        const fileId = path.parse(item.file).name;
        if (this.cache.has(fileId)) return;
        this.cache.set(fileId, {
          fileId,
          absolutePath: item.filePath,
          sizeBytes: item.size,
          archiveType: 'unknown',
        });
        this.currentSizeBytes += item.size;
      });

    await this.evictOldestIfNeeded();
    this.logger.log(`Cache ready: ${this.cache.size} files, ${this.currentSizeBytes} bytes`);
  }

  async has(fileId: string): Promise<boolean> {
    return this.cache.has(fileId);
  }

  async getLocalPath(fileId: string): Promise<string | null> {
    const node = this.cache.get(fileId);
    if (!node) return null;
    // Touch: reinsertar lo mueve al final (más reciente).
    this.cache.delete(fileId);
    this.cache.set(fileId, node);
    return node.absolutePath;
  }

  async setFromStream(fileId: string, stream: Readable): Promise<string> {
    const ongoing = this.activeLocks.get(fileId);
    if (ongoing) return ongoing;

    const download = (async () => {
      const targetPath = path.join(this.tempDir, `${fileId}.bin`);
      const sizeBytes = await this.pipeStreamToDisk(stream, targetPath);

      const prev = this.cache.get(fileId);
      if (prev) this.currentSizeBytes -= prev.sizeBytes;
      this.cache.delete(fileId);
      this.cache.set(fileId, { fileId, absolutePath: targetPath, sizeBytes, archiveType: 'unknown' });
      this.currentSizeBytes += sizeBytes;

      await this.evictOldestIfNeeded();
      return targetPath;
    })().finally(() => {
      this.activeLocks.delete(fileId);
    });

    this.activeLocks.set(fileId, download);
    return download;
  }

  async evictOldestIfNeeded(): Promise<void> {
    while (this.cache.size > this.maxFiles || this.currentSizeBytes > this.maxSizeBytes) {
      const victim = [...this.cache.keys()].find((key) => !this.activeLocks.has(key));
      if (!victim) break; // Todo en vuelo: no se puede expulsar sin corromper descargas.
      const node = this.cache.get(victim)!;
      try {
        await fs.promises.unlink(node.absolutePath);
      } catch (err) {
        this.logger.error(`Evict unlink failed for ${victim}: ${(err as Error).message}`);
      }
      this.currentSizeBytes -= node.sizeBytes;
      this.cache.delete(victim);
      this.logger.log(`LRU evict: ${victim} (${node.sizeBytes} bytes)`);
    }
  }

  private pipeStreamToDisk(stream: Readable, targetPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(targetPath);
      let bytesWritten = 0;
      const fail = (err: Error) => {
        stream.destroy();
        writer.destroy();
        fs.promises.unlink(targetPath).catch(() => undefined);
        reject(err);
      };
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;
      });
      stream.on('error', fail);
      writer.on('error', fail);
      writer.on('finish', () => resolve(bytesWritten));
      stream.pipe(writer);
    });
  }
}
