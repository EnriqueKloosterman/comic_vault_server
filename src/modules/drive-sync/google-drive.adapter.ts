import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import { EncryptionService } from '../../core/encryption/encryption.service';
import { IStorageProvider, RemoteFileMeta } from '../../core/interfaces/storage-provider.interface';

const SUPPORTED_EXT = ['.cbz', '.cbr'];
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;

function isRetryable(err: unknown): boolean {
  const status = (err as { code?: number; response?: { status?: number } })?.code;
  const http = (err as { response?: { status?: number } })?.response?.status;
  return status === 429 || http === 429 || (http !== undefined && http >= 500);
}

/**
 * Adaptador Google Drive (RF-03). Instancia por sincronización (no singleton
 * compartido): guarda el OAuth2 client del usuario en curso.
 * Construir con `new GoogleDriveAdapter(config, encryption)` + `setCredentials()`.
 */
@Injectable()
export class GoogleDriveAdapter implements IStorageProvider {
  private readonly logger = new Logger(GoogleDriveAdapter.name);
  private oauth: InstanceType<typeof google.auth.OAuth2> | null = null;
  private drive: drive_v3.Drive | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  setCredentials(encryptedRefreshToken: string): void {
    const oauth = new google.auth.OAuth2(
      this.config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      this.config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
    );
    oauth.setCredentials({ refresh_token: this.encryption.decrypt(encryptedRefreshToken) });
    this.oauth = oauth;
    this.drive = google.drive({ version: 'v3', auth: oauth });
  }

  private client(): drive_v3.Drive {
    if (!this.drive) throw new Error('GoogleDriveAdapter: setCredentials() not called');
    return this.drive;
  }

  async listSupportedArchives(): Promise<RemoteFileMeta[]> {
    const out: RemoteFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.withRetry(() =>
        this.client().files.list({
          q: `trashed = false and (name contains '.cbz' or name contains '.cbr')`,
          fields: 'files(id, name, size, modifiedTime), nextPageToken',
          pageSize: 100,
          pageToken,
        }),
      );
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name) continue;
        const lower = f.name.toLowerCase();
        if (!SUPPORTED_EXT.some((ext) => lower.endsWith(ext))) continue;
        out.push({
          fileId: f.id,
          filename: f.name,
          size: Number(f.size ?? 0),
          lastModified: f.modifiedTime ? new Date(f.modifiedTime) : new Date(),
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async downloadFileStream(fileId: string): Promise<Readable> {
    const res = await this.withRetry(() =>
      this.client().files.get({ fileId, alt: 'media' }, { responseType: 'stream' }),
    );
    return res.data as unknown as Readable;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (isInvalidGrant(err)) {
          throw new UnauthorizedException({
            message: 'Google refresh token revoked or expired',
            error: 'Unauthorized',
            code: 'GOOGLE_TOKEN_EXPIRED',
          });
        }
        if (isScopeInsufficient(err)) {
          throw new ForbiddenException({
            message: 'Google grant lacks Drive access: log in again and tick the Drive checkbox',
            error: 'Forbidden',
            code: 'DRIVE_SCOPE_INSUFFICIENT',
          });
        }
        if (!isRetryable(err) || attempt >= MAX_RETRIES) throw err;
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 250;
        this.logger.warn(`Drive rate limit, retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay)}ms`);
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }
  }
}

function isScopeInsufficient(err: unknown): boolean {
  const e = err as {
    code?: number;
    errors?: { reason?: string }[];
    message?: string;
    response?: { data?: { error?: { errors?: { reason?: string }[] } } };
  };
  if (e?.code !== 403) return false;
  const reasons = [...(e.errors ?? []), ...(e.response?.data?.error?.errors ?? [])];
  return (
    reasons.some((x) => x?.reason === 'insufficientPermissions') ||
    (typeof e.message === 'string' && e.message.includes('insufficient authentication scopes'))
  );
}

function isInvalidGrant(err: unknown): boolean {
  const e = err as { code?: number; message?: string; response?: { data?: { error?: string } } };
  return (
    e?.code === 401 ||
    e?.response?.data?.error === 'invalid_grant' ||
    (typeof e?.message === 'string' && e.message.includes('invalid_grant'))
  );
}
