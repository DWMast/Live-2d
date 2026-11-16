/** Minimal typings for the subset of pngjs this server uses. */
declare module 'pngjs' {
  export interface PNGOptions {
    width: number;
    height: number;
    fill?: boolean;
    colorType?: number;
    inputHasAlpha?: boolean;
  }

  export class PNG {
    constructor(options?: PNGOptions);
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer, options?: PNGOptions): PNG;
      write(png: PNG, options?: Record<string, unknown>): Buffer;
    };
  }
}
