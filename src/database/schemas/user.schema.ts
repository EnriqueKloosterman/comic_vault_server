import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true, unique: true, index: true })
  googleId: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  displayName: string;

  @Prop()
  avatarUrl: string;

  @Prop({ required: true })
  encryptedRefreshToken: string;

  @Prop({ default: null })
  driveFolderId: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
