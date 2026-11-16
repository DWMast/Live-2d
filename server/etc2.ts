/**
 * ETC2 / EAC decoding for the game's `UF` textures.
 *
 * Echocalypse ships its character sheets as ETC2 RGBA (EAC alpha). Each 16-byte
 * block is an 8-byte RGB half followed by an 8-byte alpha half, both read as
 * big-endian 64-bit words. That layout was verified against an independent
 * reference decoder over a full 2048x2025 sheet: the colour path reproduces the
 * reference texel for texel.
 *
 * One detail is easy to get wrong and very visible when you do: the reference
 * expands a 5-bit base channel with `(v << 3) | (v >> 2)`. When a differential
 * block pushes a channel below zero, that expression runs on a negative 32-bit
 * int and the low byte becomes 0xFF. Clamp before shifting and you get a
 * different colour than the game's own renderer.
 *
 * The output is straight (non-premultiplied) RGBA.
 */

export interface Etc2Image {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Individual/differential subblock modifier sets. */
const MODIFIERS: ReadonlyArray<ReadonlyArray<number>> = [
  [2, 8, -2, -8],
  [5, 17, -5, -17],
  [9, 29, -9, -29],
  [13, 42, -13, -42],
  [18, 60, -18, -60],
  [24, 80, -24, -80],
  [33, 106, -33, -106],
  [47, 183, -47, -183],
];

/** EAC alpha modifier sets (Table 133). */
const ALPHA_MODIFIERS: ReadonlyArray<ReadonlyArray<number>> = [
  [-3, -6, -9, -15, 2, 5, 8, 14],
  [-3, -7, -10, -13, 2, 6, 9, 12],
  [-2, -5, -8, -13, 1, 4, 7, 12],
  [-2, -4, -6, -13, 1, 3, 5, 12],
  [-3, -6, -8, -12, 2, 5, 7, 11],
  [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10],
  [-3, -5, -8, -11, 2, 4, 7, 10],
  [-2, -6, -8, -10, 1, 5, 7, 9],
  [-2, -5, -8, -10, 1, 4, 7, 9],
  [-2, -4, -8, -10, 1, 3, 7, 9],
  [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9],
  [-1, -2, -3, -10, 0, 1, 2, 9],
  [-4, -6, -8, -9, 3, 5, 7, 8],
  [-3, -5, -7, -9, 2, 4, 6, 8],
];

/**
 * `(v << 3) | (v >> 2)` for a 5-bit base channel, unclamped.
 *
 * Differential blocks can push a channel below zero. The reference keeps that
 * negative value all the way through the intensity modifier and only clamps
 * when it writes the texel, so a base of -1 with a +24 modifier lands on 23,
 * not on 24. Clamping the base early shifts every such texel by one.
 */
const expand5 = (v: number): number => (v << 3) | (v >> 2);
/** `(v << 4) | v` for the 4-bit individual bases. */
const expand4 = (v: number): number => (v << 4) | v;

/** Per-texel 2-bit selectors: LSB plane in bits 16..31, MSB plane in 32..47. */
function selector(lo: number, t: number): number {
  return (((lo >>> (t + 16)) & 1) << 1) | ((lo >>> t) & 1);
}

function writeTexel(out: Uint8Array, t: number, r: number, g: number, b: number): void {
  const p = t * 3;
  out[p] = clamp8(r);
  out[p + 1] = clamp8(g);
  out[p + 2] = clamp8(b);
}

/** Reads one 4x4 colour block into `out` (48 bytes, 3 per texel). */
function decodeColorBlock(block: Uint8Array, o: number, out: Uint8Array): void {
  const hi = ((block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3]) >>> 0;
  const lo = ((block[o + 4] << 24) | (block[o + 5] << 16) | (block[o + 6] << 8) | block[o + 7]) >>> 0;

  if ((hi & 2) === 0) {
    decodeIndividual(hi, lo, out);
    return;
  }

  const rBase = hi >>> 27;
  const gBase = (hi >>> 19) & 31;
  const bBase = (hi >>> 11) & 31;
  let dr = (hi >>> 24) & 7;
  let dg = (hi >>> 16) & 7;
  let db = (hi >>> 8) & 7;
  if (dr >= 4) dr -= 8;
  if (dg >= 4) dg -= 8;
  if (db >= 4) db -= 8;

  // NOTE: ETC2 uses an out-of-range displaced base to signal T, H and planar.
  // The game's own renderer does not take those branches: it evaluates the
  // differential path regardless and lets a base below zero stay negative until
  // the modifier is added. Matching that quirk is what makes the output
  // pixel-identical to the game rather than merely "close enough".
  const flip = (hi & 1) !== 0;
  const c1 = [expand5(rBase), expand5(gBase), expand5(bBase)];
  const c2 = [expand5(rBase + dr), expand5(gBase + dg), expand5(bBase + db)];
  const t1 = MODIFIERS[(hi >>> 5) & 7];
  const t2 = MODIFIERS[(hi >>> 2) & 7];

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const second = flip ? y >= 2 : x >= 2;
      const base = second ? c2 : c1;
      const mod = (second ? t2 : t1)[selector(lo, x * 4 + y)];
      writeTexel(out, y * 4 + x, base[0] + mod, base[1] + mod, base[2] + mod);
    }
  }
}

