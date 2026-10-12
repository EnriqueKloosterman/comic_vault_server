import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas/user.schema';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { GoogleProfile } from './google.strategy';
import { SessionPayload } from './session';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly encryption: EncryptionService,
    private readonly jwt: JwtService,
  ) {}

  async loginOrCreate(profile: GoogleProfile): Promise<{ jwt: string; user: User }> {
    const existing = await this.userModel.findOne({ googleId: profile.googleId }).exec();

    let encryptedRefreshToken = existing?.encryptedRefreshToken;
    if (profile.refreshToken) {
      encryptedRefreshToken = this.encryption.encrypt(profile.refreshToken);
    }
    if (!encryptedRefreshToken) {
      // Re-login sin refresh_token y sin token guardado: Google lo revocó o no dio consentimiento offline.
      throw new UnauthorizedException({
        message: 'Google refresh token missing or revoked, re-authenticate with consent',
        error: 'Unauthorized',
        code: 'GOOGLE_TOKEN_EXPIRED',
      });
    }

    const user =
      existing ??
      new this.userModel({
        googleId: profile.googleId,
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        driveFolderId: null,
      });
    user.email = profile.email;
    user.displayName = profile.displayName;
    if (profile.avatarUrl) user.avatarUrl = profile.avatarUrl;
    user.encryptedRefreshToken = encryptedRefreshToken;
    await user.save();

    const payload: SessionPayload = { sub: String(user._id), email: user.email };
    return { jwt: await this.jwt.signAsync(payload), user };
  }
}
