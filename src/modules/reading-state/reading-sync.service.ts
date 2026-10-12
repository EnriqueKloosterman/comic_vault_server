import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as fs from 'fs';
import { Model, Types } from 'mongoose';
import { Comic } from '../../database/schemas/comic.schema';
import { ReadingStatus, UserReadingState } from '../../database/schemas/user-reading-state.schema';
import { ComicAccessDeniedException } from '../comics/reader-stream.service';

export interface ReconcileProgressPayload {
  comicId: string;
  currentPage: number;
  /** Opcional (clientes offline); por defecto `comic.pageCount`. */
  totalPages?: number;
  isRewind?: boolean;
}

function invalidPage(message: string): BadRequestException {
  return new BadRequestException({ message, error: 'BadRequest', code: 'INVALID_PAGE_NUMBER' });
}

/**
 * Bitácora de lectura (RF-08/RF-09, RNF-05).
 * - Upsert: nunca null (D5); el snapshot título/serie/número sobrevive al Comic.
 * - Monotonía: solo avanza si `currentPage > actual`, salvo `isRewind`.
 */
@Injectable()
export class ReadingSyncService {
  private readonly logger = new Logger(ReadingSyncService.name);

  constructor(
    @InjectModel(UserReadingState.name) private readonly stateModel: Model<UserReadingState>,
    @InjectModel(Comic.name) private readonly comicModel: Model<Comic>,
  ) {}

  async reconcileProgress(userId: string, payload: ReconcileProgressPayload): Promise<UserReadingState> {
    const comic = await this.ownedComic(userId, payload.comicId);
    const totalPages = Math.floor(payload.totalPages ?? comic.pageCount);
    if (!Number.isFinite(totalPages) || totalPages <= 0) throw invalidPage('totalPages must be a positive integer');
    if (!Number.isInteger(payload.currentPage) || payload.currentPage < 0) throw invalidPage('currentPage must be >= 0');
    const target = Math.min(payload.currentPage, Math.max(totalPages - 1, 0));

    let state = await this.stateModel.findOne({ userId: comic.userId, originalComicId: payload.comicId }).exec();
    if (!state) {
      state = new this.stateModel({
        userId: comic.userId,
        originalComicId: payload.comicId,
        title: comic.title,
        series: comic.series,
        issueNumber: comic.issueNumber,
      });
    }

    if (!payload.isRewind && target <= state.currentPage && state.lastReadAt) {
      return state; // Dato viejo o duplicado: no retrocede ni toca timestamps.
    }

    state.currentPage = target;
    state.progressPercentage = totalPages <= 1 ? 100 : Number(((target / (totalPages - 1)) * 100).toFixed(1));
    state.lastReadAt = new Date();

    if (target >= totalPages - 1) {
      state.status = ReadingStatus.COMPLETED;
      state.completedAt = state.completedAt ?? new Date();
    } else if (target > 0) {
      state.status = ReadingStatus.READING;
      state.completedAt = null as unknown as Date;
    } else {
      state.status = ReadingStatus.UNREAD;
      state.completedAt = null as unknown as Date;
    }
    return state.save();
  }

  async setFavorite(userId: string, comicId: string, isFavorite: boolean): Promise<UserReadingState> {
    const comic = await this.ownedComic(userId, comicId);
    let state = await this.stateModel.findOne({ userId: comic.userId, originalComicId: comicId }).exec();
    if (!state) {
      state = new this.stateModel({
        userId: comic.userId,
        originalComicId: comicId,
        title: comic.title,
        series: comic.series,
        issueNumber: comic.issueNumber,
      });
    }
    state.isFavorite = isFavorite;
    return state.save();
  }

  async readingHistory(userId: string): Promise<UserReadingState[]> {
    return this.stateModel.find({ userId: new Types.ObjectId(userId) }).sort({ updatedAt: -1 }).exec();
  }

  /**
   * Sync destructivo (§8.1): por cada Comic huérfano borra cover y decide según progreso.
   * Retorna cantidad archivada. Lo invoca DriveSyncService dentro de POST /sync/drive.
   */
  async purgeOrphans(userId: string, orphans: Comic[]): Promise<number> {
    let archived = 0;
    for (const comic of orphans) {
      const state = await this.stateModel
        .findOne({ userId: comic.userId, originalComicId: String(comic._id) })
        .exec();

      if (comic.coverCachePath) {
        await fs.promises.unlink(comic.coverCachePath).catch(() => undefined);
      }

      if (state && state.currentPage > 0) {
        state.status = ReadingStatus.ARCHIVED;
        await state.save();
        archived++;
        this.logger.log(`Archived reading state for ${comic.filename}`);
      } else if (state) {
        await this.stateModel.deleteOne({ _id: state._id }).exec();
      }
      await this.comicModel.deleteOne({ _id: comic._id }).exec();
    }
    return archived;
  }

  private async ownedComic(userId: string, comicId: string): Promise<Comic> {
    const comic = await this.comicModel.findById(comicId).exec();
    if (!comic || String(comic.userId) !== String(userId)) {
      throw new ComicAccessDeniedException();
    }
    return comic;
  }
}
