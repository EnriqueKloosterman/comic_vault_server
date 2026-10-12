import { Readable } from 'stream';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { Comic } from '../../database/schemas/comic.schema';
import { User } from '../../database/schemas/user.schema';
import {
  ComicAccessDeniedException,
  CoverNotFoundException,
  ReaderStreamService,
  contentTypeFor,
} from './reader-stream.service';
import { PageOutOfBoundsException } from '../archive-extractor/adapters/secure-archive-extractor.adapter';

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_ID = '507f1f77bcf86cd799439012';
const COMIC_ID = '507f1f77bcf86cd799439099';

function comicDoc(over: Partial<Record<string, unknown>> = {}) {
  return {
    _id: COMIC_ID,
    userId: USER_ID,
    googleDriveFileId: 'driveA',
    title: 'T',
    series: 'S',
    issueNumber: 1,
    pageCount: 2,
    internalPages: ['p1.jpg', 'p2.png'],
    coverCachePath: null,
    ...over,
  };
}

describe('ReaderStreamService', () => {
  const findById = jest.fn();
  const comicModel = { findById } as unknown as Model<Comic>;
  const userModel = { findById: jest.fn() } as unknown as Model<User>;
  const config = {} as ConfigService;
  const encryption = {} as EncryptionService;

  const cache = {
    getLocalPath: jest.fn(),
    setFromStream: jest.fn(),
    has: jest.fn(),
    evictOldestIfNeeded: jest.fn(),
  };
  const extractor = {
    getManifest: jest.fn(),
    extractPage: jest.fn(),
    generateCoverThumbnail: jest.fn(),
  };
  const storage = {
    setCredentials: jest.fn(),
    listSupportedArchives: jest.fn(),
    downloadFileStream: jest.fn(),
  };

  function service() {
    const svc = new ReaderStreamService(comicModel, userModel, config, encryption, cache as never, extractor as never);
    (svc as unknown as { createStorage: () => unknown }).createStorage = () => storage;
    return svc;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockReturnValue({ exec: async () => comicDoc() });
    (userModel.findById as jest.Mock).mockReturnValue({
      exec: async () => ({ _id: USER_ID, encryptedRefreshToken: 'enc' }),
    });
    (cache.getLocalPath as jest.Mock).mockResolvedValue('/cache/driveA.bin');
    (extractor.extractPage as jest.Mock).mockImplementation(async (_p: string, i: number) =>
      Readable.from([Buffer.from(`page${i}`)]),
    );
  });

  it('cache-hit: no descarga de Drive y Content-Type por extensión', async () => {
    const svc = service();
    const jpg = await svc.getPageStream(USER_ID, COMIC_ID, 0);
    expect(jpg.contentType).toBe('image/jpeg');
    expect(storage.downloadFileStream).not.toHaveBeenCalled();

    const png = await svc.getPageStream(USER_ID, COMIC_ID, 1);
    expect(png.contentType).toBe('image/png');
  });

  it('cache-miss: descarga y guarda en cache', async () => {
    (cache.getLocalPath as jest.Mock).mockResolvedValue(null);
    (storage.downloadFileStream as jest.Mock).mockResolvedValue(Readable.from([Buffer.from('x')]));
    (cache.setFromStream as jest.Mock).mockResolvedValue('/cache/driveA.bin');

    await service().getPageStream(USER_ID, COMIC_ID, 0);
    expect(storage.setCredentials).toHaveBeenCalledWith('enc');
    expect(cache.setFromStream).toHaveBeenCalledWith('driveA', expect.anything());
  });

  it('otro usuario o comic inexistente → 403 COMIC_ACCESS_DENIED', async () => {
    const svc = service();
    const errOther = await svc.getPageStream(OTHER_ID, COMIC_ID, 0).catch((e: unknown) => e);
    expect(errOther).toBeInstanceOf(ComicAccessDeniedException);
    expect((errOther as ComicAccessDeniedException).getResponse()).toMatchObject({ code: 'COMIC_ACCESS_DENIED' });

    findById.mockReturnValue({ exec: async () => null });
    const errMissing = await svc.getPageStream(USER_ID, COMIC_ID, 0).catch((e: unknown) => e);
    expect((errMissing as ComicAccessDeniedException).getResponse()).toMatchObject({ code: 'COMIC_ACCESS_DENIED' });

    const errManifest = await svc.getManifest(OTHER_ID, COMIC_ID).catch((e: unknown) => e);
    expect((errManifest as ComicAccessDeniedException).getResponse()).toMatchObject({ code: 'COMIC_ACCESS_DENIED' });
  });

  it('índice fuera de rango → PAGE_INDEX_OUT_OF_BOUNDS sin tocar Drive', async () => {
    const err = await service().getPageStream(USER_ID, COMIC_ID, 9).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageOutOfBoundsException);
    expect(storage.downloadFileStream).not.toHaveBeenCalled();
  });

  it('manifest no descarga y arma URLs', async () => {
    const m = await service().getManifest(USER_ID, COMIC_ID);
    expect(m).toEqual({
      comicId: COMIC_ID,
      title: 'T',
      series: 'S',
      issueNumber: 1,
      pageCount: 2,
      pages: [
        { index: 0, url: `/api/comics/${COMIC_ID}/pages/0` },
        { index: 1, url: `/api/comics/${COMIC_ID}/pages/1` },
      ],
    });
    expect(cache.getLocalPath).not.toHaveBeenCalled();
  });

  it('cover sin path → COVER_NOT_FOUND', async () => {
    const err = await service().getCoverStream(USER_ID, COMIC_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoverNotFoundException);
  });

  it('contentTypeFor mapea extensiones', () => {
    expect(contentTypeFor('a.JPG')).toBe('image/jpeg');
    expect(contentTypeFor('a.webp')).toBe('image/webp');
    expect(contentTypeFor('a.tiff')).toBe('application/octet-stream');
  });
});
