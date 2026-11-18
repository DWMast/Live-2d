import { useEffect, useMemo, useRef } from 'react';
import type { BD2Character } from '../types/bd2';

/**
 * Live2D (Cubism 4) viewer for Dragon & Girls Symphony (Idle Huntress) models.
 *
 * Uses pixi-live2d-display-lipsyncpatch (already a project dependency) on top of
 * pixi.js v7. The official Live2D Cubism Core script is vendored in
 * public/vendor and loaded once, lazily, the first time this viewer mounts.
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
}interface Live2DViewerProps {
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
    makeCoverVisible?: (v: boolean) => void;
  } | null>(null);

  // The model URL (and only the URL) drives the (re)load effect.
  const modelUrl = useMemo(
    () => character.live2dModelUrl || '',
    [character.live2dModelUrl]
  );

  // Control flags are read through refs so speed/play toggles never reload the model.
  const playRef = useRef(isPlaying);
  const speedRef = useRef(animationSpeed);
  const activeAnimRef = useRef(activeAnimation);
  playRef.current = isPlaying;
  speedRef.current = animationSpeed;
  activeAnimRef.current = activeAnimation;

  useEffect(() => {
    let disposed = false;
    let app: import('pixi.js').Application | null = null;
    let model:
      | (import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel & {
          internalModel: { motionManager: { groups?: Record<string, string> } };
        })
      | null = null;
    let tickerFunc: (() => void) | null = null;

    const report = (err: unknown) => {
      if (!disposed) {
        console.error('Live2D load failed', err);
        onLoadError?.(err instanceof Error ? err.message : String(err));
      }
    };

    const boot = async () => {
      const host = hostRef.current;
      if (!host || !modelUrl) return;
      try {
        await Promise.all([ensureCubismCore(), loadDisplayModule()]);
        const PIXI = await import('pixi.js');
        const { Live2DModel, MotionPriority } = (await loadDisplayModule()) as unknown as {
          Live2DModel: {
            updateTextAnchor?: unknown;
            from: (
              src: string,
              opts?: {
                autoInteract?: boolean;
                autoUpdate?: boolean;
              }
            ) => Promise<import('pixi-live2d-display-lipsyncpatch/cubism4').Live2DModel>;
          };
          MotionPriority: { IDLE: number; FORCE: number; NORMAL: number; NONE: number };
        };

        if (disposed || !host) return;

        app = new PIXI.Application({
          backgroundAlpha: 0,
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        host.appendChild(app.view as HTMLCanvasElement);

        model = (await Live2DModel.from(modelUrl + (modelUrl.includes('?') ? '&' : '?') + 'cache-bust=' + Date.now(), {
          autoInteract: false,
          autoUpdate: true,
        })) as unknown as NonNullable<typeof model>;

        if (disposed) {
          model.destroy();
          model = null;
          return;
        }

        const internal = model.internalModel as {
          motionManager: { groups?: Record<string, string> };
          motionManagerSettings?: { groups: Record<string, number> };
        };

        // Fit the model to the viewport, keeping full-body framing like the spine viewer.
        const sceneW = app.renderer.width / app.renderer.resolution;
        const sceneH = app.renderer.height / app.renderer.resolution;
        const scale = Math.min(sceneW / model.internalModel.originalWidth, sceneH / model.internalModel.originalHeight, 1);
        model.scale.set(scale * 0.95);
        model.x = sceneW / 2 - (model.internalModel.originalWidth * model.scale.x) / 2;
        model.y = sceneH - model.internalModel.originalHeight * model.scale.y;

        app.stage.addChild(model as unknown as import('pixi.js').Container);

        const internalCasted = model.internalModel as unknown as {
          motionManager: { groups?: Record<string, string> };
        };
        const groups =
          (internalCasted.motionManager?.groups as Record<string, string> | undefined) ?? {};

        // Expose all motion groups that exist in the model3.json to the app so the
        // animation dropdown feels identical to the spine path.
        const animNames: string[] = [];
        const rawSettings = (model.internalModel as unknown as { settings?: { motions?: Record<string, {}> } }).settings;
        const motions = (rawSettings?.motions ?? {}) as Record<string, unknown>;
        for (const name of Object.keys(motions)) animNames.push(name);
        if (animNames.length === 0) animNames.push('idle');
        onAnimationsLoaded(animNames);
        onLayersLoaded([]);
        modelRef.current = {
          motion: (group: string) =>
            model?.internalModel.motionManager.startMotion(group, undefined, MotionPriority.FORCE),
          motionGroups: animNames,
        };

        // keep uniforms in sync on tick
        const onTick = () => {
          if (!model) return;
          const wantPlay = playRef.current;
          const motionMgr = model.internalModel.motionManager as unknown as {
            idleMotionPriority?: number;
            groups?: Record<string, string>;
            isFinished?: boolean;
            startMotion: (g: string, i?: number, p?: number) => Promise<unknown>;
          };
          if (!wantPlay) {
            motionMgr.isFinished = true;
            return;
          }
          const wanted = groups.idle || 'idle';
          if (motionMgr.isFinished) {
            void motionMgr.startMotion(wanted, undefined, 2);
          }
        };
        tickerFunc = onTick;
        app.ticker.add(onTick);
      } catch (err) {
        report(err);
      }
    };

    void boot();

    return () => {
      disposed = true;
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
          // ignore teardown races with the app having not finished setup
        }
      }
      app = null;
      if (hostRef.current) hostRef.current.innerHTML = '';
    };
    // reload only when the actual model changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  return <div ref={hostRef} className="w-full h-full" />;
}

export default Live2DViewer;
