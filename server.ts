import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { gameTextureToPng } from './server/echoTextures.ts';
import { fetchFromCdn, cdnStatus, CdnNotCovered } from './server/echoCdn.ts';
import {
  fetchFromUpgradeHquality,
  upgradeCdnStatus,
  UpgradeCdnNotCovered,
} from './server/echoUpgradeCdn.ts';
import { rangeCacheStats } from './server/remoteZip.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const UPSTREAM_SPINE_BASE = 'https://jelosus2.github.io/BD2-L2D-Viewer/assets/spines';
const UPSTREAM_AUDIO_BASE = 'https://raw.githubusercontent.com/Jelosus2/BD2-L2D-Viewer/main/src/assets/audios';
const UPSTREAM_DAICORE_BASE = 'https://daicoreviewer.jelosus1.dev';
const UPSTREAM_HAZE_BASES = [
  'https://cdn.jsdelivr.net/gh/leililei/cwcx-asset@main',
  'https://raw.githubusercontent.com/leililei/cwcx-asset/main',
];
// Echocalypse assets. jsDelivr is a fast, CORS-friendly CDN but caps individual
// files at 50 MB and throttles large images; raw.githubusercontent has the higher
// throughput ceiling for the ~3 MB atlas pages. Both point at the same commit
// tree, so a file present in one is present in the other.
const UPSTREAM_ECHO_BASES = [
  'https://raw.githubusercontent.com/leililei/echocalypse-spine/main',
  'https://cdn.jsdelivr.net/gh/leililei/echocalypse-spine@main',
];
const UPSTREAM_MAD_BASES = [
  'https://cdn.jsdelivr.net/gh/anyabot/MAD-assets-1@master',
  'https://raw.githubusercontent.com/anyabot/MAD-assets-1/master',
];
const UPSTREAM_AL_SPINE_BASES = [
  'https://cdn.jsdelivr.net/gh/o0Nomar0o/SpineCollections@main',
  'https://raw.githubusercontent.com/o0Nomar0o/SpineCollections/main',
];
// Dragon & Girls Symphony (Idle Huntress) Cubism Live2D models normally live in
// Misekato/TestIHd; the character portraits used as icons live in the IHLive2d
// viewer repo. One namespace handles both since the paths never collide.
const UPSTREAM_GS_BASES = [
  'https://cdn.jsdelivr.net/gh/Misekato/TestIHd@main',
  'https://raw.githubusercontent.com/Misekato/TestIHd/main',
  'https://cdn.jsdelivr.net/gh/Misekato/IHLive2d@main',
  'https://raw.githubusercontent.com/Misekato/IHLive2d/main',
];

const UPSTREAM_AL_ICON_BASES = [
  'https://cdn.jsdelivr.net/gh/leililei/AzurLaneTools@master/public/squareicon',
  'https://raw.githubusercontent.com/leililei/AzurLaneTools/master/public/squareicon',
];

const DISK_CACHE_ROOT = '/tmp/bd2-asset-cache';
const MAX_RAM_CACHE_BYTES = 256 * 1024 * 1024; // 256MB in-memory hot cache

interface RamEntry {
  buffer: Buffer;
  gzipBuffer?: Buffer;
  contentType: string;
  lastUsed: number;
}

const ramCache = new Map<string, RamEntry>();
let ramCacheBytes = 0;
const inflightUpstream = new Map<string, Promise<RamEntry>>();

function buildRamEntry(relPath: string, buffer: Buffer): RamEntry {
  const contentType = getContentType(relPath);
  let gzipBuffer: Buffer | undefined;
  if (/\.(json|skel|atlas)(\.prefab)?$/i.test(relPath) && buffer.byteLength > 1024) {
    try {
      gzipBuffer = zlib.gzipSync(buffer, { level: 6 });
    } catch {
      // ignore gzip failure
    }
  }
  return {
    buffer,
    gzipBuffer,
    contentType,
    lastUsed: Date.now(),
  };
}

