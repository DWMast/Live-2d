import { computeTriangleBarycentric, isPointInPolygon } from './spineHitTest';

export interface Live2DCameraPose {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Live2DFitTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_LIVE2D_ZOOM = 0.25;
export const MAX_LIVE2D_ZOOM = 12;

export function clampLive2DZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_LIVE2D_ZOOM, Math.max(MIN_LIVE2D_ZOOM, zoom));
}

/** Keep the model point under the cursor stationary while its scale changes. */
export function zoomLive2DCameraAtPoint(
  camera: Live2DCameraPose,
  fit: Live2DFitTransform,
  point: { x: number; y: number },
  requestedZoom: number
): Live2DCameraPose {
  const oldScale = fit.scale * camera.zoom;
  if (!(oldScale > 0)) return camera;

  const zoom = clampLive2DZoom(requestedZoom);
  const localX = (point.x - fit.x - camera.panX) / oldScale;
  const localY = (point.y - fit.y - camera.panY) / oldScale;
  const newScale = fit.scale * zoom;

  return {
    zoom,
    panX: point.x - localX * newScale - fit.x,
    panY: point.y - localY * newScale - fit.y,
  };
}

interface OpacityAdapter {
  layers: string[];
  read: (id: string) => number;
  write: (id: string, opacity: number) => void;
}

export interface Live2DLayerController {
  layers: string[];
  apply: (hidden: ReadonlySet<string>) => void;
  restore: () => void;
}

function createOpacityController(adapter: OpacityAdapter): Live2DLayerController {
  const savedOpacities = new Map<string, number>();
  let previousHidden = new Set<string>();

  const apply = (hidden: ReadonlySet<string>) => {
    for (const id of previousHidden) {
      if (hidden.has(id)) continue;
      const opacity = savedOpacities.get(id);
      if (opacity !== undefined) adapter.write(id, opacity);
      savedOpacities.delete(id);
    }

    for (const id of adapter.layers) {
      if (!hidden.has(id)) continue;
      if (!previousHidden.has(id)) savedOpacities.set(id, adapter.read(id));
      adapter.write(id, 0);
    }
    previousHidden = new Set(hidden);
  };

  return {
    layers: adapter.layers,
    apply,
    restore: () => {
      for (const [id, opacity] of savedOpacities) adapter.write(id, opacity);
      savedOpacities.clear();
      previousHidden = new Set();
    },
  };
}

function normalizeLive2DId(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id || null;
  }
  if (value == null) return null;
  const text = String(value);
  return text && text !== '[object Object]' ? text : null;
}

