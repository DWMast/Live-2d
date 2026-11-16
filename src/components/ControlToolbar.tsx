import React from 'react';
import { Play, Pause, FastForward, Camera, Volume2, Globe } from 'lucide-react';

interface ControlToolbarProps {
  animations: string[];
  activeAnimation: string;
  onSelectAnimation: (anim: string) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  animationSpeed: number;
  onChangeSpeed: (speed: number) => void;
  audioLanguage: 'JP' | 'KR';
  onToggleLanguage: () => void;
  onPlayVoice: () => void;
  isVoicePlaying: boolean;
  hasAudio: boolean;
  onTakeScreenshot: () => void;
}

export const ControlToolbar: React.FC<ControlToolbarProps> = ({
  animations,
  activeAnimation,
  onSelectAnimation,
  isPlaying,
  onTogglePlay,
  animationSpeed,
  onChangeSpeed,
  audioLanguage,
  onToggleLanguage,
  onPlayVoice,
  isVoicePlaying,
  hasAudio,
  onTakeScreenshot,
}) => {
  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-md select-none text-xs">
      {/* Play/Pause */}
      <button
        onClick={onTogglePlay}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-200 hover:text-white hover:bg-slate-800 transition-colors"
        title={isPlaying ? 'Pause Animation (Space)' : 'Play Animation (Space)'}
      >
        {isPlaying ? <Pause className="w-4 h-4 text-amber-400" /> : <Play className="w-4 h-4 text-emerald-400" />}
      </button>

      {/* Animation Selector */}
      {animations.length > 0 && (
        <div className="flex items-center gap-1 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800">
          <span className="text-[10px] text-slate-500 font-medium uppercase hidden sm:inline">Motion:</span>
          <select
            value={activeAnimation}
            onChange={(e) => onSelectAnimation(e.target.value)}
            className="bg-transparent text-xs font-mono font-bold text-sky-400 focus:outline-none cursor-pointer max-w-[130px] sm:max-w-[160px] truncate"
          >
            {animations.map((anim) => (
              <option key={anim} value={anim} className="bg-slate-900 text-slate-200 font-mono">
                {anim}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Speed Selector */}
      <div className="hidden sm:flex items-center gap-0.5 bg-slate-950/80 p-0.5 rounded-xl border border-slate-800 text-[11px] font-mono">
        {[0.5, 1, 1.5, 2].map((s) => (
          <button
            key={s}
            onClick={() => onChangeSpeed(s)}
            className={`px-2 py-0.5 rounded-lg transition-all ${
              animationSpeed === s
                ? 'bg-sky-600 text-white font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Language Switcher (JP / KR) */}
      {hasAudio && (
        <button
          onClick={onToggleLanguage}
          className="min-h-[36px] px-2.5 py-1 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-300 hover:text-white flex items-center gap-1 font-mono text-[11px] font-bold"
          title="Switch Voice Language (Japanese / Korean)"
        >
          <Globe className="w-3.5 h-3.5 text-sky-400" />
          <span>{audioLanguage}</span>
        </button>
      )}

      {/* Screenshot Capture */}
      <button
        onClick={onTakeScreenshot}
        className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        title="Download 4K Transparent PNG Screenshot"
      >
        <Camera className="w-4 h-4 text-sky-400" />
      </button>
    </div>
  );
};
