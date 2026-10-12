import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { LocalLRUDiskAdapter } from './local-lru-disk.adapter';

function adapter(maxFiles = 15, maxSizeBytes = 150 * 1024 * 1024, dir?: string) {
  const tempDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cvc-'));
  const config = { get: (key: string) => (key === 'TEMP_DIR' ? tempDir : key === 'MAX_CACHE_FILES' ? maxFiles : key === 'MAX_CACHE_SIZE_BYTES' ? maxSizeBytes : undefined) } as unknown as ConfigService;
  return { svc: new LocalLRUDiskAdapter(config), tempDir };
}

function streamOf(bytes: Buffer): Readable {
  return Readable.from([bytes]);
}

describe('LocalLRUDiskAdapter', () => {
  it('set + has + get roundtrip con extensión .bin', async () => {
    const { svc, tempDir } = adapter();
    const p = await svc.setFromStream('f1', streamOf(Buffer.from('hello')));
    expect(p).toBe(path.join(tempDir, 'f1.bin'));
    expect(await svc.has('f1')).toBe(true);
    expect(await svc.getLocalPath('f1')).toBe(p);
    expect(await svc.getLocalPath('missing')).toBeNull();
  });

  it('expulsa el más viejo por conteo (touch protege)', async () => {
    const { svc } = adapter(2);
    await svc.setFromStream('a', streamOf(Buffer.alloc(10)));
    await svc.setFromStream('b', streamOf(Buffer.alloc(10)));
    await svc.getLocalPath('a'); // touch: a pasa a ser más reciente
    await svc.setFromStream('c', streamOf(Buffer.alloc(10)));
    expect(await svc.has('a')).toBe(true);
    expect(await svc.has('c')).toBe(true);
    expect(await svc.has('b')).toBe(false);
  });

  it('expulsa por bytes y borra de disco', async () => {
    const { svc, tempDir } = adapter(15, 25);
    await svc.setFromStream('a', streamOf(Buffer.alloc(10)));
    await svc.setFromStream('b', streamOf(Buffer.alloc(10)));
    await svc.setFromStream('c', streamOf(Buffer.alloc(10))); // 30 > 25 → evict a
    expect(await svc.has('a')).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'a.bin'))).toBe(false);
    expect(await svc.has('b')).toBe(true);
    expect(await svc.has('c')).toBe(true);
  });

  it('descargas concurrentes del mismo fileId comparten una sola escritura', async () => {
    const { svc } = adapter();
    let writes = 0;
    const slow = () =>
      new Readable({
        read() {
          writes++;
          setTimeout(() => {
            this.push(Buffer.from('x'));
            this.push(null);
          }, 50);
        },
      });
    const [p1, p2, p3] = await Promise.all([
      svc.setFromStream('same', slow()),
      svc.setFromStream('same', slow()),
      svc.setFromStream('same', slow()),
    ]);
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(writes).toBe(1);
  });

  it('stream con error no deja archivo parcial', async () => {
    const { svc, tempDir } = adapter();
    const bad = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    await expect(svc.setFromStream('bad', bad)).rejects.toThrow('boom');
    expect(fs.existsSync(path.join(tempDir, 'bad.bin'))).toBe(false);
    expect(await svc.has('bad')).toBe(false);
  });

  it('bootstrap reconstruye índice ordenado por mtime y expulsa excedente', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvc-boot-'));
    await fs.promises.writeFile(path.join(tempDir, 'old.bin'), Buffer.alloc(10));
    await new Promise((r) => setTimeout(r, 20));
    await fs.promises.writeFile(path.join(tempDir, 'new.bin'), Buffer.alloc(10));

    const { svc } = adapter(1, 150 * 1024 * 1024, tempDir);
    await svc.onApplicationBootstrap();
    // Límite 1 archivo: sobrevive el más reciente.
    expect(await svc.has('new')).toBe(true);
    expect(await svc.has('old')).toBe(false);
  });
});
