/**
 * Extract one file out of a remote ZIP using HTTP range requests.
 *
 * The game ships its spine models inside ~150 MB patch packages. Downloading a
 * package to read a 500 KB skeleton would make the first paint of a new-batch
 * character take minutes, so this reads only what a single entry needs:
 *
 *   1. the end-of-central-directory record (last 64 KB, or 22 bytes at the very
 *      end for archives over 4 GB);
 *   2. the central directory for the requested entry (a few KB around its
 *      header, found by binary search - the directory is sorted by name);
 *   3. the local file header, which may sit after a length-variable payload;
 *   4. the compressed bytes of the entry itself, inflated in memory.
 *
 * Every response is cached at two levels: a small block cache keyed by URL (the
 * central directory of one package is read over and over as you browse through
 * its characters) and a per-model object cache of finished extracts.
 */

import zlib from 'node:zlib';

const BLOCK = 512 * 1024;
const BLOCKS_PER_URL = 24; // ~12 MB per package, enough for every file we'll touch
const MAX_CACHED_MODELS = 48;

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const blockCache = new Map<string, Map<number, Buffer>>();
const modelCache = new Map<string, ExtractedFile>();

export interface ExtractedFile {
  name: string;
  data: Buffer;
  /** Bytes actually pulled over the wire, for the health panel. */
  wireBytes: number;
  elapsedMs: number;
}

export class RangeError404 extends Error {}

