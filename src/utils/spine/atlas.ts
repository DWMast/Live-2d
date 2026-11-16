/**
 * Spine atlas parsing and alpha-mode detection.
 *
 * Atlas text is a sequence of page blocks followed by region blocks:
 *
 *   page.png                 <- page name
 *   size: 2048,2048
 *   filter: Linear,Linear
 *   repeat: none             <- optional; "pma: true" appears right here
 *   regionName               <- region
 *     rotate: true
 *     xy: 512, 1784
 *     size: 191, 151
 *     orig: 191, 151
 *     offset: 0, 0
 *     index: -1
 *
 * The `pma` key states whether the page's texels are already multiplied by
 * alpha. Spine's runtimes use it to pick the blend function:
 *
 *   pma: true  -> glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
 *   pma absent -> glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
 *
 * and the texture uploader must store texels in the matching form
 * (UNPACK_PREMULTIPLY_ALPHA_WEBGL on and off respectively). Getting the two out
 * of step - which is what happened before this module existed - darkens every
 * anti-aliased texel, which is what the "black spots" were.
 */

export interface AtlasPage {
  name: string;
  size: { width: number; height: number } | null;
  format: string | null;
  minFilter: string | null;
  magFilter: string | null;
  /** Declared premultiplied-alpha. `null` means the key was absent (straight alpha). */
  pma: boolean | null;
  repeat: string | null;
  /** Candidate files to request for this page, in order of preference. */
  candidates: string[];
}

export interface AtlasRegion {
  name: string;
  page: string;
  rotate: 'false' | 'true' | number;
  x: number;
  y: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  offsetX: number;
  offsetY: number;
  index: number;
  /** Atlas texture is a pure white alpha mask (Spine "white" style pages). */
  looksLikeMask: boolean;
}

export interface ParsedAtlas {
  pages: AtlasPage[];
  regions: AtlasRegion[];
  /** True when at least one page declares `pma: true`. */
  anyPma: boolean;
  /** True when every page is straight alpha (no pma key at all). */
  allStraight: boolean;
}

function parseSize(value: string): { width: number; height: number } | null {
  const m = value.match(/(\d+)\s*,\s*(\d+)/);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

const IMAGE_EXT = /\.(png|webp|jpg|jpeg)$/i;

/**
 * Parse an atlas file.
 *
 * Spine's own loader treats a region line as a page name only when it is the
 * first non-empty line, so a flat "line looks like an image" heuristic is wrong
 * for regions that happen to carry extensions. We track state instead: the first
 * bare line opens a page; a `\n\n`-separated new bare line after page keys opens
 * the next page; anything indented belongs to the current page or region.
 */
export function parseAtlas(atlasText: string): ParsedAtlas {
  const lines = atlasText.split(/\r?\n/);
  const pages: AtlasPage[] = [];
  const regions: AtlasRegion[] = [];

  let currentPage: AtlasPage | null = null;
  let currentRegion: AtlasRegion | null = null;

  const flushRegion = () => {
    if (currentRegion) regions.push(currentRegion);
    currentRegion = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      // A blank line ends a page block (and any region in it).
      if (currentPage && currentRegion) flushRegion();
      if (currentPage) {
        flushRegion();
      }
      continue;
    }

    const isKeyValue = line.includes(':');
    if (!isKeyValue) {
      // Bare line: a page name if we are not inside a region and the previous
      // block was closed, otherwise a region name.
      const lookingForPage =
        currentPage === null ||
        (!currentRegion && IMAGE_EXT.test(line)) ||
        (currentPage && currentRegion === null && !/^\S.*:$/.test(line) && raw === line && pages.length === regions.length);
      if (lookingForPage) {
        flushRegion();
        currentPage = {
          name: line,
          size: null,
          format: null,
          minFilter: null,
          magFilter: null,
          pma: null,
          repeat: null,
          candidates: [line],
        };
        pages.push(currentPage);
        continue;
      }
      flushRegion();
      currentRegion = {
        name: line,
        page: currentPage ? currentPage.name : '',
        rotate: 'false',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        origWidth: 0,
        origHeight: 0,
        offsetX: 0,
        offsetY: 0,
        index: -1,
        looksLikeMask: false,
      };
      continue;
    }

    // key: value
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    const target: Record<string, unknown> | null = currentRegion
      ? (currentRegion as unknown as Record<string, unknown>)
      : (currentPage as unknown as Record<string, unknown> | null);
    if (!target) continue;

    switch (key) {
      case 'size': {
        const size = parseSize(value);
        if (currentRegion) {
          currentRegion.width = size?.width ?? 0;
          currentRegion.height = size?.height ?? 0;
        } else if (currentPage) {
          currentPage.size = size;
        }
        break;
      }
      case 'orig': {
        const size = parseSize(value);
        if (currentRegion && size) {
          currentRegion.origWidth = size.width;
          currentRegion.origHeight = size.height;
        }
        break;
      }
      case 'xy': {
        const m = value.match(/(-?\d+)\s*,\s*(-?\d+)/);
        if (currentRegion && m) {
          currentRegion.x = Number(m[1]);
          currentRegion.y = Number(m[2]);
        }
        break;
      }
      case 'offset': {
        const m = value.match(/(-?\d+)\s*,\s*(-?\d+)/);
        if (currentRegion && m) {
          currentRegion.offsetX = Number(m[1]);
          currentRegion.offsetY = Number(m[2]);
        }
        break;
      }
      case 'rotate':
        if (currentRegion) {
          currentRegion.rotate =
            value === 'true' ? 'true' : value === 'false' ? 'false' : Number(value) || 0;
        }
        break;
      case 'index':
        if (currentRegion) currentRegion.index = Number(value) || -1;
        break;
      case 'format':
        if (currentPage) currentPage.format = value;
        break;
      case 'filter': {
        const [min, mag] = value.split(',').map((s) => s.trim());
        if (currentPage) {
          currentPage.minFilter = min ?? null;
          currentPage.magFilter = mag ?? null;
        }
        break;
      }
      case 'repeat':
        if (currentPage) currentPage.repeat = value;
        break;
      case 'pma':
        if (currentPage) currentPage.pma = value.toLowerCase() === 'true';
        break;
      default:
        break;
    }
  }
  flushRegion();

  // A page can be declared without a size (older exporters); fill it from the
  // largest region extent so callers can still reason about it.
  for (const page of pages) {
    if (!page.size) {
      let w = 0;
      let h = 0;
      for (const region of regions) {
        if (region.page !== page.name) continue;
        const rotated = region.rotate === 'true' || typeof region.rotate === 'number';
        w = Math.max(w, region.x + (rotated ? region.height : region.width));
        h = Math.max(h, region.y + (rotated ? region.width : region.height));
      }
      page.size = { width: w, height: h };
    }
  }

  const anyPma = pages.some((p) => p.pma === true);
  const allStraight = pages.every((p) => p.pma !== true);
  return { pages, regions, anyPma, allStraight };
}

