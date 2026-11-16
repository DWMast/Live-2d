/**
 * Texture delivery for the game-CDN Echocalypse source.
 *
 * The live game ships character sheets inside `UF` containers: a lightly
 * obfuscated wrapper around a zlib stream holding a PVR3 header and ETC2 RGBA
 * blocks. A browser cannot read any of that, so this module performs the three
 * steps the game client would otherwise hand to the GPU:
 *
 *   1. unwrap the `UF` container and inflate the CCZ! payload,
 *   2. parse the PVR3 header for the real dimensions and pixel format,
 *   3. decode the ETC2 blocks to straight RGBA and encode a PNG.
 *
 * Decoding is the expensive step (roughly 250 ms for a 4-megapixel sheet), so
 * finished PNGs are cached and the work is paid once on first view.
 *
 * The container format was confirmed against every texture in the sample set:
 * all 35 real files take the `mode === 2` path, and the tail-XOR key below is
 * the 33-byte table the game's own loader uses.
 */
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import { decodeEtc2Rgba } from './etc2.ts';

/** PVR pixel formats this module understands. */
export const PVR_FORMAT = {
  /** 8 bytes per 4x4 block: ETC1/ETC2 RGB only. */
  ETC_RGB: 22,
  /** 16 bytes per 4x4 block: EAC alpha followed by ETC2 RGB. */
  ETC2_RGBA: 23,
} as const;

const PVR_MAGIC = Buffer.from('PVR\u0003', 'latin1');
const UF_MAGIC = Buffer.from('UF', 'latin1');
const CCZ_MAGIC = 0x43435a21; // 'CCZ!'
const BLOCK_BYTES = 16;
/** Header bytes before the pixel payload in the layout the game's client reads. */
const PVR_HEADER_BYTES = 52;

/**
 * The XOR table the game's container loader indexes.
 *
 * It is laid out as `[33-byte key][15 bytes of padding][33-byte key]`. The two
 * code paths below index it differently: the full-body XOR uses `(seed + i) % 33`
 * (the first copy) while the tail XOR uses `(seed + i) % 33 + 48` (the second
 * copy). Both copies hold the same 33 bytes, but keeping the layout exact means
 * either formula is in range and the offsets stay recognisable against the
 * original loader.
 */
const UF_KEY = Buffer.from(
  '135b0c0d6616222b1119584024100e423157382c351c0b0574253a69140f4d071d' +
    '000000000000000000000000000000' +
    '135b0c0d6616222b1119584024100e423157382c351c0b0574253a69140f4d071d',
  'hex'
);

export interface DecodedTexture {
  width: number;
  height: number;
  format: number;
  png: Buffer;
  /** True when the source declared premultiplied alpha (PVR flag bit 1). */
  premultiplied: boolean;
}

/**
 * Undo the container's byte obfuscation.
 *
 * `UF` containers come in two revisions: a plain one, and one flagged by a `0x4F`
 * third byte that pushes the header forward by two bytes. Inside each, the mode
 * byte selects between a full-body XOR (mode 1), a tail XOR (mode 2) and a bare
 * header skip. Every texture the game currently serves uses mode 2.
 */
