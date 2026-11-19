export type SpineRuntimeVersion = '3.8' | '4.0' | '4.1' | '4.2';

export interface SpineColorLike {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SpineTextureLike {
  getImage?: () => CanvasImageSource | null | undefined;
  _image?: CanvasImageSource | null | undefined;
}

export interface SpineRegionLike {
  texture?: SpineTextureLike | null;
  page?: { texture?: SpineTextureLike | null } | null;
}

export interface VertexAttachmentLike {
  worldVerticesLength?: number;
  hullLength?: number;
  triangles?: ArrayLike<number>;
  uvs?: ArrayLike<number>;
  region?: SpineRegionLike | null;
  endSlot?: unknown;
  color?: SpineColorLike;
  computeWorldVertices?: (...args: unknown[]) => void;
}

export interface HitTestSlotLike {
  data: { name: string };
  bone?: unknown;
  color?: SpineColorLike;
  getAttachment: () => unknown;
}

let sharedScratchVertices = new Float32Array(4096);

export function getSharedScratchBuffer(needed: number): Float32Array {
  if (sharedScratchVertices.length < needed) {
    sharedScratchVertices = new Float32Array(Math.max(needed, sharedScratchVertices.length * 2));
  }
  return sharedScratchVertices;
}

export function getLastScratchVertices(): Float32Array {
  return sharedScratchVertices;
}

/**
 * Compute world-space vertices for any Spine attachment across Spine 3.8, 4.0, 4.1, and 4.2.
 *
 * Crucial compatibility detail:
 * - VertexAttachment (Mesh, Clipping, Path, BoundingBox): `computeWorldVertices(slot, 0, count, out, 0, 2)` in all versions.
 * - RegionAttachment:
 *   - Spine 3.8 & 4.0 expect `slot.bone` as the first argument.
 *   - Spine 4.1 & 4.2 expect `slot` as the first argument.
 * Passing `slot` to a 3.8/4.0 RegionAttachment silently produces `NaN`s without throwing.
 */
export function computeAttachmentVertices(
  slot: unknown,
  attachment: VertexAttachmentLike | null | undefined,
  runtimeVersion?: SpineRuntimeVersion,
  outBuf?: Float32Array
): { count: number; vertices: Float32Array } {
  if (!attachment || typeof attachment.computeWorldVertices !== 'function') {
    return { count: 0, vertices: outBuf ?? sharedScratchVertices };
  }

  if (typeof attachment.worldVerticesLength === 'number' && attachment.worldVerticesLength > 0) {
    const count = attachment.worldVerticesLength;
    const buf = outBuf && outBuf.length >= count ? outBuf : getSharedScratchBuffer(count);
    attachment.computeWorldVertices(slot, 0, count, buf, 0, 2);
    return { count, vertices: buf };
  }

  // RegionAttachment: 4 corners = 8 floats
  const buf = outBuf && outBuf.length >= 8 ? outBuf : getSharedScratchBuffer(8);
  const slotObj = slot as HitTestSlotLike | null | undefined;
  const preferBone = runtimeVersion === '3.8' || runtimeVersion === '4.0';

  if (preferBone && slotObj?.bone) {
    attachment.computeWorldVertices(slotObj.bone, buf, 0, 2);
    if (Number.isFinite(buf[0]) && Number.isFinite(buf[1])) {
      return { count: 8, vertices: buf };
    }
    attachment.computeWorldVertices(slot, buf, 0, 2);
  } else {
    attachment.computeWorldVertices(slot, buf, 0, 2);
    if ((!Number.isFinite(buf[0]) || !Number.isFinite(buf[1])) && slotObj?.bone) {
      attachment.computeWorldVertices(slotObj.bone, buf, 0, 2);
    }
  }

  if (!Number.isFinite(buf[0]) || !Number.isFinite(buf[1])) {
    return { count: 0, vertices: buf };
  }
  return { count: 8, vertices: buf };
}

export function isPointInPolygon(
  px: number,
  py: number,
  vertices: ArrayLike<number>,
  length: number
): boolean {
  let inside = false;
  for (let i = 0, j = length - 2; i < length; j = i, i += 2) {
    const xi = vertices[i];
    const yi = vertices[i + 1];
    const xj = vertices[j];
    const yj = vertices[j + 1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function computeTriangleBarycentric(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): [number, number, number] | null {
  const v0x = bx - ax;
  const v0y = by - ay;
  const v1x = cx - ax;
  const v1y = cy - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const denom = v0x * v1y - v1x * v0y;
  if (Math.abs(denom) < 1e-6) return null;

  const invDenom = 1 / denom;
  const v = (v2x * v1y - v1x * v2y) * invDenom;
  const w = (v0x * v2y - v2x * v0y) * invDenom;
  const u = 1 - v - w;

  const eps = -1e-4;
  if (u < eps || v < eps || w < eps) return null;
  return [u, v, w];
}

export function getAttachmentImageSource(
  attachment: VertexAttachmentLike
): CanvasImageSource | null {
  const region = attachment.region;
  if (!region) return null;
  const texture = region.texture ?? region.page?.texture;
  if (!texture) return null;
  const img =
    typeof texture.getImage === 'function' ? texture.getImage() : texture._image;
  return img ?? null;
}

interface CachedCanvasSurface {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  lastUsed: number;
}

const MAX_ALPHA_SURFACE_CACHE = 8;

/**
 * Cached 2D canvas sampler to read exact atlas pixel alpha `[0..255]` for any UV.
 * Keeps at most `MAX_ALPHA_SURFACE_CACHE` decoded canvases in memory so switching
 * characters does not retain stale 4K atlas bitmaps.
 */
export class TextureAlphaSampler {
  private surfaces = new Map<object, CachedCanvasSurface | 'failed'>();

  private getSurface(img: CanvasImageSource): CachedCanvasSurface | null {
    const key = img as unknown as object;
    const cached = this.surfaces.get(key);
    if (cached === 'failed') return null;
    if (cached) {
      cached.lastUsed = Date.now();
      return cached;
    }

    if (typeof document === 'undefined') return null;

    const htmlImg = img as HTMLImageElement;
    if (typeof htmlImg.complete === 'boolean' && !htmlImg.complete) {
      return null;
    }

    const width =
      (img as HTMLImageElement).naturalWidth ||
      (img as HTMLCanvasElement | HTMLImageElement).width ||
      0;
    const height =
      (img as HTMLImageElement).naturalHeight ||
      (img as HTMLCanvasElement | HTMLImageElement).height ||
      0;

    if (width <= 0 || height <= 0) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        this.surfaces.set(key, 'failed');
        return null;
      }
      ctx.drawImage(img, 0, 0);
      // Probe 1 pixel immediately to verify the canvas is not CORS-tainted.
      ctx.getImageData(0, 0, 1, 1);

      if (this.surfaces.size >= MAX_ALPHA_SURFACE_CACHE) {
        let oldestKey: object | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of this.surfaces.entries()) {
          if (v === 'failed') {
            oldestKey = k;
            break;
          }
          if (v.lastUsed < oldestTime) {
            oldestTime = v.lastUsed;
            oldestKey = k;
          }
        }
        if (oldestKey) this.surfaces.delete(oldestKey);
      }

      const entry: CachedCanvasSurface = { ctx, width, height, lastUsed: Date.now() };
      this.surfaces.set(key, entry);
      return entry;
    } catch {
      this.surfaces.set(key, 'failed');
      return null;
    }
  }

  sampleAttachmentAlpha(
    attachment: VertexAttachmentLike,
    u: number,
    v: number
  ): number | null {
    const img = getAttachmentImageSource(attachment);
    if (!img) return null;
    const surface = this.getSurface(img);
    if (!surface) return null;

    const clampedU = Math.min(1, Math.max(0, u));
    const clampedV = Math.min(1, Math.max(0, v));
    const px = Math.min(surface.width - 1, Math.max(0, Math.floor(clampedU * surface.width)));
    const py = Math.min(surface.height - 1, Math.max(0, Math.floor(clampedV * surface.height)));

    try {
      return surface.ctx.getImageData(px, py, 1, 1).data[3];
    } catch {
      this.surfaces.set(img as unknown as object, 'failed');
      return null;
    }
  }

  clear(): void {
    this.surfaces.clear();
  }
}

export type AlphaSampleFn = (
  attachment: VertexAttachmentLike,
  u: number,
  v: number
) => number | null;

const REGION_QUAD_TRIANGLES: readonly number[] = [0, 1, 2, 0, 2, 3];

/**
 * Exact hit test against a MeshAttachment's triangles or a RegionAttachment's quad.
 * When `sampleAlpha` is supplied and returns an alpha <= `alphaThreshold`,
 * clicks fall cleanly through transparent atlas padding to layers underneath.
 */
export function hitTestAttachment(
  px: number,
  py: number,
  vertices: ArrayLike<number>,
  vertexCount: number,
  attachment: VertexAttachmentLike,
  sampleAlpha?: AlphaSampleFn | null,
  alphaThreshold = 8
): boolean {
  const triangles =
    attachment.triangles && attachment.triangles.length >= 3
      ? attachment.triangles
      : vertexCount === 8
        ? REGION_QUAD_TRIANGLES
        : null;

  if (triangles) {
    const uvs = attachment.uvs;
    const triLen = triangles.length;
    for (let t = 0; t + 2 < triLen; t += 3) {
      const i0 = triangles[t] * 2;
      const i1 = triangles[t + 1] * 2;
      const i2 = triangles[t + 2] * 2;
      if (i0 + 1 >= vertexCount || i1 + 1 >= vertexCount || i2 + 1 >= vertexCount) {
        continue;
      }

      const bary = computeTriangleBarycentric(
        px,
        py,
        vertices[i0],
        vertices[i0 + 1],
        vertices[i1],
        vertices[i1 + 1],
        vertices[i2],
        vertices[i2 + 1]
      );
      if (!bary) continue;

      if (sampleAlpha && uvs && uvs.length > Math.max(i0, i1, i2) + 1) {
        const u = bary[0] * uvs[i0] + bary[1] * uvs[i1] + bary[2] * uvs[i2];
        const v = bary[0] * uvs[i0 + 1] + bary[1] * uvs[i1 + 1] + bary[2] * uvs[i2 + 1];
        const alpha = sampleAlpha(attachment, u, v);
        if (alpha !== null && alpha <= alphaThreshold) {
          continue;
        }
      }

      return true;
    }
    return false;
  }

  if (vertexCount >= 6) {
    return isPointInPolygon(px, py, vertices, vertexCount);
  }
  return false;
}

export interface FindTopHitSlotOptions {
  drawOrder: readonly HitTestSlotLike[];
  worldX: number;
  worldY: number;
  hiddenLayers: ReadonlySet<string>;
  runtimeVersion?: SpineRuntimeVersion;
  sampleAlpha?: AlphaSampleFn | null;
  alphaThreshold?: number;
  skeletonAlpha?: number;
}

/**
 * Walk `drawOrder` top-to-bottom and return the name of the topmost visible,
 * non-transparent renderable slot under `(worldX, worldY)`.
 */
export function findTopHitSlot({
  drawOrder,
  worldX,
  worldY,
  hiddenLayers,
  runtimeVersion,
  sampleAlpha,
  alphaThreshold = 8,
  skeletonAlpha = 1,
}: FindTopHitSlotOptions): string | null {
  if (!drawOrder || drawOrder.length === 0 || skeletonAlpha <= 0.01) return null;

  // Pass 1: Track active ClippingAttachment masks in draw order.
  // Only allocates if a ClippingAttachment is actually active.
  let clippedOutIndices: Set<number> | null = null;
  let activeClipEndSlot: unknown = null;
  let clipAllowsPoint = true;

  for (let i = 0; i < drawOrder.length; i++) {
    const slot = drawOrder[i];
    const att = slot.getAttachment() as VertexAttachmentLike | null;

    if (!activeClipEndSlot && att && 'endSlot' in att && att.endSlot) {
      activeClipEndSlot = att.endSlot;
      clipAllowsPoint = true;
      if (!hiddenLayers.has(slot.data.name)) {
        try {
          const { count, vertices } = computeAttachmentVertices(slot, att, runtimeVersion);
          if (count >= 6) {
            clipAllowsPoint = isPointInPolygon(worldX, worldY, vertices, count);
          }
        } catch {
          clipAllowsPoint = true;
        }
      }
      continue;
    }

    if (activeClipEndSlot) {
      if (!clipAllowsPoint) {
        if (!clippedOutIndices) clippedOutIndices = new Set<number>();
        clippedOutIndices.add(i);
      }
      if (slot === activeClipEndSlot) {
        activeClipEndSlot = null;
        clipAllowsPoint = true;
      }
    }
  }

  // Pass 2: Hit-test top-to-bottom on visible, renderable attachments.
  for (let i = drawOrder.length - 1; i >= 0; i--) {
    if (clippedOutIndices?.has(i)) continue;
    const slot = drawOrder[i];
    const slotName = slot.data.name;
    if (hiddenLayers.has(slotName)) continue;
    if ((slot.color?.a ?? 1) <= 0.01) continue;

    const attachment = slot.getAttachment() as VertexAttachmentLike | null;
    if (!attachment) continue;
    // Skip non-renderable attachments (ClippingAttachment, BoundingBox, Path, Point)
    if ('endSlot' in attachment || !attachment.region) continue;
    if ((attachment.color?.a ?? 1) <= 0.01) continue;

    let count = 0;
    let vertices: Float32Array;
    try {
      const res = computeAttachmentVertices(slot, attachment, runtimeVersion);
      count = res.count;
      vertices = res.vertices;
    } catch {
      continue;
    }
    if (count <= 0) continue;

    if (
      hitTestAttachment(
        worldX,
        worldY,
        vertices,
        count,
        attachment,
        sampleAlpha,
        alphaThreshold
      )
    ) {
      return slotName;
    }
  }

  return null;
}

/**
 * Extract ordered boundary polylines (vertex indices, not float offsets) from a triangle list.
 * Boundary edges appear in exactly 1 triangle, cleanly outlining single shapes, concavities,
 * holes, and disconnected multi-island meshes without internal mesh crisscrossing.
 */
export function extractBoundaryPolylines(triangles: ArrayLike<number>): number[][] {
  const edgeCounts = new Map<string, { u: number; v: number; count: number }>();

  const addEdge = (u: number, v: number) => {
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    const key = `${lo}:${hi}`;
    const existing = edgeCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      edgeCounts.set(key, { u, v, count: 1 });
    }
  };

  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (a === b || b === c || c === a) continue;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const adjMap = new Map<number, number[]>();
  const boundaryEdges: Array<{ a: number; b: number; used: boolean }> = [];

