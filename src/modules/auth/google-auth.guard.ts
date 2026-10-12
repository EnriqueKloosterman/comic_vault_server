import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    return {
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly'],
      accessType: 'offline',
      prompt: 'consent',
      state: (req.query?.next as string) ?? undefined,
    };
  }
}
