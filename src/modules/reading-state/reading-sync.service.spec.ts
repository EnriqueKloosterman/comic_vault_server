import { Model } from 'mongoose';
import { Comic } from '../../database/schemas/comic.schema';
import { ReadingStatus, UserReadingState } from '../../database/schemas/user-reading-state.schema';
import { ReadingSyncService } from './reading-sync.service';

const USER_ID = '507f1f77bcf86cd799439011';
const COMIC_ID = '507f1f77bcf86cd799439099';

function comicDoc() {
  return { _id: COMIC_ID, userId: USER_ID, title: 'T', series: 'S', issueNumber: 3 };
}

interface StateRow {
  _id: string;
  userId: string;
  originalComicId: string;
  title: string;
  series: string;
  issueNumber: number;
  status: ReadingStatus;
  currentPage: number;
  progressPercentage: number;
  isFavorite: boolean;
  lastReadAt?: Date;
  completedAt?: Date | null;
  save: jest.Mock;
}

describe('ReadingSyncService', () => {
  const rows = new Map<string, StateRow>();
  let constructed: Partial<StateRow>[] = [];

  const stateModel = Object.assign(
    jest.fn().mockImplementation((dto: Partial<StateRow>) => {
      constructed.push(dto);
      const row: StateRow = {
        _id: 's1',
        status: ReadingStatus.UNREAD,
        currentPage: 0,
        progressPercentage: 0,
        isFavorite: false,
        ...dto,
        save: jest.fn(async function (this: StateRow) {
          rows.set(this.originalComicId, this);
          return this;
        }),
      } as StateRow;
      return row;
    }),
    {
      findOne: jest.fn((q: { originalComicId: string }) => ({ exec: async () => rows.get(q.originalComicId) ?? null })),
      deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
      find: jest.fn(() => ({ sort: jest.fn(() => ({ exec: async () => [...rows.values()] })) })),
    },
  ) as unknown as Model<UserReadingState>;

  const comicModel = {
    findById: jest.fn(() => ({ exec: async () => comicDoc() })),
    deleteOne: jest.fn(() => ({ exec: async () => ({ deletedCount: 1 }) })),
  } as unknown as Model<Comic>;

  function service() {
    return new ReadingSyncService(stateModel, comicModel);
  }

  function seed(over: Partial<StateRow> = {}) {
    const row: StateRow = {
      _id: 's1',
      userId: USER_ID,
      originalComicId: COMIC_ID,
      title: 'T',
      series: 'S',
      issueNumber: 3,
      status: ReadingStatus.READING,
      currentPage: 5,
      progressPercentage: 50,
      isFavorite: false,
      lastReadAt: new Date('2026-01-01'),
      save: jest.fn(async function (this: StateRow) {
        rows.set(this.originalComicId, this);
        return this;
      }),
      ...over,
    } as StateRow;
    rows.set(COMIC_ID, row);
    return row;
  }

  beforeEach(() => {
    rows.clear();
    constructed = [];
    jest.clearAllMocks();
    (comicModel.findById as jest.Mock).mockImplementation(() => ({ exec: async () => comicDoc() }));
    (comicModel.deleteOne as jest.Mock).mockImplementation(() => ({ exec: async () => ({ deletedCount: 1 }) }));
    (stateModel.findOne as jest.Mock).mockImplementation((q: { originalComicId: string }) => ({
      exec: async () => rows.get(q.originalComicId) ?? null,
    }));
    (stateModel.deleteOne as jest.Mock).mockImplementation(() => ({ exec: async () => ({ deletedCount: 1 }) }));
    (stateModel.find as jest.Mock).mockImplementation(() => ({
      sort: jest.fn(() => ({ exec: async () => [...rows.values()] })),
    }));
  });

  it('upsert: crea estado al primer avance (nunca null)', async () => {
    const s = await service().reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 4, totalPages: 11 });
    expect(s.status).toBe(ReadingStatus.READING);
    expect(s.currentPage).toBe(4);
    expect(s.progressPercentage).toBe(40);
    expect(s.lastReadAt).toBeInstanceOf(Date);
    expect(constructed).toHaveLength(1);
  });

  it('transiciones unread → reading → completed con timestamps', async () => {
    const svc = service();
    const r1 = await svc.reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 0, totalPages: 11 });
    expect(r1.status).toBe(ReadingStatus.UNREAD);

    const r2 = await svc.reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 3, totalPages: 11 });
    expect(r2.status).toBe(ReadingStatus.READING);

    const r3 = await svc.reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 10, totalPages: 11 });
    expect(r3.status).toBe(ReadingStatus.COMPLETED);
    expect(r3.completedAt).toBeInstanceOf(Date);
    expect(r3.progressPercentage).toBe(100);
  });

  it('payload viejo no retrocede sin isRewind (ni toca lastReadAt)', async () => {
    const before = new Date('2026-01-01');
    seed({ lastReadAt: before });
    const s = await service().reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 2, totalPages: 11 });
    expect(s.currentPage).toBe(5);
    expect(s.lastReadAt).toEqual(before);
    expect(s.save).not.toHaveBeenCalled();
  });

  it('isRewind:true sí retrocede y limpia completedAt', async () => {
    seed({ status: ReadingStatus.COMPLETED, currentPage: 10, completedAt: new Date() });
    const s = await service().reconcileProgress(USER_ID, {
      comicId: COMIC_ID,
      currentPage: 2,
      totalPages: 11,
      isRewind: true,
    });
    expect(s.currentPage).toBe(2);
    expect(s.status).toBe(ReadingStatus.READING);
    expect(s.completedAt).toBeNull();
  });

  it('clampa currentPage mayor que totalPages-1 a completed', async () => {
    const s = await service().reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 99, totalPages: 11 });
    expect(s.currentPage).toBe(10);
    expect(s.status).toBe(ReadingStatus.COMPLETED);
  });

  it('setFavorite hace upsert y preserva snapshot', async () => {
    const s = await service().setFavorite(USER_ID, COMIC_ID, true);
    expect(s.isFavorite).toBe(true);
    expect(s.title).toBe('T');
  });

  it('purgeOrphans: con progreso → ARCHIVED; sin progreso → borra todo', async () => {
    seed({ currentPage: 7 });
    const orphanWithProgress = { _id: 'c1', filename: 'a.cbz', coverCachePath: null, userId: USER_ID };
    const orphanFresh = { _id: 'c2', filename: 'b.cbz', coverCachePath: null, userId: USER_ID };

    const svc = service();
    const rowC1 = rows.get(COMIC_ID)!;
    rows.delete(COMIC_ID);
    rows.set('c1', { ...rowC1, originalComicId: 'c1' });

    const archived = await svc.purgeOrphans(USER_ID, [orphanWithProgress, orphanFresh] as never);
    expect(archived).toBe(1);
    expect(rows.get('c1')!.status).toBe(ReadingStatus.ARCHIVED);
    expect(comicModel.deleteOne).toHaveBeenCalledTimes(2);
  });

  it('comic ajeno → COMIC_ACCESS_DENIED', async () => {
    const otherUser = '507f1f77bcf86cd799439012';
    (comicModel.findById as jest.Mock).mockImplementation(() => ({
      exec: async () => ({ ...comicDoc(), userId: otherUser }),
    }));
    const err = await service()
      .reconcileProgress(USER_ID, { comicId: COMIC_ID, currentPage: 1, totalPages: 5 })
      .catch((e: unknown) => e);
    expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({ code: 'COMIC_ACCESS_DENIED' });
  });
});
