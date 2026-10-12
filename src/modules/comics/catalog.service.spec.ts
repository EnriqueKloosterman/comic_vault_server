import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

describe('CatalogService', () => {
  const aggregate = jest.fn();
  const comicModel = { aggregate } as never;

  function service() {
    return new CatalogService(comicModel);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    aggregate.mockReturnValue({ exec: async () => [{ data: [], total: [] }] });
  });

  it('pipeline filtra por usuario+serie y pagina con facet', async () => {
    const query = Object.assign(new CatalogQueryDto(), { series: 'Eter', page: 2, limit: 10 });
    const page = await service().list('507f1f77bcf86cd799439011', query);

    expect(page).toEqual({ data: [], total: 0, page: 2, limit: 10, totalPages: 0 });
    const pipeline = aggregate.mock.calls[0][0] as Record<string, unknown>[];
    const match = (pipeline[0] as { $match: Record<string, unknown> }).$match;
    expect(match.series).toEqual({ $regex: 'Eter', $options: 'i' });
    const facet = pipeline.find((s) => '$facet' in s) as { $facet: { data: unknown[] } };
    expect(facet.$facet.data).toEqual([{ $skip: 10 }, { $limit: 10 }]);
    expect(pipeline.some((s) => '$lookup' in s)).toBe(true);
  });

  it('aplica filtros status y favorite sobre campos efectivos', async () => {
    const query = Object.assign(new CatalogQueryDto(), { status: 'reading', favorite: true });
    await service().list('507f1f77bcf86cd799439011', query);
    const pipeline = aggregate.mock.calls[0][0] as Record<string, unknown>[];
    expect(pipeline).toContainEqual({ $match: { effectiveStatus: 'reading' } });
    expect(pipeline).toContainEqual({ $match: { effectiveFavorite: true } });
  });

  it('ordena por serie A-Z + issueNumber numérico con collation', async () => {
    await service().list('507f1f77bcf86cd799439011', new CatalogQueryDto());
    const pipeline = aggregate.mock.calls[0][0] as Record<string, unknown>[];
    expect(pipeline).toContainEqual({ $sort: { series: 1, issueNumber: 1, updatedAt: -1 } });
    expect(aggregate.mock.calls[0][1]).toEqual({ collation: { locale: 'en' } });
  });

  it('toItem mapea defaults cuando no hay State', () => {
    const item = CatalogService.toItem({ _id: 'x', title: 'T', pageCount: 5 } as never);
    expect(item.comicId).toBe('x');
    expect(item.readingState).toEqual({
      status: 'unread',
      currentPage: 0,
      progressPercentage: 0,
      isFavorite: false,
      lastReadAt: null,
      completedAt: null,
    });
  });

  it('totalPages usa ceil', async () => {
    aggregate.mockReturnValue({ exec: async () => [{ data: [], total: [{ n: 25 }] }] });
    const page = await service().list('507f1f77bcf86cd799439011', new CatalogQueryDto());
    expect(page.total).toBe(25);
    expect(page.totalPages).toBe(2);
  });
});
