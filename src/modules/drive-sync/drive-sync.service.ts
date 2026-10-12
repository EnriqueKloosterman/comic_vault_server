import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Model, Types } from 'mongoose';
import { Comic } from '../../database/schemas/comic.schema';
import { User } from '../../database/schemas/user.schema';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { I_ARCHIVE_EXTRACTOR, IArchiveExtractor } from '../../core/interfaces/archive-extractor.interface';
import { Inject } from '@nestjs/common';
import { IStorageProvider } from '../../core/interfaces/storage-provider.interface';
import { fallbackFilenameRegex } from '../archive-extractor/utils/metadata-parser.util';
import { CoverExtractionFailedException } from '../archive-extractor/adapters/secure-archive-extractor.adapter';
import { ReadingSyncService } from '../reading-state/reading-sync.service';
import { GoogleDriveAdapter } from './google-drive.adapter';

export interface SyncSummary {
  added: number;
  kept: number;
  archived: number;
}

/** Bump al mejorar el parser: el sync reindexa in-place lo viejo (self-heal). */
export const CURRENT_METADATA_VERSION = 2;

/**
 * Indexación de biblioteca (RF-03/RF-04). Flujo por archivo nuevo:
 * descargar a temp → manifiesto → metadatos (ComicInfo o fallback) →
 * cover WebP → crear Comic → borrar temp (la fase 4 retiene en cache LRU).
 * Huérfanos (en DB pero no en Drive): purga destructiva vía ReadingSyncService (RNF-05).
 */
@Injectable()
export class DriveSyncService {
  private readonly logger = new Logger(DriveSyncService.name);

  constructor(
    @InjectModel(Comic.name) private readonly comicModel: Model<Comic>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    @Inject(I_ARCHIVE_EXTRACTOR) private readonly extractor: IArchiveExtractor,
    private readonly reading: ReadingSyncService,
  ) {}

  protected createStorage(): IStorageProvider {
    return new GoogleDriveAdapter(this.config, this.encryption);
  }

  async syncLibrary(userId: string): Promise<SyncSummary> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new Error(`syncLibrary: user ${userId} not found`);

    const storage = this.createStorage();
    storage.setCredentials(user.encryptedRefreshToken);
    const remote = await storage.listSupportedArchives();

    const existing = await this.comicModel.find({ userId: user._id }).exec();
    const known = new Map(existing.map((c) => [c.googleDriveFileId, c]));
    const remoteIds = new Set(remote.map((f) => f.fileId));

    let added = 0;
    let kept = 0;
    const keptIds: unknown[] = [];
    for (const file of remote) {
      const doc = known.get(file.fileId);
      if (doc) {
        kept++;
        keptIds.push(doc._id);
        // Self-heal: metadatos viejos se reindexan in-place (mismo _id → states intactos).
        if ((doc.metadataVersion ?? 0) < CURRENT_METADATA_VERSION) {
          try {
            await this.refreshFile(doc, storage);
          } catch (err) {
            this.logger.error(`Refresh failed for ${file.filename} (${file.fileId}): ${(err as Error).message}`);
          }
        }
        continue;
      }
      try {
        await this.indexFile(String(user._id), file.fileId, file.filename, file.size, storage);
        added++;
      } catch (err) {
        this.logger.error(`Index failed for ${file.filename} (${file.fileId}): ${(err as Error).message}`);
      }
    }
    if (keptIds.length > 0) {
      await this.comicModel.updateMany({ _id: { $in: keptIds } }, { lastSyncedAt: new Date() }).exec();
    }

    const orphans = existing.filter((c) => !remoteIds.has(c.googleDriveFileId));
    const archived = await this.reading.purgeOrphans(String(user._id), orphans);
    return { added, kept, archived };
  }

  private async indexFile(
    userId: string,
    driveFileId: string,
    filename: string,
    fileSize: number,
    storage: IStorageProvider,
  ): Promise<void> {
    const fields = await this.fetchAndProcess(driveFileId, filename, storage);
    await this.comicModel.create({
      userId: new Types.ObjectId(userId),
      googleDriveFileId: driveFileId,
      filename,
      fileSize,
      ...fields,
      metadataVersion: CURRENT_METADATA_VERSION,
      lastSyncedAt: new Date(),
    });
  }

  private async refreshFile(comic: Comic, storage: IStorageProvider): Promise<void> {
    const fields = await this.fetchAndProcess(comic.googleDriveFileId, comic.filename, storage);
    await this.comicModel
      .updateOne(
        { _id: comic._id },
        { $set: { ...fields, metadataVersion: CURRENT_METADATA_VERSION, lastSyncedAt: new Date() } },
      )
      .exec();
    this.logger.log(`Metadata refreshed for ${comic.filename} (v${CURRENT_METADATA_VERSION})`);
  }

  private async fetchAndProcess(driveFileId: string, filename: string, storage: IStorageProvider) {
    const tempDir = this.config.get<string>('TEMP_DIR') ?? os.tmpdir();
    const coverDir = this.config.get<string>('TEMP_COVER_DIR') ?? path.join(os.tmpdir(), 'covers');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, `${driveFileId}.bin`);

    const stream = await storage.downloadFileStream(driveFileId);
    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(tempPath);
      stream.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', () => resolve());
      stream.pipe(writer);
    });

    try {
      const manifest = await this.extractor.getManifest(tempPath);
      const meta = manifest.metadata ?? fallbackFilenameRegex(filename);

      let coverCachePath: string | null = null;
      const coverPath = path.join(coverDir, `${driveFileId}.webp`);
      try {
        await this.extractor.generateCoverThumbnail(tempPath, coverPath);
        coverCachePath = coverPath;
      } catch (err) {
        if (err instanceof CoverExtractionFailedException) {
          this.logger.warn(`No cover for ${filename}, coverCachePath=null`);
        } else {
          throw err;
        }
      }

      return {
        title: meta.title ?? filename,
        series: meta.series ?? 'Sin Clasificar',
        issueNumber: meta.issueNumber ?? 1,
        writer: meta.writer ?? null,
        publicationYear: meta.year ?? null,
        pageCount: manifest.pageCount,
        coverCachePath,
        internalPages: manifest.internalPages,
      };
    } finally {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    }
  }
}
