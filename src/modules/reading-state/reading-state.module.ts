import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comic, ComicSchema } from '../../database/schemas/comic.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { UserReadingState, UserReadingStateSchema } from '../../database/schemas/user-reading-state.schema';
import { AuthModule } from '../auth/auth.module';
import { ReadingStateController } from './reading-state.controller';
import { ReadingSyncService } from './reading-sync.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserReadingState.name, schema: UserReadingStateSchema },
      { name: Comic.name, schema: ComicSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
  ],
  controllers: [ReadingStateController],
  providers: [ReadingSyncService],
  exports: [ReadingSyncService],
})
export class ReadingStateModule {}
