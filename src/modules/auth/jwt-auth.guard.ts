import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../database/schemas/user.schema';
import { SESSION_COOKIE } from './session';

export interface SessionUser {
  userId: string;
  email: string;
}

function unauthorized(message: string): UnauthorizedException {
  return new UnauthorizedException({ message, error: 'Unauthorized', code: 'UNAUTHORIZED' });
}

/**
 * Sesión JWT: acepta cookie HttpOnly `cv_session` (web) o `Authorization: Bearer` (móvil).
 * No usa passport-jwt a propósito: control total del error RFC7807.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token: string | undefined =
      JwtAuthGuard.cookie(req.headers?.cookie, SESSION_COOKIE) ??
      JwtAuthGuard.bearer(req.headers?.authorization);
    if (!token) throw unauthorized('Missing session');

    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw unauthorized('Invalid or expired session');
    }

    const user = await this.userModel.findById(payload.sub).exec();
    if (!user) throw unauthorized('Session user no longer exists');

    req.user = { userId: String(user._id), email: user.email } satisfies SessionUser;
    return true;
  }

  private static bearer(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : undefined;
  }

  private static cookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    const found = header
      .split(';')
      .map((p) => p.trim().split('='))
      .find(([k]) => k === name);
    return found?.[1] ? decodeURIComponent(found[1]) : undefined;
  }
}
