import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  SpinePlayer,
  GLTexture,
  OrthoCamera,
  Vector2,
  Vector3,
  Skeleton,
  Downloader,
} from '@esotericsoftware/spine-player';
import '@esotericsoftware/spine-player/dist/spine-player.css';
import { BD2Character, AnimationCategory } from '../types/bd2';
import {
  ALL_CHARACTERS,
  getCachedGameRoster,
  getSpineModelUrls,
  prefetchCharacterModel,
} from '../utils/bd2Assets';
import {
  loadSpineAssetsFast,
  createCachedDownloader,
} from '../utils/spineAssetCache';
import {
  Trash2,
  RotateCcw,
  Undo2,
  Loader2,
  Volume2,
  Maximize2,
  RefreshCw,
  ZoomIn,
} from 'lucide-react';

import { CachedSpineAssets } from '../utils/spineAssetCache';

interface SpineRuntimeMod {
  SpinePlayer: typeof SpinePlayer;
  GLTexture: typeof GLTexture;
  OrthoCamera: typeof OrthoCamera;
  Vector2: typeof Vector2;
  Vector3: typeof Vector3;
  Downloader: typeof Downloader;
  Physics?: { none: number; reset: number; update: number; pose: number };
}

const SPINE_41_RUNTIME: SpineRuntimeMod = {
  SpinePlayer,
  GLTexture,
  OrthoCamera,
  Vector2,
  Vector3,
  Downloader,
};

function detectSpineVersion(assets: CachedSpineAssets): '3.8' | '4.0' | '4.1' | '4.2' {
  if (assets.isJson && assets.jsonText) {
    const sample = assets.jsonText.slice(0, 1024);
    const match = sample.match(/"spine"\s*:\s*"(\d+)\.(\d+)/);
    if (match) {
      const majorMinor = `${match[1]}.${match[2]}`;
      if (majorMinor === '3.7' || majorMinor === '3.8') return '3.8';
      if (majorMinor === '4.0') return '4.0';
      if (majorMinor === '4.2') return '4.2';
      return '4.1';
    }
    return '4.1';
  }
  if (assets.binary) {
    const headerSlice = assets.binary.subarray(0, Math.min(assets.binary.length, 64));
    const headerText = new TextDecoder('ascii', { fatal: false }).decode(headerSlice);
    if (/3\.[78]\.\d+/.test(headerText) || /\b3\.8\b/.test(headerText)) return '3.8';
    if (/4\.0\.\d+/.test(headerText)) return '4.0';
    if (/4\.2\.\d+/.test(headerText)) return '4.2';
  }
  return '4.1';
}

function updateWorldTransformSafe(skeleton: Skeleton, runtime: SpineRuntimeMod) {
  const fn = skeleton.updateWorldTransform as unknown as (physics?: number) => void;
  if (runtime.Physics && typeof runtime.Physics.update === 'number') {
    fn.call(skeleton, runtime.Physics.update);
  } else {
    fn.call(skeleton);
  }
}

function disposeSpinePlayerSafely(player: SpinePlayer | null) {
  if (!player) return;
  const p = player as unknown as {
    canvas?: HTMLCanvasElement | null;
    context?: { gl?: WebGLRenderingContext | WebGL2RenderingContext | null };
    dispose?: () => void;
  };
  const canvas = p.canvas;
  const gl =
    p.context?.gl ||
    (canvas
      ? ((canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')) as
          | WebGLRenderingContext
          | WebGL2RenderingContext
          | null)
      : null);

  try {
    p.dispose?.();
  } catch {
    // ignore dispose errors
  }

  if (gl && !gl.isContextLost()) {
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // ignore context release errors
    }
  }
}

function safeDrawFrame(player: SpinePlayer | null) {
  if (!player) return;
  const p = player as unknown as {
    disposed?: boolean;
    error?: boolean;
    skeleton?: unknown;
    currentViewport?: unknown;
    drawFrame?: (next: boolean) => void;
  };
  if (p.disposed || p.error || !p.skeleton || !p.currentViewport) return;
  try {
    p.drawFrame?.(false);
  } catch {
    // ignore transient drawFrame errors during teardown
  }
}

function ensureGLTexturePremultiplyPatch(
  GLTextureCtor: typeof GLTexture,
  shouldPremultiplyOnUpload: boolean
) {
  const proto = GLTextureCtor.prototype as unknown as {
    update: (useMipMaps: boolean) => void;
    context?: { gl?: WebGLRenderingContext };
    __bd2UsePremultiply?: boolean;
    __bd2PremultipliedPatchApplied?: boolean;
  };
  proto.__bd2UsePremultiply = shouldPremultiplyOnUpload;
  if (proto.__bd2PremultipliedPatchApplied) return;
  const originalUpdate = proto.update;
  proto.update = function (useMipMaps: boolean) {
    const gl = this.context?.gl;
    if (gl && !gl.isContextLost()) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, Boolean(proto.__bd2UsePremultiply));
    }
    originalUpdate.call(this, useMipMaps);
  };
  proto.__bd2PremultipliedPatchApplied = true;
}

