import React from 'react';
import { Layers, Sparkles, Image as ImageIcon } from 'lucide-react';
import { GameId } from '../types/bd2';
import { GAME_MAP } from '../utils/bd2Assets';

interface MobileBottomBarProps {
  activeTab: 'roster' | 'layers' | 'effects';
  setActiveTab: (tab: 'roster' | 'layers' | 'effects') => void;
  layerCount: number;
  hiddenCount: number;
  activeGame: GameId;
}

export const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  activeTab,
  setActiveTab,
  layerCount,
  hiddenCount,
  activeGame,
}) => {
  const gameMeta = GAME_MAP[activeGame];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-slate-900/95 border-t border-slate-800/90 backdrop-blur-md flex items-center justify-around px-2 pb-safe select-none">
      {/* Tab 1: Roster */}
      <button
        onClick={() => setActiveTab('roster')}
        className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 transition-all ${
          activeTab === 'roster' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <ImageIcon className="w-5 h-5" />
        <span className="text-[10px] mt-1 font-medium tracking-tight">
          {gameMeta.rosterLabel}
        </span>
      </button>

      {/* Tab 2: Layer Stack & Delete */}
      <button
        onClick={() => setActiveTab('layers')}
        className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 transition-all relative ${
          activeTab === 'layers' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <div className="relative">
          <Layers className="w-5 h-5" />
          {hiddenCount > 0 ? (
            <span className="absolute -top-1.5 -right-3 text-[9px] font-mono font-bold px-1 rounded-full bg-rose-600 text-white">
              -{hiddenCount}
            </span>
          ) : (
            <span className="absolute -top-1.5 -right-3 text-[9px] font-mono font-bold px-1 rounded-full bg-sky-600 text-white">
              {layerCount}
            </span>
          )}
        </div>
        <span className="text-[10px] mt-1 font-medium tracking-tight">Layer Stack</span>
      </button>

      {/* Tab 3: Shaders & Backdrop */}
      <button
        onClick={() => setActiveTab('effects')}
        className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 transition-all ${
          activeTab === 'effects' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Sparkles className="w-5 h-5" />
        <span className="text-[10px] mt-1 font-medium tracking-tight">Shaders</span>
      </button>
    </nav>
  );
};
