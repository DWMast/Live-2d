import React, { useState, useRef, useEffect } from 'react';
import { Layers, Sparkles, Download, Image as ImageIcon, Star, Loader2, Check } from 'lucide-react';
import { GameId } from '../types/bd2';
import { GAME_LIST, GAME_MAP } from '../utils/bd2Assets';

interface TopNavProps {
  activeTab: 'roster' | 'layers' | 'effects';
  setActiveTab: (tab: 'roster' | 'layers' | 'effects') => void;
  onOpenExport: () => void;
  layerCount: number;
  hiddenCount: number;
  characterCount: number;
  activeGame: GameId;
  onSelectGame: (gameId: GameId) => void;
  isGameSwitching?: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  setActiveTab,
  onOpenExport,
  layerCount,
  hiddenCount,
  characterCount,
  activeGame,
  onSelectGame,
  isGameSwitching = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const gameMeta = GAME_MAP[activeGame];
  const isDefaultGame = activeGame === 'bd2';

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="h-14 flex items-center justify-between gap-4 px-4 sm:px-6 bg-slate-900/95 border-b border-slate-800/80 backdrop-blur-md shrink-0 z-30 select-none">
      {/* Zone 1: Wordmark */}
      <div className="flex items-center gap-2 shrink-0">
        <a href="/" className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 flex items-center gap-2">
          <span
            className={`w-7 h-7 rounded-lg bg-gradient-to-tr flex items-center justify-center text-white text-[11px] font-black shadow-lg ${gameMeta.accentGradient}`}
          >
            {gameMeta.shortCode}
          </span>
          <span className="hidden sm:inline">{gameMeta.studioName}</span>
          <span className={`sm:hidden font-extrabold text-sm ${gameMeta.accentText}`}>
            {gameMeta.shortCode} Studio
          </span>
        </a>
      </div>

      {/* Zone 2: Navigation Links (Desktop) */}
      <nav className="hidden lg:flex items-center gap-2 text-sm font-medium text-slate-400">
        <button
          onClick={() => setActiveTab('roster')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'roster'
              ? 'bg-slate-800 text-sky-400 font-semibold shadow-inner'
              : 'hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          <span>{gameMeta.rosterLabel}</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 font-mono">
            {characterCount}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('layers')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'layers'
              ? 'bg-slate-800 text-sky-400 font-semibold shadow-inner'
              : 'hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Layer Stack</span>
          <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-950 text-slate-300 font-mono">
            {layerCount}
          </span>
          {hiddenCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 font-mono font-bold">
              -{hiddenCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('effects')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg transition-all whitespace-nowrap shrink-0 ${
            activeTab === 'effects'
              ? 'bg-slate-800 text-sky-400 font-semibold shadow-inner'
              : 'hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Shaders & Backdrop</span>
        </button>
      </nav>

      {/* Zone 3: Export Action + Corner Star Game Switcher (Strictly Icon-Only) */}
      <div className="flex items-center gap-2 shrink-0 relative" ref={menuRef}>
        <button
          onClick={onOpenExport}
          className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 active:bg-sky-700 rounded-xl transition-all shadow-md shadow-sky-600/20 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export PNG</span>
        </button>

        <button
          onClick={() => setMenuOpen((o) => !o)}
          disabled={isGameSwitching}
          aria-label="Switch game"
          aria-expanded={menuOpen}
          title={`Switch game (Current: ${gameMeta.name})`}
          className={`min-h-[40px] w-10 h-10 rounded-xl transition-all flex items-center justify-center shrink-0 border ${
            !isDefaultGame || menuOpen
              ? 'bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-md shadow-amber-500/20 hover:bg-amber-500/30'
              : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:text-amber-300 hover:border-amber-400/50 hover:bg-slate-800'
          }`}
        >
          {isGameSwitching ? (
            <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
          ) : (
            <Star className={`w-4 h-4 ${!isDefaultGame ? 'fill-amber-400 text-amber-300' : ''}`} />
          )}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-12 w-72 rounded-2xl bg-slate-900/95 border border-slate-700/90 shadow-2xl backdrop-blur-md p-1.5 z-50 flex flex-col gap-1">
            {GAME_LIST.map((game) => {
              const isSelected = game.id === activeGame;
              return (
                <button
                  key={game.id}
                  onClick={() => {
                    setMenuOpen(false);
                    if (game.id !== activeGame) {
                      onSelectGame(game.id);
                    }
                  }}
                  className={`w-full px-3 py-2.5 rounded-xl flex items-center gap-3 text-left transition-all ${
                    isSelected
                      ? 'bg-slate-800 border border-sky-500/50 text-white'
                      : 'hover:bg-slate-800/60 border border-transparent text-slate-300'
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-lg bg-gradient-to-tr flex items-center justify-center text-white text-[10px] font-black shrink-0 ${game.accentGradient}`}
                  >
                    {game.shortCode}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-white truncate">{game.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      {game.engineLabel}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-sky-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </header>
  );
};
