import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { EncryptionService } from '../../core/encryption/encryption.service';

describe('AuthService', () => {
  const save = jest.fn();
  const findOne = jest.fn();

  async function service() {
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken('User'), useValue: { findOne } },
        { provide: EncryptionService, useValue: { encrypt: (s: string) => `enc:${s}` } },
        { provide: JwtService, useValue: { signAsync: async () => 'signed-jwt' } },
      ],
    }).compile();
    return mod.get(AuthService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    save.mockResolvedValue(undefined);
  });

  it('crea usuario cifrando refresh_token y firma JWT', async () => {
    findOne.mockReturnValue({ exec: async () => null });
    const Model = jest.fn().mockImplementation((dto) => ({ ...dto, _id: 'u1', save }));
    (Model as unknown as Record<string, unknown>).findOne = findOne;
    const s = await service();
    (s as unknown as Record<string, unknown>).userModel = Model;

    const { jwt } = await s.loginOrCreate({
      googleId: 'g1',
      email: 'a@b.c',
      displayName: 'A',
      refreshToken: 'rt',
    });

    expect(jwt).toBe('signed-jwt');
    expect(Model.mock.results[0].value).toMatchObject({ encryptedRefreshToken: 'enc:rt' });
    expect(save).toHaveBeenCalled();
  });

  it('reutiliza token guardado si Google no devuelve refresh_token', async () => {
    const existing = { _id: 'u1', encryptedRefreshToken: 'enc:old', save };
    findOne.mockReturnValue({ exec: async () => existing });
    const s = await service();

    await s.loginOrCreate({ googleId: 'g1', email: 'a@b.c', displayName: 'A' });
    expect(save).toHaveBeenCalled();
    expect(existing.encryptedRefreshToken).toBe('enc:old');
  });

  it('sin refresh nuevo ni guardado → 401 GOOGLE_TOKEN_EXPIRED', async () => {
    findOne.mockReturnValue({ exec: async () => null });
    const Model = jest.fn().mockImplementation((dto) => ({ ...dto, _id: 'u1', save }));
    (Model as unknown as Record<string, unknown>).findOne = findOne;
    const s = await service();
    (s as unknown as Record<string, unknown>).userModel = Model;

    const err = await s
      .loginOrCreate({ googleId: 'g1', email: 'a@b.c', displayName: 'A' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'GOOGLE_TOKEN_EXPIRED' });
  });
});
