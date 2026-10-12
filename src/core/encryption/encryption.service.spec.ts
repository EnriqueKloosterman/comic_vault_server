import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

const KEY32 = '12345678901234567890123456789012';

function service(key = KEY32) {
  return new EncryptionService({ getOrThrow: () => key } as unknown as ConfigService);
}

describe('EncryptionService', () => {
  it('roundtrip encrypt/decrypt', () => {
    const s = service();
    s.onModuleInit();
    const ct = s.encrypt('refresh-token-abc');
    expect(ct.split(':')).toHaveLength(3);
    expect(s.decrypt(ct)).toBe('refresh-token-abc');
  });

  it('mismo plaintext produce ciphertext distinto (IV único)', () => {
    const s = service();
    s.onModuleInit();
    expect(s.encrypt('x')).not.toBe(s.encrypt('x'));
  });

  it('tamper en tag o formato inválido lanza', () => {
    const s = service();
    s.onModuleInit();
    const [iv, ct] = s.encrypt('x').split(':');
    expect(() => s.decrypt(`${iv}:${ct}:AAAAAAAAAAAAAAAAAAAAAA==`)).toThrow();
    expect(() => s.decrypt('not-a-payload')).toThrow();
  });

  it('acepta clave hex64 y base64, rechaza clave corta', () => {
    expect(() => EncryptionService.resolveKey('short')).toThrow();
    expect(EncryptionService.resolveKey(Buffer.alloc(32, 7).toString('hex'))).toHaveLength(32);
    expect(EncryptionService.resolveKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32);
  });

  it('se registra como provider global vía TestingModule', async () => {
    const mod = await Test.createTestingModule({
      providers: [{ provide: ConfigService, useValue: { getOrThrow: () => KEY32 } }, EncryptionService],
    }).compile();
    const s = mod.get(EncryptionService);
    s.onModuleInit();
    expect(s.decrypt(s.encrypt('ok'))).toBe('ok');
  });
});
