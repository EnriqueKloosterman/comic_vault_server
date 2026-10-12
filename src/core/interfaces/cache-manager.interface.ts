import { Readable } from 'stream';

export const I_CACHE_MANAGER = Symbol('ICacheManager');

export interface ICacheManager {
  has(fileId: string): Promise<boolean>;
  getLocalPath(fileId: string): Promise<string | null>;
  setFromStream(fileId: string, stream: Readable): Promise<string>;
  evictOldestIfNeeded(): Promise<void>;
}
