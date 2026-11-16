/**
 * Cross-validate server/echoTextures.ts + server/etc2.ts against the C reference.
 *
 * For every real texture given on the command line this:
 *   1. runs the Python dump script, which uses the C reference harness for colour;
 *   2. decodes the same file through the shipping TypeScript modules;
 *   3. compares RGB pixel by pixel.
 *
 * Usage: npx tsx tools/verify_echo_textures.ts <texture...>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { gameTextureToPng } from '../server/echoTextures.ts';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: verify_echo_textures.ts <texture...>');
  process.exit(2);
}

let failures = 0;

for (const file of files) {
  const dump = join(tmpdir(), `ref-${process.pid}-${Math.random().toString(36).slice(2)}.rgb`);
  try {
    // The reference dumper lives outside the app tree; point at it with
    // ECHO_REF_DUMP when validating against a checkout that carries it.
    const dumper = process.env.ECHO_REF_DUMP ?? 'tools/dump_reference.py';
    const summary = execFileSync('python3', [dumper, file, dump], {
      encoding: 'utf8',
      cwd: process.env.ECHO_REF_CWD ?? process.cwd(),
    }).trim();

    const ref = readFileSync(dump);
    const refW = ref.readUInt32LE(0);
    const refH = ref.readUInt32LE(4);
    const refRgb = ref.subarray(8);

    const decoded = gameTextureToPng(readFileSync(file));
    if (!decoded) {
      console.log(`FAIL ${file}: not a UF container`);
      failures++;
      continue;
    }

    const png = PNG.sync.read(decoded.png);
    if (png.width !== refW || png.height !== refH) {
      console.log(`FAIL ${file}: size ${png.width}x${png.height} vs ref ${refW}x${refH}`);
      failures++;
      continue;
    }

    let rgbMismatch = 0;
    let worstRgb = 0;
    for (let i = 0, j = 0; i < png.data.length; i += 4, j += 3) {
      const dr = Math.abs(png.data[i] - refRgb[j]);
      const dg = Math.abs(png.data[i + 1] - refRgb[j + 1]);
      const db = Math.abs(png.data[i + 2] - refRgb[j + 2]);
      const d = Math.max(dr, dg, db);
      if (d !== 0) {
        rgbMismatch++;
        if (d > worstRgb) worstRgb = d;
      }
    }

    const ok = rgbMismatch === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${file}\n` +
        `     ${summary}\n` +
        `     png=${png.width}x${png.height} premultiplied=${decoded.premultiplied} ` +
        `rgbMismatch=${rgbMismatch} worst=${worstRgb}`
    );
  } finally {
    try {
      unlinkSync(dump);
    } catch {
      /* already gone */
    }
  }
}

console.log(failures === 0 ? `\nall ${files.length} textures match the reference` : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