  for (const entry of edgeCounts.values()) {
    if (entry.count === 1) {
      const edgeIdx = boundaryEdges.length;
      boundaryEdges.push({ a: entry.u, b: entry.v, used: false });
      const listA = adjMap.get(entry.u);
      if (listA) listA.push(edgeIdx);
      else adjMap.set(entry.u, [edgeIdx]);
      const listB = adjMap.get(entry.v);
      if (listB) listB.push(edgeIdx);
      else adjMap.set(entry.v, [edgeIdx]);
    }
  }

  const polylines: number[][] = [];
  for (let startIdx = 0; startIdx < boundaryEdges.length; startIdx++) {
    const startEdge = boundaryEdges[startIdx];
    if (startEdge.used) continue;

    startEdge.used = true;
    const loop: number[] = [startEdge.a, startEdge.b];
    let curr = startEdge.b;
    const guardLimit = boundaryEdges.length + 2;
    let steps = 0;

    while (curr !== startEdge.a && steps++ < guardLimit) {
      const incident = adjMap.get(curr);
      if (!incident) break;
      let pickedIdx = -1;
      for (const candidateIdx of incident) {
        if (!boundaryEdges[candidateIdx].used) {
          pickedIdx = candidateIdx;
          break;
        }
      }
      if (pickedIdx === -1) break;
      const edge = boundaryEdges[pickedIdx];
      edge.used = true;
      const nextVertex = edge.a === curr ? edge.b : edge.a;
      if (nextVertex === startEdge.a) break;
      loop.push(nextVertex);
      curr = nextVertex;
    }

    if (loop.length >= 2) {
      polylines.push(loop);
    }
  }

  return polylines;
}
