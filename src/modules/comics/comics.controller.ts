import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, SessionUser } from '../auth/jwt-auth.guard';
import { ReadingSyncService } from '../reading-state/reading-sync.service';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto, UpdateFavoriteDto, UpdateProgressDto } from './dto/catalog-query.dto';
import { ReaderStreamService } from './reader-stream.service';

const IMMUTABLE = 'public, max-age=31536000, immutable';

@Controller('comics')
@UseGuards(JwtAuthGuard)
export class ComicsController {
  constructor(
    private readonly reader: ReaderStreamService,
    private readonly catalog: CatalogService,
    private readonly reading: ReadingSyncService,
  ) {}

  @Get()
  list(@Query() query: CatalogQueryDto, @CurrentUser() user: SessionUser) {
    return this.catalog.list(user.userId, query);
  }

  @Patch(':id/progress')
  progress(
    @Param('id') id: string,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.reading.reconcileProgress(user.userId, {
      comicId: id,
      currentPage: dto.currentPage,
      isRewind: dto.isRewind,
    });
  }

  @Patch(':id/favorite')
  favorite(
    @Param('id') id: string,
    @Body() dto: UpdateFavoriteDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.reading.setFavorite(user.userId, id, dto.isFavorite);
  }

  @Get(':id/manifest')
  manifest(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.reader.getManifest(user.userId, id);
  }

  @Get(':id/pages/:pageIndex')
  async page(
    @Param('id') id: string,
    @Param('pageIndex', ParseIntPipe) pageIndex: number,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, contentType } = await this.reader.getPageStream(user.userId, id, pageIndex);
    res.set({ 'Content-Type': contentType, 'Cache-Control': IMMUTABLE });
    return new StreamableFile(stream);
  }

  @Get(':id/cover')
  async cover(
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, contentType } = await this.reader.getCoverStream(user.userId, id);
    res.set({ 'Content-Type': contentType, 'Cache-Control': IMMUTABLE });
    return new StreamableFile(stream);
  }
}
