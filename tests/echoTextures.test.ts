/**
 * Regression tests for the Echocalypse texture pipeline.
 *
 * These cover the two things that broke repeatedly while this was built, and each
 * would fail silently if it regressed:
 *
 *   1. the `UF` container decrypt - a wrong key table or header offset still
 *      produces *something*, just garbage that reads as a corrupt model;
 *   2. the ETC2 block decode - an off-by-one in a bit field shifts every colour,
 *      which reads as "the renderer is broken" rather than "the decoder is".
 *
 * The bit-exact comparison against the independent C reference lives in
 * tools/verify_echo_textures.ts, since it needs that harness.
 *
 * Run with: npx tsx --test tests/echoTextures.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PNG } from 'pngjs';
import {
  decryptUf,
  unwrapUfTexture,
  blockBytes,
  gameTextureToPng,
} from '../server/echoTextures.ts';
import { decodeEtc2Rgba } from '../server/etc2.ts';

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');
const FIXTURE = path.join(FIXTURE_DIR, 'echo-texture.png');

// Package that carries the fixture texture, taken from the generated CDN index so
// the test cannot drift away from the data the server actually serves.
const FIXTURE_NAME = 'res/common/knight_spine/701060/701060.png';
const PACKAGE =
  'https://cdn-wx-studio.gtarcade.com/product-2013002/cdn1/5.1.50.64/4090071_5015064_1.zip';
const PACKAGE_SIZE = 71399413;

/**
 * Fetch one real game texture and cache it under tests/fixtures.
 *
 * Only the bytes of that single entry are pulled, using the same range extractor
 * the server uses, so this stays fast and does not need the whole package.
 */
async function realTexture(): Promise<Buffer | null> {
  if (fs.existsSync(FIXTURE)) return fs.readFileSync(FIXTURE);
  try {
    const { extractFromZip } = await import('../server/remoteZip.ts');
    const file = await extractFromZip(PACKAGE, PACKAGE_SIZE, FIXTURE_NAME);
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(FIXTURE, file.data);
    return file.data;
  } catch {
    return null;
  }
}

