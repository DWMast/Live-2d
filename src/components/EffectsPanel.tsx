import React from 'react';
import { ScreenFilters, EnvironmentPreset } from '../types';
import { ENVIRONMENTS } from '../data/environments';
import { Sparkles, Sliders, Sun, ShieldAlert, Palette, Check } from 'lucide-react';

interface EffectsPanelProps {
  filters: ScreenFilters;
  onChangeFilters: (updates: Partial<ScreenFilters>) => void;
  currentEnvironment: EnvironmentPreset;
  onChangeEnvironment: (env: EnvironmentPreset) => void;
}

export const EffectsPanel: React.FC<EffectsPanelProps> = ({
  filters,
  onChangeFilters,
  currentEnvironment,
  onChangeEnvironment,
}) => {
  return (
    <div className="w-80 lg:w-96 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex flex-col gap-3 shrink-0 bg-slate-900/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">VFX & Shaders</h2>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 text-xs text-slate-300">
        {/* Environment Backdrops */}
        <div className="flex flex-col gap-3">
          <span className="font-bold text-white flex items-center gap-2">
            <Palette className="w-4 h-4 text-sky-400" />
            <span>Environment Backdrops</span>
          </span>

          <div className="grid grid-cols-2 gap-2">
            {ENVIRONMENTS.map((env) => {
              const isSelected = env.id === currentEnvironment.id;
              return (
                <button
                  key={env.id}
                  onClick={() => onChangeEnvironment(env)}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-20 relative overflow-hidden ${
                    isSelected
                      ? 'bg-slate-800 border-sky-400 shadow-md ring-1 ring-sky-400'
                      : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span className="text-xs font-bold text-white relative z-10">{env.name}</span>
                  <span className="text-[10px] text-slate-400 relative z-10">{env.category}</span>
                  {isSelected && (
                    <span className="absolute top-2 right-2 text-sky-400">
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Post-Processing Filters */}
        <div className="flex flex-col gap-3 pt-4 border-t border-slate-800">
          <span className="font-bold text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-400" />
            <span>Screen Post-Processing</span>
          </span>

          {/* Color Grading Filter Presets */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-400 font-medium">Color Grade Tone</label>
            <div className="grid grid-cols-3 gap-1.5 text-[11px]">
              {[
                { id: 'none', label: 'Default' },
                { id: 'cyberpunk', label: 'Cyberpunk' },
                { id: 'warm_gold', label: 'Warm Gold' },
                { id: 'gothic_cool', label: 'Gothic Cool' },
                { id: 'retro_anime', label: 'Retro Anime' },
                { id: 'monochrome', label: 'Mono' },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() => onChangeFilters({ colorFilter: c.id as ScreenFilters['colorFilter'] })}
                  className={`py-1.5 px-2 rounded-lg font-medium transition-colors ${
                    filters.colorFilter === c.id
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brightness */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <label className="text-slate-400">Brightness</label>
              <span className="font-mono text-slate-300">{Math.round(filters.brightness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={filters.brightness}
              onChange={(e) => onChangeFilters({ brightness: parseFloat(e.target.value) })}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg"
            />
          </div>

          {/* Saturation */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <label className="text-slate-400">Saturation</label>
              <span className="font-mono text-slate-300">{Math.round(filters.saturation * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={filters.saturation}
              onChange={(e) => onChangeFilters({ saturation: parseFloat(e.target.value) })}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg"
            />
          </div>

          {/* Vignette Shadow */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between">
              <label className="text-slate-400">Vignette Edge Blur</label>
              <span className="font-mono text-slate-300">{Math.round(filters.vignette * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={filters.vignette}
              onChange={(e) => onChangeFilters({ vignette: parseFloat(e.target.value) })}
              className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded-lg"
            />
          </div>

          {/* Retro Scanlines Toggle */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-slate-300 font-medium">CRT Retro Scanlines</span>
            <button
              onClick={() => onChangeFilters({ scanlines: !filters.scanlines })}
              className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                filters.scanlines ? 'bg-sky-600' : 'bg-slate-800'
              }`}
            >
              <span
                className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                  filters.scanlines ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