/**
 * Files most likely to exist for a page, given a page name and the skeleton id.
 *
 * Exported galleries are inconsistent about page names. A page can be declared
 * with the asset name (700010.png), with a numbered suffix (7000102.png), or
 * with a relative path. Some mirrors also ship a texture prefix or extension
 * that differs from the declaration. The downloader tries these in order and the
 * first that resolves wins, so a wrong atlas name degrades to "still works"
 * instead of "no texture at all".
 */
export function pageFileCandidates(page: AtlasPage, skeletonId: string): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    const normalised = name.replace(/^\.\//, '');
    if (!out.includes(normalised)) out.push(normalised);
  };

  push(page.name);

  const dot = page.name.lastIndexOf('.');
  const base = dot > 0 ? page.name.slice(0, dot) : page.name;
  const ext = dot > 0 ? page.name.slice(dot) : '.png';
  push(`${skeletonId}${ext}`);
  for (let n = 2; n <= 4; n++) push(`${skeletonId}${n}${ext}`);
  if (base !== skeletonId) push(`${base}${ext}`);
  push(`${skeletonId}.webp`);
  return out;
}

/**
 * Decide the render configuration for a parsed atlas.
 *
 * `declared` is what the atlas says; `uploadPma` / `blendPma` are what the
 * renderer must be told so the two agree. They are derived, never guessed:
 *
 *  - a page that declares `pma: true` must be uploaded premultiplied and blended
 *    as premultiplied;
 *  - a page with no `pma` key holds straight-alpha texels and must be uploaded
 *    straight and blended with SRC_ALPHA.
 *
 * If a model mixes both across its pages, the majority wins and the odd pages
 * are recorded so the health report can say so rather than silently mis-blending.
 */
export interface AlphaPlan {
  /** Value for the renderer's vertex premultiplication + blend function. */
  blendPma: boolean;
  /** Value for UNPACK_PREMULTIPLY_ALPHA_WEBGL at texture upload time. */
  uploadPma: boolean;
  /** Pages whose declaration disagrees with the plan. */
  mismatchedPages: string[];
  /** Human-readable summary for the diagnostics panel. */
  summary: string;
}

export function planAlpha(atlas: ParsedAtlas): AlphaPlan {
  const total = atlas.pages.length || 1;
  const pmaPages = atlas.pages.filter((p) => p.pma === true).length;
  const blendPma = atlas.pages.length > 0 ? pmaPages * 2 >= total : false;

  const mismatched = atlas.pages
    .filter((p) => (p.pma === true) !== blendPma)
    .map((p) => p.name);

  const declared = atlas.pages
    .map((p) => `${p.name}: ${p.pma === true ? 'pma' : 'straight'}`)
    .join(', ');

  return {
    blendPma,
    uploadPma: blendPma,
    mismatchedPages: mismatched,
    summary:
      atlas.pages.length === 0
        ? 'no page declarations found'
        : `${blendPma ? 'premultiplied' : 'straight'} alpha (${pmaPages}/${total} pages declare pma)${mismatched.length ? ` — mixed: ${mismatched.join(', ')}` : ''}; ${declared}`,
  };
}
