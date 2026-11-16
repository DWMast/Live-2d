import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpinePlayer, GLTexture, OrthoCamera, Vector2, Vector3, Downloader } from '@esotericsoftware/spine-player';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import { BD2Character } from '../types/bd2';
import { ECHO_SPINE_BASE } from '../utils/bd2Assets';
import { loadModel, createModelDownloader, ModelLoadError, type LoadedModel } from '../utils/spine/assetLoader';
import { applyTextureContract, type ContractState } from '../utils/spine/renderContract';
import { runtimeForVersion, type SpineInspection } from '../utils/spine/skeletonInspector';
import {
  Check,
  AlertTriangle,
  Loader2,
  Maximize2,
  RefreshCw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Camera,
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
  onModelLoaded?: (info: ModelHealth) => void;
}

/** Everything the health panel reports, taken from the file rather than guessed. */
export interface ModelHealth {
  modelId: string;
  version: string | null;
  runtime: '3.8' | '4.0' | '4.1' | '4.2';
  headerOk: boolean;
  headerError: string | null;
  alphaSummary: string;
  blendPma: boolean;
  uploadPma: boolean;
  texturePatched: boolean;
  mipmaps: boolean;
  pageCount: number;
  pageNames: string[];
  slots: number;
  bones: number;
  animations: number;
  skins: string[];
  darkTintedSlots: number;
  loadMs: number;
  payloadMb: number;
  warnings: string[];
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
  color?: { r: number; g: number; b: number; a: number };
  darkColor?: { r: number; g: number; b: number; a: number };
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
    onModelLoaded,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<SpinePlayer | null>(null);
  const cameraRef = useRef<OrthoCamera | null>(null);
  const defaultPoseRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const hiddenRef = useRef(hiddenLayers);
  const playingRef = useRef(isPlaying);
  const speedRef = useRef(animationSpeed);
  const setupColorsRef = useRef<Map<string, SlotLike['color']>>(new Map());
  const forcedHiddenRef = useRef<Set<string>>(new Set());
  const [reloadNonce, setReloadNonce] = useState(0);

  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState('Preparing');
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const [health, setHealth] = useState<ModelHealth | null>(null);

  hiddenRef.current = hiddenLayers;
  playingRef.current = isPlaying;
  speedRef.current = animationSpeed;

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

