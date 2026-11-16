/**
 * Khronos ETC2 / EAC decoding for Echocalypse `UF` PVR3 textures.
 *
 * Each 16-byte 4x4 tile consists of an 8-byte big-endian EAC alpha block
 * followed by an 8-byte big-endian ETC2 RGB block.
 *
 * Both color selectors and EAC alpha indices are indexed in column-major
 * order (`t = x * 4 + y`) per the Khronos OpenGL ES 3.0 ETC2 specification,
 * and all five ETC2 RGB modes are decoded:
 *   - Individual (diff bit = 0, R1/R2/G1/G2/B1/B2 4-bit layout)
 *   - T mode     (diff bit = 1, R+dR out of [0..31])
 *   - H mode     (diff bit = 1, G+dG out of [0..31])
 *   - Planar     (diff bit = 1, B+dB out of [0..31])
 *   - Differential (diff bit = 1, all base+delta in [0..31])
 *
 * Output is straight (non-premultiplied) RGBA.
 */

export interface Etc2Image {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Individual/differential subblock modifier sets (Table C.1). */
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

/** T and H mode distance table (Table C.1.3c). */
const TH_DISTANCES: ReadonlyArray<number> = [3, 6, 11, 16, 23, 32, 41, 64];

/** EAC alpha modifier sets (Table C.1.4). */
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

const expand4 = (v: number): number => (v << 4) | v;
const expand5 = (v: number): number => (v << 3) | (v >> 2);
const expand6 = (v: number): number => (v << 2) | (v >> 4);
const expand7 = (v: number): number => (v << 1) | (v >> 6);

/** Per-texel 2-bit selectors: LSB plane in bits 0..15, MSB plane in bits 16..31. */
function selector(lo: number, t: number): number {
  return (((lo >>> (t + 16)) & 1) << 1) | ((lo >>> t) & 1);
}

function writeTexel(out: Uint8Array, t: number, r: number, g: number, b: number): void {
  const p = t * 3;
  out[p] = clamp8(r);
  out[p + 1] = clamp8(g);
  out[p + 2] = clamp8(b);
}

function decodeIndividual(hi: number, lo: number, out: Uint8Array): void {
  const flip = (hi & 1) !== 0;
  // Individual layout: R1(31..28), R2(27..24), G1(23..20), G2(19..16), B1(15..12), B2(11..8)
  const c1 = [expand4(hi >>> 28), expand4((hi >>> 20) & 15), expand4((hi >>> 12) & 15)];
  const c2 = [expand4((hi >>> 24) & 15), expand4((hi >>> 16) & 15), expand4((hi >>> 8) & 15)];
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

function decodeTMode(hi: number, lo: number, out: Uint8Array): void {
  const r1 = expand4((((hi >>> 27) & 3) << 2) | ((hi >>> 24) & 3));
  const g1 = expand4((hi >>> 20) & 15);
  const b1 = expand4((hi >>> 16) & 15);
  const r2 = expand4((hi >>> 12) & 15);
  const g2 = expand4((hi >>> 8) & 15);
  const b2 = expand4((hi >>> 4) & 15);
  const dist = TH_DISTANCES[((hi >>> 1) & 6) | (hi & 1)];

  const pr = [r1, clamp8(r2 + dist), r2, clamp8(r2 - dist)];
  const pg = [g1, clamp8(g2 + dist), g2, clamp8(g2 - dist)];
  const pb = [b1, clamp8(b2 + dist), b2, clamp8(b2 - dist)];

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = selector(lo, x * 4 + y);
      writeTexel(out, y * 4 + x, pr[idx], pg[idx], pb[idx]);
    }
  }
}

