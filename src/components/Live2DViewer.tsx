import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, RefreshCw, RotateCcw, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Point } from '@pixi/math';
import type { BD2Character } from '../types/bd2';
import { extractBoundaryPolylines } from '../utils/spineHitTest';
import {
  clampLive2DZoom,
  createLive2DLayerController,
  createLive2DLayerPicker,
  zoomLive2DCameraAtPoint,
  type Live2DCameraPose,
  type Live2DLayerController,
  type Live2DLayerPicker,
} from '../utils/live2dControls';

/** Cubism 2 and Cubism 4 Live2D viewer with native part and camera controls. */
let coreLoadPromise: Promise<void> | null = null;

function ensureLive2DRuntimes(): Promise<void> {
  if (!coreLoadPromise) {
    const scripts = [
      { globalName: 'Live2D', src: '/vendor/live2d.min.js' },
      { globalName: 'Live2DCubismCore', src: '/vendor/live2dcubismcore.min.js' },
    ];
    coreLoadPromise = Promise.all(
      scripts.map(({ globalName, src }) => {
        if ((window as unknown as Record<string, unknown>)[globalName]) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`Failed to load ${src}`));
          document.head.appendChild(script);
        });
      })
    ).then(() => undefined).catch((error) => {
      coreLoadPromise = null;
      throw error;
    });
  }
  return coreLoadPromise;
}

let displayModulePromise: Promise<typeof import('pixi-live2d-display-lipsyncpatch')> | null = null;

function loadDisplayModule() {
  if (!displayModulePromise) {
    displayModulePromise = import('pixi-live2d-display-lipsyncpatch');
  }
  return displayModulePromise;
}

interface Live2DViewerProps {
  character: BD2Character;
  isPlaying: boolean;
  animationSpeed: number;
  activeAnimation: string;
  hiddenLayers: Set<string>;
  selectedLayerName: string | null;
  onAnimationsLoaded: (animations: string[]) => void;
  onLayersLoaded: (layers: string[]) => void;
  onSelectLayer: (layerName: string | null) => void;
  onDeleteLayer: (layerName: string) => void;
  onUndoDelete: () => void;
  onResetAllLayers: () => void;
  onLoadError?: (message: string) => void;
}

interface Live2DViewControls {
  zoomBy: (factor: number) => void;
  reset: () => void;
}

