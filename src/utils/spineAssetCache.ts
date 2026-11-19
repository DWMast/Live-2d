import { Downloader } from '@esotericsoftware/spine-player';

export interface CachedSpineAssets {
  skeletonUrl: string;
  atlasUrl: string;
  isJson: boolean;
  binary?: Uint8Array;
  jsonText?: string;
  atlasText: string;
  pageBlobUrls: Map<string, string>;
  lastUsed: number;
}

const CACHE_NAME = 'bd2-spine-assets-v2';
const MAX_MEMORY_ENTRIES = 16;
const MAX_CONCURRENT_FETCHES = 4;

const memoryCache = new Map<string, CachedSpineAssets>();
const inflightRequests = new Map<string, Promise<CachedSpineAssets>>();

let activePriorityLoads = 0;
let activePrefetchCount = 0;
let currentConcurrency = 0;
const concurrencyQueue: Array<() => void> = [];

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (currentConcurrency >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => concurrencyQueue.push(resolve));
  }
  currentConcurrency++;
  try {
    return await fn();
  } finally {
    currentConcurrency--;
    const next = concurrencyQueue.shift();
    if (next) next();
  }
}

function makeCacheKey(skeletonUrl: string, atlasUrl: string): string {
  return `${skeletonUrl}|${atlasUrl}`;
}

function evictLruIfNeeded() {
  if (memoryCache.size <= MAX_MEMORY_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    const oldEntry = memoryCache.get(oldestKey);
    if (oldEntry) {
      for (const blobUrl of oldEntry.pageBlobUrls.values()) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // ignore
        }
      }
    }
    memoryCache.delete(oldestKey);
  }
}

/**
 * Parse page image filenames directly from a Spine .atlas file.
 */
export function parseAtlasPageFilenames(atlasText: string): string[] {
  const pages: string[] = [];
  const lines = atlasText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (!trimmed.includes(':') && /\.(png|webp|jpg|jpeg)$/i.test(trimmed)) {
      if (!pages.includes(trimmed)) {
        pages.push(trimmed);
      }
    }
  }
  return pages;
}

async function openAssetCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function parseRetryAfterHeader(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.min(6000, Math.max(500, Math.round(sec * 1000)));
  }
  return null;
}

