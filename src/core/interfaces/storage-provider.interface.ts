import { Readable } from 'stream';

export interface RemoteFileMeta {
  fileId: string;
  filename: string;
  size: number;
  lastModified: Date;
}

export const I_STORAGE_PROVIDER = Symbol('IStorageProvider');

export interface IStorageProvider {
  setCredentials(encryptedRefreshToken: string): void;
  listSupportedArchives(): Promise<RemoteFileMeta[]>;
  downloadFileStream(fileId: string): Promise<Readable>;
}
