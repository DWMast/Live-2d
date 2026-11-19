import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { BD2Character } from '../types/bd2';

/**
 * Live2D (Cubism 4) viewer for Dragon & Girls Symphony (Idle Huntress) models.
 *
 * Uses pixi-live2d-display-lipsyncpatch on top of pixi.js v7.
 * The official Live2D Cubism Core script is vendored in public/vendor
 * and loaded once, lazily, the first time this viewer mounts.
 */

let coreLoadPromise: Promise<void> | null = null;
let coreLoadFailed = false;

function ensureCubismCore(): Promise<void> {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    return Promise.resolve();
  }
  if (coreLoadFailed) return Promise.reject(new Error('Live2D Cubism Core failed to load'));
  if (!coreLoadPromise) {
    coreLoadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/live2dcubismcore.min.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        coreLoadFailed = true;
        coreLoadPromise = null;
        reject(new Error('Failed to load the Live2D Cubism Core'));
      };
      document.head.appendChild(script);
    });
  }
  return coreLoadPromise;
}

let displayModulePromise: Promise<typeof import('pixi-live2d-display-lipsyncpatch/cubism4')> | null = null;

function loadDisplayModule() {
  if (!displayModulePromise) {
    displayModulePromise = import('pixi-live2d-display-lipsyncpatch/cubism4') as Promise<
      typeof import('pixi-live2d-display-lipsyncpatch/cubism4')
    >;
  }
  return displayModulePromise;
}

interface Live2DViewerProps {
  character: BD2Character;
  isPlaying: boolean;
  animationSpeed: number;
  activeAnimation: string;
  onAnimationsLoaded: (animations: string[]) => void;
  onLayersLoaded: (layers: string[]) => void;
  onLoadError?: (message: string) => void;
}

export function Live2DViewer({
  character,
  isPlaying,
  animationSpeed,
  activeAnimation,
  onAnimationsLoaded,
  onLayersLoaded,
  onLoadError,
}: Live2DViewerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<{
    motion: (group: string, index?: number, priority?: number) => Promise<unknown> | unknown;
    motionGroups?: string[];
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const modelUrl = useMemo(() => character.live2dModelUrl || '', [character.live2dModelUrl]);

  const playRef = useRef(isPlaying);
  const speedRef = useRef(animationSpeed);
  const activeAnimRef = useRef(activeAnimation);
  const callbacksRef = useRef({ onAnimationsLoaded, onLayersLoaded, onLoadError });

  playRef.current = isPlaying;
  speedRef.current = animationSpeed;
  activeAnimRef.current = activeAnimation;
  callbacksRef.current = { onAnimationsLoaded, onLayersLoaded, onLoadError };

  useEffect(() => {
    let disposed = false;
    let app: import('pixi.js').Application | null = null;
    let model:
      | (import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel & {
          internalModel: { motionManager: { groups?: Record<string, string> } };
        })
      | null = null;
    let tickerFunc: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    setIsLoading(true);
    setLoadError(null);

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
        const [, displayMod, PIXI] = await Promise.all([
          ensureCubismCore(),
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
            ) => Promise<import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel>;
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
        host.appendChild(view);

        model = (await Live2DModel.from(modelUrl, {
          autoUpdate: true,
          autoHitTest: false,
          autoFocus: false,
          ticker: app.ticker,
        })) as unknown as NonNullable<typeof model>;

        if (disposed) {
          model.destroy();
          model = null;
          return;
        }

        const fitModel = () => {
          if (!app || !model || !host) return;
          const sceneW = Math.max(1, host.clientWidth || app.renderer.width / app.renderer.resolution);
          const sceneH = Math.max(1, host.clientHeight || app.renderer.height / app.renderer.resolution);
          const origW = Math.max(1, model.internalModel.originalWidth || model.width || 1000);
          const origH = Math.max(1, model.internalModel.originalHeight || model.height || 1000);
          const scale = Math.min((sceneW * 0.92) / origW, (sceneH * 0.92) / origH);
          model.scale.set(scale);
          model.x = (sceneW - origW * scale) / 2;
          model.y = (sceneH - origH * scale) / 2;
        };

        fitModel();
        app.stage.addChild(model as unknown as import('pixi.js').Container);

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            app?.resize();
            fitModel();
          });
          resizeObserver.observe(host);
        }

        const internalCasted = model.internalModel as unknown as {
          motionManager: { groups?: Record<string, string> };
        };
        const groups =
          (internalCasted.motionManager?.groups as Record<string, string> | undefined) ?? {};

        const animNames: string[] = [];
        const rawSettings = (
          model.internalModel as unknown as { settings?: { motions?: Record<string, unknown> } }
        ).settings;
        const motions = rawSettings?.motions ?? {};
        for (const name of Object.keys(motions)) animNames.push(name);
        if (animNames.length === 0) animNames.push('idle');

        callbacksRef.current.onAnimationsLoaded(animNames);
        callbacksRef.current.onLayersLoaded([]);

        modelRef.current = {
          motion: (group: string) =>
            (
              model?.internalModel.motionManager as unknown as {
                startMotion: (g: string, i?: number, p?: number) => Promise<unknown>;
              }
            )?.startMotion(group, undefined, MotionPriority.FORCE),
          motionGroups: animNames,
        };

        const initialAnim = animNames.includes('idle') ? 'idle' : animNames[0];
        if (initialAnim) {
          void modelRef.current.motion(initialAnim);
        }

        const onTick = () => {
          if (!model || !app) return;
          app.ticker.speed = playRef.current ? speedRef.current : 0;
          const motionMgr = model.internalModel.motionManager as unknown as {
            isFinished?: boolean;
            startMotion: (g: string, i?: number, p?: number) => Promise<unknown>;
          };
          if (!playRef.current) return;
          const wanted = activeAnimRef.current || groups.idle || initialAnim || 'idle';
          if (motionMgr.isFinished) {
            void motionMgr.startMotion(wanted, undefined, MotionPriority.IDLE);
          }
        };
        tickerFunc = onTick;
        app.ticker.add(onTick);

        setIsLoading(false);
      } catch (err) {
        report(err);
      }
    };

    void boot();

    return () => {
      disposed = true;
      modelRef.current = null;
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (tickerFunc && app) {
        app.ticker.remove(tickerFunc);
      }
      try {
        model?.destroy();
      } catch {
        // model may never have finished loading
      }
      model = null;
      if (app) {
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        } catch {
          // ignore teardown races
        }
      }
      app = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
  }, [modelUrl, reloadNonce]);

  useEffect(() => {
    if (!activeAnimation || !modelRef.current) return;
    try {
      void modelRef.current.motion(activeAnimation);
    } catch {
      // ignore missing motion group
    }
  }, [activeAnimation]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      <div ref={hostRef} className="w-full h-full" />

      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-sm text-center px-6 pointer-events-none">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-white">
            Loading {character.charName}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {character.costumeName} · Cubism 4 Live2D
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
