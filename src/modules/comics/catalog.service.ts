import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Comic } from '../../database/schemas/comic.schema';
import { ReadingStatus } from '../../database/schemas/user-reading-state.schema';
import { CatalogQueryDto } from './dto/catalog-query.dto';

export interface CatalogReadingState {
  status: ReadingStatus;
  currentPage: number;
  progressPercentage: number;
  isFavorite: boolean;
  lastReadAt: Date | null;
  completedAt: Date | null;
}

export interface CatalogItem {
  comicId: string;
  filename: string;
  title: string;
  series: string;
  issueNumber: number;
  writer: string | null;
  publicationYear: number | null;
  pageCount: number;
  fileSize: number;
  coverCachePath: string | null;
  lastSyncedAt: Date;
  readingState: CatalogReadingState;
}

export interface CatalogPage {
  data: CatalogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Catálogo paginado (D4). Decisiones documentadas:
 * - Join `$lookup` Comics→States en la query (sin desnormalizar estado en Comic).
 *   El State es la fuente única; `effectiveStatus` trata "sin State" como `unread`.
 * - Orden fijo serie A-Z (collation `en`) + `issueNumber` numérico: la biblioteca
 *   se lee como colección, no como feed reciente.
 */
@Injectable()
export class CatalogService {
  constructor(@InjectModel(Comic.name) private readonly comicModel: Model<Comic>) {}

  async list(userId: string, query: CatalogQueryDto): Promise<CatalogPage> {
    const uid = new Types.ObjectId(userId);
    const match: Record<string, unknown> = { userId: uid };
    if (query.series) match.series = { $regex: escapeRegex(query.series), $options: 'i' };

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'userreadingstates',
          let: { cid: { $toString: '$_id' }, uid },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$originalComicId', '$$cid'] }, { $eq: ['$userId', '$$uid'] }] } } },
            { $limit: 1 },
          ],
          as: 'state',
        },
      },
      { $unwind: { path: '$state', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          effectiveStatus: { $ifNull: ['$state.status', ReadingStatus.UNREAD] },
          effectiveFavorite: { $ifNull: ['$state.isFavorite', false] },
        },
      },
    ];

    if (query.status) pipeline.push({ $match: { effectiveStatus: query.status } });
    if (query.favorite !== undefined) pipeline.push({ $match: { effectiveFavorite: query.favorite } });

    const skip = (query.page - 1) * query.limit;
    pipeline.push(
      // Orden de biblioteca: serie A-Z y número de ejemplar (orden numérico real,
      // no alfabético). Desempata por fecha de sync para filas idénticas.
      { $sort: { series: 1, issueNumber: 1, updatedAt: -1 } },
      { $facet: { data: [{ $skip: skip }, { $limit: query.limit }], total: [{ $count: 'n' }] } },
    );

    const [result] = await this.comicModel.aggregate(pipeline, { collation: { locale: 'en' } }).exec();
    const total: number = result?.total?.[0]?.n ?? 0;
    const data: CatalogItem[] = (result?.data ?? []).map((doc: Record<string, unknown>) =>
      CatalogService.toItem(doc),
    );
    return { data, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  }

  static toItem(doc: Record<string, unknown>): CatalogItem {
    const state = (doc.state as Record<string, unknown> | undefined) ?? {};
    return {
      comicId: String(doc._id),
      filename: doc.filename as string,
      title: doc.title as string,
      series: doc.series as string,
      issueNumber: doc.issueNumber as number,
      writer: (doc.writer as string) ?? null,
      publicationYear: (doc.publicationYear as number) ?? null,
      pageCount: doc.pageCount as number,
      fileSize: doc.fileSize as number,
      coverCachePath: (doc.coverCachePath as string) ?? null,
      lastSyncedAt: doc.lastSyncedAt as Date,
      readingState: {
        status: (state.status as ReadingStatus) ?? ReadingStatus.UNREAD,
        currentPage: (state.currentPage as number) ?? 0,
        progressPercentage: (state.progressPercentage as number) ?? 0,
        isFavorite: (state.isFavorite as boolean) ?? false,
        lastReadAt: (state.lastReadAt as Date) ?? null,
        completedAt: (state.completedAt as Date) ?? null,
      },
    };
  }
}
