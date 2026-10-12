import { Module } from '@nestjs/common';
import { I_CACHE_MANAGER } from '../../core/interfaces/cache-manager.interface';
import { LocalLRUDiskAdapter } from './local-lru-disk.adapter';

@Module({
  providers: [LocalLRUDiskAdapter, { provide: I_CACHE_MANAGER, useExisting: LocalLRUDiskAdapter }],
  exports: [I_CACHE_MANAGER, LocalLRUDiskAdapter],
})
export class TempCacheModule {}