async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchWithRetry(url: string, signal?: AbortSignal, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} loading ${url}`) as Error & {
          status?: number;
          retryAfterMs?: number | null;
        };
        err.status = res.status;
        err.retryAfterMs = parseRetryAfterHeader(res);
        throw err;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw err;
      }
      const typed = err as { status?: number; retryAfterMs?: number | null };
      const status = typed?.status;
      if (status === 404 || status === 400 || status === 403) break;
      if (i < attempts - 1) {
        const baseDelay =
          status === 429
            ? typed.retryAfterMs ?? 700 * Math.pow(2, i)
            : status === 502 || status === 503 || status === 504
            ? 500 * Math.pow(2, i)
            : 400 * (i + 1);
        const jitter = Math.floor(Math.random() * 250);
        await waitWithAbort(baseDelay + jitter, signal);
      }
    }
  }
  throw lastError;
}

async function fetchWithPersistentCache(
  url: string,
  cache: Cache | null,
  signal?: AbortSignal
): Promise<Response> {
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit && hit.ok) {
        return hit;
      }
    } catch {
      // ignore Cache API read errors
    }
  }

  return withConcurrencyLimit(async () => {
    const res = await fetchWithRetry(url, signal, 4);
    if (cache) {
      try {
        const clone = res.clone();
        void cache.put(url, clone).catch(() => {});
      } catch {
        // ignore Cache API write errors
      }
    }
    return res;
  });
}

async function fetchBinaryAsset(
  url: string,
  cache: Cache | null,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const res = await fetchWithPersistentCache(url, cache, signal);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

async function fetchTextAsset(
  url: string,
  cache: Cache | null,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetchWithPersistentCache(url, cache, signal);
  return await res.text();
}

async function fetchTextureBlobUrl(
  url: string,
  cache: Cache | null,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetchWithPersistentCache(url, cache, signal);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function looksLikeJsonBytes(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  ) {
    i++;
  }
  return i < bytes.length && bytes[i] === 0x7b;
}

/**
 * Download .skel or .json, .atlas, AND textures with bounded concurrency, retries,
 * in-memory LRU, and persistent CacheStorage.
 */
export async function loadSpineAssetsFast(
  skeletonUrl: string,
  atlasUrl: string,
  signal?: AbortSignal,
  isPriority = true
): Promise<CachedSpineAssets> {
  const key = makeCacheKey(skeletonUrl, atlasUrl);

  const memHit = memoryCache.get(key);
  if (memHit) {
    memHit.lastUsed = Date.now();
    return memHit;
  }

  const existingInflight = inflightRequests.get(key);
  if (existingInflight && !signal) {
    return existingInflight;
  }

  if (isPriority) activePriorityLoads++;

  const work = (async () => {
    const cache = await openAssetCache();
    const atlasDir = atlasUrl.includes('/')
      ? atlasUrl.slice(0, atlasUrl.lastIndexOf('/') + 1)
      : '';

    // Only attempt speculative .png for co-located BD2 .atlas files
    const isSpeculativeDisabled =
      atlasUrl.includes('/api/daicore/') ||
      atlasUrl.includes('/api/haze-spine/') ||
      atlasUrl.includes('/api/echo-spine/') ||
      atlasUrl.includes('/api/al-spine/') ||
      atlasUrl.includes('/api/mad-spine/') ||
      atlasUrl.includes('/api/anchor-spine/');
    const speculativePngUrl = atlasUrl.replace(/\.atlas(\.prefab)?$/i, '.png');
    const speculativePngPromise =
      !isSpeculativeDisabled && speculativePngUrl !== atlasUrl
        ? fetchTextureBlobUrl(speculativePngUrl, cache, signal).catch(() => null)
        : Promise.resolve(null);

    // Launch skeleton & tiny atlas fetch concurrently, then immediately start downloading
    // texture pages as soon as atlas arrives instead of waiting for huge .json files.
    const skeletonPromise = fetchBinaryAsset(skeletonUrl, cache, signal);

    const atlasText = await fetchTextAsset(atlasUrl, cache, signal);
    const pageNames = parseAtlasPageFilenames(atlasText);
    const pageBlobUrls = new Map<string, string>();

    const pagesPromise = Promise.all(
      pageNames.map(async (pageName) => {
        const encodedPage = pageName
          .split('/')
          .map((seg) => encodeURIComponent(seg))
          .join('/');
        const pageUrl = `${atlasDir}${pageName}`;
        const fetchUrl = `${atlasDir}${encodedPage}`;
        if (pageUrl === speculativePngUrl) {
          const specBlobUrl = await speculativePngPromise;
          if (specBlobUrl) {
            pageBlobUrls.set(pageUrl, specBlobUrl);
            return;
          }
        }
        const blobUrl = await fetchTextureBlobUrl(fetchUrl, cache, signal);
        pageBlobUrls.set(pageUrl, blobUrl);
      })
    );

    const [skeletonBytes] = await Promise.all([skeletonPromise, pagesPromise]);

    if (!pageBlobUrls.has(speculativePngUrl)) {
      const unused = await speculativePngPromise;
      if (unused) {
        try {
          URL.revokeObjectURL(unused);
        } catch {
          // ignore
        }
      }
    }

    const isJson = looksLikeJsonBytes(skeletonBytes);
    const entry: CachedSpineAssets = {
      skeletonUrl,
      atlasUrl,
      isJson,
      binary: isJson ? undefined : skeletonBytes,
      jsonText: isJson ? new TextDecoder('utf-8').decode(skeletonBytes) : undefined,
      atlasText,
      pageBlobUrls,
      lastUsed: Date.now(),
    };

    memoryCache.set(key, entry);
    evictLruIfNeeded();
    return entry;
  })();

  if (!signal) {
    inflightRequests.set(key, work);
    work.finally(() => {
      inflightRequests.delete(key);
    });
  }

  try {
    return await work;
  } finally {
    if (isPriority) activePriorityLoads = Math.max(0, activePriorityLoads - 1);
  }
}

/**
 * Low-priority background prefetch (skips if an active priority load or prefetch is running).
 */
export function prefetchSpineAssets(skeletonUrl: string, atlasUrl: string): void {
  if (activePriorityLoads > 0 || activePrefetchCount > 0) return;
  const key = makeCacheKey(skeletonUrl, atlasUrl);
  if (memoryCache.has(key) || inflightRequests.has(key)) return;
  activePrefetchCount++;
  void loadSpineAssetsFast(skeletonUrl, atlasUrl, undefined, false)
    .catch(() => {
      // ignore background prefetch failures
    })
    .finally(() => {
      activePrefetchCount = Math.max(0, activePrefetchCount - 1);
    });
}

/**
 * Create a zero-copy Spine Downloader for any Spine runtime version (3.8, 4.0, 4.1, 4.2)
 * that serves pre-fetched Uint8Array / string / blob: URLs directly from RAM.
 */
export function createCachedDownloader<T extends Downloader>(
  DownloaderCtor: new () => T,
  assets: CachedSpineAssets
): T {
  const downloader = new DownloaderCtor();
  const originalDownloadText = downloader.downloadText.bind(downloader);
  const originalDownloadBinary = downloader.downloadBinary.bind(downloader);

  for (const [pageUrl, blobUrl] of assets.pageBlobUrls.entries()) {
    downloader.rawDataUris[pageUrl] = blobUrl;
  }

  downloader.downloadText = (
    url: string,
    success: (data: string) => void,
    error: (status: number, responseText: string) => void
  ) => {
    if (url === assets.atlasUrl) {
      queueMicrotask(() => success(assets.atlasText));
      return;
    }
    if (assets.isJson && url === assets.skeletonUrl && assets.jsonText !== undefined) {
      queueMicrotask(() => success(assets.jsonText!));
      return;
    }
    originalDownloadText(url, success, error);
  };

  downloader.downloadBinary = (
    url: string,
    success: (data: Uint8Array) => void,
    error: (status: number, responseText: string) => void
  ) => {
    if (!assets.isJson && url === assets.skeletonUrl && assets.binary !== undefined) {
      queueMicrotask(() => success(assets.binary!));
      return;
    }
    originalDownloadBinary(url, success, error);
  };

  return downloader;
}

export class CachedSpineDownloader extends Downloader {
  private binaries = new Map<string, Uint8Array>();
  private texts = new Map<string, string>();

  constructor(assets: CachedSpineAssets) {
    super();
    if (assets.binary) {
      this.binaries.set(assets.skeletonUrl, assets.binary);
    }
    if (assets.jsonText !== undefined) {
      this.texts.set(assets.skeletonUrl, assets.jsonText);
    }
    this.texts.set(assets.atlasUrl, assets.atlasText);
    for (const [pageUrl, blobUrl] of assets.pageBlobUrls.entries()) {
      this.rawDataUris[pageUrl] = blobUrl;
    }
  }

  override downloadText(
    url: string,
    success: (data: string) => void,
    error: (status: number, responseText: string) => void
  ): void {
    const cached = this.texts.get(url);
    if (cached !== undefined) {
      queueMicrotask(() => success(cached));
      return;
    }
    super.downloadText(url, success, error);
  }

  override downloadBinary(
    url: string,
    success: (data: Uint8Array) => void,
    error: (status: number, responseText: string) => void
  ): void {
    const cached = this.binaries.get(url);
    if (cached !== undefined) {
      queueMicrotask(() => success(cached));
      return;
    }
    super.downloadBinary(url, success, error);
  }
}