  React.useImperativeHandle(
    ref,
    () => ({
      getPose: () => {
        const cam = cameraRef.current;
        return cam ? { x: cam.position.x, y: cam.position.y, zoom: cam.zoom } : null;
      },
      setPose: (pose) => {
        const cam = cameraRef.current;
        const renderCam = playerRef.current?.sceneRenderer?.camera;
        if (!cam) return;
        cam.position.x = pose.x;
        cam.position.y = pose.y;
        cam.zoom = pose.zoom;
        cam.update();
        if (renderCam) {
          renderCam.position.x = pose.x;
          renderCam.position.y = pose.y;
          renderCam.zoom = pose.zoom;
          renderCam.update();
        }
      },
      resetPose: () => {
        const cam = cameraRef.current;
        const pose = defaultPoseRef.current;
        const renderCam = playerRef.current?.sceneRenderer?.camera;
        if (!cam || !pose) return;
        cam.position.x = pose.x;
        cam.position.y = pose.y;
        cam.zoom = pose.zoom;
        cam.update();
        if (renderCam) {
          renderCam.position.x = pose.x;
          renderCam.position.y = pose.y;
          renderCam.zoom = pose.zoom;
          renderCam.update();
        }
      },
      zoomBy: (factor) => {
        const cam = cameraRef.current;
        if (!cam) return;
        const next = cam.zoom * factor;
        if (next > 0 && Number.isFinite(next)) {
          cam.zoom = next;
          cam.update();
        }
      },
      capture: () => {
        const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
        return canvas ? canvas.toDataURL('image/png') : null;
      },
    }),
    []
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
    setHealth(null);
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

      // Runtime chosen from the skeleton's own header, not from the catalog guess.
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

      // The contract: upload form must equal blend form, both from the atlas.
      const contract: ContractState = applyTextureContract(runtime.GLTexture, {
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
        binaryUrl: model.skeletonUrl,
        atlasUrl: model.atlasUrl,
        downloader,
        showControls: false,
        showLoading: false,
        // Blend side of the contract.
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

          // Snapshot setup colours before anything hides them.
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
          }

          // Frame the model from its live bounds.
          const canvas = p.canvas;
          const renderCam = p.sceneRenderer?.camera;
          if (canvas && renderCam) {
            canvas.style.display = 'block';
            canvas.style.width = '100%';
            canvas.style.height = '100%';

            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            const cssW = canvas.clientWidth || 800;
            const cssH = canvas.clientHeight || 800;
            const bounds = measureBounds(skeleton, runtime);

            const cam = new runtime.OrthoCamera(Math.round(cssW * dpr), Math.round(cssH * dpr));
            cam.position.x = bounds.x + bounds.width / 2;
            cam.position.y = bounds.y + bounds.height / 2;

            const aspect = cssH / Math.max(cssW, 1);
            const padW = Math.max(bounds.width, 100) * 1.08;
            const padH = Math.max(bounds.height, 100) * 1.08;
            const viewAspect = padH / Math.max(padW, 1);
            cam.zoom = aspect > viewAspect ? padW / Math.max(cssW * dpr, 1) : padH / Math.max(cssH * dpr, 1);
            if (!Number.isFinite(cam.zoom) || cam.zoom <= 0) cam.zoom = 1;
            cam.update();

            cameraRef.current = cam;
            defaultPoseRef.current = { x: cam.position.x, y: cam.position.y, zoom: cam.zoom };
            renderCam.position.x = cam.position.x;
            renderCam.position.y = cam.position.y;
            renderCam.zoom = cam.zoom;
            renderCam.update();
          }

          p.speed = playingRef.current ? speedRef.current : 0;
          if (playingRef.current) p.play();
          else p.pause();

          const info: ModelHealth = summarize(model, contract, p.skeleton as unknown as {
            bones?: unknown[];
            slots?: unknown[];
          }, runtimeVersion);
          setHealth(info);
          onModelLoaded?.(info);
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
  }, [hiddenLayers, applyVisibility]);