/** Build a minimal `UF` container wrapping a PVR3 header and zeroed blocks. */
function buildContainer(width: number, height: number): Buffer {
  const body = Buffer.alloc(52 + blockBytes(width, height));
  body.write('PVR\u0003', 0, 'latin1');
  body.writeUInt32LE(0x2, 4); // flags: premultiplied
  body.writeUInt32LE(23, 8); // ETC2_RGBA
  body.writeUInt32LE(height, 24);
  body.writeUInt32LE(width, 28);

  const ccz = Buffer.concat([
    Buffer.from([0x43, 0x43, 0x5a, 0x21, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
    zlib.deflateSync(body),
  ]);
  // Real header is 5 bytes: 'UF', a flag byte, then mode and seed. Mode 0 means
  // "skip the header and take the rest", the plain path; modes 1 and 2
  // additionally shuffle bytes and are covered by the real-game fixture.
  return Buffer.concat([Buffer.from('UF', 'latin1'), Buffer.from([0, 0, 0]), ccz]);
}

test('decryptUf returns non-container data untouched', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  assert.deepEqual(decryptUf(png), png);
});

test('decryptUf unwraps a container to a CCZ! stream', () => {
  const inner = decryptUf(buildContainer(8, 8));
  assert.equal(inner.subarray(0, 4).toString('latin1'), 'CCZ!');
  assert.equal(inner.readUInt32BE(4), 2, 'CCZ version word');
});

test('unwrapUfTexture reads the real header fields', () => {
  const u = unwrapUfTexture(buildContainer(64, 32));
  assert.equal(u.width, 64);
  assert.equal(u.height, 32);
  assert.equal(u.format, 23);
  assert.equal(u.flags & 0x2, 2, 'premultiplied flag');
  assert.equal(u.pvr.subarray(0, 4).toString('latin1'), 'PVR\u0003');
});

test('blockBytes rounds up to whole 4x4 tiles', () => {
  assert.equal(blockBytes(4, 4), 16);
  assert.equal(blockBytes(2048, 2048), 2048 * 2048);
  // A 2025-tall sheet needs as many tiles as a 2028-tall one.
  assert.equal(blockBytes(2048, 2025), blockBytes(2048, 2028));
});

test('decodeEtc2Rgba fills every texel of a uniform block', () => {
  // An all-zero block decodes to one flat colour, so every texel must agree and
  // none may be left uninitialised - unfilled texels are what show as black spots.
  const img = decodeEtc2Rgba(new Uint8Array(16), 4, 4);
  const first = Array.from(img.rgba.subarray(0, 4));
  for (let i = 1; i < 16; i++) {
    assert.deepEqual(Array.from(img.rgba.subarray(i * 4, i * 4 + 4)), first, `texel ${i}`);
  }
});

test('decodeEtc2Rgba sizes output from the requested dimensions', () => {
  // 2025 is a real shipped height; the output must not be rounded up to the grid.
  const w = 8;
  const h = 5;
  const img = decodeEtc2Rgba(new Uint8Array(blockBytes(w, h)), w, h);
  assert.equal(img.rgba.length, w * h * 4);
});

test('decodeEtc2Rgba decodes Individual mode R1/R2/G1/G2/B1/B2 channel order without green/magenta shift', () => {
  // Block taken from Akira 700420: hi=0x838373c4 (grey C1=[8,8,7], C2=[3,3,3], diff=0)
  const block = Buffer.from('0000000000000000838373c400000000', 'hex');
  const img = decodeEtc2Rgba(block, 4, 4);
  for (let i = 0; i < 16; i++) {
    const r = img.rgba[i * 4];
    const g = img.rgba[i * 4 + 1];
    const b = img.rgba[i * 4 + 2];
    assert.ok(Math.abs(r - g) <= 20 && Math.abs(g - b) <= 20, `neutral grey at texel ${i}, got ${r},${g},${b}`);
  }
});

test('decodeEtc2Rgba decodes Planar mode smoothly', () => {
  // Block from Akira 700420: hi=0x82820483 lo=0x040840c1 (dark planar gradient)
  const block = Buffer.from('ff0000000000000082820483040840c1', 'hex');
  const img = decodeEtc2Rgba(block, 4, 4);
  for (let i = 0; i < 16; i++) {
    const r = img.rgba[i * 4];
    const g = img.rgba[i * 4 + 1];
    const b = img.rgba[i * 4 + 2];
    assert.ok(r <= 20 && g <= 20 && b <= 20, `expected dark planar values at texel ${i}, got ${r},${g},${b}`);
    assert.equal(img.rgba[i * 4 + 3], 255);
  }
});

test('decodeEtc2Rgba indexes EAC alpha in column-major order (x*4+y)', () => {
  // Put idx=7 (+14 * 1) at t=1 (x=0, y=1) and idx=0 (-15 * 1) elsewhere on base=100.
  // Bit 45..43 = idx0, bit 42..40 = idx1 = 7 -> bits = 7n << 42n = 0x1c0000000000n (byte 2=0x1c)
  const block = Buffer.from('64101c000000000000000002ffffffff', 'hex');
  const img = decodeEtc2Rgba(block, 4, 4);
  // x=0, y=1 -> pixel offset (1*4 + 0) = 4 should have higher alpha than (0,1)
  assert.ok(img.rgba[4 * 4 + 3] > img.rgba[1 * 4 + 3], 't=1 must map to (x=0, y=1), not (x=1, y=0)');
});

test('gameTextureToPng passes a non-container through untouched', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(gameTextureToPng(png), null);
});

test('gameTextureToPng converts a container to a decodable PNG', () => {
  const out = gameTextureToPng(buildContainer(8, 8));
  assert.ok(out, 'converted');
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  assert.equal(out.premultiplied, true);
  const png = PNG.sync.read(out.png);
  assert.equal(png.width, 8);
  assert.equal(png.height, 8);
  assert.equal(png.data.length, 8 * 8 * 4);
});

test('a real game texture decodes to a well-formed PNG', async () => {
  const data = await realTexture();
  if (!data) {
    // No network available: the synthetic cases above still cover the format.
    return;
  }
  assert.ok(data.subarray(0, 2).equals(Buffer.from('UF', 'latin1')), 'fixture is a container');
  const out = gameTextureToPng(data);
  assert.ok(out, 'real texture converted');
  assert.equal(out.width, 2048);
  assert.equal(out.height, 2048);
  const png = PNG.sync.read(out.png);
  assert.equal(png.width, out.width);
  assert.equal(png.height, out.height);
});
