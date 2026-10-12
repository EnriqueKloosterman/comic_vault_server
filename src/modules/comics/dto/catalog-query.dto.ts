import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReadingStatus } from '../../../database/schemas/user-reading-state.schema';

export class CatalogQueryDto {
  @IsOptional()
  @IsEnum(ReadingStatus)
  status?: ReadingStatus;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsString()
  series?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 24;
}

export class UpdateProgressDto {
  @IsInt()
  @Min(0)
  currentPage: number;

  @IsOptional()
  @IsBoolean()
  isRewind?: boolean;
}

export class UpdateFavoriteDto {
  @IsBoolean()
  isFavorite: boolean;
}
