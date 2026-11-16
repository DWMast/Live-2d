import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import {
  buildUpgradeManifest,
  parseZipEntries,
  extractZipEntryBuffer,
  indexZipFilesByBasename,
  fetchFromUpgradeHquality,
  UpgradeCdnNotCovered,
} from '../server/echoUpgradeCdn.ts';

/** Build a valid minimal ZIP buffer with both stored (0) and deflated (8) entries. */
function makeTestZip(files: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer {
  const localParts: Buffer[] = [];
  const cenParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const method = f.deflate ? 8 : 0;
    const comp = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localParts.push(local, comp);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt32LE(offset, 42);
    nameBuf.copy(cen, 46);
    cenParts.push(cen);

    offset += local.length + comp.length;
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(cenParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test('buildUpgradeManifest indexes ks_, pic_, and icon_ entries', () => {
  const manifest = buildUpgradeManifest({
    zip_list: [
      { name: 'ks_700010.zip', md5: 'abc' },
      { name: 'ks_40008001.zip', md5: 'def' },
      { name: 'pic_knightAvatar_censor_600010.png.zip', md5: '111' },
      { name: 'icon_item_1.png.zip', md5: '222' },
    ],
  });

  assert.equal(manifest.counts.total, 4);
  assert.equal(manifest.counts.models, 2);
  assert.equal(manifest.counts.pics, 1);
  assert.equal(manifest.counts.icons, 1);
  assert.equal(manifest.modelZips.get('700010')?.md5, 'abc');
  assert.equal(manifest.modelZips.get('40008001')?.name, 'ks_40008001.zip');
  assert.equal(
    manifest.picZips.get('pic_knightavatar_censor_600010.png.zip')?.md5,
    '111'
  );
});

test('parseZipEntries and indexZipFilesByBasename extract censor-prefixed entries', () => {
  const zipBuf = makeTestZip([
    { name: 'res/common/censor/knight_spine/700010/', data: Buffer.alloc(0) },
    {
      name: 'res/common/censor/knight_spine/700010/700010.atlas',
      data: Buffer.from('700010.png\nsize: 2048,2048\n'),
      deflate: true,
    },
    {
      name: 'res/common/censor/knight_spine/700010/700010.skel',
      data: Buffer.from([1, 2, 3, 4, 5]),
      deflate: false,
    },
  ]);

  const entries = parseZipEntries(zipBuf);
  assert.equal(entries.length, 3);
  const atlasEntry = entries.find((e) => e.name.endsWith('700010.atlas'));
  assert.ok(atlasEntry);
  assert.equal(
    extractZipEntryBuffer(zipBuf, atlasEntry).toString('utf8'),
    '700010.png\nsize: 2048,2048\n'
  );

  const indexed = indexZipFilesByBasename(zipBuf);
  assert.ok(indexed.has('res/common/censor/knight_spine/700010/700010.atlas'));
  assert.ok(indexed.has('700010.atlas'));
  assert.deepEqual(indexed.get('700010.skel'), Buffer.from([1, 2, 3, 4, 5]));
});

test('fetchFromUpgradeHquality throws UpgradeCdnNotCovered for unknown model IDs', async () => {
  try {
    await assert.rejects(
      () => fetchFromUpgradeHquality('res/common/knight_spine/99999999/99999999.skel'),
      (err: unknown) => err instanceof UpgradeCdnNotCovered
    );
  } catch (err) {
    // Allow offline environments where upgrade.config cannot be reached
    if ((err as { code?: string })?.code === 'ENOTFOUND') return;
    throw err;
  }
});
