import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, SkipForward, Film, Heart, X } from 'lucide-react';
import { ShotSequence, SequencerStatus } from '../types/shot';
import { SpineViewerHandle } from './SpineViewer';
import {
  buildTimeline,
  timelineDuration,
  poseForShot,
  blendPoses,
  breathingOffset,
  findActiveIndex,
  clamp01,
  CameraPose,
} from '../utils/shotSequencer';

interface CinematicPlayerProps {
  sequence: ShotSequence | null;
  viewerRef: React.RefObject<SpineViewerHandle | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Model bounds, forwarded by the viewer once it has loaded. */
  modelFrame: { x: number; y: number; width: number; height: number } | null;
  onExit: () => void;
}

const TYPE_SPEED_MS = 28;

/**
 * BD2-style shot player.
 *
 * Owns the camera while a sequence is active: each shot gets its own framing,
 * shots cross-fade via an eased camera blend, and one shot can hand off to the
 * next with typed dialogue underneath. This is the "standing cutscene -> they
 * sit down -> dialogue" flow, driven off the same skeleton that is already
 * loaded rather than swapping models.
 */
export const CinematicPlayer: React.FC<CinematicPlayerProps> = ({
  sequence,
  viewerRef,
  viewportRef,
  modelFrame,
  onExit,
}) => {
  const [status, setStatus] = useState<SequencerStatus>('idle');
  const [shotIndex, setShotIndex] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [progress, setProgress] = useState(0);

  const timeline = useMemo(() => (sequence ? buildTimeline(sequence) : []), [sequence]);
  const totalDuration = useMemo(() => timelineDuration(timeline), [timeline]);

  const elapsedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const statusRef = useRef<SequencerStatus>('idle');
  statusRef.current = status;

  // Restart whenever a new sequence is loaded.
  useEffect(() => {
    if (!sequence) {
      setStatus('idle');
      setShotIndex(0);
      setTypedChars(0);
      elapsedRef.current = 0;
      return;
    }
    elapsedRef.current = 0;
    lastTsRef.current = null;
    setShotIndex(0);
    setTypedChars(0);
    setProgress(0);
    setStatus('playing');
  }, [sequence]);

  const applyCameraAt = useCallback(
    (t: number) => {
      const viewer = viewerRef.current;
      const frame = modelFrame;
      const viewport = viewportRef.current;
      if (!viewer || !frame || !viewport || timeline.length === 0) return;

      const vw = viewport.clientWidth || 1;
      const vh = viewport.clientHeight || 1;
      const idx = findActiveIndex(timeline, t);
      const entry = timeline[idx];
      const pose = poseForShot(frame, entry.shot.camera, vw, vh);

      // Blend out of the previous shot's pose so the move reads as a camera
      // move rather than a jump cut.
      const sinceStart = t - entry.start;
      const fade = entry.shot.transition;
      let finalPose: CameraPose = pose;
      if (fade > 0 && sinceStart < fade && idx > 0) {
        const prevPose = poseForShot(frame, timeline[idx - 1].shot.camera, vw, vh);
        finalPose = blendPoses(prevPose, pose, sinceStart / fade);
      }

      // A hair of vertical drift keeps locked-off shots from feeling frozen.
      const drift = breathingOffset(t / 1000, 0.0035) * (vh * finalPose.zoom);
      viewer.setPose({ x: finalPose.x, y: finalPose.y + drift, zoom: finalPose.zoom });

      if (idx !== shotIndex) setShotIndex(idx);
    },
    [modelFrame, shotIndex, timeline, viewerRef, viewportRef]
  );

  // Main clock.
  useEffect(() => {
    if (status !== 'playing' || !sequence || timeline.length === 0) return;

    const step = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min(ts - lastTsRef.current, 100);
      lastTsRef.current = ts;
      elapsedRef.current += dt;
      const t = elapsedRef.current;

      applyCameraAt(t);

      setProgress(totalDuration > 0 ? clamp01(t / totalDuration) : 0);

      if (t >= totalDuration) {
        setStatus('finished');
        viewerRef.current?.resetPose();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = null;
    };
  }, [status, sequence, timeline, totalDuration, applyCameraAt, viewerRef]);

  // Re-aim the camera immediately after a seek or a model (re)load.
  useEffect(() => {
    if (status === 'playing' || status === 'paused') {
      applyCameraAt(elapsedRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelFrame]);

  const activeEntry = timeline[Math.min(shotIndex, timeline.length - 1)];
  const activeLine = activeEntry?.shot.line;

  // Typewriter for the active shot's dialogue.
  useEffect(() => {
    if (!activeLine) {
      setTypedChars(0);
      return;
    }
    setTypedChars(0);
    if (status !== 'playing') return;
    const text = activeLine.text;
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setTypedChars(i);
      if (i >= text.length) window.clearInterval(timer);
    }, TYPE_SPEED_MS);
    return () => window.clearInterval(timer);
  }, [activeLine, status]);

  const seekTo = useCallback(
    (t: number) => {
      elapsedRef.current = Math.max(0, Math.min(t, totalDuration));
      const idx = findActiveIndex(timeline, elapsedRef.current);
      setShotIndex(idx);
      setProgress(totalDuration > 0 ? clamp01(elapsedRef.current / totalDuration) : 0);
      applyCameraAt(elapsedRef.current);
    },
    [applyCameraAt, timeline, totalDuration]
  );

  const skipNext = useCallback(() => {
    const next = timeline[shotIndex + 1];
    if (next) seekTo(next.start);
    else {
      seekTo(totalDuration);
      setStatus('finished');
      viewerRef.current?.resetPose();
    }
  }, [seekTo, shotIndex, timeline, totalDuration, viewerRef]);

  const replay = useCallback(() => {
    seekTo(0);
    setStatus('playing');
  }, [seekTo]);

  const handleTogglePlay = useCallback(() => {
    if (status === 'finished') {
      replay();
      return;
    }
    setStatus((s) => (s === 'playing' ? 'paused' : 'playing'));
  }, [status, replay]);

  const handleExit = useCallback(() => {
    setStatus('idle');
    elapsedRef.current = 0;
    viewerRef.current?.resetPose();
    onExit();
  }, [onExit, viewerRef]);

  if (!sequence) return null;

  const isPlaying = status === 'playing';
  const fullText = activeLine?.text ?? '';
  const visibleText = activeLine ? fullText.slice(0, typedChars) : '';
  const typing = Boolean(activeLine) && typedChars < fullText.length;

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {/* Letterbox bars, pinned to the edges so they never reflow the HUD */}
      <div
        className="absolute inset-x-0 top-0 bg-black transition-[height] duration-500 ease-out"
        style={{ height: status === 'idle' ? 0 : '8vh' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 bg-black transition-[height] duration-500 ease-out"
        style={{ height: status === 'idle' ? 0 : '8vh' }}
      />

      {/* Shot label + progress, top centre */}
      {status !== 'idle' && (
        <div className="pointer-events-auto absolute inset-x-0 top-[8vh] flex items-center justify-center gap-2 pt-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/55 border border-white/10 backdrop-blur-sm">
            <span className="text-[11px] font-semibold tracking-wide text-white/90">
              {sequence.title}
            </span>
            <span className="w-px h-3 bg-white/20" />
            <span className="text-[11px] font-mono text-sky-300">
              {String(shotIndex + 1).padStart(2, '0')}/{String(timeline.length).padStart(2, '0')}
            </span>
            <span className="text-[11px] text-white/60">{activeEntry?.shot.label}</span>
          </div>
        </div>
      )}

      {/* Dialogue + transport */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-[8vh] px-3 pb-3 sm:px-6 sm:pb-5">
        {activeLine && (
          <div className="mx-auto max-w-2xl mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/40 text-[10px] font-bold uppercase tracking-wider text-sky-200">
                {activeLine.speaker}
              </span>
            </div>
            <p className="text-sm sm:text-base leading-relaxed text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] min-h-[3.5em]">
              {visibleText}
              {typing && <span className="inline-block w-[2px] h-[1em] align-middle bg-sky-300 ml-0.5 animate-pulse" />}
            </p>
          </div>
        )}

        <div className="mx-auto max-w-2xl flex items-center gap-2 px-2.5 py-2 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-md">
          <button
            onClick={handleTogglePlay}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause sequence' : 'Play sequence'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button
            onClick={replay}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Replay from the first shot"
            aria-label="Replay sequence"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={skipNext}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="Next shot"
            aria-label="Next shot"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Shot timeline: click a segment to jump to it */}
          <div className="flex-1 flex items-center gap-1">
            {timeline.map((entry, i) => (
              <button
                key={entry.shot.id}
                onClick={() => seekTo(entry.start)}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < shotIndex
                    ? 'bg-sky-500/70'
                    : i === shotIndex
                    ? 'bg-sky-400'
                    : 'bg-white/20 hover:bg-white/35'
                }`}
                title={entry.shot.label}
                aria-label={`Jump to shot ${entry.shot.label}`}
              />
            ))}
          </div>

          <button
            onClick={handleExit}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl bg-white/10 hover:bg-rose-500/70 text-white transition-colors"
            title="Exit cinematic mode"
            aria-label="Exit cinematic mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {status === 'finished' && (
          <div className="mx-auto max-w-2xl mt-2 text-center">
            <span className="text-[11px] text-white/60">
              Sequence complete · <button className="underline hover:text-white" onClick={replay}>replay</button> · <button className="underline hover:text-white" onClick={handleExit}>exit</button>
            </span>
          </div>
        )}

        <div className="mx-auto max-w-2xl mt-1.5 h-0.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-sky-400/80" style={{ width: `${(progress * 100).toFixed(1)}%` }} />
        </div>
      </div>
    </div>
  );
};

/** Small launcher button shown in the viewport when no sequence is running. */
export const CinematicLauncher: React.FC<{
  onPlayCutscene: () => void;
  onPlayDating: () => void;
  hasCutscene: boolean;
  hasDating: boolean;
}> = ({ onPlayCutscene, onPlayDating, hasCutscene, hasDating }) => {
  if (!hasCutscene && !hasDating) return null;
  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1.5">
      {hasCutscene && (
        <button
          onClick={onPlayCutscene}
          className="min-h-[42px] px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800 shadow-xl backdrop-blur-sm flex items-center gap-1.5 text-xs font-semibold transition-colors"
          title="Play the cinematic shot sequence"
        >
          <Film className="w-4 h-4 text-sky-400" />
          <span>Scene</span>
        </button>
      )}
      {hasDating && (
        <button
          onClick={onPlayDating}
          className="min-h-[42px] px-3.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800 shadow-xl backdrop-blur-sm flex items-center gap-1.5 text-xs font-semibold transition-colors"
          title="Play the dialogue framing sequence"
        >
          <Heart className="w-4 h-4 text-rose-400" />
          <span>Talk</span>
        </button>
      )}
    </div>
  );
};
