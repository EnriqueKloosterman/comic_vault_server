import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, SessionUser } from '../auth/jwt-auth.guard';
import { DriveSyncService } from './drive-sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: DriveSyncService) {}

  @Post('drive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  syncDrive(@CurrentUser() user: SessionUser) {
    return this.sync.syncLibrary(user.userId);
  }
}
