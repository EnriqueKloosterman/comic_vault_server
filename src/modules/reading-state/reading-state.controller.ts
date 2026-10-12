import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, SessionUser } from '../auth/jwt-auth.guard';
import { ReadingSyncService } from './reading-sync.service';

@Controller('reading-history')
@UseGuards(JwtAuthGuard)
export class ReadingStateController {
  constructor(private readonly reading: ReadingSyncService) {}

  @Get()
  history(@CurrentUser() user: SessionUser) {
    return this.reading.readingHistory(user.userId);
  }
}
