/**
 * Primary Echocalypse high-quality asset source:
 *   https://cdn-wx-studio.uuzuonline.com/product-2013001/cdn1/upgrade_hquality/
 *
 * The CDN publishes `upgrade.config`, a JSON manifest listing per-character
 * asset packs (`ks_<modelId>.zip`, ~1–4 MB each) and portrait packs
 * (`pic_knightAvatar_censor_<id>.png.zip`). Inside each `ks_<modelId>.zip`,
 * Spine files live under `res/common/censor/knight_spine/<modelId>/...` and
 * textures are high-res `UF` PVR3+ETC2 containers (or PNGs) decoded downstream
 * by `gameTextureToPng`.
 */
import zlib from 'node:zlib';
import path from 'node:path';

export const UPGRADE_HQ_BASE =
  'https://cdn-wx-studio.uuzuonline.com/product-2013001/cdn1/upgrade_hquality';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const MAX_CACHED_MODEL_ZIPS = 20;
const MAX_CACHED_PIC_ZIPS = 48;

export class UpgradeCdnNotCovered extends Error {}

export interface UpgradeZipMeta {
  name: string;
  md5: string;
}

export interface UpgradeManifest {
  fetchedAt: number;
  modelZips: Map<string, UpgradeZipMeta>;
  picZips: Map<string, UpgradeZipMeta>;
  counts: {
    total: number;
    models: number;
    pics: number;
    icons: number;
  };
}

export interface ParsedZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

let cachedManifest: UpgradeManifest | null = null;
let inflightManifest: Promise<UpgradeManifest> | null = null;

/** Separate caches so scrolling portrait thumbnails never evict large Spine ZIPs. */
const extractedModelZipCache = new Map<string, Map<string, Buffer>>();
const extractedPicZipCache = new Map<string, Map<string, Buffer>>();
const inflightZipFetches = new Map<string, Promise<Map<string, Buffer>>>();

async function fetchBufferWithRetry(url: string, attempts = 3, timeoutMs = 25000): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; echo-viewer/2.0)',
        },
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${url}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 403) break;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export function buildUpgradeManifest(raw: { zip_list?: UpgradeZipMeta[] }): UpgradeManifest {
  const list = Array.isArray(raw?.zip_list) ? raw.zip_list : [];
  const modelZips = new Map<string, UpgradeZipMeta>();
  const picZips = new Map<string, UpgradeZipMeta>();
  let icons = 0;

  for (const item of list) {
    if (!item?.name) continue;
    if (item.name.startsWith('ks_') && item.name.endsWith('.zip')) {
      const modelId = item.name.slice(3, -4);
      modelZips.set(modelId, item);
    } else if (item.name.startsWith('pic_') && item.name.endsWith('.zip')) {
      picZips.set(item.name.toLowerCase(), item);
    } else if (item.name.startsWith('icon_')) {
      icons++;
    }
  }

  return {
    fetchedAt: Date.now(),
    modelZips,
    picZips,
    counts: {
      total: list.length,
      models: modelZips.size,
      pics: picZips.size,
      icons,
    },
  };
}

export async function loadUpgradeManifest(): Promise<UpgradeManifest> {
  if (cachedManifest) return cachedManifest;
  if (inflightManifest) return inflightManifest;

  inflightManifest = (async () => {
    const buf = await fetchBufferWithRetry(`${UPGRADE_HQ_BASE}/upgrade.config`, 3, 20000);
    const parsed = JSON.parse(buf.toString('utf8')) as { zip_list?: UpgradeZipMeta[] };
    const manifest = buildUpgradeManifest(parsed);
    cachedManifest = manifest;
    return manifest;
  })();

  try {
    return await inflightManifest;
  } finally {
    inflightManifest = null;
  }
}

export function parseZipEntries(zipBuf: Buffer): ParsedZipEntry[] {
  const minOffset = Math.max(0, zipBuf.length - 65557);
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (zipBuf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('Invalid ZIP: missing end-of-central-directory record');
  }

  let cdOffset = zipBuf.readUInt32LE(eocd + 16);
  let cdSize = zipBuf.readUInt32LE(eocd + 12);
  let entryCount = zipBuf.readUInt16LE(eocd + 10);

  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entryCount === 0xffff) {
    const locatorPos = eocd - 20;
    if (locatorPos >= 0 && zipBuf.readUInt32LE(locatorPos) === SIG_EOCD64_LOC) {
      const z64Offset = Number(zipBuf.readBigUInt64LE(locatorPos + 8));
      if (z64Offset + 56 <= zipBuf.length && zipBuf.readUInt32LE(z64Offset) === SIG_EOCD64) {
        entryCount = Number(zipBuf.readBigUInt64LE(z64Offset + 32));
        cdSize = Number(zipBuf.readBigUInt64LE(z64Offset + 40));
        cdOffset = Number(zipBuf.readBigUInt64LE(z64Offset + 48));
      }
    }
  }

  const entries: ParsedZipEntry[] = [];
  let pos = cdOffset;
  const cdEnd = Math.min(zipBuf.length, cdOffset + cdSize);
  while (pos + 46 <= cdEnd) {
    if (zipBuf.readUInt32LE(pos) !== SIG_CEN) break;
    const method = zipBuf.readUInt16LE(pos + 10);
    const compressedSize = zipBuf.readUInt32LE(pos + 20);
    const uncompressedSize = zipBuf.readUInt32LE(pos + 24);
    const nameLen = zipBuf.readUInt16LE(pos + 28);
    const extraLen = zipBuf.readUInt16LE(pos + 30);
    const commentLen = zipBuf.readUInt16LE(pos + 32);
    const localOffset = zipBuf.readUInt32LE(pos + 42);
    if (pos + 46 + nameLen > cdEnd) break;
    const name = zipBuf.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

export function extractZipEntryBuffer(zipBuf: Buffer, entry: ParsedZipEntry): Buffer {
  if (entry.localOffset + 30 > zipBuf.length || zipBuf.readUInt32LE(entry.localOffset) !== SIG_LOC) {
    throw new Error(`Invalid local header for ${entry.name}`);
  }
  const nameLen = zipBuf.readUInt16LE(entry.localOffset + 26);
  const extraLen = zipBuf.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const raw = zipBuf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}

export function indexZipFilesByBasename(zipBuf: Buffer): Map<string, Buffer> {
  const entries = parseZipEntries(zipBuf);
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    const data = extractZipEntryBuffer(zipBuf, entry);
    const normalized = entry.name.replace(/^\/+/, '');
    const base = path.posix.basename(normalized);
    files.set(normalized, data);
    if (!files.has(base)) {
      files.set(base, data);
    }
    const lowerBase = base.toLowerCase();
    if (!files.has(lowerBase)) {
      files.set(lowerBase, data);
    }
  }
  return files;
}