function ensureSpinePlayerSafeShowError(SpinePlayerCtor: typeof SpinePlayer) {
  const proto = SpinePlayerCtor.prototype as unknown as {
    showError: (message: string, error?: unknown) => void;
    loadSkeleton?: () => void;
    drawFrame?: (requestNextFrame?: boolean) => void;
    error: boolean;
    disposed?: boolean;
    context?: { gl?: WebGLRenderingContext };
    config?: { error?: (player: SpinePlayer, msg: string) => void };
    __bd2SafeShowErrorApplied?: boolean;
  };
  if (proto.__bd2SafeShowErrorApplied) return;
  proto.showError = function (message: string) {
    if (this.error) return;
    this.error = true;
    if (this.config?.error) {
      this.config.error(this as unknown as SpinePlayer, message);
    }
  };
  if (typeof proto.loadSkeleton === 'function') {
    const origLoadSkeleton = proto.loadSkeleton;
    proto.loadSkeleton = function () {
      if (this.error || this.disposed || !this.context?.gl) return;
      try {
        origLoadSkeleton.call(this);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load skeleton.';
        this.showError(msg, err);
      }
    };
  }
  if (typeof proto.drawFrame === 'function') {
    const origDrawFrame = proto.drawFrame;
    proto.drawFrame = function (requestNextFrame?: boolean) {
      if (this.error || this.disposed || !this.context?.gl) return;
      if (this.context.gl.isContextLost()) return;
      origDrawFrame.call(this, requestNextFrame);
    };
  }
  proto.__bd2SafeShowErrorApplied = true;
}

interface SpineViewerProps {
  character: BD2Character;
  category: AnimationCategory;
  animationSpeed: number;
  isPlaying: boolean;
  activeAnimation: string;
  onAnimationsLoaded: (animations: string[]) => void;
  onLayersLoaded: (layers: string[]) => void;
  hiddenLayers: Set<string>;
  onDeleteLayer: (layerName: string) => void;
  onUndoDelete: () => void;
  onResetAllLayers: () => void;
  selectedLayerName: string | null;
  onSelectLayer: (layerName: string | null) => void;
  hasHiddenLayers: boolean;
  onPlayVoice: () => void;
  isVoicePlaying: boolean;
}

type VertexAttachmentLike = {
  worldVerticesLength?: number;
  computeWorldVertices?: (...args: unknown[]) => void;
};

type SlotWithDarkColor = {
  data: { name: string; color?: { a: number }; darkColor?: { a: number } };
  bone?: unknown;
  color?: { a: number };
  darkColor?: { a: number };
  getAttachment: () => unknown;
};

let scratchVertices = new Float32Array(2048);
function getScratchBuffer(needed: number): Float32Array {
  if (scratchVertices.length < needed) {
    scratchVertices = new Float32Array(Math.max(needed, scratchVertices.length * 2));
  }
  return scratchVertices;
}

function computeAttachmentVertices(slot: unknown, attachment: VertexAttachmentLike | null): number {
  if (!attachment || typeof attachment.computeWorldVertices !== 'function') return 0;
  if (typeof attachment.worldVerticesLength === 'number' && attachment.worldVerticesLength > 0) {
    const count = attachment.worldVerticesLength;
    const buf = getScratchBuffer(count);
    attachment.computeWorldVertices(slot, 0, count, buf, 0, 2);
    return count;
  }
  // RegionAttachment (8 world floats: 4 corners x,y)
  const buf = getScratchBuffer(8);
  attachment.computeWorldVertices(slot, buf, 0, 2);
  return 8;
}

function isPointInPolygon(
  px: number,
  py: number,
  vertices: Float32Array,
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

function isBackgroundSlotName(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.startsWith('bg') ||
    n.startsWith('bk') ||
    n.includes(' bg') ||
    n.includes('_bg') ||
    n.includes('background')
  );
}

function computeModelBounds(
  skeleton: Skeleton,
  Vector2Ctor: typeof Vector2
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const slot of skeleton.drawOrder) {
    if (isBackgroundSlotName(slot.data.name)) continue;
    const attachment = slot.getAttachment() as VertexAttachmentLike | null;
    if (!attachment) continue;
    let vertexCount = 0;
    try {
      vertexCount = computeAttachmentVertices(slot, attachment);
    } catch {
      continue;
    }
    if (vertexCount <= 0) continue;
    const buf = scratchVertices;
    for (let i = 0; i < vertexCount; i += 2) {
      const vx = buf[i];
      const vy = buf[i + 1];
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
      found = true;
    }
  }

  if (found && maxX - minX > 10 && maxY - minY > 10) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  const offset = new Vector2Ctor();
  const size = new Vector2Ctor();
  skeleton.getBounds(offset, size);
  return {
    x: Number.isFinite(offset.x) ? offset.x : -400,
    y: Number.isFinite(offset.y) ? offset.y : 0,
    width: size.x > 10 && Number.isFinite(size.x) ? size.x : 800,
    height: size.y > 10 && Number.isFinite(size.y) ? size.y : 800,
  };
}