export function Live2DViewer({
  character,
  isPlaying,
  animationSpeed,
  activeAnimation,
  hiddenLayers,
  selectedLayerName,
  onAnimationsLoaded,
  onLayersLoaded,
  onSelectLayer,
  onDeleteLayer,
  onUndoDelete,
  onResetAllLayers,
  onLoadError,
}: Live2DViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<{
    motion: (group: string, index?: number, priority?: number) => Promise<unknown> | unknown;
    motionGroups?: string[];
  } | null>(null);
  const controlsRef = useRef<Live2DViewControls | null>(null);
  const layerControllerRef = useRef<Live2DLayerController | null>(null);
  const layerPickerRef = useRef<Live2DLayerPicker | null>(null);
  const renderNowRef = useRef<(() => void) | null>(null);
  const drawHighlightRef = useRef<(() => void) | null>(null);
  const cameraRef = useRef<Live2DCameraPose>({ zoom: 1, panX: 0, panY: 0 });

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [zoomPercent, setZoomPercent] = useState(100);

  const modelUrl = useMemo(() => character.live2dModelUrl || '', [character.live2dModelUrl]);

  const playRef = useRef(isPlaying);
  const speedRef = useRef(animationSpeed);
  const activeAnimRef = useRef(activeAnimation);
  const hiddenLayersRef = useRef(hiddenLayers);
  const selectedLayerRef = useRef(selectedLayerName);
  const callbacksRef = useRef({ onAnimationsLoaded, onLayersLoaded, onSelectLayer, onLoadError });

  playRef.current = isPlaying;
  speedRef.current = animationSpeed;
  activeAnimRef.current = activeAnimation;
  hiddenLayersRef.current = hiddenLayers;
  selectedLayerRef.current = selectedLayerName;
  callbacksRef.current = { onAnimationsLoaded, onLayersLoaded, onSelectLayer, onLoadError };

  useEffect(() => {
    let disposed = false;
    let app: import('pixi.js').Application | null = null;
    let model: import('pixi-live2d-display-lipsyncpatch').Live2DModel | null = null;
    let tickerFunc: (() => void) | null = null;
    let highlightTickerFunc: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupCameraListeners: (() => void) | null = null;
    let removeLayerListener: (() => void) | null = null;

    setIsLoading(true);
    setLoadError(null);
    setZoomPercent(100);
    cameraRef.current = { zoom: 1, panX: 0, panY: 0 };
    controlsRef.current = null;
    layerControllerRef.current = null;
    layerPickerRef.current = null;
    renderNowRef.current = null;
    drawHighlightRef.current = null;

    const report = (err: unknown) => {
      if (!disposed) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Live2D load failed', err);
        setIsLoading(false);
        setLoadError(msg);
        callbacksRef.current.onLoadError?.(msg);
      }
    };

    const boot = async () => {
      const host = hostRef.current;
      if (!host || !modelUrl) return;
      try {
        // The display module captures both runtime globals when it is imported.
        await ensureLive2DRuntimes();
        const [displayMod, PIXI] = await Promise.all([
          loadDisplayModule(),
          import('pixi.js'),
        ]);

        const { Live2DModel, MotionPriority } = displayMod as unknown as {
          Live2DModel: {
            registerTicker?: (tickerClass: unknown) => void;
            from: (
              src: string,
              opts?: {
                autoUpdate?: boolean;
                autoHitTest?: boolean;
                autoFocus?: boolean;
                ticker?: unknown;
              }
            ) => Promise<import('pixi-live2d-display-lipsyncpatch').Live2DModel>;
          };
          MotionPriority: { IDLE: number; FORCE: number; NORMAL: number; NONE: number };
        };

        if (disposed || !host) return;

        Live2DModel.registerTicker?.(PIXI.Ticker);

        app = new PIXI.Application({
          backgroundAlpha: 0,
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          preserveDrawingBuffer: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        host.innerHTML = '';
        const view = app.view as HTMLCanvasElement;
        view.style.display = 'block';
        view.style.width = '100%';
        view.style.height = '100%';
        view.style.touchAction = 'none';
        view.style.cursor = 'grab';
        view.setAttribute('aria-label', `${character.charName} interactive Live2D model`);
        host.appendChild(view);

        model = await Live2DModel.from(modelUrl, {
          autoUpdate: true,
          autoHitTest: false,
          autoFocus: false,
          ticker: app.ticker,
        });

        if (disposed) {
          model.destroy();
          model = null;
          return;
        }

        const activeModel = model;
        const originalWidth = Math.max(
          1,
          activeModel.internalModel.originalWidth || activeModel.width || 1000
        );
        const originalHeight = Math.max(
          1,
          activeModel.internalModel.originalHeight || activeModel.height || 1000
        );

        const computeFit = () => {
          const sceneW = Math.max(1, host.clientWidth || app?.renderer.width || 800);
          const sceneH = Math.max(1, host.clientHeight || app?.renderer.height || 600);
          const scale = Math.min((sceneW * 0.92) / originalWidth, (sceneH * 0.92) / originalHeight);
          return {
            scale,
            x: (sceneW - originalWidth * scale) / 2,
            y: (sceneH - originalHeight * scale) / 2,
            sceneW,
            sceneH,
          };
        };

        const applyCamera = () => {
          if (!app) return;
          const fit = computeFit();
          const camera = cameraRef.current;
          const scale = fit.scale * camera.zoom;
          activeModel.scale.set(scale);
          activeModel.x = fit.x + camera.panX;
          activeModel.y = fit.y + camera.panY;
        };

        const localTransform = (activeModel.internalModel as unknown as {
          localTransform: { apply: (point: Point, result?: Point) => Point };
        }).localTransform;

        const drawHighlightOverlay = () => {
          const canvas = overlayCanvasRef.current;
          if (!canvas || !app || disposed) return;
          const rect = view.getBoundingClientRect();
          const cssW = Math.max(1, rect.width || host.clientWidth || 800);
          const cssH = Math.max(1, rect.height || host.clientHeight || 600);
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          const targetW = Math.max(1, Math.round(cssW * dpr));
          const targetH = Math.max(1, Math.round(cssH * dpr));
          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, targetW, targetH);

          const activeLayer = selectedLayerRef.current;
          if (!activeLayer || hiddenLayersRef.current.has(activeLayer)) return;
          const meshes = layerPickerRef.current?.getMeshes(activeLayer) ?? [];
          if (meshes.length === 0) return;

          const scaleX = cssW / Math.max(1, app.screen.width);
          const scaleY = cssH / Math.max(1, app.screen.height);
          const toScreen = (x: number, y: number) => {
            const local = localTransform.apply(new Point(x, y), new Point());
            const global = activeModel.toGlobal(local);
            return { x: global.x * scaleX, y: global.y * scaleY };
          };

          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
          ctx.setLineDash([6, 4]);

          for (const mesh of meshes) {
            const { vertices, triangles } = mesh;
            if (triangles && triangles.length >= 3) {
              ctx.beginPath();
              for (let t = 0; t + 2 < triangles.length; t += 3) {
                const a = triangles[t] * 2;
                const b = triangles[t + 1] * 2;
                const c = triangles[t + 2] * 2;
                if (a + 1 >= vertices.length || b + 1 >= vertices.length || c + 1 >= vertices.length) continue;
                const p0 = toScreen(vertices[a], vertices[a + 1]);
                const p1 = toScreen(vertices[b], vertices[b + 1]);
                const p2 = toScreen(vertices[c], vertices[c + 1]);
                if (![p0.x, p0.y, p1.x, p1.y, p2.x, p2.y].every(Number.isFinite)) continue;
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.closePath();
              }
              ctx.fill();

              ctx.beginPath();
              for (const loop of extractBoundaryPolylines(triangles)) {
                let started = false;
                for (const index of loop) {
                  const offset = index * 2;
                  if (offset + 1 >= vertices.length) continue;
                  const point = toScreen(vertices[offset], vertices[offset + 1]);
                  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                  if (started) ctx.lineTo(point.x, point.y);
                  else {
                    ctx.moveTo(point.x, point.y);
                    started = true;
                  }
                }
                if (started) ctx.closePath();
              }
              ctx.stroke();
            } else {
              ctx.beginPath();
              let started = false;
              for (let i = 0; i + 1 < vertices.length; i += 2) {
                const point = toScreen(vertices[i], vertices[i + 1]);
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                if (started) ctx.lineTo(point.x, point.y);
                else {
                  ctx.moveTo(point.x, point.y);
                  started = true;
                }
              }
              if (started) {
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        };
        drawHighlightRef.current = drawHighlightOverlay;
        highlightTickerFunc = drawHighlightOverlay;

        const renderNow = () => {
          if (app && !disposed) {
            app.renderer.render(app.stage);
            drawHighlightOverlay();
          }
        };
        renderNowRef.current = renderNow;

        const setCamera = (camera: Live2DCameraPose) => {
          cameraRef.current = camera;
          setZoomPercent(Math.round(camera.zoom * 100));
          applyCamera();
          renderNow();
        };

        const zoomAt = (factor: number, point?: { x: number; y: number }) => {
          const fit = computeFit();
          const target = point ?? { x: fit.sceneW / 2, y: fit.sceneH / 2 };
          setCamera(
            zoomLive2DCameraAtPoint(
              cameraRef.current,
              fit,
              target,
              clampLive2DZoom(cameraRef.current.zoom * factor)
            )
          );
        };

        controlsRef.current = {
          zoomBy: (factor) => zoomAt(factor),
          reset: () => setCamera({ zoom: 1, panX: 0, panY: 0 }),
        };

        app.stage.addChild(activeModel as unknown as import('pixi.js').Container);
        applyCamera();

        const pointers = new Map<number, { x: number; y: number }>();
        let panStart: {
          pointerId: number;
          clientX: number;
          clientY: number;
          panX: number;
          panY: number;
        } | null = null;
        let pinchStart: {
          distance: number;
          midpoint: { x: number; y: number };
          camera: Live2DCameraPose;
          fit: ReturnType<typeof computeFit>;
        } | null = null;
        let suppressTap = false;

        const localPoint = (event: PointerEvent) => {
          const rect = view.getBoundingClientRect();
          return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };
        const pairInfo = () => {
          const pair = [...pointers.values()].slice(0, 2);
          if (pair.length < 2) return null;
          const rect = view.getBoundingClientRect();
          return {
            distance: Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)),
            midpoint: {
              x: (pair[0].x + pair[1].x) / 2 - rect.left,
              y: (pair[0].y + pair[1].y) / 2 - rect.top,
            },
          };
        };
        const startPan = (pointerId: number) => {
          const pointer = pointers.get(pointerId);
          if (!pointer) return;
          panStart = {
            pointerId,
            clientX: pointer.x,
            clientY: pointer.y,
            panX: cameraRef.current.panX,
            panY: cameraRef.current.panY,
          };
          pinchStart = null;
        };

        const onPointerDown = (event: PointerEvent) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          event.preventDefault();
          if (pointers.size === 0) suppressTap = false;
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.size >= 2) suppressTap = true;
          try {
            view.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is optional on older mobile browsers.
          }
          view.style.cursor = 'grabbing';
          if (pointers.size === 1) {
            startPan(event.pointerId);
          } else if (pointers.size === 2) {
            const pair = pairInfo();
            if (pair) {
              pinchStart = {
                ...pair,
                camera: { ...cameraRef.current },
                fit: computeFit(),
              };
              panStart = null;
            }
          }
        };

        const onPointerMove = (event: PointerEvent) => {
          if (!pointers.has(event.pointerId)) return;
          pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

          if (pointers.size === 1 && panStart?.pointerId === event.pointerId) {
            if (Math.hypot(event.clientX - panStart.clientX, event.clientY - panStart.clientY) >= 6) {
              suppressTap = true;
            }
            setCamera({
              ...cameraRef.current,
              panX: panStart.panX + event.clientX - panStart.clientX,
              panY: panStart.panY + event.clientY - panStart.clientY,
            });
            return;
          }

          if (pointers.size >= 2 && pinchStart) {
            const pair = pairInfo();
            if (!pair) return;
            const next = zoomLive2DCameraAtPoint(
              pinchStart.camera,
              pinchStart.fit,
              pinchStart.midpoint,
              clampLive2DZoom(
                pinchStart.camera.zoom * pair.distance / Math.max(1, pinchStart.distance)
              )
            );
            next.panX += pair.midpoint.x - pinchStart.midpoint.x;
            next.panY += pair.midpoint.y - pinchStart.midpoint.y;
            setCamera(next);
          }
        };

        const onPointerEnd = (event: PointerEvent) => {
          if (!pointers.has(event.pointerId)) return;
          const shouldPick =
            event.type === 'pointerup' &&
            pointers.size === 1 &&
            !suppressTap &&
            panStart?.pointerId === event.pointerId &&
            Math.hypot(event.clientX - panStart.clientX, event.clientY - panStart.clientY) < 6;
          pointers.delete(event.pointerId);

          if (shouldPick) {
            try {
              const rect = view.getBoundingClientRect();
              const point = activeModel.toModelPosition(new Point(
                (event.clientX - rect.left) * (app?.screen.width ?? rect.width) / Math.max(rect.width, 1),
                (event.clientY - rect.top) * (app?.screen.height ?? rect.height) / Math.max(rect.height, 1)
              ));
              const hit = layerPickerRef.current?.(
                point.x,
                point.y,
                hiddenLayersRef.current
              ) ?? null;
              callbacksRef.current.onSelectLayer(
                hit && hit === selectedLayerRef.current ? null : hit
              );
            } catch {
              callbacksRef.current.onSelectLayer(null);
            }
          }

          const remaining = [...pointers.keys()];
          if (remaining.length === 1) startPan(remaining[0]);
          else {
            panStart = null;
            pinchStart = null;
          }
          if (pointers.size === 0) {
            suppressTap = false;
            view.style.cursor = 'grab';
          }
        };

        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          const rect = view.getBoundingClientRect();
          zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        };

        view.addEventListener('pointerdown', onPointerDown);
        view.addEventListener('pointermove', onPointerMove);
        view.addEventListener('pointerup', onPointerEnd);
        view.addEventListener('pointercancel', onPointerEnd);
        view.addEventListener('lostpointercapture', onPointerEnd);
        view.addEventListener('wheel', onWheel, { passive: false });
        cleanupCameraListeners = () => {
          view.removeEventListener('pointerdown', onPointerDown);
          view.removeEventListener('pointermove', onPointerMove);
          view.removeEventListener('pointerup', onPointerEnd);
          view.removeEventListener('pointercancel', onPointerEnd);
          view.removeEventListener('lostpointercapture', onPointerEnd);
          view.removeEventListener('wheel', onWheel);
          pointers.clear();
        };

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            app?.resize();
            applyCamera();
            renderNow();
          });
          resizeObserver.observe(host);
        }

        const internalCasted = activeModel.internalModel as unknown as {
          motionManager: { groups?: Record<string, string>; isFinished?: () => boolean };
          settings?: { motions?: Record<string, unknown> };
          on: (event: string, listener: () => void) => void;
          off?: (event: string, listener: () => void) => void;
        };
        const groups = internalCasted.motionManager?.groups ?? {};
        const animNames = Object.keys(internalCasted.settings?.motions ?? {});

        callbacksRef.current.onAnimationsLoaded(animNames);

        const layerController = createLive2DLayerController(activeModel.internalModel);
        layerControllerRef.current = layerController;
        layerPickerRef.current = createLive2DLayerPicker(activeModel.internalModel);
        const applyLayers = () => layerController.apply(hiddenLayersRef.current);
        internalCasted.on('beforeModelUpdate', applyLayers);
        removeLayerListener = () => internalCasted.off?.('beforeModelUpdate', applyLayers);
        applyLayers();
        callbacksRef.current.onLayersLoaded(layerController.layers);

        modelRef.current = {
          motion: (group: string) => activeModel.motion(group, undefined, MotionPriority.FORCE),
          motionGroups: animNames,
        };

        const initialAnim = animNames.includes('idle') ? 'idle' : animNames[0];
        if (initialAnim) void modelRef.current.motion(initialAnim);

        const onTick = () => {
          if (!app) return;
          app.ticker.speed = playRef.current ? speedRef.current : 0;
          if (!playRef.current || animNames.length === 0) return;
          const wanted = activeAnimRef.current || groups.idle || initialAnim;
          if (!wanted) return;
          if (internalCasted.motionManager.isFinished?.()) {
            void activeModel.motion(wanted, undefined, MotionPriority.IDLE);
          }
        };
        tickerFunc = onTick;
        app.ticker.add(onTick);
        app.ticker.add(drawHighlightOverlay, undefined, PIXI.UPDATE_PRIORITY.LOW);

        setIsLoading(false);
        renderNow();
      } catch (err) {
        report(err);
      }
    };

    void boot();

    return () => {
      disposed = true;
      modelRef.current = null;
      controlsRef.current = null;
      layerControllerRef.current = null;
      layerPickerRef.current = null;
      renderNowRef.current = null;
      drawHighlightRef.current = null;
      cleanupCameraListeners?.();
      removeLayerListener?.();
      resizeObserver?.disconnect();
      if (tickerFunc && app) app.ticker.remove(tickerFunc);
      if (highlightTickerFunc && app) app.ticker.remove(highlightTickerFunc);
      try {
        model?.destroy();
      } catch {
        // Model may never have finished loading.
      }
      model = null;
      if (app) {
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {
          // Ignore teardown races.
        }
      }
      app = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [modelUrl, reloadNonce, character.charName]);

  useEffect(() => {
    layerControllerRef.current?.apply(hiddenLayers);
    renderNowRef.current?.();
    drawHighlightRef.current?.();
  }, [hiddenLayers, selectedLayerName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'Delete' || event.key === 'Backspace' || event.key.toLowerCase() === 'h') {
        if (selectedLayerName) {
          event.preventDefault();
          onDeleteLayer(selectedLayerName);
        }
      } else if (event.key.toLowerCase() === 'u') {
        event.preventDefault();
        onUndoDelete();
      } else if (event.key === 'Escape') {
        if (selectedLayerName) {
          event.preventDefault();
          onSelectLayer(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLayerName, onDeleteLayer, onUndoDelete, onSelectLayer]);

  useEffect(() => {
    if (!activeAnimation || !modelRef.current) return;
    try {
      void modelRef.current.motion(activeAnimation);
    } catch {
      // Ignore missing motion group.
    }
  }, [activeAnimation]);

  const controlsDisabled = isLoading || Boolean(loadError);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      <div ref={hostRef} className="w-full h-full" />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
        aria-hidden="true"
      />

      {selectedLayerName && (
        <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 z-40 flex items-center justify-between sm:justify-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-sky-400/50 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
            <span className="text-xs text-slate-400 font-medium hidden sm:inline">Selected:</span>
            <span className="text-xs font-bold text-sky-300 truncate max-w-[160px] font-mono" title={selectedLayerName}>
              {selectedLayerName}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onDeleteLayer(selectedLayerName)}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/30"
              title="Delete this layer (Delete / Backspace / H)"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
            <button
              onClick={() => onSelectLayer(null)}
              className="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex items-center justify-center"
              aria-label="Clear selection"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5">
        {hiddenLayers.size > 0 && (
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900/90 border border-slate-800 shadow-xl backdrop-blur-sm text-xs">
            <button
              onClick={onUndoDelete}
              className="min-h-[34px] flex items-center gap-1.5 px-3 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors font-medium"
              title="Undo last deleted layer (U key)"
            >
              <Undo2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Undo ({hiddenLayers.size})</span>
            </button>
            <div className="w-[1px] h-4 bg-slate-800" />
            <button
              onClick={onResetAllLayers}
              className="min-h-[34px] flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Restore all deleted layers"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800 shadow-xl backdrop-blur-sm">
          <button
            onClick={() => controlsRef.current?.zoomBy(1 / 1.1)}
            disabled={controlsDisabled}
            className="w-9 h-9 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 flex items-center justify-center"
            title="Zoom out 10%"
            aria-label="Zoom out 10%"
          >
            <ZoomOut className="w-4 h-4 text-sky-400" />
          </button>
          <span className="min-w-[48px] text-center text-[11px] font-mono text-slate-300">
            {zoomPercent}%
          </span>
          <button
            onClick={() => controlsRef.current?.zoomBy(1.1)}
            disabled={controlsDisabled}
            className="min-h-[36px] px-2 rounded-lg text-slate-200 hover:text-white hover:bg-slate-800 disabled:opacity-30 flex items-center gap-1 text-xs font-semibold"
            title="Zoom in 10%"
            aria-label="Zoom in 10%"
          >
            <ZoomIn className="w-4 h-4 text-sky-400" />
            <span>+10%</span>
          </button>
          <button
            onClick={() => controlsRef.current?.reset()}
            disabled={controlsDisabled}
            className="w-9 h-9 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 flex items-center justify-center"
            title="Reset zoom and recenter"
            aria-label="Reset zoom and recenter"
          >
            <Maximize2 className="w-4 h-4 text-sky-400" />
          </button>
        </div>
      </div>

      <div className="hidden sm:flex absolute bottom-4 left-4 z-30 items-center px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800/80 text-[11px] text-slate-400 backdrop-blur-sm pointer-events-none">
        Tap part to select & delete · Drag to pan · Pinch or scroll to zoom
      </div>

      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-sm text-center px-6 pointer-events-none">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-white">Loading {character.charName}</p>
          <p className="text-xs text-slate-400 mt-1">
            {character.costumeName} · {character.cubismApi === 'cubism2' ? 'Cubism 2' : 'Cubism 4'} Live2D
          </p>
        </div>
      )}

      {loadError && !isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/85 text-center px-6">
          <p className="text-sm font-semibold text-rose-400 mb-2">{loadError}</p>
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Load</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default Live2DViewer;
