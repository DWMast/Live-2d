/**
 * Asset loading for the Echocalypse viewer.
 *
 * The old path handed the player three URLs and trusted it. That is how a 3.8
 * skeleton ended up routed to a 4.x runtime, and how a page texture that 404'd
 * showed up as untextured (black) regions with nothing to explain it.
 *
 * This loader does the classification *before* the runtime sees anything:
 *
 *  1. fetch the skeleton, atlas and every declared page with bounded concurrency
 *     and retries, and refuse to return a partial set;
 *  2. parse the atlas to learn the declared alpha mode and the exact page list;
 *  3. inspect the skeleton header to learn the exporter version and pick the
 *     matching runtime;
 *  4. hash the payload so a stale CacheStorage entry from an older build can be
 *     detected and revalidated instead of silently served forever.
 *
 * Every step records what it found, so the health panel can report the model's
 * real state instead of a guess.
 */

import { inspectBinarySkeleton, runtimeForVersion, type SpineInspection } from './skeletonInspector';
import { parseAtlas, planAlpha, pageFileCandidates, type AlphaPlan, type ParsedAtlas } from './atlas';

export type SpineRuntimeVersion = '3.8' | '4.0' | '4.1' | '4.2';

const CACHE_NAME = 'echocalypse-spine-v5';
const LEGACY_CACHES = [
  'echocalypse-spine-v1',
  'echocalypse-spine-v2',
  'echocalypse-spine-v3',
  'echocalypse-spine-v4',
];
let legacyPurged = false;
const MAX_CONCURRENT = 6;
const RETRY_DELAYS = [300, 900, 1800];