function sendCachedEntry(req: express.Request, res: express.Response, entry: RamEntry) {
  res.setHeader('Content-Type', entry.contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (entry.gzipBuffer && /\bgzip\b/i.test(acceptEncoding)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.send(entry.gzipBuffer);
    return;
  }
  res.send(entry.buffer);
}

function putRamCache(key: string, entry: RamEntry) {
  if (entry.buffer.byteLength > 48 * 1024 * 1024) return;
  const existing = ramCache.get(key);
  if (existing) {
    ramCacheBytes -= existing.buffer.byteLength + (existing.gzipBuffer?.byteLength || 0);
    ramCache.delete(key);
  }
  const entryBytes = entry.buffer.byteLength + (entry.gzipBuffer?.byteLength || 0);
  while (ramCacheBytes + entryBytes > MAX_RAM_CACHE_BYTES && ramCache.size > 0) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of ramCache.entries()) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (!oldestKey) break;
    const evicted = ramCache.get(oldestKey);
    if (evicted) {
      ramCacheBytes -= evicted.buffer.byteLength + (evicted.gzipBuffer?.byteLength || 0);
    }
    ramCache.delete(oldestKey);
  }
  ramCache.set(key, entry);
  ramCacheBytes += entryBytes;
}

function getContentType(relPath: string): string {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.atlas') || lower.endsWith('.atlas.prefab') || lower.endsWith('.mtn')) {
    return 'text/plain; charset=utf-8';
  }
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