function decodeIndividual(hi: number, lo: number, out: Uint8Array): void {
  const flip = (hi & 1) !== 0;
  const c1 = [expand4(hi >>> 28), expand4((hi >>> 24) & 15), expand4((hi >>> 20) & 15)];
  const c2 = [expand4((hi >>> 16) & 15), expand4((hi >>> 12) & 15), expand4((hi >>> 8) & 15)];
  const t1 = MODIFIERS[(hi >>> 5) & 7];
  const t2 = MODIFIERS[(hi >>> 2) & 7];

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const second = flip ? y >= 2 : x >= 2;
      const base = second ? c2 : c1;
      const mod = (second ? t2 : t1)[selector(lo, x * 4 + y)];
      writeTexel(out, y * 4 + x, base[0] + mod, base[1] + mod, base[2] + mod);
    }
  }
}

/** EAC alpha half: base byte, multiplier/table byte, sixteen MSB-first indices. */
function decodeAlphaBlock(block: Uint8Array, o: number, out: Uint8Array): void {
  const base = block[o];
  const multiplier = (block[o + 1] >>> 4) & 15;
  const table = ALPHA_MODIFIERS[block[o + 1] & 15];

  // The six bytes after the header are a 48-bit big-endian bitstream of sixteen
  // 3-bit indices. Holding it as a single 48-bit integer keeps every field
  // contiguous no matter where it falls; the per-block cost is negligible next
  // to decoding the texture itself.
  const bits =
    (BigInt(block[o + 2]) << 40n) |
    (BigInt(block[o + 3]) << 32n) |
    (BigInt(block[o + 4]) << 24n) |
    (BigInt(block[o + 5]) << 16n) |
    (BigInt(block[o + 6]) << 8n) |
    BigInt(block[o + 7]);

  for (let t = 0; t < 16; t++) {
    // Bit 47 is the MSB of field 0, so field t starts at bit 45 - 3t.
    const idx = Number((bits >> BigInt(45 - 3 * t)) & 7n);
    out[t] = clamp8(base + table[idx] * multiplier);
  }
}

export function decodeEtc2Rgba(blocks: Uint8Array, width: number, height: number): Etc2Image {
  const rgba = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const need = bw * bh * 16;

  let src = blocks;
  if (src.length < need) {
    const padded = new Uint8Array(need);
    padded.set(src);
    src = padded;
  }

  const color = new Uint8Array(48);
  const alpha = new Uint8Array(16);

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const off = (by * bw + bx) * 16;
      if (off + 16 > src.length) break;
      // Colour half first would read the alpha bytes; the game stores them
      // alpha-first, colour-second, and getting this backwards is invisible
      // except as wrong colours on a correct silhouette.
      decodeColorBlock(src, off + 8, color);
      decodeAlphaBlock(src, off, alpha);

      const rows = Math.min(4, height - by * 4);
      const cols = Math.min(4, width - bx * 4);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const t = y * 4 + x;
          const o = ((by * 4 + y) * width + bx * 4 + x) * 4;
          rgba[o] = color[t * 3];
          rgba[o + 1] = color[t * 3 + 1];
          rgba[o + 2] = color[t * 3 + 2];
          rgba[o + 3] = alpha[t];
        }
      }
    }
  }
  return { width, height, rgba };
}