function applySlotVisibility(skeleton: Skeleton, hidden: Set<string>) {
  const slots = skeleton.slots as unknown as SlotWithDarkColor[];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (hidden.has(slot.data.name)) {
      if (slot.color) slot.color.a = 0;
      if (slot.darkColor) slot.darkColor.a = 0;
    } else if (slot.color && slot.color.a === 0 && (slot.data.color?.a ?? 1) > 0) {
      slot.color.a = slot.data.color?.a ?? 1;
      if (slot.darkColor && slot.data.darkColor) {
        slot.darkColor.a = slot.data.darkColor.a;
      }
    }
  }
}

export const SpineViewer: React.FC<SpineViewerProps> = ({
  character,
  category,
  animationSpeed,
  isPlaying,
  activeAnimation,
  onAnimationsLoaded,
  onLayersLoaded,
  hiddenLayers,
  onDeleteLayer,
  onUndoDelete,
  onResetAllLayers,
  selectedLayerName,
  onSelectLayer,
  hasHiddenLayers,
  onPlayVoice,
  isVoicePlaying,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<SpinePlayer | null>(null);
  const manualCameraRef = useRef<OrthoCamera | null>(null);
  const defaultCameraPoseRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

  // Refs synced to the 60fps SpinePlayer update callback without re-creating the player
  const hiddenLayersRef = useRef<Set<string>>(hiddenLayers);
  const selectedLayerRef = useRef<string | null>(selectedLayerName);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const animationSpeedRef = useRef<number>(animationSpeed);
  const callbacksRef = useRef({
    onAnimationsLoaded,
    onLayersLoaded,
    onSelectLayer,
  });

  hiddenLayersRef.current = hiddenLayers;
  selectedLayerRef.current = selectedLayerName;
  isPlayingRef.current = isPlaying;
  animationSpeedRef.current = animationSpeed;
  callbacksRef.current = { onAnimationsLoaded, onLayersLoaded, onSelectLayer };

  const [isLoading, setIsLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<'assets' | 'webgl'>('assets');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 800, height: 600 });
  const overlayHasDrawingRef = useRef(false);

  // Track pointer travel so drag-to-pan does not accidentally select a layer
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        containerSizeRef.current = { width: rect.width, height: rect.height };
      }
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const drawHighlightOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    const player = playerRef.current;
    const activeLayer = selectedLayerRef.current;

    if (!canvas) return;
    if (
      !activeLayer ||
      !player?.skeleton ||
      hiddenLayersRef.current.has(activeLayer)
    ) {
      if (overlayHasDrawingRef.current) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        overlayHasDrawingRef.current = false;
      }
      return;
    }

    const { width: cssW, height: cssH } = containerSizeRef.current;
    const targetW = Math.max(1, Math.round(cssW));
    const targetH = Math.max(1, Math.round(cssH));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, targetW, targetH);

    const slot = player.skeleton.slots.find((s) => s.data.name === activeLayer);
    if (!slot) return;

    const attachment = slot.getAttachment() as VertexAttachmentLike | null;
    const renderCam = player.sceneRenderer?.camera;

    if (
      !attachment ||
      !renderCam ||
      renderCam.viewportWidth <= 0 ||
      renderCam.viewportHeight <= 0
    ) {
      return;
    }

    let vertexCount = 0;
    try {
      vertexCount = computeAttachmentVertices(slot, attachment);
    } catch {
      return;
    }
    if (vertexCount <= 0) return;
    const worldVertices = scratchVertices;

    const { position, zoom, viewportWidth, viewportHeight } = renderCam;
    const halfW = (viewportWidth / 2) * zoom;
    const halfH = (viewportHeight / 2) * zoom;
    if (!Number.isFinite(halfW) || !Number.isFinite(halfH) || halfW === 0 || halfH === 0) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.setLineDash([6, 4]);

    ctx.beginPath();
    for (let i = 0; i < vertexCount; i += 2) {
      const wx = worldVertices[i];
      const wy = worldVertices[i + 1];
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const nx = (wx - position.x) / halfW;
      const ny = (wy - position.y) / halfH;
      const sx = ((nx + 1) / 2) * cssW;
      const sy = ((1 - ny) / 2) * cssH;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    overlayHasDrawingRef.current = true;
  }, []);

  const handleResetCamera = useCallback(() => {
    const manualCam = manualCameraRef.current;
    const pose = defaultCameraPoseRef.current;
    const player = playerRef.current;
    if (!manualCam || !pose) return;
    manualCam.position.x = pose.x;
    manualCam.position.y = pose.y;
    manualCam.zoom = pose.zoom;
    manualCam.update();
    if (player && !isPlayingRef.current) {
      safeDrawFrame(player);
    }
  }, []);

  const handleZoomIn = useCallback(() => {
    const manualCam = manualCameraRef.current;
    const player = playerRef.current;
    if (!manualCam) return;
    const nextZoom = manualCam.zoom / 1.1;
    if (nextZoom > 0 && Number.isFinite(nextZoom)) {
      manualCam.zoom = nextZoom;
      manualCam.update();
      if (player && !isPlayingRef.current) {
        safeDrawFrame(player);
      }
    }
  }, []);

  const runtimeRef = useRef<SpineRuntimeMod>(SPINE_41_RUNTIME);

  // Load Spine Model using parallel prefetch + zero-copy downloader + non-blocking viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setIsLoading(true);
    setLoadingStage('assets');
    setLoadError(null);
    callbacksRef.current.onSelectLayer(null);

    if (playerRef.current) {
      disposeSpinePlayerSafely(playerRef.current);
      playerRef.current = null;
    }
    manualCameraRef.current = null;
    defaultCameraPoseRef.current = null;
    container.innerHTML = '';

    const { skeletonUrl, atlasUrl, isJson } = getSpineModelUrls(character, category);
    const abortController = new AbortController();
    let isSubscribed = true;
    let cleanupCameraListeners: (() => void) | null = null;

    const initPlayer = async () => {
      let runtime: SpineRuntimeMod = SPINE_41_RUNTIME;
      let downloader: Downloader;
      let isAtlasPma = false;
      try {
        const cachedAssets = await loadSpineAssetsFast(
          skeletonUrl,
          atlasUrl,
          abortController.signal
        );
        if (!isSubscribed) return;

        isAtlasPma = /\bpma\s*:\s*true\b/i.test(cachedAssets.atlasText);
        const version = detectSpineVersion(cachedAssets);
        if (version === '4.0') {
          const mod = await import('../vendor/spine-player4.0.js');
          if (!isSubscribed) return;
          runtime = mod.default;
        } else if (version === '4.2') {
          const mod = await import('../vendor/spine-player4.2.js');
          if (!isSubscribed) return;
          runtime = mod.default;
        } else if (version === '3.8') {
          const mod = await import('../vendor/spine-player3.8.js');
          if (!isSubscribed) return;
          runtime = mod.default;
        }
        runtimeRef.current = runtime;
        downloader = createCachedDownloader(runtime.Downloader, cachedAssets);
      } catch (err) {
        if (!isSubscribed || abortController.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setIsLoading(false);
        setLoadError(
          err instanceof Error
            ? `Unable to load model assets (${err.message}).`
            : 'Unable to load character model assets.'
        );
        return;
      }

      if (!isSubscribed) return;
      setLoadingStage('webgl');

      try {
        ensureGLTexturePremultiplyPatch(runtime.GLTexture, !isAtlasPma);
        ensureSpinePlayerSafeShowError(runtime.SpinePlayer);

        const skeletonConfig: Record<string, unknown> = isJson
          ? { jsonUrl: skeletonUrl }
          : { binaryUrl: skeletonUrl, skelUrl: skeletonUrl };

        const player = new runtime.SpinePlayer(container, {
          ...skeletonConfig,
          atlasUrl,
          downloader,
          showControls: false,
          showLoading: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: true,
          alpha: true,
          mipmaps: false,
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
            const cam = p.sceneRenderer?.camera;
            const manualCam = manualCameraRef.current;
            if (cam && manualCam) {
              manualCam.viewportWidth = cam.viewportWidth;
              manualCam.viewportHeight = cam.viewportHeight;
              cam.position.x = manualCam.position.x;
              cam.position.y = manualCam.position.y;
              cam.zoom = manualCam.zoom;
              cam.update();
            }
            if (p.skeleton) {
              applySlotVisibility(p.skeleton, hiddenLayersRef.current);
            }
            drawHighlightOverlay();
          },
          success: (p) => {
            if (!isSubscribed) {
              try {
                disposeSpinePlayerSafely(p);
              } catch {
                // ignore
              }
              return;
            }
            playerRef.current = p;

            const skeleton = p.skeleton;
            if (!skeleton) {
              setIsLoading(false);
              return;
            }

            // 1. Setup pose + bind default skin
            skeleton.setToSetupPose();
            updateWorldTransformSafe(skeleton, runtime);

            const skinNames = skeleton.data.skins.map((s) => s.name);
            const defaultSkin = skinNames.find((s) => s !== 'default') || skinNames[0];
            if (defaultSkin) {
              skeleton.setSkinByName(defaultSkin);
              skeleton.setSlotsToSetupPose();
              updateWorldTransformSafe(skeleton, runtime);
            }

            // 2. Pick and apply initial animation immediately at frame 0
            const anims = skeleton.data.animations.map((a) => a.name) || [];
            callbacksRef.current.onAnimationsLoaded(anims);
            if (anims.length > 0 && p.animationState) {
              const defaultAnim = anims.includes('idle')
                ? 'idle'
                : anims.includes('stand')
                ? 'stand'
                : anims.includes('cut_1')
                ? 'cut_1'
                : anims.find((a) => a.toLowerCase().includes('idle')) || anims[0];
              p.animationState.setAnimation(0, defaultAnim, true);
              p.animationState.apply(skeleton);
              updateWorldTransformSafe(skeleton, runtime);
            }

            // 3. Extract slot names for Layer Stack
            const slotNames = (skeleton.slots || [])
              .map((s) => s.data.name)
              .filter(Boolean);
            callbacksRef.current.onLayersLoaded(slotNames);

            // 4. Auto-fit OrthoCamera cleanly & enable pan/zoom via CameraController
            const bounds = computeModelBounds(skeleton, runtime.Vector2);
            const canvas = p.canvas;
            const renderCam = p.sceneRenderer?.camera;

            if (canvas && renderCam) {
              canvas.style.display = 'block';
              canvas.style.width = '100%';
              canvas.style.height = '100%';

              const canvasWidth =
                canvas.clientWidth || containerSizeRef.current.width || canvas.width || 800;
              const canvasHeight =
                canvas.clientHeight || containerSizeRef.current.height || canvas.height || 600;
              const manualCam = new runtime.OrthoCamera(canvasWidth, canvasHeight);
              manualCam.position.x = bounds.x + bounds.width / 2;
              manualCam.position.y = bounds.y + bounds.height / 2;

              const canvasAspect = canvasHeight / Math.max(canvasWidth, 1);
              const paddedWidth = Math.max(bounds.width, 120) * 1.15;
              const paddedHeight = Math.max(bounds.height + 60, 120) * 1.15;
              const viewportAspect = paddedHeight / Math.max(paddedWidth, 1);

              const computedZoom =
                canvasAspect > viewportAspect
                  ? paddedWidth / Math.max(canvasWidth, 1)
                  : paddedHeight / Math.max(canvasHeight, 1);
              manualCam.zoom = Number.isFinite(computedZoom) && computedZoom > 0 ? computedZoom : 1;
              manualCam.update();

              manualCameraRef.current = manualCam;
              defaultCameraPoseRef.current = {
                x: manualCam.position.x,
                y: manualCam.position.y,
                zoom: manualCam.zoom,
              };

              // Sync immediately into sceneRenderer.camera so frame 1 is centered
              renderCam.position.x = manualCam.position.x;
              renderCam.position.y = manualCam.position.y;
              renderCam.zoom = manualCam.zoom;
              renderCam.update();

              // Attach accurate pan, wheel zoom, and 2-finger pinch-to-zoom (no zoom limit)
              const redrawIfPaused = () => {
                if (!isPlayingRef.current) {
                  safeDrawFrame(p);
                }
              };

              const onContextLost = (ev: Event) => {
                ev.preventDefault();
                if (!isSubscribed) return;
                setIsLoading(false);
                setLoadError('WebGL rendering context was interrupted. Tap Retry Load to restore.');
              };

              let isMousePanning = false;
              let mouseStartX = 0;
              let mouseStartY = 0;
              let camStartX = 0;
              let camStartY = 0;

              const onMouseDown = (ev: MouseEvent) => {
                if (ev.button !== 0) return;
                isMousePanning = true;
                mouseStartX = ev.clientX;
                mouseStartY = ev.clientY;
                camStartX = manualCam.position.x;
                camStartY = manualCam.position.y;
              };

              const onMouseMove = (ev: MouseEvent) => {
                if (!isMousePanning) return;
                const dx = ev.clientX - mouseStartX;
                const dy = ev.clientY - mouseStartY;
                const scaleX = manualCam.viewportWidth / Math.max(canvas.clientWidth, 1);
                const scaleY = manualCam.viewportHeight / Math.max(canvas.clientHeight, 1);
                manualCam.position.x = camStartX - dx * scaleX * manualCam.zoom;
                manualCam.position.y = camStartY + dy * scaleY * manualCam.zoom;
                manualCam.update();
                redrawIfPaused();
              };

              const onMouseUp = () => {
                isMousePanning = false;
              };

              const onWheel = (ev: WheelEvent) => {
                ev.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const localX = ev.clientX - rect.left;
                const localY = ev.clientY - rect.top;
                const factor = ev.deltaY < 0 ? 1 / 1.1 : 1.1;
                const nextZoom = manualCam.zoom * factor;
                if (!(nextZoom > 0 && Number.isFinite(nextZoom))) return;

                const before = manualCam.screenToWorld(
                  new runtime.Vector3(localX, localY, 0),
                  canvas.clientWidth || rect.width,
                  canvas.clientHeight || rect.height
                );
                manualCam.zoom = nextZoom;
                manualCam.update();
                const after = manualCam.screenToWorld(
                  new runtime.Vector3(localX, localY, 0),
                  canvas.clientWidth || rect.width,
                  canvas.clientHeight || rect.height
                );
                manualCam.position.x += before.x - after.x;
                manualCam.position.y += before.y - after.y;
                manualCam.update();
                redrawIfPaused();
              };

              let touchPanStart: { x: number; y: number; camX: number; camY: number } | null = null;
              let prevPinchDistance: number | null = null;
              let wasPinching = false;

              const onTouchStart = (ev: TouchEvent) => {
                if (ev.touches.length === 1 && !wasPinching) {
                  const t = ev.touches[0];
                  touchPanStart = {
                    x: t.clientX,
                    y: t.clientY,
                    camX: manualCam.position.x,
                    camY: manualCam.position.y,
                  };
                  prevPinchDistance = null;
                } else if (ev.touches.length >= 2) {
                  pointerStartRef.current = null;
                  touchPanStart = null;
                  wasPinching = true;
                  const t0 = ev.touches[0];
                  const t1 = ev.touches[1];
                  const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                  prevPinchDistance = dist > 0 ? dist : null;
                }
              };

              const onTouchMove = (ev: TouchEvent) => {
                if (ev.cancelable) ev.preventDefault();
                if (ev.touches.length >= 2) {
                  pointerStartRef.current = null;
                  const t0 = ev.touches[0];
                  const t1 = ev.touches[1];
                  const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                  if (prevPinchDistance === null) {
                    if (dist > 0) prevPinchDistance = dist;
                    wasPinching = true;
                    return;
                  }
                  if (dist > 1 && prevPinchDistance > 1) {
                    const nextZoom = manualCam.zoom * (prevPinchDistance / dist);
                    if (nextZoom > 0 && Number.isFinite(nextZoom)) {
                      const rect = canvas.getBoundingClientRect();
                      const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
                      const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
                      const before = manualCam.screenToWorld(
                        new runtime.Vector3(midX, midY, 0),
                        canvas.clientWidth || rect.width,
                        canvas.clientHeight || rect.height
                      );
                      manualCam.zoom = nextZoom;
                      manualCam.update();
                      const after = manualCam.screenToWorld(
                        new runtime.Vector3(midX, midY, 0),
                        canvas.clientWidth || rect.width,
                        canvas.clientHeight || rect.height
                      );
                      manualCam.position.x += before.x - after.x;
                      manualCam.position.y += before.y - after.y;
                      manualCam.update();
                      redrawIfPaused();
                    }
                    prevPinchDistance = dist;
                  }
                } else if (ev.touches.length === 1 && touchPanStart && !wasPinching) {
                  const t = ev.touches[0];
                  const dx = t.clientX - touchPanStart.x;
                  const dy = t.clientY - touchPanStart.y;
                  const scaleX = manualCam.viewportWidth / Math.max(canvas.clientWidth, 1);
                  const scaleY = manualCam.viewportHeight / Math.max(canvas.clientHeight, 1);
                  manualCam.position.x = touchPanStart.camX - dx * scaleX * manualCam.zoom;
                  manualCam.position.y = touchPanStart.camY + dy * scaleY * manualCam.zoom;
                  manualCam.update();
                  redrawIfPaused();
                }
              };

              const onTouchEnd = (ev: TouchEvent) => {
                if (ev.touches.length === 0) {
                  touchPanStart = null;
                  prevPinchDistance = null;
                  wasPinching = false;
                } else if (ev.touches.length === 1) {
                  prevPinchDistance = null;
                }
              };

              canvas.addEventListener('webglcontextlost', onContextLost);
              canvas.addEventListener('mousedown', onMouseDown);
              window.addEventListener('mousemove', onMouseMove);
              window.addEventListener('mouseup', onMouseUp);
              canvas.addEventListener('wheel', onWheel, { passive: false });
              canvas.addEventListener('touchstart', onTouchStart, { passive: false });
              canvas.addEventListener('touchmove', onTouchMove, { passive: false });
              canvas.addEventListener('touchend', onTouchEnd);
              canvas.addEventListener('touchcancel', onTouchEnd);

              cleanupCameraListeners = () => {
                canvas.removeEventListener('webglcontextlost', onContextLost);
                canvas.removeEventListener('mousedown', onMouseDown);
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                canvas.removeEventListener('wheel', onWheel);
                canvas.removeEventListener('touchstart', onTouchStart);
                canvas.removeEventListener('touchmove', onTouchMove);
                canvas.removeEventListener('touchend', onTouchEnd);
                canvas.removeEventListener('touchcancel', onTouchEnd);
              };
            }

            // 5. Start or pause playback at selected speed
            p.speed = isPlayingRef.current ? animationSpeedRef.current : 0;
            if (isPlayingRef.current) p.play();
            else p.pause();

            setIsLoading(false);

            // 6. Idle background prefetch of popular next models + current character's cutscene
            const scheduleIdle =
              typeof window !== 'undefined' && 'requestIdleCallback' in window
                ? (cb: () => void) =>
                    (window as unknown as { requestIdleCallback: (fn: () => void) => number }).requestIdleCallback(cb)
                : (cb: () => void) => setTimeout(cb, 250);

            scheduleIdle(() => {
              if (!isSubscribed) return;
              if (character.game && character.game !== 'bd2') {
                const roster = getCachedGameRoster(character.game);
                const idx = roster.findIndex((c) => c.id === character.id);
                if (idx >= 0 && idx + 1 < roster.length) {
                  prefetchCharacterModel(roster[idx + 1], 'character');
                }
                return;
              }
              if (category === 'character' && character.hasCutscene) {
                prefetchCharacterModel(character, 'cutscene');
              }
              const nextChar = ALL_CHARACTERS.find((c) => c.id === '000301');
              const thirdChar = ALL_CHARACTERS.find((c) => c.id === '000101');
              if (nextChar && nextChar.id !== character.id) {
                prefetchCharacterModel(nextChar, 'character');
              }
              if (thirdChar && thirdChar.id !== character.id) {
                prefetchCharacterModel(thirdChar, 'character');
              }
            });
          },
          error: (_p, msg) => {
            if (!isSubscribed) return;
            setIsLoading(false);
            setLoadError(
              typeof msg === 'string' ? msg : 'Failed to load character model.'
            );
          },
        });
        playerRef.current = player;
      } catch (err: unknown) {
        if (!isSubscribed) return;
        setIsLoading(false);
        setLoadError(
          err instanceof Error ? err.message : 'Error initializing WebGL Spine Player.'
        );
      }
    };

    void initPlayer();

    return () => {
      isSubscribed = false;
      abortController.abort();
      if (cleanupCameraListeners) {
        cleanupCameraListeners();
        cleanupCameraListeners = null;
      }
      if (playerRef.current) {
        disposeSpinePlayerSafely(playerRef.current);
        playerRef.current = null;
      }
      manualCameraRef.current = null;
    };
  }, [character.id, category, reloadNonce]);

  // Handle active animation change
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !player.skeleton || !player.animationState || !activeAnimation) return;
    try {
      const current = player.animationState.getCurrent(0);
      if (current?.animation?.name === activeAnimation) return;
      player.animationState.setAnimation(0, activeAnimation, true);
      if (!isPlayingRef.current) {
        player.animationState.apply(player.skeleton);
        updateWorldTransformSafe(player.skeleton, runtimeRef.current);
        safeDrawFrame(player);
      }
    } catch {
      // ignore animation transition issues
    }
  }, [activeAnimation]);

  // Handle playback speed & play/pause
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.speed = isPlaying ? animationSpeed : 0;
    if (isPlaying) player.play();
    else player.pause();
  }, [animationSpeed, isPlaying]);

  // Immediately re-apply visibility and redraw overlay when hidden/selected layers change (even if paused)
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.skeleton) {
      drawHighlightOverlay();
      return;
    }
    applySlotVisibility(player.skeleton, hiddenLayers);
    if (!isPlaying) {
      safeDrawFrame(player);
    }
    drawHighlightOverlay();
  }, [hiddenLayers, selectedLayerName, isPlaying, drawHighlightOverlay]);

  // Hit test coordinate conversion
  const getWorldPoint = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    const player = playerRef.current;
    if (!container || !player) return null;

    const bounds = container.getBoundingClientRect();
    const renderCam = player.sceneRenderer?.camera;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !renderCam) return null;

    const screenX = clientX - bounds.left;
    const screenY = clientY - bounds.top;
    const nx = (screenX / bounds.width) * 2 - 1;
    const ny = 1 - 2 * (screenY / bounds.height);
    const { position, zoom, viewportWidth, viewportHeight } = renderCam;

    return {
      x: nx * (viewportWidth / 2) * zoom + position.x,
      y: ny * (viewportHeight / 2) * zoom + position.y,
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
    };
  };

  // Select/deselect layer only on a genuine tap/click (not after panning the camera)
  const handlePointerUp = (e: React.PointerEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerId !== e.pointerId) return;

    const travel = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (travel > 8) return; // User panned the canvas

    const player = playerRef.current;
    if (!player || !player.skeleton) return;

    const worldPoint = getWorldPoint(e.clientX, e.clientY);
    if (!worldPoint) return;

    const slots = player.skeleton.drawOrder;
    if (!slots) return;

    for (let i = slots.length - 1; i >= 0; i--) {
      const slot = slots[i];
      if (hiddenLayers.has(slot.data.name)) continue;

      const attachment = slot.getAttachment() as VertexAttachmentLike | null;
      if (attachment) {
        let vertexCount = 0;
        try {
          vertexCount = computeAttachmentVertices(slot, attachment);
        } catch {
          continue;
        }
        if (vertexCount > 0 && isPointInPolygon(worldPoint.x, worldPoint.y, scratchVertices, vertexCount)) {
          onSelectLayer(selectedLayerName === slot.data.name ? null : slot.data.name);
          return;
        }
      }
    }

    onSelectLayer(null);
  };

  // Keyboard Shortcuts: Delete/Backspace/H to delete, U to undo, Esc to deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'h') {
        if (selectedLayerName) {
          e.preventDefault();
          onDeleteLayer(selectedLayerName);
        }
      } else if (e.key.toLowerCase() === 'u') {
        e.preventDefault();
        onUndoDelete();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onSelectLayer(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLayerName, onDeleteLayer, onUndoDelete, onSelectLayer]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      {/* WebGL Spine Container */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className="w-full h-full cursor-crosshair relative z-10 touch-none"
      />

      {/* Layer Highlight Canvas Overlay */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 pointer-events-none z-20"
      />

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-slate-950/75 backdrop-blur-sm gap-3 text-slate-300">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-bold text-white tracking-wide">
              Loading {character.charName}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {character.costumeName} ·{' '}
              {loadingStage === 'assets' ? 'Fetching textures...' : 'Initializing WebGL...'}
            </span>
          </div>
        </div>
      )}

      {/* Error Fallback */}
      {loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center bg-slate-950/90 gap-3 text-slate-300">
          <p className="text-sm text-rose-400 font-semibold">{loadError}</p>
          <p className="text-xs text-slate-500 max-w-md">
            This scene might not be available or timed out. Try retrying or switching back to the standing model.
          </p>
          <button
            onClick={() => setReloadNonce((n) => n + 1)}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Retry Load</span>
          </button>
        </div>
      )}

      {/* Selected Layer Floating Control Bar (Direct Tap & Delete) */}
      {selectedLayerName && (
        <div className="absolute top-4 left-4 right-4 sm:left-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 z-40 flex items-center justify-between sm:justify-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-900/95 border border-sky-400/50 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
            <span className="text-xs text-slate-400 font-medium hidden sm:inline">Selected:</span>
            <span className="text-xs font-bold text-sky-300 truncate max-w-[160px] font-mono">
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

      {/* Floating Canvas Quick Undo/Restore & Reset Camera Bar */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5">
        {hasHiddenLayers && (
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

        <button
          onClick={handleZoomIn}
          className="min-h-[42px] px-3 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800 active:bg-slate-700 shadow-xl backdrop-blur-sm flex items-center gap-1.5 text-xs font-semibold transition-colors"
          title="Zoom in +10% (no limit)"
          aria-label="Zoom in 10%"
        >
          <ZoomIn className="w-4 h-4 text-sky-400" />
          <span>+10%</span>
        </button>

        <button
          onClick={handleResetCamera}
          className="min-h-[42px] px-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 shadow-xl backdrop-blur-sm flex items-center justify-center transition-colors"
          title="Recenter camera"
          aria-label="Recenter camera"
        >
          <Maximize2 className="w-4 h-4 text-sky-400" />
        </button>
      </div>

      {/* Tap Character Hint & Voice Callout */}
      <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2">
        {character.audio && (
          <button
            onClick={onPlayVoice}
            disabled={isVoicePlaying}
            className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-lg backdrop-blur-md ${
              isVoicePlaying
                ? 'bg-sky-600 text-white ring-2 ring-sky-400/50'
                : 'bg-slate-900/90 border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Volume2 className={`w-4 h-4 ${isVoicePlaying ? 'animate-bounce text-white' : 'text-sky-400'}`} />
            <span>{isVoicePlaying ? 'Playing Voice...' : 'Play Voice'}</span>
          </button>
        )}

        <div className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800/80 text-[11px] text-slate-400 backdrop-blur-sm">
          <span>Tap part to select & delete · Drag to pan · Pinch or scroll to zoom</span>
        </div>
      </div>
    </div>
  );
};
