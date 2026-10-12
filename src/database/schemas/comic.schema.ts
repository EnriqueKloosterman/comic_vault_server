import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Comic extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, index: true })
  googleDriveFileId: string;

  @Prop({ required: true })
  filename: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true, index: true })
  series: string;

  @Prop({ required: true, default: 1 })
  issueNumber: number;

  @Prop({ default: null })
  writer: string;

  @Prop({ default: null })
  publicationYear: number;

  @Prop({ required: true })
  pageCount: number;

  @Prop({ required: true })
  fileSize: number;

  // Nullable por D2: puede no haber portada legible dentro del archivo.
  @Prop({ default: null })
  coverCachePath: string;

  @Prop({ type: [String], required: true })
  internalPages: string[];

  // Versión del parser de metadatos: el sync reindexa in-place lo viejo (self-heal).
  @Prop({ required: true, default: 1 })
  metadataVersion: number;

  @Prop({ default: Date.now })
  lastSyncedAt: Date;
}

export const ComicSchema = SchemaFactory.createForClass(Comic);
ComicSchema.index({ userId: 1, googleDriveFileId: 1 }, { unique: true });
ComicSchema.index({ userId: 1, series: 1 });
