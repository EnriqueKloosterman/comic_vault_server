import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_ENV = 'ENCRYPTION_KEY_AES256';

/**
 * AES-256-GCM para refresh_tokens (RF-02).
 * Formato: `iv:ciphertext:tag`, todo base64, IV único (12B) por registro.
 * La clave se acepta como: 64 hex chars, base64 de 32B, o string de 32 chars.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private key: Buffer;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.key = EncryptionService.resolveKey(this.config.getOrThrow<string>(KEY_ENV));
  }

  static resolveKey(raw: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    if (raw.length === 32) return Buffer.from(raw, 'utf8');
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
    throw new Error(`${KEY_ENV} must decode to 32 bytes (hex64, base64-of-32B, or 32 chars)`);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, ctB64, tagB64] = payload.split(':');
    if (!ivB64 || !ctB64 || !tagB64) throw new Error('Malformed encrypted payload');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(ctB64, 'base64'), undefined, 'utf8') + decipher.final('utf8');
  }
}

@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