function sanitizeAssetPath(rawPath: string, allowedExts: RegExp): string | null {
  const cleaned = rawPath.replace(/^\/+/, '').split('?')[0];
  if (!cleaned || cleaned.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(cleaned)) {
    return null;
  }
  if (!allowedExts.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function sanitizeUtf8AssetPath(rawPath: string, allowedExts: RegExp): string | null {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  const cleaned = decoded.replace(/^\/+/, '').split('?')[0];
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\\') || /[\0-\x1f]/.test(cleaned)) {
    return null;
  }
  if (!allowedExts.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function encodeUrlSegments(relPath: string): string {
  return relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function fetchUpstreamWithRetry(url: string, attempts = 3): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const err = new Error(`Upstream HTTP ${res.status}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 403) break;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Keep the on-disk cache bounded. Decoded echocalypse sheets are ~6.7 MB each, so
 * a two-hundred-character browse would otherwise leave gigabytes behind in /tmp.
 * Files are evicted oldest-first once the total passes the ceiling.
 */
const MAX_DISK_CACHE_BYTES = 768 * 1024 * 1024;
let diskTrimRunning = false;

async function trimDiskCache() {
  if (diskTrimRunning) return;
  diskTrimRunning = true;
  try {
    const files: Array<{ path: string; size: number; atime: number }> = [];
    let total = 0;
    const walk = async (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          try {
            const st = await fsp.stat(full);
            files.push({ path: full, size: st.size, atime: st.atimeMs });
            total += st.size;
          } catch {
            // raced with another writer; skip
          }
        }
      }
    };
    await walk(DISK_CACHE_ROOT);
    if (total <= MAX_DISK_CACHE_BYTES) return;
    files.sort((a, b) => a.atime - b.atime);
    for (const f of files) {
      if (total <= MAX_DISK_CACHE_BYTES * 0.8) break;
      try {
        await fsp.unlink(f.path);
        total -= f.size;
      } catch {
        // already gone
      }
    }
  } finally {
    diskTrimRunning = false;
  }
}

async function resolveCachedAsset(
  namespace:
    | 'spines'
    | 'audios'
    | 'daicore'
    | 'haze-spines'
    | 'echo-spines-hq'
    | 'echo-pics-hq'
    | 'al-spines'
    | 'al-icons'
    | 'mad-spines'
    | 'anchor-spines'
    | 'gs-live2d',
  relPath: string,
  upstreamBases: string | string[],
  encodePathForUpstream = false
): Promise<RamEntry> {
  const cacheKey = `${namespace}/${relPath}`;
  const memHit = ramCache.get(cacheKey);
  if (memHit) {
    memHit.lastUsed = Date.now();
    return memHit;
  }

  // Check local bundled public/spines first if applicable
  if (namespace === 'spines') {
    const localPublicPath = path.join(__dirname, 'public', 'spines', relPath);
    if (fs.existsSync(localPublicPath)) {
      const buffer = await fsp.readFile(localPublicPath);
      const entry = buildRamEntry(relPath, buffer);
      putRamCache(cacheKey, entry);
      return entry;
    }
  }

  // Check disk cache
  const diskPath = path.join(DISK_CACHE_ROOT, namespace, relPath);
  if (fs.existsSync(diskPath)) {
    try {
      const buffer = await fsp.readFile(diskPath);
      const entry = buildRamEntry(relPath, buffer);
      putRamCache(cacheKey, entry);
      return entry;
    } catch {
      // fall through to upstream fetch
    }
  }

  const existingInflight = inflightUpstream.get(cacheKey);
  if (existingInflight) {
    return existingInflight;
  }

  const bases = Array.isArray(upstreamBases) ? upstreamBases : [upstreamBases];
  const upstreamRel = encodePathForUpstream ? encodeUrlSegments(relPath) : relPath;

  const work = (async () => {
    let buffer: Buffer | null = null;
    let lastErr: unknown;
    const isEchoHq = namespace === 'echo-spines-hq' || namespace === 'echo-pics-hq';

    if (isEchoHq) {
      try {
        buffer = await fetchFromUpgradeHquality(relPath);
      } catch (err) {
        if (!(err instanceof UpgradeCdnNotCovered)) {
          throw err;
        }
        lastErr = err;
      }

      if (!buffer) {
        try {
          buffer = await fetchFromCdn(relPath);
        } catch (err) {
          if (!(err instanceof CdnNotCovered)) {
            console.warn(`[echo] CDN fallback failed for ${relPath}: ${(err as Error).message}`);
          }
          lastErr = err;
        }
      }

      if (!buffer) {
        for (const base of bases) {
          try {
            buffer = await fetchUpstreamWithRetry(`${base}/${upstreamRel}`, 2);
            break;
          } catch (err) {
            lastErr = err;
          }
        }
      }
    } else {
      for (const base of bases) {
        try {
          buffer = await fetchUpstreamWithRetry(`${base}/${upstreamRel}`, 2);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
    }

    if (!buffer) {
      throw lastErr || new Error(`Failed to fetch ${relPath}`);
    }

    // Echocalypse sheets arrive as `UF` containers holding ETC2 blocks, which no
    // browser can read. Decode them here, once, and cache the PNG rather than the
    // container: the decode costs ~250 ms per sheet and the PNG is what every
    // later request wants.
    let served = buffer;
    if (isEchoHq) {
      try {
        const decoded = gameTextureToPng(buffer);
        if (decoded) served = decoded.png;
      } catch (err) {
        // A container we cannot decode is still better served raw than not at all,
        // but say so loudly - a silent fallback is what made the old viewer look
        // like it was working on textures it was mangling.
        console.warn(`[echo] could not decode ${relPath}: ${(err as Error).message}`);
      }
    }

    const entry = buildRamEntry(relPath, served);
    putRamCache(cacheKey, entry);

    // Persist asynchronously to disk cache
    void (async () => {
      try {
        await fsp.mkdir(path.dirname(diskPath), { recursive: true });
        await fsp.writeFile(diskPath, served);
        await trimDiskCache();
      } catch {
        // ignore disk cache write failure
      }
    })();

    return entry;
  })();

  inflightUpstream.set(cacheKey, work);
  try {
    return await work;
  } finally {
    inflightUpstream.delete(cacheKey);
  }
}

async function startServer() {
  // Purge legacy non-upgrade_hquality Echocalypse disk caches if present
  void (async () => {
    for (const legacyDir of ['echo-spines', 'echo-pics']) {
      const target = path.join(DISK_CACHE_ROOT, legacyDir);
      if (fs.existsSync(target)) {
        try {
          await fsp.rm(target, { recursive: true, force: true });
        } catch {
          // ignore cleanup failure
        }
      }
    }
  })();

  const app = express();

  app.get('/api/bd2-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeAssetPath(rawParam, /\.(skel|atlas|png|webp|jpg|jpeg|json)$/i);
    if (!relPath) {
      res.status(400).json({ error: 'Invalid spine asset path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('spines', relPath, UPSTREAM_SPINE_BASE);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch spine asset: ${relPath}` });
    }
  });

  app.get('/api/bd2-audio/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeAssetPath(rawParam, /\.(webm|mp3|ogg|wav)$/i);
    if (!relPath) {
      res.status(400).json({ error: 'Invalid audio asset path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('audios', relPath, UPSTREAM_AUDIO_BASE);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch audio asset: ${relPath}` });
    }
  });

  app.get('/api/daicore/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(json|skel|atlas|png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Daiblos Core asset path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('daicore', relPath, UPSTREAM_DAICORE_BASE, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Daiblos Core asset: ${relPath}` });
    }
  });

  app.get('/api/haze-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(skel|atlas|json)(\.prefab)?$|\.(png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Haze Reverb spine path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('haze-spines', relPath, UPSTREAM_HAZE_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Haze Reverb asset: ${relPath}` });
    }
  });

  app.get('/api/mad-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(skel|atlas|json|png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid MAD asset path' });
      return;
    }
    try {
      const candidates = [relPath];
      const skinMatch = relPath.match(/^skins\/([^/]+)\/(.+)$/i);
      if (skinMatch && !skinMatch[1].includes('__')) {
        candidates.push(`skins/${skinMatch[1]}__google/${skinMatch[2]}`);
        candidates.push(`skins/${skinMatch[1]}__onestore/${skinMatch[2]}`);
      }
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          const entry = await resolveCachedAsset('mad-spines', candidate, UPSTREAM_MAD_BASES, true);
          sendCachedEntry(req, res, entry);
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError;
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch MAD asset: ${relPath}` });
    }
  });

  // The health panel uses this to tell "this character is not in any source" apart
  // from "this character failed to load", which otherwise look identical.
  app.get('/api/echo-source-status', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      sources: {
        upgradeHquality: upgradeCdnStatus(),
        cdn: cdnStatus(),
        ripFallback: { bases: UPSTREAM_ECHO_BASES },
      },
      rangeCache: rangeCacheStats(),
    });
  });

  app.get('/api/echo-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(json|skel|atlas|png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Echocalypse spine path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('echo-spines-hq', relPath, UPSTREAM_ECHO_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Echocalypse asset: ${relPath}` });
    }
  });

  // Character portraits (knightAvatar / fragment). These are small and stable, so
  // they get a long-lived immutable cache header and no gzip.
  app.get('/api/echo-pic/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(rawParam, /\.(png|webp|jpg|jpeg)$/i);
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Echocalypse portrait path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('echo-pics-hq', relPath, UPSTREAM_ECHO_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Echocalypse portrait: ${relPath}` });
    }
  });

  app.get('/api/al-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(json|skel|atlas|png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Azur Lane spine path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('al-spines', relPath, UPSTREAM_AL_SPINE_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Azur Lane spine asset: ${relPath}` });
    }
  });

  app.get('/api/anchor-spine/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(
      rawParam,
      /\.(json|skel|atlas|png|webp|jpg|jpeg)$/i
    );
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Anchor Panic spine path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('anchor-spines', relPath, UPSTREAM_AL_SPINE_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Anchor Panic asset: ${relPath}` });
    }
  });

  // Dragon & Girls Symphony (Idle Huntress) Cubism Live2D assets + portrait icons.
  app.get('/api/gs-live2d/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(rawParam, /\.(json|moc3|png|webp|jpg|jpeg)$/i);
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Dragon & Girls Symphony asset path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('gs-live2d', relPath, UPSTREAM_GS_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch DGS Live2D asset: ${relPath}` });
    }
  });

  app.get('/api/al-icon/*', async (req, res) => {
    const rawParam = (req.params as Record<string, string>)[0] ?? '';
    const relPath = sanitizeUtf8AssetPath(rawParam, /\.(png|webp|jpg|jpeg)$/i);
    if (!relPath) {
      res.status(400).json({ error: 'Invalid Azur Lane icon path' });
      return;
    }
    try {
      const entry = await resolveCachedAsset('al-icons', relPath, UPSTREAM_AL_ICON_BASES, true);
      sendCachedEntry(req, res, entry);
    } catch (err) {
      const status = (err as { status?: number })?.status || 502;
      res.status(status).json({ error: `Failed to fetch Azur Lane icon: ${relPath}` });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BD2 Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
