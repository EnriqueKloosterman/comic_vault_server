import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comic, ComicSchema } from '../../database/schemas/comic.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { I_ARCHIVE_EXTRACTOR } from '../../core/interfaces/archive-extractor.interface';
import { SecureArchiveExtractorAdapter } from '../archive-extractor/adapters/secure-archive-extractor.adapter';
import { AuthModule } from '../auth/auth.module';
import { ReadingStateModule } from '../reading-state/reading-state.module';
import { DriveSyncService } from './drive-sync.service';
import { SyncController } from './sync.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Comic.name, schema: ComicSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    ReadingStateModule,
  ],
  controllers: [SyncController],
  providers: [
    DriveSyncService,
    SecureArchiveExtractorAdapter,
    { provide: I_ARCHIVE_EXTRACTOR, useExisting: SecureArchiveExtractorAdapter },
  ],
  exports: [DriveSyncService],
})
export class DriveSyncModule {}