  // ---------------------------------------------------------------------------
  // input: pan / wheel zoom / pinch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      container.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const cam = cameraRef.current;
      const canvas = container.querySelector('canvas') as HTMLCanvasElement | null;
      if (!cam || !canvas) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const perPxX = (cam.viewportWidth * cam.zoom) / Math.max(canvas.clientWidth, 1);
      const perPxY = (cam.viewportHeight * cam.zoom) / Math.max(canvas.clientHeight, 1);
      cam.position.x -= dx * perPxX;
      cam.position.y += dy * perPxY;
      cam.update();
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onWheel = (e: WheelEvent) => {
      const cam = cameraRef.current;
      if (!cam) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1 / 1.12 : 1.12;
      const next = cam.zoom * factor;
      if (next > 0 && Number.isFinite(next)) {
        cam.zoom = next;
        cam.update();
      }
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  const healthBadge = useMemo(() => {
    if (!health) return null;
    const issues = health.warnings.length + (health.headerError ? 1 : 0);
    if (issues === 0) return { tone: 'ok' as const, label: 'Clean' };
    return { tone: 'warn' as const, label: `${issues} note${issues === 1 ? '' : 's'}` };
  }, [health]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden select-none">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing touch-none" />

      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-sm">
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

      {/* Health badge */}
      {healthBadge && (
        <div
          className={`absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-mono backdrop-blur-sm ${
            healthBadge.tone === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
          }`}
        >
          <Check className="w-3 h-3" />
          Spine {health?.version ?? '?'} · {health?.pageCount ?? 0} page{(health?.pageCount ?? 0) === 1 ? '' : 's'} ·{' '}
          {health?.slots ?? 0} slots · {health?.blendPma ? 'PMA' : 'straight'} · {healthBadge.label}
        </div>
      )}

      {/* Selected layer actions */}
      {selectedLayerName && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/95 border border-emerald-400/50 shadow-xl">
          <span className="text-[11px] font-mono text-emerald-300 truncate max-w-[180px]">
            {selectedLayerName}
          </span>
          <button
            onClick={() => onDeleteLayer(selectedLayerName)}
            className="min-h-[30px] px-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Hide
          </button>
          <button
            onClick={() => onSelectLayer(null)}
            className="text-slate-400 hover:text-white text-xs"
            aria-label="Clear selection"
          >
            ✕
          </button>
        </div>
      )}

      {/* Camera controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        {hiddenLayers.size > 0 && (
          <button
            onClick={onUndoDelete}
            className="min-h-[34px] px-2.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 text-[11px] flex items-center gap-1"
          >
            <Undo2 className="w-3 h-3" /> Undo ({hiddenLayers.size})
          </button>
        )}
        {hiddenLayers.size > 1 && (
          <button
            onClick={onResetAllLayers}
            className="min-h-[34px] px-2.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 text-[11px]"
          >
            Show all
          </button>
        )}
        <button
          onClick={() => (ref as React.MutableRefObject<{ zoomBy: (f: number) => void }>)?.current?.zoomBy?.(1 / 1.2)}
          className="w-[34px] h-[34px] rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 flex items-center justify-center"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => (ref as React.MutableRefObject<{ zoomBy: (f: number) => void }>)?.current?.zoomBy?.(1.2)}
          className="w-[34px] h-[34px] rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 flex items-center justify-center"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => (ref as React.MutableRefObject<{ resetPose: () => void }>)?.current?.resetPose?.()}
          className="w-[34px] h-[34px] rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 flex items-center justify-center"
          aria-label="Recenter"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            const url = (ref as React.MutableRefObject<{ capture: () => string | null }>)?.current?.capture?.();
            if (!url) return;
            const link = document.createElement('a');
            link.download = `${character.baseId || character.spine}_${character.spine}.png`;
            link.href = url;
            link.click();
          }}
          className="w-[34px] h-[34px] rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 flex items-center justify-center"
          aria-label="Save transparent PNG"
        >
          <Camera className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});

EchoSpineViewer.displayName = 'EchoSpineViewer';

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

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
      } else {
        attachment.computeWorldVertices(typedSlot, scratch, 0, 2);
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

function summarize(
  model: LoadedModel,
  contract: ContractState,
  skeleton: { bones?: unknown[]; slots?: unknown[] },
  runtimeVersion: '3.8' | '4.0' | '4.1' | '4.2'
): ModelHealth {
  const inspection: SpineInspection = model.inspection;
  return {
    modelId: model.skeletonUrl.split('/').slice(-2)[0] ?? '',
    version: inspection.version,
    runtime: runtimeVersion,
    headerOk: inspection.ok,
    headerError: inspection.error,
    alphaSummary: model.alpha.summary,
    blendPma: contract.blendPma,
    uploadPma: contract.uploadPma,
    texturePatched: contract.patched,
    mipmaps: contract.mipmaps,
    pageCount: model.pages.length,
    pageNames: model.pages.map((p) => `${p.declaredName}${p.resolvedName !== p.declaredName ? ` → ${p.resolvedName}` : ''}`),
    slots: skeleton.slots?.length ?? inspection.slots.length,
    bones: skeleton.bones?.length ?? inspection.bones.length,
    animations: inspection.animationCount,
    skins: inspection.skins.map((s) => s.name),
    darkTintedSlots: inspection.darkTintedSlots.length,
    loadMs: model.elapsedMs,
    payloadMb:
      Math.round(
        ((model.skeleton.byteLength + new TextEncoder().encode(model.atlasText).length +
          model.pages.reduce((sum, p) => sum + p.bytes, 0)) /
          1048576) *
          10
      ) / 10,
    warnings: model.warnings,
  };
}
