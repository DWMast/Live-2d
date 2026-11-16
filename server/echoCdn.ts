/**
 * Second asset source: the live game's own update CDN.
 *
 * The third-party rip this app was built around is a strict subset of what the
 * game ships — it has no entries for the newer heroes, so those characters fail
 * with a 404 no matter how the renderer is configured. The game, however,
 * publishes its update packages publicly, and those packages contain the missing
 * models at full quality.
 *
 * This module turns a catalog request path (`res/common/knight_spine/701060/
 * 701060.skel`) into bytes pulled from the right package:
 *
 *   1. look the path up in an index of every file listed by every package,
 *   2. extract just that entry from the package over HTTP range requests.
 *
 * The index is generated ahead of time (see `tools/build_cdn_index.py`) and
 * committed, so no scraping happens at request time. When a path is not in the
 * index this module reports "not covered" and the caller falls back to the rip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractFromZip, RangeError404 } from './remoteZip.ts';

/** One package listing: the file, and the package that carries it. */
export interface CdnEntry {
  package: string;
  packageSize: number;
  size: number;
}

export interface CdnIndex {
  generatedAt: string;
  /** Request path -> where to find it. */
  files: Record<string, CdnEntry>;
  /** Characters the index can serve, keyed by base character id. */
  byCharacter: Record<string, string[]>;
}

export class CdnNotCovered extends Error {}

let index: CdnIndex | null = null;
let indexError: string | null = null;

/** Load the CDN index, which lives next to the built server. */
export function loadCdnIndex(file?: string): CdnIndex {
  if (index) return index;
  if (indexError) throw new CdnNotCovered(indexError);

  const candidates = file
    ? [file]
    : [
        path.join(process.cwd(), 'public', 'data', 'echocalypse_cdn_index.json'),
        path.join(process.cwd(), 'data', 'echocalypse_cdn_index.json'),
      ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as CdnIndex;
      index = parsed;
      return parsed;
    } catch (err) {
      indexError = `CDN index at ${candidate} is unreadable: ${(err as Error).message}`;
      throw new CdnNotCovered(indexError);
    }
  }

  indexError = 'no CDN index found; run tools/build_cdn_index.py';
  throw new CdnNotCovered(indexError);
}

/** True when the index covers this request path. */
export function cdnCovers(relPath: string): boolean {
  try {
    return Boolean(loadCdnIndex().files[relPath]);
  } catch {
    return false;
  }
}

/** Status of the CDN source, for the health panel. */
export function cdnStatus() {
  try {
    const idx = loadCdnIndex();
    return {
      available: true,
      generatedAt: idx.generatedAt,
      files: Object.keys(idx.files).length,
      characters: Object.keys(idx.byCharacter).length,
      packages: new Set(Object.values(idx.files).map((e) => e.package)).size,
    };
  } catch (err) {
    return { available: false, reason: (err as Error).message };
  }
}

/**
 * Fetch one file from the game CDN.
 *
 * Throws `CdnNotCovered` when the index has no entry, so the caller can fall
 * back to the rip rather than surfacing a 404 for something that may still exist
 * in the other source.
 */
export async function fetchFromCdn(relPath: string): Promise<Buffer> {
  const entry = loadCdnIndex().files[relPath];
  if (!entry) throw new CdnNotCovered(`${relPath} is not in the CDN index`);

  try {
    const file = await extractFromZip(entry.package, entry.packageSize, relPath);
    return file.data;
  } catch (err) {
    if (err instanceof RangeError404) {
      throw new CdnNotCovered(`${relPath} was listed but is missing from ${entry.package}`);
    }
    throw err;
  }
}

/** Serve a whole package and read everything, used by the index builder. */
export function clearCdnIndexForTests() {
  index = null;
  indexError = null;
}