function cacheInsert(url: string, block: number, buffer: Buffer) {
  let map = blockCache.get(url);
  if (!map) {
    map = new Map();
    blockCache.set(url, map);
  }
  map.set(block, buffer);
  if (map.size > BLOCKS_PER_URL) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/**
 * Fetch `length` bytes at `offset`. Blocks are cached so the central-directory
 * search and the file read share reads.
 */
async function readRange(url: string, size: number, offset: number, length: number): Promise<Buffer> {
  const start = Math.max(0, offset);
  const end = Math.min(size, offset + length);
  if (end <= start) return Buffer.alloc(0);

  const first = Math.floor(start / BLOCK);
  const last = Math.floor((end - 1) / BLOCK);
  const blockMap = blockCache.get(url) ?? new Map<number, Buffer>();
  blockCache.set(url, blockMap);

  const parts: Buffer[] = [];
  for (let block = first; block <= last; block++) {
    if (!blockMap.has(block)) {
      const bStart = block * BLOCK;
      const bEnd = Math.min(size, bStart + BLOCK) - 1;
      blockMap.set(block, await httpGet(url, bStart, bEnd));
    }
    parts.push(blockMap.get(block) as Buffer);
  }
  if (parts.length === 1 && first === last) {
    const base = first * BLOCK;
    return parts[0].subarray(start - base, end - base);
  }
  const joined = Buffer.concat(parts);
  const base = first * BLOCK;
  return joined.subarray(start - base, end - base);
}

async function httpGet(url: string, start: number, end: number, attempt = 0): Promise<Buffer> {
  const controller = new AbortController();
  // Patch packages live on a slower origin; 150 MB-class archives routinely take
  // >10 s for a cold 512 KB block.
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end}`,
        'User-Agent': 'Mozilla/5.0 (compatible; echo-viewer/1.0)',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.status === 404 || res.status === 403) {
      throw new RangeError404(`HTTP ${res.status} for ${url}`);
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const status = (err as { status?: number }).status;
    const retryable = err instanceof RangeError404 ? false : status ? RETRYABLE.has(status) : true;
    if (attempt < 3 && retryable) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      return httpGet(url, start, end, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface CentralDirectory {
  size: number;
  /** Absolute offset of the central directory. */
  cdOffset: number;
  cdSize: number;
  entries: number;
}

async function readEndRecord(url: string, size: number): Promise<CentralDirectory> {
  const tailLen = Math.min(size, 65557);
  let tail = await readRange(url, size, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`No end-of-central-directory record in ${url}`);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let entries = tail.readUInt16LE(eocd + 10);

  // Zip64 when any field is saturated: the real values live in the Zip64 record
  // that precedes this one.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff) {
    const locatorPos = eocd - 20;
    if (locatorPos >= 0 && tail.readUInt32LE(locatorPos) === SIG_EOCD64_LOC) {
      const z64Offset = Number(tail.readBigUInt64LE(locatorPos + 8));
      const z64 = await readRange(url, size, z64Offset, 56);
      if (z64.readUInt32LE(0) === SIG_EOCD64) {
        entries = Number(z64.readBigUInt64LE(32));
        cdSize = Number(z64.readBigUInt64LE(40));
        cdOffset = Number(z64.readBigUInt64LE(48));
      }
    }
  }
  return { size, cdOffset, cdSize, entries };
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function parseCentralHeader(buf: Buffer, pos: number): Entry | null {
  if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CEN) return null;
  const method = buf.readUInt16LE(pos + 10);
  const compressedSize = buf.readUInt32LE(pos + 20);
  const uncompressedSize = buf.readUInt32LE(pos + 24);
  const nameLen = buf.readUInt16LE(pos + 28);
  const extraLen = buf.readUInt16LE(pos + 30);
  const commentLen = buf.readUInt16LE(pos + 32);
  const localOffset = buf.readUInt32LE(pos + 42);
  if (pos + 46 + nameLen > buf.length) return null;
  const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
  const total = 46 + nameLen + extraLen + commentLen;
  return { name, method, compressedSize, uncompressedSize, localOffset };
}

/**
 * Locate one central-directory entry without downloading the directory.
 *
 * The central directory is sorted by name (zip writers use a byte-wise sort when
 * every name is pure ASCII, which these are). Binary search finds a byte range
 * that brackets the target, then a linear scan over that bracket finds the exact
 * header. If the search fails - a package written with a different collation -
 * we fall back to reading the whole directory rather than reporting a 404 for a
 * file that exists.
 */
async function findEntry(url: string, cd: CentralDirectory, target: string): Promise<Entry | null> {
  const WINDOW = 64 * 1024;
  let lo = 0;
  let hi = cd.cdSize;

  while (hi - lo > WINDOW) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const probe = await readRange(url, cd.size, cd.cdOffset + mid, WINDOW);
    let pos = probe.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    // Scanning at most a window at a time keeps this bounded even if the byte
    // pattern appears inside a name.
    if (pos < 0) {
      pos = 0;
    }
    const entry = parseCentralHeader(probe.subarray(pos), 0);
    if (!entry) {
      // Cannot align on a header here; shrink the bracket instead of guessing.
      hi = mid;
      continue;
    }
    if (entry.name < target) lo = mid + pos + 1;
    else if (entry.name > target) hi = mid + pos;
    else {
      const exact = await walk(url, cd, mid + pos - 2048, 4096, target);
      if (exact) return exact;
      hi = mid + pos;
    }
  }

  const window = await readRange(url, cd.size, cd.cdOffset + Math.max(0, lo - 128), hi - lo + 512);
  const found = parseCentralHeader(window, 0);
  if (found && found.name === target) return found;
  const walked = await walkBuffer(window, target);
  if (walked) return walked;

  // Fallback: read the full directory.
  const full = await readRange(url, cd.size, cd.cdOffset, cd.cdSize);
  return walkBuffer(full, target);
}

async function walk(url: string, cd: CentralDirectory, start: number, len: number, target: string) {
  const from = Math.max(0, start);
  const buf = await readRange(url, cd.size, cd.cdOffset + from, len);
  return walkBuffer(buf, target);
}

function walkBuffer(buf: Buffer, target: string): Entry | null {
  let pos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  while (pos >= 0 && pos + 46 <= buf.length) {
    const entry = parseCentralHeader(buf, pos);
    if (entry && entry.name === target) return entry;
    if (!entry) break;
    const next = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), pos + 4);
    pos = next;
  }
  return null;
}

/** Read and inflate the bytes of one entry. */
async function readEntry(url: string, size: number, entry: Entry): Promise<Buffer> {
  const local = await readRange(url, size, entry.localOffset, 30);
  if (local.readUInt32LE(0) !== SIG_LOC) throw new Error(`Bad local header for ${entry.name}`);
  const nameLen = local.readUInt16LE(26);
  const extraLen = local.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const raw = await readRange(url, size, dataStart, entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(raw);
    } catch (err) {
      // Retry once with a fresh copy: a truncated block read shows up here.
      const again = await readRange(url, size, dataStart, entry.compressedSize);
      return zlib.inflateRawSync(again);
    }
  }
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Extract `name` from the zip at `url`. Results are memoised per url+name, so
 * revisiting a character (or opening its backdrop) costs nothing.
 */
export async function extractFromZip(
  url: string,
  size: number,
  name: string
): Promise<ExtractedFile> {
  const key = `${url}#${name}`;
  const hit = modelCache.get(key);
  if (hit) {
    modelCache.delete(key);
    modelCache.set(key, hit);
    return hit;
  }
  const started = Date.now();
  const cd = await readEndRecord(url, size);
  const entry = await findEntry(url, cd, name);
  if (!entry) throw new RangeError404(`${name} is not in ${url}`);
  const data = await readEntry(url, size, entry);
  if (data.length !== entry.uncompressedSize) {
    throw new Error(`${name}: expected ${entry.uncompressedSize} bytes, inflated ${data.length}`);
  }
  const result: ExtractedFile = {
    name,
    data,
    wireBytes: entry.compressedSize,
    elapsedMs: Date.now() - started,
  };
  modelCache.set(key, result);
  while (modelCache.size > MAX_CACHED_MODELS) {
    const oldest = modelCache.keys().next().value;
    if (oldest === undefined) break;
    modelCache.delete(oldest);
  }
  return result;
}

/** Forget every cached extract (the diagnostics "drop CDN cache" action). */
export function clearRangeCaches() {
  blockCache.clear();
  modelCache.clear();
}

export function rangeCacheStats() {
  let blocks = 0;
  let bytes = 0;
  for (const map of blockCache.values()) {
    blocks += map.size;
    for (const b of map.values()) bytes += b.length;
  }
  let modelBytes = 0;
  for (const m of modelCache.values()) modelBytes += m.data.length;
  return { urls: blockCache.size, blocks, blockBytes: bytes, models: modelCache.size, modelBytes };
}
