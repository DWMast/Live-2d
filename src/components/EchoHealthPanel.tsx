import React from 'react';
import { Check, AlertTriangle, X, Cpu, Image as ImageIcon, Layers, Activity } from 'lucide-react';
import type { ModelHealth } from './EchoSpineViewer';

/**
 * Model health, read from the files themselves.
 *
 * Every value here comes out of the skeleton header, the atlas text or the live
 * skeleton - nothing is inferred from the catalog or the character id. That is
 * the point: when something looks wrong, this panel says *which* of the moving
 * parts is wrong instead of leaving it to guesswork.
 */
interface EchoHealthPanelProps {
  open: boolean;
  onClose: () => void;
  health: ModelHealth | null;
  characterName: string;
  modelId: string;
}

const Row: React.FC<{ label: string; children: React.ReactNode; mono?: boolean }> = ({
  label,
  children,
  mono = true,
}) => (
  <div className="flex items-start gap-3 py-1.5 border-b border-slate-800/60 last:border-0">
    <span className="w-32 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
    <span className={`flex-1 text-[11px] ${mono ? 'font-mono' : ''} text-slate-200 break-words`}>
      {children}
    </span>
  </div>
);

const Ok: React.FC<{ value: boolean; children: React.ReactNode }> = ({ value, children }) => (
  <span className={`inline-flex items-center gap-1 ${value ? 'text-emerald-400' : 'text-rose-400'}`}>
    {value ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
    {children}
  </span>
);

export const EchoHealthPanel: React.FC<EchoHealthPanelProps> = ({
  open,
  onClose,
  health,
  characterName,
  modelId,
}) => {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-stretch justify-end bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-md h-full bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Model Health</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
            aria-label="Close health panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!health ? (
            <p className="text-xs text-slate-400">
              Load a character to read its health report. Values are taken from the skeleton
              binary, the atlas text and the live GL context — not from the catalog.
            </p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-bold text-white">{characterName}</p>
                <p className="text-[11px] font-mono text-slate-400">export {modelId}</p>
              </div>

              {health.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-1">
                  {health.warnings.map((w) => (
                    <p key={w} className="text-[11px] text-amber-200 flex gap-1.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      {w}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                  <Cpu className="w-3 h-3" /> Skeleton
                </p>
                <Row label="Exporter">{health.version ?? 'not found'}</Row>
                <Row label="Runtime">
                  Spine {health.runtime}
                  {health.runtime === '3.8' ? ' (bundled)' : ' (bundled)'}
                </Row>
                <Row label="Header">
                  <Ok value={health.headerOk}>
                    {health.headerOk ? 'parsed' : health.headerError || 'parse failed'}
                  </Ok>
                </Row>
                <Row label="Bones">{health.bones}</Row>
                <Row label="Slots">{health.slots}</Row>
                <Row label="Animations">{health.animations}</Row>
                <Row label="Skins">
                  {health.skins.length ? health.skins.join(', ') : 'default only'}
                </Row>
                <Row label="Two-colour">
                  {health.darkTintedSlots > 0 ? (
                    <Ok value={false}>{health.darkTintedSlots} dark-tinted slots</Ok>
                  ) : (
                    <span className="text-slate-400">none</span>
                  )}
                </Row>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                  <ImageIcon className="w-3 h-3" /> Textures
                </p>
                <Row label="Pages">
                  {health.pageCount}
                  {health.pageNames.length > 0 && (
                    <span className="block text-slate-500 text-[10px] mt-0.5">
                      {health.pageNames.join(', ')}
                    </span>
                  )}
                </Row>
                <Row label="Alpha">{health.alphaSummary}</Row>
                <Row label="Upload">
                  <Ok value={health.uploadPma === health.blendPma}>
                    {health.uploadPma ? 'premultiplied' : 'straight'}
                  </Ok>
                </Row>
                <Row label="Blend">
                  <Ok value={health.uploadPma === health.blendPma}>
                    {health.blendPma ? '(ONE, 1−src)' : '(SRC_ALPHA, 1−src)'}
                  </Ok>
                </Row>
                <Row label="Contract">
                  <Ok value={health.texturePatched}>
                    {health.texturePatched ? 'enforced per upload' : 'not patched'}
                  </Ok>
                </Row>
                <Row label="Mipmaps">{health.mipmaps ? 'on (anisotropic)' : 'off'}</Row>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                  <Layers className="w-3 h-3" /> Load
                </p>
                <Row label="Payload">{health.payloadMb.toFixed(1)} MB</Row>
                <Row label="Time">{health.loadMs} ms</Row>
              </div>

              <p className="text-[10px] leading-relaxed text-slate-500 border-t border-slate-800 pt-2">
                Upload and blend must agree. When an atlas declares no <code>pma</code> key its
                texels are straight alpha, so both must be straight; otherwise every
                anti-aliased edge texel is darkened by roughly <code>a·(1−a)</code>, which is what
                the black marks around hair, lashes and cloth edges were.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
