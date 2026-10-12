import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import * as path from 'path';

export const MAX_UNCOMPRESSED_PAGE_SIZE = 50 * 1024 * 1024; // 50 MB (Zip Bomb)
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export class ZipSlipException extends BadRequestException {
  constructor(detail = 'Intento de Zip Slip detectado en la cabecera del archivo') {
    super({ message: detail, error: 'SecurityException', code: 'SECURITY_ZIP_SLIP_DETECTED' });
  }
}

export class ZipBombException extends PayloadTooLargeException {
  constructor(detail = 'Posible Zip Bomb detectada: imagen supera 50 MB') {
    super({ message: detail, error: 'PayloadTooLarge', code: 'ZIP_BOMB_DETECTED' });
  }
}

export function assertSafePath(targetDirectory: string, filename: string): string {
  const resolvedPath = path.resolve(targetDirectory, filename);
  if (!resolvedPath.startsWith(path.resolve(targetDirectory) + path.sep)) {
    throw new ZipSlipException();
  }
  return resolvedPath;
}

export function isSafeImageEntry(entryName: string, uncompressedSize: number): boolean {
  if (uncompressedSize > MAX_UNCOMPRESSED_PAGE_SIZE) {
    throw new ZipBombException();
  }
  const ext = path.extname(entryName).toLowerCase();
  const isSystemGarbage =
    entryName.includes('__MACOSX') || entryName.includes('.DS_Store') || entryName.includes('Thumbs.db');
  return ALLOWED_EXTENSIONS.has(ext) && !isSystemGarbage;
}
