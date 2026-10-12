import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { SessionUser } from './jwt-auth.guard';
import { SESSION_COOKIE, SESSION_TTL_MS } from './session';
import { GoogleProfile } from './google.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions() {
    const isProd = this.config.get('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: isProd,
      maxAge: SESSION_TTL_MS,
      path: '/',
    };
  }

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleLogin(): void {
    // Passport redirige a Google.
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request & { user: GoogleProfile }, @Res() res: Response): Promise<void> {
    const { jwt, user } = await this.auth.loginOrCreate(req.user);
    res.cookie(SESSION_COOKIE, jwt, this.cookieOptions());
    // ?format=json para clientes no-web; browsers redirigen al frontend.
    if ((req.query as Record<string, string>)?.format === 'json') {
      res.json({
        userId: String(user._id),
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
      });
      return;
    }
    const frontend = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    res.redirect(`${frontend}/?login=ok`);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: SessionUser) {
    return user;
  }
}