async function getExtractedZipFiles(
  meta: UpgradeZipMeta,
  kind: 'model' | 'pic'
): Promise<Map<string, Buffer>> {
  const cache = kind === 'model' ? extractedModelZipCache : extractedPicZipCache;
  const maxEntries = kind === 'model' ? MAX_CACHED_MODEL_ZIPS : MAX_CACHED_PIC_ZIPS;

  const hit = cache.get(meta.name);
  if (hit) {
    cache.delete(meta.name);
    cache.set(meta.name, hit);
    return hit;
  }

  const inflight = inflightZipFetches.get(meta.name);
  if (inflight) return inflight;

  const work = (async () => {
    const url = meta.md5
      ? `${UPGRADE_HQ_BASE}/${encodeURIComponent(meta.name)}?md5=${encodeURIComponent(meta.md5)}`
      : `${UPGRADE_HQ_BASE}/${encodeURIComponent(meta.name)}`;
    const zipBuf = await fetchBufferWithRetry(url, 3, 30000);
    const files = indexZipFilesByBasename(zipBuf);

    cache.set(meta.name, files);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
    return files;
  })();

  inflightZipFetches.set(meta.name, work);
  try {
    return await work;
  } finally {
    inflightZipFetches.delete(meta.name);
  }
}

/**
 * Resolve an Echocalypse spine or portrait path from `upgrade_hquality`.
 *
 * Maps request paths like:
 *   `res/common/knight_spine/700010/700010.skel` -> `ks_700010.zip` -> `res/common/censor/knight_spine/700010/700010.skel`
 *   `res/common/pic/knightAvatar/700010.png` -> `pic_knightAvatar_censor_700010.png.zip` -> `.../700010.png`
 *
 * Throws `UpgradeCdnNotCovered` only when `upgrade.config` has no pack for the
 * requested model/portrait. If the pack DOES exist in `upgrade.config` but the
 * individual file is absent inside it, throws a 404 Error so the caller does not
 * mix stale rip textures into an `upgrade_hquality` model.
 */
export async function fetchFromUpgradeHquality(relPath: string): Promise<Buffer> {
  const manifest = await loadUpgradeManifest();

  const spineMatch = relPath.match(/^res\/common\/(?:censor\/)?knight_spine\/([^/]+)\/([^/]+)$/);
  if (spineMatch) {
    const [, modelId, fileName] = spineMatch;
    const meta = manifest.modelZips.get(modelId);
    if (!meta) {
      throw new UpgradeCdnNotCovered(`${modelId} is not present in upgrade_hquality manifest`);
    }
    const files = await getExtractedZipFiles(meta, 'model');
    const hit =
      files.get(`res/common/censor/knight_spine/${modelId}/${fileName}`) ||
      files.get(`res/common/knight_spine/${modelId}/${fileName}`) ||
      files.get(fileName) ||
      files.get(fileName.toLowerCase());
    if (!hit) {
      const err = new Error(`${fileName} not found inside ${meta.name}`) as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    return hit;
  }

  const picMatch = relPath.match(/^res\/common\/pic\/([^/]+)\/([^/]+)$/);
  if (picMatch) {
    const [, folder, fileName] = picMatch;
    const candidates = [
      `pic_${folder}_censor_${fileName}.zip`,
      `pic_${folder}_${fileName}.zip`,
    ];
    let meta: UpgradeZipMeta | undefined;
    for (const candidate of candidates) {
      meta = manifest.picZips.get(candidate.toLowerCase());
      if (meta) break;
    }
    if (!meta) {
      throw new UpgradeCdnNotCovered(`${relPath} is not present in upgrade_hquality manifest`);
    }
    const files = await getExtractedZipFiles(meta, 'pic');
    const hit =
      files.get(fileName) ||
      files.get(fileName.toLowerCase()) ||
      Array.from(files.values())[0];
    if (!hit) {
      const err = new Error(`${fileName} not found inside ${meta.name}`) as Error & { status?: number };
      err.status = 404;
      throw err;
    }
    return hit;
  }

  throw new UpgradeCdnNotCovered(`${relPath} does not map to an upgrade_hquality pack`);
}

export function upgradeCdnStatus() {
  return {
    base: UPGRADE_HQ_BASE,
    loaded: Boolean(cachedManifest),
    fetchedAt: cachedManifest?.fetchedAt ?? null,
    counts: cachedManifest?.counts ?? null,
    cachedModelZips: extractedModelZipCache.size,
    cachedPicZips: extractedPicZipCache.size,
  };
}

export function clearUpgradeCdnCachesForTests() {
  cachedManifest = null;
  inflightManifest = null;
  extractedModelZipCache.clear();
  extractedPicZipCache.clear();
  inflightZipFetches.clear();
}
