/**
 * Cinematic shot sequencing.
 *
 * Modelled on the way Brown Dust 2 frames its character scenes: a sequence of
 * discrete camera "shots" (wide, medium, close-up, dialogue) that cross-fade
 * into one another rather than hard-cutting. Each shot owns where the camera
 * sits, how tight it is, and how long it holds before moving on.
 */

/** A normalised framing cue, independent of any particular character's size. */
export type ShotFraming = 'wide' | 'full' | 'medium' | 'close' | 'face';

/** Which part of the character the shot centres on. */
export type ShotFocus = 'center' | 'chest' | 'face';

export interface ShotCamera {
  framing: ShotFraming;
  focus: ShotFocus;
  /**
   * Vertical offset as a fraction of the framing height. Negative looks lower
   * (pushes the character up in frame), positive looks higher.
   */
  offsetY?: number;
  /** Horizontal offset as a fraction of the framing width, for off-centre compositions. */
  offsetX?: number;
  /** Extra roll of the camera in degrees, for dramatic tilts. */
  tilt?: number;
}

export interface Shot {
  id: string;
  /** Short human label, e.g. "Wide", "Eye line". */
  label: string;
  camera: ShotCamera;
  /** Hold duration in ms, excluding the transition into the next shot. */
  hold: number;
  /** Cross-fade duration (ms) into the following shot. 0 = hard cut. */
  transition: number;
  /**
   * Optional dialogue shown during this shot. If absent, the sequencer will
   * fall back to a neutral caption or show nothing at all.
   */
  line?: {
    speaker: string;
    text: string;
  };
  /** Optional animation name to switch the skeleton to while this shot plays. */
  animation?: string;
}

export interface ShotSequence {
  /** Rising-edge trigger, e.g. `cut` for "play the cutscene sequence". */
  id: string;
  title: string;
  subtitle: string;
  shots: Shot[];
}

export type SequencerStatus = 'idle' | 'playing' | 'paused' | 'finished';

export interface SequencerState {
  status: SequencerStatus;
  sequenceId: string | null;
  shotIndex: number;
  /** 0..1 progress within the currently held shot. */
  shotProgress: number;
  /** True while the letterbox bars should be visible. */
  cinematic: boolean;
}
