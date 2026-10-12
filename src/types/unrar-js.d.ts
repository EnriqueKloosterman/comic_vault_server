// node-unrar-js no publica campo "types": declaraciones mínimas según su dist/index.d.ts.
declare module 'node-unrar-js' {
  export interface RarFileHeader {
    name: string;
    flags: { encrypted: boolean; solid: boolean; directory: boolean };
    packSize: number;
    unpSize: number;
  }
  export interface RarArcFile {
    fileHeader: RarFileHeader;
    extraction?: Uint8Array;
  }
  export interface RarExtractor {
    getFileList(): { fileHeaders: Generator<RarFileHeader> };
    extract(opts?: { files?: string[] | ((h: RarFileHeader) => boolean); password?: string }): {
      files: Generator<RarArcFile>;
    };
  }
  export function createExtractorFromFile(opts: { filepath: string; password?: string }): Promise<RarExtractor>;
  export function createExtractorFromData(opts: { data: ArrayBuffer; password?: string }): Promise<RarExtractor>;
}