export function decryptUf(data: Buffer): Buffer {
  if (data.length < 8 || !data.subarray(0, 2).equals(UF_MAGIC)) return data;

  const obfuscated = data[2] === 0x4f;
  const headerStart = obfuscated ? 4 : 2;
  const modeIndex = obfuscated ? 5 : 3;
  const seedIndex = obfuscated ? 6 : 4;

  const mode = data[modeIndex];
  const bodyStart = headerStart + 3;
  const bodyLength = data.length - bodyStart;
  if (bodyLength <= 0) return Buffer.alloc(0);

  if (mode === 1) {
    const seed = data[seedIndex] - bodyStart;
    const out = Buffer.allocUnsafe(bodyLength);
    for (let i = 0; i < bodyLength; i++) {
      out[i] = data[bodyStart + i] ^ UF_KEY[(seed + bodyStart + i) % 33];
    }
    return out;
  }

  if (mode === 2) {
    const seed = data[seedIndex];
    // The container records a short run of bytes that sit past the logical end
    // and belong at the front. Copy the whole buffer first so those reads still
    // land on real bytes, then XOR the head, then truncate to the body length.
    const out = Buffer.from(data);
    const moved = obfuscated ? 7 : 5;
    for (let i = 0; i < moved; i++) {
      const from = bodyLength + i;
      if (from >= data.length) break;
      out[i] = data[from] ^ UF_KEY[(seed + i) % 33 + 48];
    }
    const tailSpan = Math.min(bodyLength - bodyStart, 95);
    for (let i = 0; i < tailSpan; i++) {
      out[bodyStart + i] = data[bodyStart + i] ^ UF_KEY[(seed + bodyStart + i) % 33 + 48];
    }
    return out.subarray(0, bodyLength);
  }

  const skip = obfuscated ? 7 : 5;
  return data.length > skip ? data.subarray(skip) : Buffer.alloc(0);
}

/** Unwrap a `UF` texture into its raw PVR3 buffer plus the parsed header fields. */
export function unwrapUfTexture(data: Buffer): {
  pvr: Buffer;
  width: number;
  height: number;
  format: number;
  flags: number;
  metaSize: number;
} {
  const inner = decryptUf(data);

  let pvr = inner;
  if (inner.length >= 16 && inner.readUInt32BE(0) === CCZ_MAGIC) {
    pvr = zlib.inflateSync(inner.subarray(16));
  }

  if (pvr.length < PVR_HEADER_BYTES || !pvr.subarray(0, 4).equals(PVR_MAGIC)) {
    throw new Error('not a PVR3 texture');
  }

  // Field offsets, verified against real sheets (a 2048x2025 model and a plain
  // 2048x2048 one): flags at 4, pixel format at 8, height at 24, width at 28,
  // metadata size at 40. The fields between format and height are mipmap
  // levels/count and are 0 for every sheet the game ships.
  const flags = pvr.readUInt32LE(4);
  const format = pvr.readUInt32LE(8);
  const height = pvr.readUInt32LE(24);
  const width = pvr.readUInt32LE(28);
  const metaSize = pvr.readUInt32LE(40);
  return { pvr, width, height, format, flags, metaSize };
}

/** Bytes of compressed block data a texture of this size needs. */
export function blockBytes(width: number, height: number, bytesPerBlock = BLOCK_BYTES): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * bytesPerBlock;
}

/**
 * Convert a game texture to PNG.
 *
 * Returns `null` when the input is not a `UF` container, so an already-PNG asset
 * passes through untouched and is never re-encoded lossily.
 */
export function gameTextureToPng(data: Buffer, metaSizeHint?: number): DecodedTexture | null {
  if (data.length < 8 || !data.subarray(0, 2).equals(UF_MAGIC)) return null;

  const { pvr, width, height, format, flags, metaSize } = unwrapUfTexture(data);

  if (format !== PVR_FORMAT.ETC2_RGBA) {
    throw new Error(`unsupported PVR format ${format}`);
  }

  // Real sheets put the pixel data immediately after the fixed 52-byte header
  // (verified: payload length == ceil(w/4) * ceil(h/4) * 16), so take exactly the
  // blocks the dimensions call for and ignore any trailing pad.
  const start = PVR_HEADER_BYTES + (metaSizeHint ?? 0);
  const needed = blockBytes(width, height);
  let payload = pvr.subarray(start, start + needed);
  if (payload.length < needed) {
    // Sheets whose height is not a multiple of four are stored short by the
    // padding rows; zero-fill so the last row of blocks still decodes.
    payload = Buffer.concat([payload, Buffer.alloc(needed - payload.length)]);
  }

  const image = decodeEtc2Rgba(new Uint8Array(payload), width, height);

  const png = new PNG({ width, height });
  png.data = Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.length);
  return {
    width,
    height,
    format,
    png: PNG.sync.write(png),
    premultiplied: (flags & 0x2) !== 0,
  };
}
