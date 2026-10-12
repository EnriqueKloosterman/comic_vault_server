import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import { Model } from 'mongoose';
import { Readable } from 'stream';
import { Comic } from '../../database/schemas/comic.schema';
import { User } from '../../database/schemas/user.schema';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { I_ARCHIVE_EXTRACTOR, IArchiveExtractor } from '../../core/interfaces/archive-extractor.interface';
import { I_CACHE_MANAGER, ICacheManager } from '../../core/interfaces/cache-manager.interface';
import { IStorageProvider } from '../../core/interfaces/storage-provider.interface';
import { PageOutOfBoundsException } from '../archive-extractor/adapters/secure-archive-extractor.adapter';
import { GoogleDriveAdapter } from '../drive-sync/google-drive.adapter';

export class ComicAccessDeniedException extends ForbiddenException {
  constructor() {
    super({ message: 'Comic does not belong to this user', error: 'Forbidden', code: 'COMIC_ACCESS_DENIED' });
  }
}

export class CoverNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Comic has no readable cover', error: 'NotFound', code: 'COVER_NOT_FOUND' });
  }
}

export interface PageStream {
  stream: Readable;
  contentType: string;
}

export interface ManifestPage {
  index: number;
  url: string;
}

export interface ComicManifest {
  comicId: string;
  title: string;
  series: string;
  issueNumber: number;
  pageCount: number;
  pages: ManifestPage[];
}

const CONTENT_TYPE: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function contentTypeFor(entryName: string): string {
  const ext = entryName.slice(entryName.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPE[ext] ?? 'application/octet-stream';
}

/**
 * Streaming on-demand (RF-06): Cache → (miss) Drive → Cache → Extract.
 * Ownership (RNF-02): comic inexistente o de otro usuario → 403 uniforme (sin oráculo).
 */
@Injectable()
export class ReaderStreamService {
  constructor(
    @InjectModel(Comic.name) private readonly comicModel: Model<Comic>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    @Inject(I_CACHE_MANAGER) private readonly cache: ICacheManager,
    @Inject(I_ARCHIVE_EXTRACTOR) private readonly extractor: IArchiveExtractor,
  ) {}

  protected createStorage(): IStorageProvider {
    return new GoogleDriveAdapter(this.config, this.encryption);
  }

  async getPageStream(userId: string, comicId: string, pageIndex: number): Promise<PageStream> {
    const comic = await this.ownedComic(userId, comicId);
    if (pageIndex < 0 || pageIndex >= comic.internalPages.length) {
      throw new PageOutOfBoundsException(pageIndex, comic.internalPages.length);
    }
    const entryName = comic.internalPages[pageIndex];
    const localPath = await this.ensureCached(comic);
    const stream = await this.extractor.extractPage(localPath, pageIndex);
    return { stream, contentType: contentTypeFor(entryName) };
  }

  async getManifest(userId: string, comicId: string): Promise<ComicManifest> {
    const comic = await this.ownedComic(userId, comicId);
    const id = String(comic._id);
    return {
      comicId: id,
      title: comic.title,
      series: comic.series,
      issueNumber: comic.issueNumber,
      pageCount: comic.pageCount,
      pages: comic.internalPages.map((_, index) => ({ index, url: `/api/comics/${id}/pages/${index}` })),
    };
  }

  async getCoverStream(userId: string, comicId: string): Promise<PageStream> {
    const comic = await this.ownedComic(userId, comicId);
    if (!comic.coverCachePath || !fs.existsSync(comic.coverCachePath)) {
      throw new CoverNotFoundException();
    }
    return { stream: fs.createReadStream(comic.coverCachePath), contentType: 'image/webp' };
  }

  private async ownedComic(userId: string, comicId: string): Promise<Comic> {
    const comic = await this.comicModel.findById(comicId).exec();
    if (!comic || String(comic.userId) !== String(userId)) {
      throw new ComicAccessDeniedException();
    }
    return comic;
  }

  private async ensureCached(comic: Comic): Promise<string> {
    const cached = await this.cache.getLocalPath(comic.googleDriveFileId);
    if (cached) return cached;

    const user = await this.userModel.findById(comic.userId).exec();
    if (!user) throw new ComicAccessDeniedException();
    const storage = this.createStorage();
    storage.setCredentials(user.encryptedRefreshToken);
    const remote = await storage.downloadFileStream(comic.googleDriveFileId);
    return this.cache.setFromStream(comic.googleDriveFileId, remote);
  }
}