function decodeHMode(hi: number, lo: number, out: Uint8Array): void {
  const r1 = expand4((hi >>> 27) & 15);
  const g1 = expand4((((hi >>> 24) & 7) << 1) | ((hi >>> 20) & 1));
  const b1 = expand4((((hi >>> 19) & 1) << 3) | ((hi >>> 15) & 7));
  const r2 = expand4((hi >>> 11) & 15);
  const g2 = expand4((hi >>> 7) & 15);
  const b2 = expand4((hi >>> 3) & 15);
  const c1Val = (r1 << 16) | (g1 << 8) | b1;
  const c2Val = (r2 << 16) | (g2 << 8) | b2;
  const dist = TH_DISTANCES[(hi & 4) | ((hi & 1) << 1) | (c1Val >= c2Val ? 1 : 0)];

  const pr = [clamp8(r1 + dist), clamp8(r1 - dist), clamp8(r2 + dist), clamp8(r2 - dist)];
  const pg = [clamp8(g1 + dist), clamp8(g1 - dist), clamp8(g2 + dist), clamp8(g2 - dist)];
  const pb = [clamp8(b1 + dist), clamp8(b1 - dist), clamp8(b2 + dist), clamp8(b2 - dist)];

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const idx = selector(lo, x * 4 + y);
      writeTexel(out, y * 4 + x, pr[idx], pg[idx], pb[idx]);
    }
  }
}

function decodePlanarMode(hi: number, lo: number, out: Uint8Array): void {
  const q = (BigInt(hi) << 32n) | BigInt(lo);
  const ro = expand6(Number((q >> 57n) & 63n));
  const go = expand7((Number((q >> 56n) & 1n) << 6) | Number((q >> 49n) & 63n));
  const bo = expand6(
    (Number((q >> 48n) & 1n) << 5) |
      (Number((q >> 43n) & 3n) << 3) |
      Number((q >> 39n) & 7n)
  );
  const rh = expand6((Number((q >> 34n) & 31n) << 1) | Number((q >> 32n) & 1n));
  const gh = expand7(Number((q >> 25n) & 127n));
  const bh = expand6(Number((q >> 19n) & 63n));
  const rv = expand6(Number((q >> 13n) & 63n));
  const gv = expand7(Number((q >> 6n) & 127n));
  const bv = expand6(Number(q & 63n));

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      writeTexel(
        out,
        y * 4 + x,
        (x * (rh - ro) + y * (rv - ro) + 4 * ro + 2) >> 2,
        (x * (gh - go) + y * (gv - go) + 4 * go + 2) >> 2,
        (x * (bh - bo) + y * (bv - bo) + 4 * bo + 2) >> 2
      );
    }
  }
}

/** Reads one 4x4 colour block into `out` (48 bytes, 3 per texel row-major). */
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

  if (rBase + dr < 0 || rBase + dr > 31) {
    decodeTMode(hi, lo, out);
    return;
  }
  if (gBase + dg < 0 || gBase + dg > 31) {
    decodeHMode(hi, lo, out);
    return;
  }
  if (bBase + db < 0 || bBase + db > 31) {
    decodePlanarMode(hi, lo, out);
    return;
  }

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

/**
 * EAC alpha half: base byte, multiplier/table byte, sixteen MSB-first indices
 * stored in column-major texel order (`t = x * 4 + y`).
 */
function decodeAlphaBlock(block: Uint8Array, o: number, out: Uint8Array): void {
  const base = block[o];
  const multiplier = (block[o + 1] >>> 4) & 15;
  const table = ALPHA_MODIFIERS[block[o + 1] & 15];

  const bits =
    (BigInt(block[o + 2]) << 40n) |
    (BigInt(block[o + 3]) << 32n) |
    (BigInt(block[o + 4]) << 24n) |
    (BigInt(block[o + 5]) << 16n) |
    (BigInt(block[o + 6]) << 8n) |
    BigInt(block[o + 7]);

  for (let t = 0; t < 16; t++) {
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
      decodeColorBlock(src, off + 8, color);
      decodeAlphaBlock(src, off, alpha);

      const rows = Math.min(4, height - by * 4);
      const cols = Math.min(4, width - bx * 4);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const ct = y * 4 + x;
          const at = x * 4 + y; // EAC indices are column-major (x*4+y)
          const o = ((by * 4 + y) * width + bx * 4 + x) * 4;
          rgba[o] = color[ct * 3];
          rgba[o + 1] = color[ct * 3 + 1];
          rgba[o + 2] = color[ct * 3 + 2];
          rgba[o + 3] = alpha[at];
        }
      }
    }
  }
  return { width, height, rgba };
}
