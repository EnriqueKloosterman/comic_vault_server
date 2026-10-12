import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { Comic } from '../../database/schemas/comic.schema';
import { User } from '../../database/schemas/user.schema';
import { SecureArchiveExtractorAdapter } from '../archive-extractor/adapters/secure-archive-extractor.adapter';
import { ReadingSyncService } from '../reading-state/reading-sync.service';
import { DriveSyncService } from './drive-sync.service';
import { ZipEntryInput, buildStoredZip, makeTestPng } from '../../../test/zip-fixtures';

const USER_ID = '507f1f77bcf86cd799439011';

describe('DriveSyncService', () => {
  let dir: string;
  let tempDir: string;
  let coverDir: string;
  let img: Buffer;
  const created: Record<string, unknown>[] = [];

  const fixtures = new Map<string, Buffer>();

  const comicModel = {
    find: jest.fn(),
    create: jest.fn(async (dto: unknown) => {
      const doc = { ...(dto as object) };
      created.push(doc);
      return doc;
    }),
    updateOne: jest.fn(() => ({ exec: async () => ({ modifiedCount: 1 }) })),
    updateMany: jest.fn(() => ({ exec: async () => ({ modifiedCount: 1 }) })),
  } as unknown as Model<Comic>;

  const userModel = {
    findById: jest.fn(() => ({
      exec: async () => ({ _id: USER_ID, encryptedRefreshToken: 'enc:rt' }),
    })),
  } as unknown as Model<User>;

  const config = {
    get: (key: string) => (key === 'TEMP_DIR' ? tempDir : key === 'TEMP_COVER_DIR' ? coverDir : undefined),
  } as unknown as ConfigService;

  const encryption = {} as EncryptionService;

  const mockStorage = {
    setCredentials: jest.fn(),
    listSupportedArchives: jest.fn(async () => [
      { fileId: 'A', filename: 'Eternauta.cbz', size: 100, lastModified: new Date() },
      { fileId: 'B', filename: 'Saga 12.cbz', size: 100, lastModified: new Date() },
      { fileId: 'C', filename: 'random_file.cbz', size: 100, lastModified: new Date() },
    ]),
    downloadFileStream: jest.fn(async (fileId: string) => Readable.from(fixtures.get(fileId)!)),
  };

  const reading = { purgeOrphans: jest.fn(async () => 0) } as unknown as ReadingSyncService;

  async function service() {
    const svc = new DriveSyncService(
      comicModel,
      userModel,
      config,
      encryption,
      new SecureArchiveExtractorAdapter(),
      reading,
    );
    (svc as unknown as { createStorage: () => unknown }).createStorage = () => mockStorage;
    return svc;
  }

  function comicDocs() {
    return (comicModel.find as jest.Mock).mock.calls.length
      ? created.filter((c) => (c as { googleDriveFileId: string }).googleDriveFileId)
      : created;
  }

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cvs-'));
    tempDir = path.join(dir, 'comics');
    coverDir = path.join(dir, 'covers');
    img = await makeTestPng();

    const withMeta: ZipEntryInput[] = [
      { name: 'p10.jpg', data: img },
      { name: 'ComicInfo.xml', data: Buffer.from('<ComicInfo><Series>El Eternauta</Series><Number>1</Number><Title>El Héroe</Title></ComicInfo>') },
      { name: 'p2.jpg', data: img },
      { name: 'p1.jpg', data: img },
    ];
    fixtures.set('A', buildStoredZip(withMeta));
    fixtures.set('B', buildStoredZip([{ name: 'a.jpg', data: img }]));
    fixtures.set('C', buildStoredZip([{ name: 'solo.jpg', data: img }]));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    created.length = 0;
    // clearAllMocks borra implementaciones de create: restaurar
    (comicModel.create as jest.Mock).mockImplementation(async (dto: unknown) => {
      const doc = { ...(dto as object) };
      created.push(doc);
      return doc;
    });
    (userModel.findById as jest.Mock).mockImplementation(() => ({
      exec: async () => ({ _id: USER_ID, encryptedRefreshToken: 'enc:rt' }),
    }));
    (mockStorage.listSupportedArchives as jest.Mock).mockImplementation(async () => [
      { fileId: 'A', filename: 'Eternauta.cbz', size: 100, lastModified: new Date() },
      { fileId: 'B', filename: 'Saga 12.cbz', size: 100, lastModified: new Date() },
      { fileId: 'C', filename: 'random_file.cbz', size: 100, lastModified: new Date() },
    ]);
    (mockStorage.downloadFileStream as jest.Mock).mockImplementation(async (fileId: string) =>
      Readable.from(fixtures.get(fileId)!),
    );
    (comicModel.updateOne as jest.Mock).mockImplementation(() => ({ exec: async () => ({ modifiedCount: 1 }) }));
    (comicModel.updateMany as jest.Mock).mockImplementation(() => ({ exec: async () => ({ modifiedCount: 1 }) }));
    (reading.purgeOrphans as jest.Mock).mockResolvedValue(0);
  });

  it('indexa 3 archivos: ComicInfo, regex y fallback', async () => {
    (comicModel.find as jest.Mock).mockReturnValue({ exec: async () => [] });
    const summary = await (await service()).syncLibrary(USER_ID);

    expect(summary).toEqual({ added: 3, kept: 0, archived: 0 });
    expect(created).toHaveLength(3);

    const byId = Object.fromEntries(created.map((c) => [(c as { googleDriveFileId: string }).googleDriveFileId, c])) as Record<string, Record<string, unknown>>;
    expect(byId.A).toMatchObject({ series: 'El Eternauta', issueNumber: 1, title: 'El Héroe', pageCount: 3 });
    expect((byId.A.internalPages as string[])).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
    expect(byId.B).toMatchObject({ series: 'Saga', issueNumber: 12 });
    expect(byId.C).toMatchObject({ series: 'Sin Clasificar', issueNumber: 1 });

    for (const id of ['A', 'B', 'C']) {
      const cover = byId[id].coverCachePath as string;
      expect(cover).toContain('.webp');
      expect(fs.existsSync(cover)).toBe(true);
      expect(fs.existsSync(path.join(tempDir, `${id}.bin`))).toBe(false); // temp limpio
    }
  });

  it('re-sync no duplica (idempotente)', async () => {
    (comicModel.find as jest.Mock).mockReturnValue({
      exec: async () => ['A', 'B', 'C'].map((googleDriveFileId) => ({ googleDriveFileId, metadataVersion: 2 })),
    });
    const summary = await (await service()).syncLibrary(USER_ID);
    expect(summary).toEqual({ added: 0, kept: 3, archived: 0 });
    expect(mockStorage.downloadFileStream).not.toHaveBeenCalled();
    expect(comicDocs()).toHaveLength(0);
  });

  it('huérfanos se purgan vía ReadingSyncService y cuentan como archived', async () => {
    (comicModel.find as jest.Mock).mockReturnValue({
      exec: async () => [
        { _id: 'db1', googleDriveFileId: 'A', metadataVersion: 2 },
        { _id: 'db-gone', googleDriveFileId: 'GONE', filename: 'gone.cbz', metadataVersion: 2 },
      ],
    });
    (reading.purgeOrphans as jest.Mock).mockResolvedValue(1);
    const summary = await (await service()).syncLibrary(USER_ID);
    expect(reading.purgeOrphans).toHaveBeenCalledWith(
      USER_ID,
      [{ _id: 'db-gone', googleDriveFileId: 'GONE', filename: 'gone.cbz', metadataVersion: 2 }],
    );
    expect(summary).toEqual({ added: 2, kept: 1, archived: 1 });
  });

  it('versión vieja se refresca in-place (mismo _id, sin duplicar)', async () => {
    const stale = {
      _id: 'db1',
      googleDriveFileId: 'A',
      filename: 'Eternauta.cbz',
      metadataVersion: 1,
      series: 'Sin Clasificar',
    };
    (comicModel.find as jest.Mock).mockReturnValue({ exec: async () => [stale] });
    (mockStorage.listSupportedArchives as jest.Mock).mockImplementation(async () => [
      { fileId: 'A', filename: 'Eternauta.cbz', size: 100, lastModified: new Date() },
    ]);
    const summary = await (await service()).syncLibrary(USER_ID);
    expect(summary).toEqual({ added: 0, kept: 1, archived: 0 });
    expect(mockStorage.downloadFileStream).toHaveBeenCalledWith('A');
    expect(comicModel.create).not.toHaveBeenCalled();
    expect(comicModel.updateOne).toHaveBeenCalledWith(
      { _id: 'db1' },
      expect.objectContaining({ $set: expect.objectContaining({ metadataVersion: 2 }) }),
    );
  });
});
