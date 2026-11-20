import React, { useState } from 'react';
import { Layers, Trash2, Eye, EyeOff, RotateCcw, Undo2, Search, Check, Sparkles } from 'lucide-react';

interface LayerDrawerProps {
  layers: string[];
  hiddenLayers: Set<string>;
  selectedLayerName: string | null;
  onSelectLayer: (layerName: string | null) => void;
  onToggleLayerVisibility: (layerName: string) => void;
  onDeleteLayer: (layerName: string) => void;
  onUndoDelete: () => void;
  onResetAllLayers: () => void;
}

export const LayerDrawer: React.FC<LayerDrawerProps> = ({
  layers,
  hiddenLayers,
  selectedLayerName,
  onSelectLayer,
  onToggleLayerVisibility,
  onDeleteLayer,
  onUndoDelete,
  onResetAllLayers,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLayers = layers.filter((layer) =>
    layer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeVisibleCount = layers.length - hiddenLayers.size;

  return (
    <div className="w-full lg:w-96 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none overflow-hidden">
      {/* Mobile Grab Bar */}
      <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto my-2 shrink-0 lg:hidden" />

      {/* Header */}
      <div className="p-3.5 sm:p-4 border-b border-slate-800 flex flex-col gap-3 shrink-0 bg-slate-900/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">Live2D Layer Stack</h2>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-sky-400 font-bold">{activeVisibleCount}</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-400">{layers.length} Active</span>
          </div>
        </div>

        {/* Action Bar: Undo & Reset All */}
        <div className="flex items-center gap-2">
          <button
            onClick={onUndoDelete}
            disabled={hiddenLayers.size === 0}
            className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none text-slate-200 transition-all flex items-center justify-center gap-1.5 border border-slate-700"
          >
            <Undo2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Undo Delete ({hiddenLayers.size})</span>
          </button>

          <button
            onClick={onResetAllLayers}
            disabled={hiddenLayers.size === 0}
            className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 active:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none text-slate-200 transition-all flex items-center justify-center gap-1.5 border border-slate-700"
            title="Restore all deleted layers"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>Reset</span>
          </button>
        </div>

        {/* Filter Search */}
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search layer by name (e.g. hair, cape, body)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>
      </div>

      {/* Selected Layer Info Banner */}
      {selectedLayerName && (
        <div className="p-3 bg-sky-950/60 border-b border-sky-800/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 truncate">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="text-slate-300">Selected:</span>
            <span className="font-bold text-sky-300 font-mono truncate">{selectedLayerName}</span>
          </div>

          <button
            onClick={() => onDeleteLayer(selectedLayerName)}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-lg font-bold flex items-center gap-1 shadow-sm shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Layers List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {filteredLayers.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            {layers.length === 0 ? 'No removable layers found in model' : `No layer matching "${searchTerm}"`}
          </div>
        ) : (
          filteredLayers.map((layerName) => {
            const isHidden = hiddenLayers.has(layerName);
            const isSelected = selectedLayerName === layerName;

            return (
              <div
                key={layerName}
                onClick={() => onSelectLayer(isSelected ? null : layerName)}
                className={`min-h-[52px] p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-slate-800 border-sky-400 shadow-lg shadow-sky-500/10 ring-1 ring-sky-400'
                    : isHidden
                    ? 'bg-slate-950/30 border-slate-900 opacity-40'
                    : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/40 hover:border-slate-700'
                }`}
              >
                {/* Layer Name & Status */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-mono font-bold ${
                      isSelected
                        ? 'bg-sky-500 text-white'
                        : isHidden
                        ? 'bg-slate-800 text-slate-500'
                        : 'bg-slate-800 text-sky-400'
                    }`}
                  >
                    {isSelected ? <Check className="w-4 h-4" /> : '#'}
                  </div>

                  <span
                    className={`text-xs font-mono font-semibold truncate ${
                      isHidden ? 'line-through text-slate-500' : isSelected ? 'text-sky-200' : 'text-slate-200'
                    }`}
                  >
                    {layerName}
                  </span>
                </div>

                {/* Touch Hitbox Actions: Eye & Easy Delete (44px min hitboxes) */}
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {/* Visibility Toggle */}
                  <button
                    onClick={() => onToggleLayerVisibility(layerName)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                      isHidden ? 'text-slate-600 bg-slate-900' : 'text-slate-300 hover:bg-slate-700'
                    }`}
                    title={isHidden ? 'Show Layer' : 'Hide Layer'}
                  >
                    {isHidden ? <EyeOff className="w-4 h-4 text-rose-400" /> : <Eye className="w-4 h-4" />}
                  </button>

                  {/* Easy Instant Delete Button */}
                  <button
                    onClick={() => onDeleteLayer(layerName)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      isHidden
                        ? 'text-slate-600 hover:text-slate-400'
                        : 'text-rose-400 hover:text-white bg-rose-950/30 hover:bg-rose-600'
                    }`}
                    title="Instant Delete Layer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
