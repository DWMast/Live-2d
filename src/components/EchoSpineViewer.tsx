import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SpinePlayer, GLTexture, OrthoCamera, Vector2, Vector3, Downloader } from '@esotericsoftware/spine-player';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import { BD2Character } from '../types/bd2';
import { loadModel, createModelDownloader, ModelLoadError, type LoadedModel } from '../utils/spine/assetLoader';

const ECHO_SPINE_BASE = '/api/echo-spine';
import { applyTextureContract } from '../utils/spine/renderContract';
import { runtimeForVersion } from '../utils/spine/skeletonInspector';
import {
  AlertTriangle,
  Loader2,
  Maximize2,
  RefreshCw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface EchoSpineViewerProps {
  character: BD2Character;
  isPlaying: boolean;
  animationSpeed: number;
  activeAnimation: string;
  onAnimationsLoaded: (animations: string[]) => void;
  onLayersLoaded: (layers: string[]) => void;
  hiddenLayers: Set<string>;
  onDeleteLayer: (name: string) => void;
  onUndoDelete: () => void;
  onResetAllLayers: () => void;
  selectedLayerName: string | null;
  onSelectLayer: (name: string | null) => void;
}

const RUNTIME_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  '3.8': () => import('../vendor/spine-player3.8.js'),
  '4.0': () => import('../vendor/spine-player4.0.js'),
  '4.2': () => import('../vendor/spine-player4.2.js'),
};

interface RuntimeModule {
  SpinePlayer: typeof SpinePlayer;
  GLTexture: typeof GLTexture;
  OrthoCamera: typeof OrthoCamera;
  Vector2: typeof Vector2;
  Vector3: typeof Vector3;
  Downloader: typeof Downloader;
}

const DEFAULT_RUNTIME: RuntimeModule = {
  SpinePlayer,
  GLTexture,
  OrthoCamera,
  Vector2,
  Vector3,
  Downloader,
};

function loadRuntime(version: '3.8' | '4.0' | '4.1' | '4.2'): Promise<RuntimeModule> {
  const loader = RUNTIME_MODULES[version];
  if (!loader) return Promise.resolve(DEFAULT_RUNTIME);
  return loader().then((mod) => mod.default as RuntimeModule);
}

/**
 * Each bundled player accepts a different set of skeleton keys:
 *   3.8   jsonUrl | skelUrl
 *   4.0   jsonUrl | binaryUrl
 *   4.1+  jsonUrl | skelUrl | binaryUrl (and `skeleton`)
 */
function skeletonConfigFor(
  runtimeVersion: '3.8' | '4.0' | '4.1' | '4.2',
  model: LoadedModel
): Record<string, string> {
  const url = model.skeletonUrl;
  const isJson = !!url && /\.json(\?.*)?$/i.test(url);

  if (isJson) return { jsonUrl: url };
  if (runtimeVersion === '3.8') return { skelUrl: url };
  if (runtimeVersion === '4.0') return { binaryUrl: url };
  return { skeleton: url, skelUrl: url, binaryUrl: url };
}

function disposePlayer(player: SpinePlayer | null) {
  if (!player) return;
  const candidate = player as unknown as {
    dispose?: () => void;
    canvas?: HTMLCanvasElement | null;
    context?: { gl?: WebGLRenderingContext | WebGL2RenderingContext | null };
  };
  try {
    candidate.dispose?.();
  } catch {
    // ignore
  }
  const gl =
    candidate.context?.gl ||
    (candidate.canvas
      ? (candidate.canvas.getContext('webgl2') ||
          candidate.canvas.getContext('webgl')) as WebGLRenderingContext | null
      : null);
  if (gl && !gl.isContextLost()) {
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // ignore
    }
  }
}

type SlotLike = {
  data: { name: string };
  bone?: unknown;
  color?: { r: number; g: number; b: number; a: number };
  darkColor?: { r: number; g: number; b: number; a: number };
  getAttachment?: () => unknown;
};

export const EchoSpineViewer = React.forwardRef<
  {
    getPose: () => { x: number; y: number; zoom: number } | null;
    setPose: (pose: { x: number; y: number; zoom: number }) => void;
    resetPose: () => void;
    zoomBy: (factor: number) => void;
    capture: () => string | null;
  },
  EchoSpineViewerProps