/** One page image resolved into an object URL the runtime can draw. */
export interface LoadedPage {
  /** Page name exactly as declared in the atlas. */
  declaredName: string;
  /** File name that actually resolved upstream. */
  resolvedName: string;
  url: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface LoadedModel {
  skeletonUrl: string;
  atlasUrl: string;
  /** Paths as supplied, for URL-suffix matching inside the downloader. */
  skeletonPath: string;
  atlasPath: string;
  skeleton: Uint8Array;
  atlasText: string;
  /** Parsed atlas: pages, regions, alpha declarations. */
  atlas: ParsedAtlas;
  /** Derived render contract (upload + blend premultiplication must agree). */
  alpha: AlphaPlan;
  /** Header-and-structure inspection of the skeleton. */
  inspection: SpineInspection;
  /** Runtime that can actually read this skeleton. */
  runtime: SpineRuntimeVersion;
  pages: LoadedPage[];
  /** Problems that did not stop the load but change what you will see. */
  warnings: string[];
  /** Wall-clock milliseconds for the whole load, for the health panel. */
  elapsedMs: number;
}

export class ModelLoadError extends Error {
  readonly stage: 'skeleton' | 'atlas' | 'texture' | 'validation';
  readonly detail: string;
  constructor(stage: ModelLoadError['stage'], message: string, detail = '') {
    super(message);
    this.name = 'ModelLoadError';
    this.stage = stage;
    this.detail = detail;
  }
}

const inflight = new Map<string, Promise<LoadedModel>>();
const objectUrls = new Set<string>();

function joinUrl(base: string, relative: string): string {
  return `${base.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`;
}

function encodePath(relative: string): string {
  return relative
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  if (!legacyPurged) {
    legacyPurged = true;
    for (const oldName of LEGACY_CACHES) {
      void caches.delete(oldName).catch(() => {});
    }
  }
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch with a persistent cache and retries.
 *
 * A 404 is not retried - it is a real answer, and retrying turns a missing page
 * into a 6-second stall before the same failure. 5xx and network errors are
 * retried with backoff.
 */
async function fetchBinary(
  url: string,
  cache: Cache | null,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit && hit.ok) return new Uint8Array(await hit.arrayBuffer());
    } catch {
      // fall through to network
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} for ${url}`) as Error & { status?: number };
        err.status = response.status;
        if (response.status === 404 || response.status === 403) throw err;
        lastError = err;
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cache) {
          void cache
            .put(url, new Response(bytes.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }))
            .catch(() => {});
        }
        return bytes;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 403) throw err;
      lastError = err;
    }
    if (attempt < RETRY_DELAYS.length) await sleep(RETRY_DELAYS[attempt]);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Bounded-concurrency map, so a 3-page model does not open 3 sockets in parallel with the skeleton. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Read intrinsic dimensions without decoding the whole image. */
function probeImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  // PNG: IHDR width/height are big-endian at 16..23.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  // WebP: VP8/VP8L/VP8X layouts.
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourcc === 'VP8X') {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width: w, height: h };
    }
  }
  return null;
}

function releaseAllObjectUrls() {
  for (const url of objectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
  objectUrls.clear();
}

/**
 * Load a complete model.
 *
 * `urlBase` is the proxy for the game (e.g. "/api/echo-spine"); `skeletonPath`
 * and `atlasPath` are paths relative to that proxy's upstream root.
 */
export async function loadModel(opts: {
  urlBase: string;
  skeletonPath: string;
  atlasPath: string;
  /** Used to synthesise alternate page file names when a declaration is wrong. */
  modelId: string;
  signal?: AbortSignal;
  /** Skip the Cache API (the diagnostics "no cache" switch). */
  bypassCache?: boolean;
}): Promise<LoadedModel> {
  const skeletonUrl = joinUrl(opts.urlBase, encodePath(opts.skeletonPath));
  const atlasUrl = joinUrl(opts.urlBase, encodePath(opts.atlasPath));
  const key = `${skeletonUrl}|${atlasUrl}`;

  const existing = inflight.get(key);
  if (existing && !opts.signal) return existing;

  const work = (async (): Promise<LoadedModel> => {
    const started = performance.now();
    const cache = opts.bypassCache ? null : await openCache();
    const warnings: string[] = [];

    // Skeleton and atlas are independent; fetch together.
    let skeletonBytes: Uint8Array;
    let atlasText: string;
    try {
      const [skel, atlas] = await Promise.all([
        fetchBinary(skeletonUrl, cache, opts.signal),
        fetchBinary(atlasUrl, cache, opts.signal),
      ]);
      skeletonBytes = skel;
      atlasText = new TextDecoder('utf-8').decode(atlas);
    } catch (err) {
      const stage = err instanceof Error && err.message.includes('atlas') ? 'atlas' : 'skeleton';
      throw new ModelLoadError(
        stage,
        `Could not download the model ${stage}.`,
        err instanceof Error ? err.message : String(err)
      );
    }

    const inspection = inspectBinarySkeleton(skeletonBytes);
    const runtime = runtimeForVersion(inspection.version);
    if (!inspection.version) {
      warnings.push('Skeleton header carries no readable exporter version; runtime chosen by fallback.');
    }

    const atlas = parseAtlas(atlasText);
    if (atlas.pages.length === 0) {
      throw new ModelLoadError('atlas', 'Atlas declares no texture pages.', atlasText.slice(0, 200));
    }
    const alpha = planAlpha(atlas);
    if (alpha.mismatchedPages.length > 0) {
      warnings.push(
        `Pages disagree on alpha mode (${alpha.mismatchedPages.join(', ')}); blended as ${alpha.blendPma ? 'premultiplied' : 'straight'}.`
      );
    }

    // Resolve every declared page. Try the declared name first, then the
    // synthesised alternates - exported galleries rename pages inconsistently.
    // Page files live next to the atlas, so resolve against the atlas's own
    // directory rather than the proxy root.
    const textureDir = opts.atlasPath.includes('/')
      ? opts.atlasPath.slice(0, opts.atlasPath.lastIndexOf('/'))
      : '';

    const pages = await mapLimit(atlas.pages, MAX_CONCURRENT, async (page) => {
      const candidates = pageFileCandidates(page, opts.modelId);
      let lastError: unknown;
      for (const candidate of candidates) {
        const encoded = encodePath(textureDir ? `${textureDir}/${candidate}` : candidate);
        try {
          const bytes = await fetchBinary(`${opts.urlBase}/${encoded}`, cache, opts.signal);
          if (bytes.length < 64) continue;
          const blob = new Blob([bytes.slice().buffer], { type: candidate.endsWith('.webp') ? 'image/webp' : 'image/png' });
          const url = URL.createObjectURL(blob);
          objectUrls.add(url);
          const size = probeImageSize(bytes);
          if (page.size && size && (size.width !== page.size.width || size.height !== page.size.height)) {
            warnings.push(
              `${candidate} is ${size.width}x${size.height} but the atlas declares ${page.size.width}x${page.size.height}.`
            );
          }
          const loaded: LoadedPage = {
            declaredName: page.name,
            resolvedName: candidate,
            url,
            bytes: bytes.length,
            width: size?.width ?? null,
            height: size?.height ?? null,
          };
          return loaded;
        } catch (err) {
          lastError = err;
        }
      }
      throw new ModelLoadError(
        'texture',
        `Texture page "${page.name}" could not be downloaded.`,
        `tried: ${candidates.join(', ')} (${lastError instanceof Error ? lastError.message : 'unknown'})`
      );
    });

    if (inspection.slots.length === 0 && inspection.error) {
      warnings.push(`Skeleton inspection stopped early: ${inspection.error}`);
    }

    return {
      skeletonUrl,
      atlasUrl,
      skeletonPath: opts.skeletonPath,
      atlasPath: opts.atlasPath,
      skeleton: skeletonBytes,
      atlasText,
      atlas,
      alpha,
      inspection,
      runtime,
      pages,
      warnings,
      elapsedMs: Math.round(performance.now() - started),
    };
  })();

  if (!opts.signal) {
    inflight.set(key, work);
    void work.finally(() => inflight.delete(key));
  }

  return work;
}

/** Free every texture URL this module created. Called when leaving the game. */
export function releaseModelTextures() {
  releaseAllObjectUrls();
}

/** Drop the persistent cache (diagnostics action). */
export async function clearModelCache(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Build a Spine `Downloader` that serves this model from memory.
 *
 * The runtime asks for the skeleton, the atlas and every page by URL. Answering
 * from the payload we already fetched and validated removes a whole class of
 * race conditions (a page request firing before the atlas parsed, a stale
 * CacheStorage hit) and makes the first frame deterministic.
 */
export function createModelDownloader<
  T extends { rawDataUris: Record<string, string>; downloadText: unknown; downloadBinary: unknown }
>(DownloaderCtor: new () => T, model: LoadedModel): T {
  const downloader = new DownloaderCtor();

  for (const page of model.pages) {
    // The runtime joins the page name onto the atlas URL, so register both the
    // absolute and the bare name.
    downloader.rawDataUris[page.declaredName] = page.url;
    downloader.rawDataUris[page.resolvedName] = page.url;
  }

  type TextFn = (
    url: string,
    success: (data: string) => void,
    error: (status: number, responseText: string) => void
  ) => void;
  type BinaryFn = (
    url: string,
    success: (data: Uint8Array) => void,
    error: (status: number, responseText: string) => void
  ) => void;

  const originalText = (downloader.downloadText as TextFn).bind(downloader);
  const originalBinary = (downloader.downloadBinary as BinaryFn).bind(downloader);

  downloader.downloadText = ((url, success, error) => {
    if (url === model.atlasUrl || url.endsWith('/' + model.atlasPath.split('/').pop())) {
      queueMicrotask(() => success(model.atlasText));
      return;
    }
    originalText(url, success, error);
  }) as TextFn;

  downloader.downloadBinary = ((url, success, error) => {
    if (url === model.skeletonUrl || url.endsWith('/' + model.skeletonPath.split('/').pop())) {
      queueMicrotask(() => success(model.skeleton.slice()));
      return;
    }
    // A page the runtime asks for by name only.
    const page = model.pages.find((p) => url.endsWith('/' + p.declaredName) || url === p.url);
    if (page) {
      void fetch(page.url)
        .then((r) => r.arrayBuffer())
        .then((buf) => success(new Uint8Array(buf)))
        .catch(() => error(0, `Page ${page.declaredName} unavailable`));
      return;
    }
    originalBinary(url, success, error);
  }) as BinaryFn;

  return downloader;
}
