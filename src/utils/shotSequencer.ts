import { Shot, ShotSequence, ShotCamera } from '../types/shot';

/**
 * Pure camera maths for the shot sequencer.
 *
 * Kept free of React and of the Spine runtime so it can be reasoned about (and
 * unit tested) without a WebGL context. Everything here is expressed in the
 * skeleton's world units; callers convert to camera position/zoom.
 */

export interface ModelFrame {
  /** World-space bounding box of the character at its current pose. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraPose {
  x: number;
  y: number;
  /** Orthographic zoom: world units per screen pixel. Smaller = closer. */
  zoom: number;
}

/**
 * Fraction of the model's height that each framing should cover in frame.
 * Values were tuned so that portrait, square and landscape viewports all keep
 * the character readable without cropping the silhouette.
 */
const FRAMING_HEIGHT: Record<ShotCamera['framing'], number> = {
  // wide: character plus breathing room around it
  wide: 1.18,
  // full: head to toe
  full: 1.0,
  // medium: roughly thighs up
  medium: 0.66,
  // close: chest and head
  close: 0.44,
  // face: eyes and a little shoulder
  face: 0.26,
};

/** How much horizontal room to reserve beyond the silhouette before it may crop. */
const WIDTH_SLACK = 1.25;

/** Where the focus point sits within the model's bounding box (0 = bottom, 1 = top). */
const FOCUS_ANCHOR: Record<ShotCamera['focus'], number> = {
  center: 0.5,
  chest: 0.72,
  face: 0.88,
};

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Compute the camera pose for a shot.
 *
 * @param frame     current model bounding box in world space
 * @param cam       the shot's framing instruction
 * @param viewportW render target width in device pixels
 * @param viewportH render target height in device pixels
 * @param fill      how much of the viewport the shot should occupy (1 = tight fit)
 */
export function poseForShot(
  frame: ModelFrame,
  cam: ShotCamera,
  viewportW: number,
  viewportH: number,
  fill = 1
): CameraPose {
  const w = Math.max(viewportW, 1);
  const h = Math.max(viewportH, 1);
  const frameHeight = Math.max(frame.height, 1);
  const frameWidth = Math.max(frame.width, 1);

  const targetH = frameHeight * FRAMING_HEIGHT[cam.framing] * fill;
  const targetW = frameWidth * Math.min(FRAMING_HEIGHT[cam.framing], 1) * WIDTH_SLACK * fill;

  // Zoom is world-units-per-pixel, so a larger zoom means a wider view. Take
  // the looser of the two fits: height drives the composition, width only
  // widens it when the viewport is narrow enough to crop the silhouette.
  const zoomByHeight = targetH / h;
  const zoomByWidth = targetW / w;
  const zoom = Math.max(zoomByHeight, zoomByWidth, 1e-4);

  const anchorY = FOCUS_ANCHOR[cam.focus];
  const focusY = frame.y + frameHeight * anchorY;
  const focusX = frame.x + frameWidth / 2;

  return {
    x: focusX + (cam.offsetX ?? 0) * targetW,
    y: focusY + (cam.offsetY ?? 0) * targetH,
    zoom,
  };
}

/**
 * Interpolate between two poses with an eased blend factor. Zoom lerps in log
 * space so a dolly-in feels like constant-speed travel rather than slowing
 * down as it tightens.
 */
export function blendPoses(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const k = easeInOutCubic(clamp01(t));
  return {
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
    zoom: Math.exp(lerp(Math.log(from.zoom), Math.log(to.zoom), k)),
  };
}

/** Small deterministic vertical float, so idle shots don't feel frozen. */
export function breathingOffset(seconds: number, amplitude = 0.004): number {
  return Math.sin(seconds * 0.9) * amplitude;
}

export interface ShotTimelineEntry {
  shot: Shot;
  /** Absolute start time of the shot's hold, in ms. */
  start: number;
  holdEnd: number;
  end: number;
}

export function buildTimeline(sequence: ShotSequence): ShotTimelineEntry[] {
  let cursor = 0;
  return sequence.shots.map((shot) => {
    const start = cursor;
    const holdEnd = start + Math.max(0, shot.hold);
    const end = holdEnd + Math.max(0, shot.transition);
    cursor = end;
    return { shot, start, holdEnd, end };
  });
}

export function timelineDuration(entries: ShotTimelineEntry[]): number {
  return entries.length === 0 ? 0 : entries[entries.length - 1].end;
}

/** Opacity of a shot at time t, so shots cross-fade instead of hard cutting. */
export function shotOpacity(entry: ShotTimelineEntry, t: number): number {
  const fadeIn = entry.shot.transition;
  if (t < entry.start) return 0;
  if (t >= entry.end) return 0;
  if (fadeIn > 0 && t < entry.start + fadeIn) {
    return clamp01((t - entry.start) / fadeIn);
  }
  if (t > entry.holdEnd && entry.shot.transition > 0) {
    return clamp01(1 - (t - entry.holdEnd) / entry.shot.transition);
  }
  return 1;
}

export function findActiveIndex(entries: ShotTimelineEntry[], t: number): number {
  for (let i = 0; i < entries.length; i++) {
    if (t < entries[i].end) return i;
  }
  return entries.length - 1;
}

/**
 * Build the default cinematic sequence for a character: the "standing cutscene"
 * view pulling into a dialogue framing, which is the flow BD2 uses when it
 * moves from a scene piece into a conversation.
 */
export function buildCharacterSequence(name: string): ShotSequence {
  return {
    id: 'cutscene',
    title: `${name} — Scene`,
    subtitle: 'Wide · Medium · Eye line',
    shots: [
      {
        id: 'establish',
        label: 'Establishing',
        camera: { framing: 'wide', focus: 'center', offsetY: -0.02 },
        hold: 2200,
        transition: 900,
      },
      {
        id: 'approach',
        label: 'Approach',
        camera: { framing: 'full', focus: 'chest' },
        hold: 2000,
        transition: 900,
      },
      {
        id: 'medium',
        label: 'Medium',
        camera: { framing: 'medium', focus: 'chest', offsetY: -0.02 },
        hold: 2200,
        transition: 900,
      },
      {
        id: 'eyeline',
        label: 'Eye line',
        camera: { framing: 'close', focus: 'face', offsetY: -0.03 },
        hold: 2600,
        transition: 1000,
      },
      {
        id: 'settle',
        label: 'Return',
        camera: { framing: 'full', focus: 'center' },
        hold: 1800,
        transition: 900,
      },
    ],
  };
}

/** Dialogue-focused sequence used by the "Dating" framing. */
export function buildDatingSequence(name: string): ShotSequence {
  return {
    id: 'dating',
    title: `${name} — Conversation`,
    subtitle: 'Medium · Two-shot feel · Eye line',
    shots: [
      {
        id: 'open',
        label: 'Open',
        camera: { framing: 'medium', focus: 'chest', offsetX: -0.06 },
        hold: 2400,
        transition: 1000,
      },
      {
        id: 'listen',
        label: 'Listen',
        camera: { framing: 'close', focus: 'face', offsetX: 0.05, offsetY: -0.02 },
        hold: 2600,
        transition: 1100,
      },
      {
        id: 'close',
        label: 'Close',
        camera: { framing: 'face', focus: 'face', offsetY: -0.01 },
        hold: 3000,
        transition: 1000,
      },
      {
        id: 'out',
        label: 'Pull out',
        camera: { framing: 'full', focus: 'center' },
        hold: 2000,
        transition: 900,
      },
    ],
  };
}
