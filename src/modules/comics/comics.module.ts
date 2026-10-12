import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comic, ComicSchema } from '../../database/schemas/comic.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { I_ARCHIVE_EXTRACTOR } from '../../core/interfaces/archive-extractor.interface';
import { SecureArchiveExtractorAdapter } from '../archive-extractor/adapters/secure-archive-extractor.adapter';
import { AuthModule } from '../auth/auth.module';
import { TempCacheModule } from '../temp-cache/temp-cache.module';
import { ReadingStateModule } from '../reading-state/reading-state.module';
import { CatalogService } from './catalog.service';
import { ComicsController } from './comics.controller';
import { ReaderStreamService } from './reader-stream.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Comic.name, schema: ComicSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    TempCacheModule,
    ReadingStateModule,
  ],
  controllers: [ComicsController],
  providers: [
    ReaderStreamService,
    CatalogService,
    SecureArchiveExtractorAdapter,
    { provide: I_ARCHIVE_EXTRACTOR, useExisting: SecureArchiveExtractorAdapter },
  ],
  exports: [ReaderStreamService],
})
export class ComicsModule {}
