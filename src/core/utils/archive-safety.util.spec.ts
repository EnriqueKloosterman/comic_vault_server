import { ZipSlipException, assertSafePath, isSafeImageEntry } from './archive-safety.util';

describe('archive-safety', () => {
  describe('assertSafePath', () => {
    it('acepta rutas internas normales', () => {
      const out = assertSafePath('/temp/x', 'ch/p01.jpg');
      expect(out.endsWith('p01.jpg')).toBe(true);
    });

    it('rechaza traversal ../ con SECURITY_ZIP_SLIP_DETECTED', () => {
      const err = (() => {
        try {
          assertSafePath('/temp/x', '../evil.jpg');
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(ZipSlipException);
      expect((err as ZipSlipException).getResponse()).toMatchObject({
        code: 'SECURITY_ZIP_SLIP_DETECTED',
      });
    });

    it('rechaza path absoluto fuera del target', () => {
      expect(() => assertSafePath('/temp/x', '/etc/passwd')).toThrow(ZipSlipException);
    });
  });

  describe('isSafeImageEntry', () => {
    it('acepta jpg/png/webp dentro del límite', () => {
      expect(isSafeImageEntry('a.JPG', 100)).toBe(true);
      expect(isSafeImageEntry('a.webp', 100)).toBe(true);
    });

    it('rechaza extensiones no imagen y basura de sistema', () => {
      expect(isSafeImageEntry('a.txt', 100)).toBe(false);
      expect(isSafeImageEntry('__MACOSX/a.jpg', 100)).toBe(false);
      expect(isSafeImageEntry('.DS_Store', 100)).toBe(false);
    });

    it('imagen >50MB lanza ZIP_BOMB_DETECTED', () => {
      const err = (() => {
        try {
          isSafeImageEntry('big.jpg', 51 * 1024 * 1024);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect((err as Error & { getResponse(): unknown }).getResponse()).toMatchObject({
        code: 'ZIP_BOMB_DETECTED',
      });
    });
  });
});
