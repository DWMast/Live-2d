import React from 'react';
import { Bug, X, RotateCcw } from 'lucide-react';

/**
 * On-device rendering diagnostics.
 *
 * The "shadows / black blobs" complaint has several plausible causes that look
 * almost identical to the eye, and they need totally different fixes:
 *
 *   1. baked-in dark matte in the atlas PNGs (asset problem - needs art repair)
 *   2. slot tint corruption from hiding/unhiding layers (code - fixed in
 *      applySlotVisibility)
 *   3. CSS contrast/vignette drawn over the canvas (presentation - now neutral)
 *   4. texture filtering / mipmaps (quality - needs anisotropic settings)
 *
 * Rather than guess again, this panel lets you toggle one variable at a time and
 * see which change actually removes the marks. Whatever you report back maps
 * directly onto one of the four rows above.
 */

export interface DiagnosticToggles {
  /** Strip every CSS filter and overlay so the raw WebGL canvas shows through. */
  rawCanvas: boolean;
  /** Force the atlas texture to be sampled without mipmaps. */
  noMipmaps: boolean;
  /** Draw the character with a flat white albedo to expose geometry only. */
  flatShading: boolean;
  /** Cycle slots one at a time to find which layer owns a mark. */
  isolateSlots: boolean;
}

export const DEFAULT_DIAGNOSTIC_TOGGLES: DiagnosticToggles = {
  rawCanvas: false,
  noMipmaps: false,
  flatShading: false,
  isolateSlots: false,
};

interface RenderDiagnosticsProps {
  open: boolean;
  onClose: () => void;
  toggles: DiagnosticToggles;
  onChangeToggles: (updates: Partial<DiagnosticToggles>) => void;
  /** Downloadable report so the user can paste raw numbers back. */
  onCopyReport: () => void;
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
    hint: 'On = textures are point/linear sampled at level 0. If edges get jaggy but the dark marks change, filtering is involved.',
  },
  {
    key: 'flatShading',
    label: 'Flat shading',
    hint: 'On = slot tints are neutralised. If dark patches vanish here, the tint data is the cause.',
  },
  {
    key: 'isolateSlots',
    label: 'Isolate layers',
    hint: 'On = only one slot draws at a time, slowly cycling. Watch which layer brings the marks back.',
  },
];

export const RenderDiagnostics: React.FC<RenderDiagnosticsProps> = ({
  open,
  onClose,
  toggles,
  onChangeToggles,
  onCopyReport,
  reportText,
}) => {
  if (!open) return null;

  return (
    <div className="absolute top-4 right-4 z-50 w-[min(92vw,22rem)] max-h-[80vh] overflow-y-auto rounded-2xl bg-slate-950/95 border border-amber-400/40 shadow-2xl backdrop-blur-md">
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

      <div className="p-3 flex flex-col gap-2">
        <p className="text-[11px] leading-relaxed text-slate-400">
          Toggle one at a time. Note which one makes the dark marks under the
          brows, eyes and fingers change or disappear, then send me that.
        </p>

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
            onClick={onCopyReport}
            className="flex-1 min-h-[36px] rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
          >
            Copy report
          </button>
        </div>

        <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-black/60 border border-slate-800 p-2 text-[10px] leading-relaxed text-emerald-300 font-mono whitespace-pre-wrap break-all">
{reportText}
        </pre>
      </div>
    </div>
  );
};
