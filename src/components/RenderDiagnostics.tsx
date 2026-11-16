import React from 'react';
import { Bug, X, RotateCcw, Camera, Check } from 'lucide-react';

/**
 * One-tap evidence capture.
 *
 * Text descriptions of "dark patches under the eyes" have been ambiguous enough
 * to send me down three wrong fixes. Instead of another questionnaire, this
 * panel grabs the actual pixels: the character is cropped out of the live WebGL
 * canvas, composited over white, and paired with the exact model, pose, atlas
 * pages and renderer settings that produced it. That is enough to measure the
 * marks directly rather than reason about them.
 */

export interface DiagnosticToggles {
  /** Strip every CSS filter and overlay so the raw WebGL canvas shows through. */
  rawCanvas: boolean;
  /** Force the atlas texture to be sampled without mipmaps. */
  noMipmaps: boolean;
  /** Draw the character with a neutral tint to expose geometry only. */
  flatShading: boolean;
}

export const DEFAULT_DIAGNOSTIC_TOGGLES: DiagnosticToggles = {
  rawCanvas: false,
  noMipmaps: false,
  flatShading: false,
};

export interface PoseShotSummary {
  label: string;
  dataUrl: string;
  detail: string;
}

interface RenderDiagnosticsProps {
  open: boolean;
  onClose: () => void;
  toggles: DiagnosticToggles;
  onChangeToggles: (updates: Partial<DiagnosticToggles>) => void;
  /** Captured character crops, newest last. */
  shots: PoseShotSummary[];
  onCapture: () => void;
  onClearShots: () => void;
  reportText: string;
}

const ROWS: Array<{
  key: keyof DiagnosticToggles;
  label: string;
  hint: string;
}> = [
  {
    key: 'rawCanvas',
    label: 'Raw canvas (no filters)',
    hint: 'On = vignette, contrast, saturation and scanlines are all disabled.',
  },
  {
    key: 'noMipmaps',
    label: 'Disable mipmaps',
    hint: 'On = textures sampled at level 0 only. Cheaper and crisper at 1:1, aliased when zoomed out.',
  },
  {
    key: 'flatShading',
    label: 'Neutral tint',
    hint: 'On = slot colours forced to white, so only painted pixels remain.',
  },
];

export const RenderDiagnostics: React.FC<RenderDiagnosticsProps> = ({
  open,
  onClose,
  toggles,
  onChangeToggles,
  shots,
  onCapture,
  onClearShots,
  reportText,
}) => {
  const [copied, setCopied] = React.useState(false);
  if (!open) return null;

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked on some browsers; the <pre> below is selectable.
    }
  };

  return (
    <div className="absolute top-4 right-4 z-50 w-[min(94vw,24rem)] max-h-[86vh] overflow-y-auto rounded-2xl bg-slate-950/95 border border-amber-400/40 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800 sticky top-0 bg-slate-950/95">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white">Render Diagnostics</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        <button
          onClick={onCapture}
          className="w-full min-h-[52px] rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white flex items-center justify-center gap-2 font-bold text-sm"
        >
          <Camera className="w-4.5 h-4.5" />
          Snapshot this pose
        </button>
        <p className="text-[11px] leading-relaxed text-slate-400">
          Crops the character out of the canvas. Take one normal, one zoomed on
          the face, and one zoomed on a hand — then save them off this device
          and send them over.
        </p>

        {shots.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Captured ({shots.length})
              </span>
              <button
                onClick={onClearShots}
                className="text-[10px] font-semibold text-slate-400 hover:text-white"
              >
                Clear
              </button>
            </div>
            {shots.map((shot, i) => (
              <div
                key={`${shot.label}-${i}`}
                className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900/60"
              >
                <a
                  href={shot.dataUrl}
                  download={`${shot.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`}
                  className="block"
                  title="Tap to save this PNG"
                >
                  <img
                    src={shot.dataUrl}
                    alt={shot.label}
                    className="block w-full max-h-44 object-contain bg-white"
                  />
                </a>
                <div className="px-2 py-1.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold text-slate-200">{shot.label}</span>
                  <span className="text-[9px] leading-snug text-slate-500 font-mono break-all">
                    {shot.detail}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="h-px bg-slate-800" />

        {ROWS.map((row) => (
          <label
            key={row.key}
            className={`flex gap-2.5 p-2 rounded-xl border cursor-pointer transition-colors ${
              toggles[row.key]
                ? 'bg-amber-500/10 border-amber-400/60'
                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
            }`}
          >
            <input
              type="checkbox"
              checked={toggles[row.key]}
              onChange={(e) => onChangeToggles({ [row.key]: e.target.checked })}
              className="mt-0.5 w-4 h-4 shrink-0 accent-amber-500"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[11px] font-bold text-slate-100">{row.label}</span>
              <span className="text-[10px] leading-snug text-slate-500">{row.hint}</span>
            </span>
          </label>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onChangeToggles(DEFAULT_DIAGNOSTIC_TOGGLES)}
            className="flex-1 min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset all
          </button>
          <button
            onClick={copyReport}
            className="flex-1 min-h-[36px] rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : null}
            {copied ? 'Copied' : 'Copy report'}
          </button>
        </div>

        <pre className="max-h-44 overflow-auto rounded-xl bg-black/60 border border-slate-800 p-2 text-[10px] leading-relaxed text-emerald-300 font-mono whitespace-pre-wrap break-all select-all">
          {reportText}
        </pre>
      </div>
    </div>
  );
};
