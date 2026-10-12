import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum ReadingStatus {
  UNREAD = 'unread',
  READING = 'reading',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

@Schema({ timestamps: true })
export class UserReadingState extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  // String(comic._id): sobrevive al hard-delete del Comic (RNF-05).
  @Prop({ required: true, index: true })
  originalComicId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  series: string;

  @Prop({ required: true })
  issueNumber: number;

  @Prop({ type: String, enum: ReadingStatus, default: ReadingStatus.UNREAD, index: true })
  status: ReadingStatus;

  @Prop({ required: true, default: 0 })
  currentPage: number;

  @Prop({ required: true, default: 0 })
  progressPercentage: number;

  @Prop({ required: true, default: false, index: true })
  isFavorite: boolean;

  @Prop({ default: null })
  lastReadAt: Date;

  @Prop({ default: null })
  completedAt: Date;
}

export const UserReadingStateSchema = SchemaFactory.createForClass(UserReadingState);
UserReadingStateSchema.index({ userId: 1, originalComicId: 1 }, { unique: true });
