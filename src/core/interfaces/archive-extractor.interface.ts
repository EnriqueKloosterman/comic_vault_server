import { Readable } from 'stream';

export interface ParsedComicMetadata {
  title?: string;
  series?: string;
  issueNumber?: number;
  writer?: string;
  year?: number;
}

export interface ArchiveManifest {
  pageCount: number;
  internalPages: string[];
  metadata?: ParsedComicMetadata;
}

export const I_ARCHIVE_EXTRACTOR = Symbol('IArchiveExtractor');

export interface IArchiveExtractor {
  getManifest(filePath: string): Promise<ArchiveManifest>;
  extractPage(filePath: string, pageIndex: number): Promise<Readable>;
  generateCoverThumbnail(filePath: string, destinationPath: string): Promise<void>;
}