function uniqueIds(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * Adapt Cubism 2 and 4 part opacity to one visibility controller. Applying it
 * after the runtime pose update prevents animations from revealing hidden parts.
 */
export function createLive2DLayerController(internalModel: unknown): Live2DLayerController {
  const internal = internalModel as {
    coreModel?: Record<string, unknown>;
    settings?: { initOpacities?: Array<{ id?: unknown }> };
    pose?: { partsGroups?: Array<Array<{ id?: unknown }>> };
  };
  const core = internal?.coreModel;
  if (!core) return { layers: [], apply: () => {}, restore: () => {} };

  const getModel = core.getModel as (() => {
    parts?: { count?: number; ids?: unknown[]; opacities?: Float32Array };
  }) | undefined;
  const cubism4Model = typeof getModel === 'function' ? getModel.call(core) : undefined;
  const parts = cubism4Model?.parts;

  if (parts?.ids?.length) {
    const layers = uniqueIds(
      parts.ids.slice(0, parts.count ?? parts.ids.length).map(normalizeLive2DId)
    );
    const readIndex = (id: string) => layers.indexOf(id);
    const getByIndex = core.getPartOpacityByIndex as ((index: number) => number) | undefined;
    const setByIndex = core.setPartOpacityByIndex as
      | ((index: number, opacity: number) => void)
      | undefined;

    return createOpacityController({
      layers,
      read: (id) => {
        const index = readIndex(id);
        return typeof getByIndex === 'function'
          ? getByIndex.call(core, index)
          : parts.opacities?.[index] ?? 1;
      },
      write: (id, opacity) => {
        const index = readIndex(id);
        if (index < 0) return;
        if (typeof setByIndex === 'function') setByIndex.call(core, index, opacity);
        else if (parts.opacities) parts.opacities[index] = opacity;
      },
    });
  }

  const getContext = core.getModelContext as (() => Record<string, unknown>) | undefined;
  const context = typeof getContext === 'function' ? getContext.call(core) : undefined;
  const rawParts = Array.isArray(context?._$F2) ? context._$F2 : [];
  const partIds = rawParts.map((part) => {
    if (!part || typeof part !== 'object') return null;
    const data = part as { _$p2?: () => unknown; getPartsID?: () => unknown };
    return normalizeLive2DId(data._$p2?.() ?? data.getPartsID?.());
  });
  const poseIds = internal.pose?.partsGroups?.flatMap((group) =>
    group.map((part) => normalizeLive2DId(part.id))
  ) ?? [];
  const initialIds = internal.settings?.initOpacities?.map((part) =>
    normalizeLive2DId(part.id)
  ) ?? [];

  const getIndex = core.getPartsDataIndex as ((id: string) => number) | undefined;
  const getOpacity = core.getPartsOpacity as ((index: number) => number) | undefined;
  const setOpacity = core.setPartsOpacity as ((index: number, opacity: number) => void) | undefined;
  const layers = uniqueIds([...partIds, ...poseIds, ...initialIds]).filter(
    (id) => typeof getIndex === 'function' && getIndex.call(core, id) >= 0
  );

  if (typeof getIndex !== 'function' || typeof getOpacity !== 'function' || typeof setOpacity !== 'function') {
    return { layers: [], apply: () => {}, restore: () => {} };
  }

  return createOpacityController({
    layers,
    read: (id) => getOpacity.call(core, getIndex.call(core, id)),
    write: (id, opacity) => {
      const index = getIndex.call(core, id);
      if (index >= 0) setOpacity.call(core, index, opacity);
    },
  });
}

export type Live2DLayerPicker = (
  x: number,
  y: number,
  hidden: ReadonlySet<string>
) => string | null;

interface Live2DPickDrawable {
  index: number;
  partId: string;
  triangles?: ArrayLike<number>;
  isVisible?: () => boolean;
}

function hitTestLive2DDrawables(
  drawables: Live2DPickDrawable[],
  getVertices: (index: number) => Float32Array,
  x: number,
  y: number,
  hidden: ReadonlySet<string>
): string | null {
  for (let i = drawables.length - 1; i >= 0; i--) {
    const drawable = drawables[i];
    if (hidden.has(drawable.partId) || drawable.isVisible?.() === false) continue;

    let vertices: Float32Array;
    try {
      vertices = getVertices(drawable.index);
    } catch {
      continue;
    }
    if (vertices.length < 6) continue;

    if (drawable.triangles) {
      const triangles = drawable.triangles;
      for (let t = 0; t + 2 < triangles.length; t += 3) {
        const a = triangles[t] * 2;
        const b = triangles[t + 1] * 2;
        const c = triangles[t + 2] * 2;
        if (a + 1 >= vertices.length || b + 1 >= vertices.length || c + 1 >= vertices.length) {
          continue;
        }
        if (computeTriangleBarycentric(
          x, y,
          vertices[a], vertices[a + 1],
          vertices[b], vertices[b + 1],
          vertices[c], vertices[c + 1]
        )) {
          return drawable.partId;
        }
      }
    } else if (isPointInPolygon(x, y, vertices, vertices.length)) {
      return drawable.partId;
    }
  }
  return null;
}

/** Pick the top visible Cubism part under a point in original model-canvas space. */
export function createLive2DLayerPicker(internalModel: unknown): Live2DLayerPicker {
  const internal = internalModel as {
    coreModel?: Record<string, unknown>;
    getDrawableIDs?: () => string[];
    getDrawableVertices?: (index: number) => Float32Array;
  };
  const core = internal?.coreModel;
  if (!core || typeof internal.getDrawableIDs !== 'function' ||
      typeof internal.getDrawableVertices !== 'function') {
    return () => null;
  }

  const drawableIds = internal.getDrawableIDs();
  const getVertices = internal.getDrawableVertices.bind(internal);
  const getModel = core.getModel as (() => {
    parts?: { count?: number; ids?: unknown[] };
    drawables?: { parentPartIndices?: ArrayLike<number> };
  }) | undefined;
  const cubism4Model = typeof getModel === 'function' ? getModel.call(core) : undefined;
  const partIds = cubism4Model?.parts?.ids?.map(normalizeLive2DId) ?? [];

  if (partIds.length) {
    const getParent = core.getDrawableParentPartIndex as ((index: number) => number) | undefined;
    const getIndices = core.getDrawableVertexIndices as
      | ((index: number) => ArrayLike<number>)
      | undefined;
    const getRenderOrders = core.getDrawableRenderOrders as (() => ArrayLike<number>) | undefined;
    const renderOrders = typeof getRenderOrders === 'function'
      ? getRenderOrders.call(core)
      : drawableIds.map((_, index) => index);
    const getDynamicVisible = core.getDrawableDynamicFlagIsVisible as
      | ((index: number) => boolean)
      | undefined;
    const getOpacity = core.getDrawableOpacity as ((index: number) => number) | undefined;

    const drawables: Live2DPickDrawable[] = [];
    for (let order = 0; order < renderOrders.length; order++) {
      const index = renderOrders[order];
      const parentIndex = typeof getParent === 'function'
        ? getParent.call(core, index)
        : cubism4Model?.drawables?.parentPartIndices?.[index] ?? -1;
      const partId = partIds[parentIndex];
      if (!partId || index < 0 || index >= drawableIds.length) continue;
      drawables.push({
        index,
        partId,
        triangles: typeof getIndices === 'function' ? getIndices.call(core, index) : undefined,
        isVisible: () =>
          (typeof getDynamicVisible !== 'function' || getDynamicVisible.call(core, index)) &&
          (typeof getOpacity !== 'function' || getOpacity.call(core, index) > 0.01),
      });
    }
    return (x, y, hidden) => hitTestLive2DDrawables(drawables, getVertices, x, y, hidden);
  }

  const getContext = core.getModelContext as (() => { _$F2?: unknown[] }) | undefined;
  const context = typeof getContext === 'function' ? getContext.call(core) : undefined;
  const rawParts = Array.isArray(context?._$F2) ? context._$F2 : [];
  const getPartIndex = core.getPartsDataIndex as ((id: string) => number) | undefined;
  const getPartOpacity = core.getPartsOpacity as ((index: number) => number) | undefined;
  const drawableParts = new Map<string, string>();

  for (const rawPart of rawParts) {
    if (!rawPart || typeof rawPart !== 'object') continue;
    const part = rawPart as {
      getPartsID?: () => unknown;
      getDrawData?: () => Array<{ getDrawDataID?: () => unknown }>;
    };
    const partId = normalizeLive2DId(part.getPartsID?.());
    if (!partId) continue;
    for (const drawData of part.getDrawData?.() ?? []) {
      const drawableId = normalizeLive2DId(drawData.getDrawDataID?.());
      if (drawableId && !drawableParts.has(drawableId)) drawableParts.set(drawableId, partId);
    }
  }

  const drawables: Live2DPickDrawable[] = [];
  drawableIds.forEach((drawableId, index) => {
    const mappedPart = drawableParts.get(drawableId);
    const directIndex = typeof getPartIndex === 'function' ? getPartIndex.call(core, drawableId) : -1;
    const partId = mappedPart ?? (directIndex >= 0 ? drawableId : null);
    if (!partId) return;
    const partIndex = typeof getPartIndex === 'function' ? getPartIndex.call(core, partId) : -1;
    drawables.push({
      index,
      partId,
      isVisible: () => partIndex < 0 || typeof getPartOpacity !== 'function' ||
        getPartOpacity.call(core, partIndex) > 0.01,
    });
  });

  return (x, y, hidden) => hitTestLive2DDrawables(drawables, getVertices, x, y, hidden);
}