>(function EchoSpineViewer(
  {
    character,
    isPlaying,
    animationSpeed,
    activeAnimation,
    onAnimationsLoaded,
    onLayersLoaded,
    hiddenLayers,
    onDeleteLayer,
    onUndoDelete,
    onResetAllLayers,
    selectedLayerName,
    onSelectLayer,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 800, height: 600 });
  const overlayHasDrawingRef = useRef(false);
  const playerRef = useRef<SpinePlayer | null>(null);
  const cameraRef = useRef<OrthoCamera | null>(null);
  const runtimeRef = useRef<RuntimeModule>(DEFAULT_RUNTIME);
  const defaultPoseRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const hiddenRef = useRef(hiddenLayers);
  const selectedLayerRef = useRef<string | null>(selectedLayerName);
  const playingRef = useRef(isPlaying);
  const speedRef = useRef(animationSpeed);
  const onSelectLayerRef = useRef(onSelectLayer);
  const onDeleteLayerRef = useRef(onDeleteLayer);
  const onUndoDeleteRef = useRef(onUndoDelete);
  const setupColorsRef = useRef<Map<string, SlotLike['color']>>(new Map());
  const forcedHiddenRef = useRef<Set<string>>(new Set());
  const [reloadNonce, setReloadNonce] = useState(0);

  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState('Preparing');
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);

  hiddenRef.current = hiddenLayers;
  selectedLayerRef.current = selectedLayerName;
  playingRef.current = isPlaying;
  speedRef.current = animationSpeed;
  onSelectLayerRef.current = onSelectLayer;
  onDeleteLayerRef.current = onDeleteLayer;
  onUndoDeleteRef.current = onUndoDelete;

  // ---------------------------------------------------------------------------
  // visibility
  // ---------------------------------------------------------------------------
  const applyVisibility = useCallback((player: SpinePlayer | null) => {
    const skeleton = player?.skeleton as unknown as { slots?: SlotLike[] } | undefined;
    if (!skeleton?.slots) return;
    for (const slot of skeleton.slots) {
      const name = slot.data.name;
      const shouldHide = hiddenRef.current.has(name);
      if (shouldHide) {
        if (slot.color) slot.color.a = 0;
        if (slot.darkColor) slot.darkColor.a = 0;
        forcedHiddenRef.current.add(name);
      } else if (forcedHiddenRef.current.delete(name)) {
        const setup = setupColorsRef.current.get(name);
        if (slot.color && setup) {
          slot.color.r = setup.r;
          slot.color.g = setup.g;
          slot.color.b = setup.b;
          slot.color.a = setup.a;
        }
      }
    }
  }, []);

  const drawHighlightOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    const player = playerRef.current;
    const activeLayer = selectedLayerRef.current;

    if (!overlay) return;
    if (
      !activeLayer ||
      !player?.skeleton ||
      hiddenRef.current.has(activeLayer)
    ) {
      if (overlayHasDrawingRef.current) {
        const ctx = overlay.getContext('2d');
        ctx?.clearRect(0, 0, overlay.width, overlay.height);
        overlayHasDrawingRef.current = false;
      }
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    const cssW = rect && rect.width > 0 ? rect.width : containerSizeRef.current.width;
    const cssH = rect && rect.height > 0 ? rect.height : containerSizeRef.current.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetW = Math.max(1, Math.round(cssW * dpr));
    const targetH = Math.max(1, Math.round(cssH * dpr));
    if (overlay.width !== targetW || overlay.height !== targetH) {
      overlay.width = targetW;
      overlay.height = targetH;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, targetW, targetH);

    const skeleton = player.skeleton as unknown as {
      drawOrder?: SlotLike[];
      slots?: SlotLike[];
    };
    const slot =
      skeleton.drawOrder?.find((s) => s.data.name === activeLayer) ||
      skeleton.slots?.find((s) => s.data.name === activeLayer);
    if (!slot) {
      overlayHasDrawingRef.current = false;
      return;
    }

    const attachment = slot.getAttachment?.() as {
      worldVerticesLength?: number;
      hullLength?: number;
      triangles?: number[];
      computeWorldVertices?: (...args: unknown[]) => void;
    } | null;
    const renderCam = player.sceneRenderer?.camera;

    if (
      !attachment?.computeWorldVertices ||
      !renderCam ||
      renderCam.viewportWidth <= 0 ||
      renderCam.viewportHeight <= 0
    ) {
      overlayHasDrawingRef.current = false;
      return;
    }

    const { position, zoom, viewportWidth, viewportHeight } = renderCam;
    const halfW = (viewportWidth / 2) * zoom;
    const halfH = (viewportHeight / 2) * zoom;
    if (!Number.isFinite(halfW) || !Number.isFinite(halfH) || halfW === 0 || halfH === 0) {
      overlayHasDrawingRef.current = false;
      return;
    }

    const projectX = (wx: number) => (((wx - position.x) / halfW + 1) / 2) * cssW;
    const projectY = (wy: number) => ((1 - (wy - position.y) / halfH) / 2) * cssH;

    let count = 0;
    let buf: Float32Array;
    try {
      if (typeof attachment.worldVerticesLength === 'number' && attachment.worldVerticesLength > 0) {
        count = attachment.worldVerticesLength;
        buf = new Float32Array(count);
        attachment.computeWorldVertices(slot, 0, count, buf, 0, 2);
      } else {
        count = 8;
        buf = new Float32Array(8);
        try {
          attachment.computeWorldVertices(slot, buf, 0, 2);
        } catch {
          if (!slot.bone) return;
          attachment.computeWorldVertices(slot.bone, buf, 0, 2);
        }
      }
    } catch {
      return;
    }

    if (count < 6) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);

    const tris = attachment.triangles;
    if (tris && tris.length >= 3) {
      // Fill the exact triangle mesh without self-overlap streaks
      ctx.beginPath();
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const i0 = tris[t] * 2;
        const i1 = tris[t + 1] * 2;
        const i2 = tris[t + 2] * 2;
        if (
          !Number.isFinite(buf[i0]) ||
          !Number.isFinite(buf[i1]) ||
          !Number.isFinite(buf[i2])
        ) {
          continue;
        }
        ctx.moveTo(projectX(buf[i0]), projectY(buf[i0 + 1]));
        ctx.lineTo(projectX(buf[i1]), projectY(buf[i1 + 1]));
        ctx.lineTo(projectX(buf[i2]), projectY(buf[i2 + 1]));
        ctx.closePath();
      }
      ctx.fill();

      // Stroke only the outer perimeter (`hullLength` or unique triangle boundary edges)
      const hullLen =
        typeof attachment.hullLength === 'number' &&
        attachment.hullLength >= 6 &&
        attachment.hullLength <= count
          ? attachment.hullLength
          : 0;

      ctx.beginPath();
      if (hullLen > 0) {
        let moved = false;
        for (let i = 0; i < hullLen; i += 2) {
          const wx = buf[i];
          const wy = buf[i + 1];
          if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
          const sx = projectX(wx);
          const sy = projectY(wy);
          if (!moved) {
            ctx.moveTo(sx, sy);
            moved = true;
          } else {
            ctx.lineTo(sx, sy);
          }
        }
        if (moved) ctx.closePath();
      } else {
        const edgeCounts = new Map<string, [number, number, number]>();
        const addEdge = (a: number, b: number) => {
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          const key = `${lo}:${hi}`;
          const prev = edgeCounts.get(key);
          if (prev) prev[2] += 1;
          else edgeCounts.set(key, [lo, hi, 1]);
        };
        for (let t = 0; t + 2 < tris.length; t += 3) {
          addEdge(tris[t], tris[t + 1]);
          addEdge(tris[t + 1], tris[t + 2]);
          addEdge(tris[t + 2], tris[t]);
        }
        for (const [a, b, edgeCount] of edgeCounts.values()) {
          if (edgeCount !== 1) continue;
          ctx.moveTo(projectX(buf[a * 2]), projectY(buf[a * 2 + 1]));
          ctx.lineTo(projectX(buf[b * 2]), projectY(buf[b * 2 + 1]));
        }
      }
      ctx.stroke();
    } else {
      // Region / Quad attachment
      ctx.beginPath();
      let moved = false;
      for (let i = 0; i < count; i += 2) {
        const wx = buf[i];
        const wy = buf[i + 1];
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
        const sx = projectX(wx);
        const sy = projectY(wy);
        if (!moved) {
          ctx.moveTo(sx, sy);
          moved = true;
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      if (moved) {
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
    overlayHasDrawingRef.current = true;
  }, []);

  const syncCamera = useCallback(
    (cam: OrthoCamera) => {
      cam.update();
      const player = playerRef.current;
      const renderCam = player?.sceneRenderer?.camera;
      if (renderCam) {
        renderCam.viewportWidth = cam.viewportWidth;
        renderCam.viewportHeight = cam.viewportHeight;
        renderCam.position.x = cam.position.x;
        renderCam.position.y = cam.position.y;
        renderCam.zoom = cam.zoom;
        renderCam.update();
      }
      if (!playingRef.current) {
        try {
          (player as unknown as { drawFrame?: (req?: boolean) => void } | null)?.drawFrame?.(false);
        } catch {
          // ignore
        }
      }
      drawHighlightOverlay();
    },
    [drawHighlightOverlay]
  );

  const clampZoom = useCallback((nextZoom: number): number => {
    const base = defaultPoseRef.current?.zoom || 1;
    const minZoom = Math.max(0.01, base * 0.04);
    const maxZoom = Math.max(40, base * 25);
    return Math.max(minZoom, Math.min(maxZoom, nextZoom));
  }, []);

  const zoomAtClientPoint = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const cam = cameraRef.current;
      const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
      const rt = runtimeRef.current;
      if (!cam || !canvas || !(factor > 0) || !Number.isFinite(factor)) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const localX = clientX !== undefined ? clientX - rect.left : rect.width / 2;
      const localY = clientY !== undefined ? clientY - rect.top : rect.height / 2;
      const nextZoom = clampZoom(cam.zoom * factor);
      if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;

      const before = cam.screenToWorld(
        new rt.Vector3(localX, localY, 0),
        rect.width,
        rect.height
      );
      cam.zoom = nextZoom;
      cam.update();
      const after = cam.screenToWorld(
        new rt.Vector3(localX, localY, 0),
        rect.width,
        rect.height
      );
      cam.position.x += before.x - after.x;
      cam.position.y += before.y - after.y;
      syncCamera(cam);
    },
    [clampZoom, syncCamera]
  );

  const resetCameraPose = useCallback(() => {
    const cam = cameraRef.current;
    const pose = defaultPoseRef.current;
    if (!cam || !pose) return;
    cam.position.x = pose.x;
    cam.position.y = pose.y;
    cam.zoom = pose.zoom;
    syncCamera(cam);
  }, [syncCamera]);

  const hitTestLayerAtClientPoint = useCallback((clientX: number, clientY: number): string | null => {
    const cam = cameraRef.current;
    const player = playerRef.current;
    const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    const skeleton = player?.skeleton as unknown as { drawOrder?: SlotLike[] } | undefined;
    if (!cam || !canvas || !skeleton?.drawOrder) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const world = cam.screenToWorld(
      new runtimeRef.current.Vector3(localX, localY, 0),
      rect.width,
      rect.height
    );

    const scratch = new Float32Array(4096);
    for (let i = skeleton.drawOrder.length - 1; i >= 0; i--) {
      const slot = skeleton.drawOrder[i];
      const name = slot.data.name;
      if (!name || hiddenRef.current.has(name)) continue;
      if ((slot.color?.a ?? 1) <= 0.01) continue;
      const lower = name.toLowerCase();
      if (lower.startsWith('bg') || lower.includes('background')) continue;

      const attachment = slot.getAttachment?.() as {
        worldVerticesLength?: number;
        hullLength?: number;
        triangles?: number[];
        computeWorldVertices?: (...args: unknown[]) => void;
      } | null;
      if (!attachment?.computeWorldVertices) continue;

      try {
        if (typeof attachment.worldVerticesLength === 'number' && attachment.worldVerticesLength > 0) {
          const count = attachment.worldVerticesLength;
          const buf = count <= scratch.length ? scratch : new Float32Array(count);
          attachment.computeWorldVertices(slot, 0, count, buf, 0, 2);
          const tris = attachment.triangles;
          if (tris && tris.length >= 3) {
            for (let t = 0; t < tris.length; t += 3) {
              const i0 = tris[t] * 2;
              const i1 = tris[t + 1] * 2;
              const i2 = tris[t + 2] * 2;
              if (
                pointInTriangle(
                  world.x,
                  world.y,
                  buf[i0],
                  buf[i0 + 1],
                  buf[i1],
                  buf[i1 + 1],
                  buf[i2],
                  buf[i2 + 1]
                )
              ) {
                return name;
              }
            }
          }
        } else if (slot.bone) {
          attachment.computeWorldVertices(slot.bone, scratch, 0, 2);
          if (
            pointInTriangle(
              world.x,
              world.y,
              scratch[0],
              scratch[1],
              scratch[2],
              scratch[3],
              scratch[4],
              scratch[5]
            ) ||
            pointInTriangle(
              world.x,
              world.y,
              scratch[0],
              scratch[1],
              scratch[4],
              scratch[5],
              scratch[6],
              scratch[7]
            )
          ) {
            return name;
          }
        }
      } catch {
        continue;
      }
    }
    return null;
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      getPose: () => {
        const cam = cameraRef.current;
        return cam ? { x: cam.position.x, y: cam.position.y, zoom: cam.zoom } : null;
      },
      setPose: (pose) => {
        const cam = cameraRef.current;
        if (!cam) return;
        cam.position.x = pose.x;
        cam.position.y = pose.y;
        cam.zoom = clampZoom(pose.zoom);
        syncCamera(cam);
      },
      resetPose: resetCameraPose,
      zoomBy: (factor) => zoomAtClientPoint(factor),
      capture: () => {
        const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
        return canvas ? canvas.toDataURL('image/png') : null;
      },
    }),
    [clampZoom, resetCameraPose, syncCamera, zoomAtClientPoint]
  );

  // ---------------------------------------------------------------------------
  // load
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setStage('Downloading skeleton and atlas');

    disposePlayer(playerRef.current);
    playerRef.current = null;
    cameraRef.current = null;
    defaultPoseRef.current = null;
    container.innerHTML = '';

    const modelUrlBase = ECHO_SPINE_BASE;
    const skeletonPath = `res/common/knight_spine/${character.spine}/${character.spine}.skel`;
    const atlasPath = `res/common/knight_spine/${character.spine}/${character.spine}.atlas`;

    void (async () => {
      let model: LoadedModel;
      try {
        model = await loadModel({
          urlBase: modelUrlBase,
          skeletonPath,
          atlasPath,
          modelId: character.spine,
          signal: controller.signal,
        });
      } catch (err) {
        if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
        const loadError = err as ModelLoadError;
        setLoading(false);
        setError({
          message: loadError.message || 'Could not load this model.',
          detail: loadError.detail || String(err),
        });
        return;
      }
      if (disposed) return;

      const runtimeVersion = runtimeForVersion(model.inspection.version);
      setStage(`Starting Spine ${runtimeVersion} runtime`);

      let runtime: RuntimeModule;
      try {
        runtime = await loadRuntime(runtimeVersion);
      } catch (err) {
        setLoading(false);
        setError({
          message: `Spine ${runtimeVersion} runtime failed to start.`,
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      if (disposed) return;

      runtimeRef.current = runtime;

      applyTextureContract(runtime.GLTexture, {
        blendPma: model.alpha.blendPma,
        mipmaps: true,
      });

      setStage('Building GPU textures');

      const downloader = createModelDownloader(
        runtime.Downloader as unknown as new () => {
          rawDataUris: Record<string, string>;
          downloadText: unknown;
          downloadBinary: unknown;
        },
        model
      ) as unknown as Downloader;

      const player = new runtime.SpinePlayer(container, {
        ...skeletonConfigFor(runtimeVersion, model),
        atlasUrl: model.atlasUrl,
        downloader,
        showControls: false,
        showLoading: false,
        premultipliedAlpha: model.alpha.blendPma,
        preserveDrawingBuffer: true,
        alpha: true,
        mipmaps: true,
        backgroundColor: '#00000000',
        viewport: {
          x: -500,
          y: -500,
          width: 1000,
          height: 1000,
          padLeft: 0,
          padRight: 0,
          padTop: 0,
          padBottom: 0,
          transitionTime: 0,
        },
        update: (p) => {
          const renderCam = p.sceneRenderer?.camera;
          const cam = cameraRef.current;
          if (renderCam && cam) {
            cam.viewportWidth = renderCam.viewportWidth;
            cam.viewportHeight = renderCam.viewportHeight;
            renderCam.position.x = cam.position.x;
            renderCam.position.y = cam.position.y;
            renderCam.zoom = cam.zoom;
            renderCam.update();
          }
          applyVisibility(p);
          drawHighlightOverlay();
        },
        success: (p) => {
          if (disposed) {
            disposePlayer(p);
            return;
          }
          playerRef.current = p;
          const skeleton = p.skeleton;
          if (!skeleton) {
            setLoading(false);
            return;
          }

          skeleton.setToSetupPose();

          const slots = (skeleton as unknown as { slots: SlotLike[] }).slots;
          setupColorsRef.current = new Map(
            slots.map((slot) => [
              slot.data.name,
              slot.color ? { ...slot.color } : undefined,
            ])
          );
          forcedHiddenRef.current.clear();

          const animations = (skeleton.data.animations || []).map((a) => a.name);
          onAnimationsLoaded(animations);
          onLayersLoaded(slots.map((slot) => slot.data.name));

          if (animations.length > 0 && p.animationState) {
            const preferred =
              animations.find((a) => /^(idle|stand|loop|dai|wait)/i.test(a)) || animations[0];
            p.animationState.setAnimation(0, preferred, true);
            p.animationState.apply(skeleton);
            skeleton.updateWorldTransform();
          }

          const canvas = p.canvas;
          const renderCam = p.sceneRenderer?.camera;
          if (canvas && renderCam) {
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';

            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            const cssW = canvas.clientWidth || container.clientWidth || 800;
            const cssH = canvas.clientHeight || container.clientHeight || 800;
            const bufW = Math.max(1, Math.round(cssW * dpr));
            const bufH = Math.max(1, Math.round(cssH * dpr));
            const bounds = measureBounds(skeleton, runtime);

            const cam = new runtime.OrthoCamera(bufW, bufH);
            cam.position.x = bounds.x + bounds.width / 2;
            cam.position.y = bounds.y + bounds.height / 2;

            const aspect = bufH / Math.max(bufW, 1);
            const padW = Math.max(bounds.width, 100) * 1.1;
            const padH = Math.max(bounds.height, 100) * 1.1;
            const viewAspect = padH / Math.max(padW, 1);
            cam.zoom = aspect > viewAspect ? padW / Math.max(bufW, 1) : padH / Math.max(bufH, 1);
            if (!Number.isFinite(cam.zoom) || cam.zoom <= 0) cam.zoom = 1;
            cam.update();

            cameraRef.current = cam;
            defaultPoseRef.current = { x: cam.position.x, y: cam.position.y, zoom: cam.zoom };
            renderCam.viewportWidth = bufW;
            renderCam.viewportHeight = bufH;
            renderCam.position.x = cam.position.x;
            renderCam.position.y = cam.position.y;
            renderCam.zoom = cam.zoom;
            renderCam.update();
          }

          p.speed = playingRef.current ? speedRef.current : 0;
          if (playingRef.current) p.play();
          else p.pause();

          setLoading(false);
        },
        error: (_p, message) => {
          if (disposed) return;
          setLoading(false);
          setError({ message: 'The Spine runtime rejected this model.', detail: String(message) });
        },
      });
      playerRef.current = player;
    })();

    return () => {
      disposed = true;
      controller.abort();
      disposePlayer(playerRef.current);
      playerRef.current = null;
      cameraRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, reloadNonce]);

  // ---------------------------------------------------------------------------
  // reactive props
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.animationState || !activeAnimation) return;
    const current = player.animationState.getCurrent(0);
    if (current?.animation?.name === activeAnimation) return;
    try {
      player.animationState.setAnimation(0, activeAnimation, true);
      if (!playingRef.current && player.skeleton) {
        player.animationState.apply(player.skeleton);
        player.skeleton.updateWorldTransform();
        (player as unknown as { drawFrame?: (req?: boolean) => void }).drawFrame?.(false);
      }
    } catch {
      // ignore invalid animation
    }
  }, [activeAnimation]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.speed = isPlaying ? animationSpeed : 0;
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying, animationSpeed]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    applyVisibility(player);
    if (!playingRef.current) {
      try {
        (player as unknown as { drawFrame?: (req?: boolean) => void }).drawFrame?.(false);
      } catch {
        // ignore
      }
    }
    drawHighlightOverlay();
  }, [hiddenLayers, applyVisibility, drawHighlightOverlay]);

  useEffect(() => {
    drawHighlightOverlay();
  }, [selectedLayerName, isPlaying, activeAnimation, drawHighlightOverlay]);

  // Keyboard shortcuts matching BD2 viewer
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'h') {
        if (selectedLayerRef.current) {
          e.preventDefault();
          onDeleteLayerRef.current(selectedLayerRef.current);
        }
      } else if (e.key.toLowerCase() === 'u') {
        e.preventDefault();
        onUndoDeleteRef.current();
      } else if (e.key === 'Escape') {
        if (selectedLayerRef.current) {
          e.preventDefault();
          onSelectLayerRef.current(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---------------------------------------------------------------------------
  // input: mouse pan / wheel & trackpad zoom / 2-finger pinch / tap layer pick
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mousePanning = false;
    let mouseDownX = 0;
    let mouseDownY = 0;
    let mouseLastX = 0;
    let mouseLastY = 0;
    let mouseMoved = 0;

    let touchPanStart: {
      x: number;
      y: number;
      camX: number;
      camY: number;
      moved: number;
    } | null = null;
    let prevPinchDistance: number | null = null;
    let prevPinchMid: { x: number; y: number } | null = null;
    let wasPinching = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mousePanning = true;
      mouseDownX = e.clientX;
      mouseDownY = e.clientY;
      mouseLastX = e.clientX;
      mouseLastY = e.clientY;
      mouseMoved = 0;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mousePanning) return;
      const cam = cameraRef.current;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cam || !canvas) return;
      const dx = e.clientX - mouseLastX;
      const dy = e.clientY - mouseLastY;
      mouseLastX = e.clientX;
      mouseLastY = e.clientY;
      mouseMoved = Math.max(mouseMoved, Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY));
      const rect = canvas.getBoundingClientRect();
      const perPxX = (cam.viewportWidth * cam.zoom) / Math.max(rect.width, 1);
      const perPxY = (cam.viewportHeight * cam.zoom) / Math.max(rect.height, 1);
      cam.position.x -= dx * perPxX;
      cam.position.y += dy * perPxY;
      syncCamera(cam);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!mousePanning) return;
      mousePanning = false;
      if (mouseMoved < 6) {
        const hit = hitTestLayerAtClientPoint(e.clientX, e.clientY);
        onSelectLayerRef.current(hit && hit === selectedLayerRef.current ? null : hit);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!cameraRef.current) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const clampedDelta = Math.max(-140, Math.min(140, e.deltaY));
      const sensitivity = e.ctrlKey ? 0.008 : 0.0014;
      const factor = Math.exp(clampedDelta * sensitivity);
      zoomAtClientPoint(factor, e.clientX, e.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      const cam = cameraRef.current;
      if (!cam) return;
      if (e.touches.length === 1 && !wasPinching) {
        const t = e.touches[0];
        touchPanStart = {
          x: t.clientX,
          y: t.clientY,
          camX: cam.position.x,
          camY: cam.position.y,
          moved: 0,
        };
        prevPinchDistance = null;
        prevPinchMid = null;
      } else if (e.touches.length >= 2) {
        touchPanStart = null;
        wasPinching = true;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        prevPinchDistance = dist > 2 ? dist : null;
        prevPinchMid = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const cam = cameraRef.current;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cam || !canvas) return;
      if (e.cancelable) e.preventDefault();

      if (e.touches.length >= 2) {
        touchPanStart = null;
        wasPinching = true;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const curMid = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };

        if (prevPinchDistance === null || prevPinchMid === null) {
          if (dist > 2) {
            prevPinchDistance = dist;
            prevPinchMid = curMid;
          }
          return;
        }

        if (dist > 2 && prevPinchDistance > 2) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const rt = runtimeRef.current;
            const before = cam.screenToWorld(
              new rt.Vector3(prevPinchMid.x - rect.left, prevPinchMid.y - rect.top, 0),
              rect.width,
              rect.height
            );
            const nextZoom = clampZoom(cam.zoom * (prevPinchDistance / dist));
            if (Number.isFinite(nextZoom) && nextZoom > 0) {
              cam.zoom = nextZoom;
              cam.update();
              const after = cam.screenToWorld(
                new rt.Vector3(curMid.x - rect.left, curMid.y - rect.top, 0),
                rect.width,
                rect.height
              );
              cam.position.x += before.x - after.x;
              cam.position.y += before.y - after.y;
              syncCamera(cam);
            }
          }
          prevPinchDistance = dist;
          prevPinchMid = curMid;
        }
      } else if (e.touches.length === 1 && touchPanStart && !wasPinching) {
        const t = e.touches[0];
        const dx = t.clientX - touchPanStart.x;
        const dy = t.clientY - touchPanStart.y;
        touchPanStart.moved = Math.max(touchPanStart.moved, Math.hypot(dx, dy));
        const rect = canvas.getBoundingClientRect();
        const perPxX = (cam.viewportWidth * cam.zoom) / Math.max(rect.width, 1);
        const perPxY = (cam.viewportHeight * cam.zoom) / Math.max(rect.height, 1);
        cam.position.x = touchPanStart.camX - dx * perPxX;
        cam.position.y = touchPanStart.camY + dy * perPxY;
        syncCamera(cam);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        if (touchPanStart && !wasPinching && touchPanStart.moved < 8) {
          const lastTouch = e.changedTouches[0];
          if (lastTouch) {
            const hit = hitTestLayerAtClientPoint(lastTouch.clientX, lastTouch.clientY);
            onSelectLayerRef.current(hit && hit === selectedLayerRef.current ? null : hit);
          }
        }
        touchPanStart = null;
        prevPinchDistance = null;
        prevPinchMid = null;
        wasPinching = false;
      } else if (e.touches.length === 1) {
        prevPinchDistance = null;
        prevPinchMid = null;
      }
    };

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerSizeRef.current = { width: rect.width, height: rect.height };
      }
      const cam = cameraRef.current;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cam || !canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (cam.viewportWidth !== w || cam.viewportHeight !== h) {
        cam.viewportWidth = w;
        cam.viewportHeight = h;
        syncCamera(cam);
      } else {
        drawHighlightOverlay();
      }
    });
    ro.observe(container);

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      ro.disconnect();
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [clampZoom, hitTestLayerAtClientPoint, syncCamera, zoomAtClientPoint]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden select-none">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing relative z-10 touch-none" />

      {/* Body-Part Highlight Overlay (matching BD2 viewer) */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      />

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-slate-950/75 backdrop-blur-sm">
          <Loader2 className="w-7 h-7 text-emerald-400 animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-white">{character.charName}</p>
            <p className="text-[11px] font-mono text-slate-400">
              {character.costumeName} · {stage}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-slate-950/90 p-6 text-center">
          <AlertTriangle className="w-7 h-7 text-rose-400" />
          <p className="text-sm font-semibold text-rose-300">{error.message}</p>
          {error.detail && (
            <p className="max-w-lg text-[11px] font-mono text-slate-500 break-words">{error.detail}</p>
          )}
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            className="min-h-[38px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Selected layer actions */}
      {selectedLayerName && (
        <div className="absolute top-14 left-3 sm:top-4 sm:left-1/2 sm:-translate-x-1/2 z-30 flex items-center gap-2.5 px-3.5 py-2 rounded-2xl bg-slate-900/95 border border-sky-400/50 shadow-2xl backdrop-blur-md">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping shrink-0" />
          <span className="text-xs text-slate-400 font-medium hidden sm:inline">Selected:</span>
          <span className="text-xs font-bold text-sky-300 truncate max-w-[160px] sm:max-w-[220px] font-mono">
            {selectedLayerName}
          </span>
          <button
            onClick={() => onDeleteLayer(selectedLayerName)}
            className="min-h-[30px] px-2.5 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors shadow-md shadow-rose-600/25"
            title="Hide this layer (Delete / Backspace / H)"
          >
            <Trash2 className="w-3.5 h-3.5" /> Hide
          </button>
          <button
            onClick={() => onSelectLayer(null)}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center text-xs transition-colors"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}

      {/* Camera & layer undo controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        {hiddenLayers.size > 0 && (
          <div className="flex items-center p-1 rounded-xl bg-slate-900/90 border border-slate-800/90 backdrop-blur-md shadow-xl gap-1">
            <button
              onClick={onUndoDelete}
              className="h-8 px-2.5 rounded-lg hover:bg-slate-800 text-slate-200 text-[11px] font-medium flex items-center gap-1.5 transition-colors tabular-nums"
              title="Restore last hidden layer"
            >
              <Undo2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Undo ({hiddenLayers.size})</span>
            </button>
            {hiddenLayers.size > 1 && (
              <button
                onClick={onResetAllLayers}
                className="h-8 px-2.5 rounded-lg hover:bg-slate-800 text-slate-300 text-[11px] font-medium transition-colors"
              >
                Show all
              </button>
            )}
          </div>
        )}

        <div className="flex items-center p-1 rounded-xl bg-slate-900/90 border border-slate-800/90 backdrop-blur-md shadow-xl">
          <button
            onClick={() => zoomAtClientPoint(1 / 1.25)}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => zoomAtClientPoint(1.25)}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-slate-800 mx-0.5" />
          <button
            onClick={resetCameraPose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors"
            aria-label="Recenter"
            title="Fit to screen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});

EchoSpineViewer.displayName = 'EchoSpineViewer';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denom = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denom) < 1e-8) return false;
  const invDenom = 1 / denom;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function measureBounds(
  skeleton: unknown,
  runtime: RuntimeModule
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  const drawOrder = (skeleton as { drawOrder?: unknown[] }).drawOrder || [];
  const scratch = new Float32Array(4096);

  for (const slot of drawOrder) {
    const typedSlot = slot as {
      data: { name: string };
      bone?: unknown;
      getAttachment: () => unknown;
    };
    const name = typedSlot.data.name.toLowerCase();
    if (name.startsWith('bg') || name.includes('background')) continue;
    const attachment = typedSlot.getAttachment() as {
      worldVerticesLength?: number;
      computeWorldVertices?: (...args: unknown[]) => void;
    } | null;
    if (!attachment?.computeWorldVertices) continue;

    let count = 0;
    try {
      if (typeof attachment.worldVerticesLength === 'number' && attachment.worldVerticesLength > 0) {
        count = attachment.worldVerticesLength;
        const buf = count <= scratch.length ? scratch : new Float32Array(count);
        attachment.computeWorldVertices(typedSlot, 0, count, buf, 0, 2);
        for (let i = 0; i < count; i += 2) {
          if (Number.isFinite(buf[i]) && Number.isFinite(buf[i + 1])) {
            minX = Math.min(minX, buf[i]);
            maxX = Math.max(maxX, buf[i]);
            minY = Math.min(minY, buf[i + 1]);
            maxY = Math.max(maxY, buf[i + 1]);
            found = true;
          }
        }
      } else if (typedSlot.bone) {
        attachment.computeWorldVertices(typedSlot.bone, scratch, 0, 2);
        for (let i = 0; i < 8; i += 2) {
          if (Number.isFinite(scratch[i]) && Number.isFinite(scratch[i + 1])) {
            minX = Math.min(minX, scratch[i]);
            maxX = Math.max(maxX, scratch[i]);
            minY = Math.min(minY, scratch[i + 1]);
            maxY = Math.max(maxY, scratch[i + 1]);
            found = true;
          }
        }
      }
    } catch {
      continue;
    }
  }

  if (found && maxX - minX > 5 && maxY - minY > 5) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  const offset = new runtime.Vector2();
  const size = new runtime.Vector2();
  (skeleton as { getBounds: (o: unknown, s: unknown) => void }).getBounds(offset, size);
  return {
    x: Number.isFinite(offset.x) ? offset.x : -400,
    y: Number.isFinite(offset.y) ? offset.y : -400,
    width: size.x > 5 ? size.x : 800,
    height: size.y > 5 ? size.y : 800,
  };
}
