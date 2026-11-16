import React, { useState, useRef, useCallback, useEffect } from 'react';
import { BD2Character, AnimationCategory, GameId } from './types/bd2';
import {
  ALL_CHARACTERS,
  DEFAULT_CHARACTER,
  GAME_MAP,
  getCharacterVoiceUrls,
  loadGameRoster,
  pickDefaultCharacterForGame,
} from './utils/bd2Assets';
import { ENVIRONMENTS } from './data/environments';
import { EnvironmentPreset, ScreenFilters } from './types';
import { TopNav } from './components/TopNav';
import { SpineViewer } from './components/SpineViewer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CharacterDrawer } from './components/CharacterDrawer';
import { LayerDrawer } from './components/LayerDrawer';
import { EffectsPanel } from './components/EffectsPanel';
import { ControlToolbar } from './components/ControlToolbar';
import { MobileBottomBar } from './components/MobileBottomBar';
import { ChevronDown, ChevronUp } from 'lucide-react';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export default function App() {
  const isDesktop = useIsDesktop();
  const [activeGame, setActiveGame] = useState<GameId>('bd2');
  const [rostersByGame, setRostersByGame] = useState<Partial<Record<GameId, BD2Character[]>>>({
    bd2: ALL_CHARACTERS,
  });
  const [isGameSwitching, setIsGameSwitching] = useState(false);
  const lastCharacterByGameRef = useRef<Partial<Record<GameId, BD2Character>>>({
    bd2: DEFAULT_CHARACTER,
  });

  const [activeTab, setActiveTab] = useState<'roster' | 'layers' | 'effects'>('roster');
  const [selectedCharacter, setSelectedCharacter] = useState<BD2Character>(DEFAULT_CHARACTER);
  const [activeCategory, setActiveCategory] = useState<AnimationCategory>('character');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const activeRoster = rostersByGame[activeGame] || ALL_CHARACTERS;
  const gameMeta = GAME_MAP[activeGame];

  // Model Animation & Layer State
  const [animations, setAnimations] = useState<string[]>([]);
  const [activeAnimation, setActiveAnimation] = useState<string>('');
  const [layers, setLayers] = useState<string[]>([]);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [hiddenHistory, setHiddenHistory] = useState<string[]>([]);
  const [selectedLayerName, setSelectedLayerName] = useState<string | null>(null);

  // Playback & Audio
  const [isPlaying, setIsPlaying] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState(1);
  const [audioLanguage, setAudioLanguage] = useState<'JP' | 'KR'>('JP');
  const [isVoicePlaying, setIsVoicePlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Shaders & Backdrop
  const [currentEnvironment, setCurrentEnvironment] = useState<EnvironmentPreset>(ENVIRONMENTS[0]);
  const [filters, setFilters] = useState<ScreenFilters>({
    bloom: 0,
    vignette: 0.2,
    chromaticAberration: 0,
    brightness: 1.0,
    contrast: 1.05,
    saturation: 1.1,
    scanlines: false,
    colorFilter: 'none',
  });

  // Spacebar play/pause shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle Character Change
  const handleSelectCharacter = useCallback((char: BD2Character) => {
    const targetGame: GameId = char.game || 'bd2';
    lastCharacterByGameRef.current[targetGame] = char;
    setSelectedCharacter(char);
    setActiveCategory('character');
    setHiddenLayers(new Set());
    setHiddenHistory([]);
    setSelectedLayerName(null);
    setIsMobileDrawerOpen(false);
  }, []);

  // Switch between Brown Dust 2, Daiblos Core, Haze Reverb, Echocalypse, and Azur Lane via the corner Star button
  const handleSelectGame = useCallback(
    async (targetGame: GameId) => {
      if (isGameSwitching || targetGame === activeGame) return;
      lastCharacterByGameRef.current[activeGame] = selectedCharacter;

      setIsGameSwitching(true);
      try {
        const roster = rostersByGame[targetGame] || (await loadGameRoster(targetGame));
        if (!rostersByGame[targetGame]) {
          setRostersByGame((prev) => ({ ...prev, [targetGame]: roster }));
        }
        const nextChar =
          lastCharacterByGameRef.current[targetGame] ||
          pickDefaultCharacterForGame(targetGame, roster);
        lastCharacterByGameRef.current[targetGame] = nextChar;
        setActiveGame(targetGame);
        setSelectedCharacter(nextChar);
        setActiveCategory('character');
        setHiddenLayers(new Set());
        setHiddenHistory([]);
        setSelectedLayerName(null);
      } catch {
        // Keep current game active if catalog fetch fails
      } finally {
        setIsGameSwitching(false);
      }
    },
    [activeGame, isGameSwitching, rostersByGame, selectedCharacter]
  );

  // Handle Category Change (Standing / Cutscene / Dating)
  const handleSelectCategory = useCallback((category: AnimationCategory) => {
    setActiveCategory(category);
    setHiddenLayers(new Set());
    setHiddenHistory([]);
    setSelectedLayerName(null);
    setIsMobileDrawerOpen(false);
  }, []);

  // Handle Animations Loaded
  const handleAnimationsLoaded = useCallback((anims: string[]) => {
    setAnimations(anims);
    if (anims.length > 0) {
      const defaultAnim = anims.includes('idle')
        ? 'idle'
        : anims.includes('stand')
        ? 'stand'
        : anims.includes('cut_1')
        ? 'cut_1'
        : anims.find((a) => a.toLowerCase().includes('idle')) || anims[0];
      setActiveAnimation(defaultAnim);
    } else {
      setActiveAnimation('');
    }
  }, []);

  // Handle Layers Loaded
  const handleLayersLoaded = useCallback((slotNames: string[]) => {
    setLayers(slotNames);
  }, []);

  // Easy Layer Selection
  const handleSelectLayer = useCallback((name: string | null) => {
    setSelectedLayerName(name);
  }, []);

  // Easy Instant Layer Delete (Hide)
  const handleDeleteLayer = useCallback((layerName: string) => {
    setHiddenLayers((prev) => {
      if (prev.has(layerName)) return prev;
      const next = new Set(prev);
      next.add(layerName);
      return next;
    });
    setHiddenHistory((prev) => [...prev, layerName]);
    setSelectedLayerName((curr) => (curr === layerName ? null : curr));
  }, []);

  // Toggle Visibility
  const handleToggleLayerVisibility = useCallback((layerName: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerName)) {
        next.delete(layerName);
      } else {
        next.add(layerName);
        setHiddenHistory((h) => [...h, layerName]);
      }
      return next;
    });
  }, []);

  // Undo Last Deleted Layer
  const handleUndoDelete = useCallback(() => {
    setHiddenHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setHiddenLayers((hiddenPrev) => {
        const next = new Set(hiddenPrev);
        next.delete(last);
        return next;
      });
      setSelectedLayerName(last);
      return prev.slice(0, -1);
    });
  }, []);

  // Reset All Layers to Default
  const handleResetAllLayers = useCallback(() => {
    setHiddenLayers(new Set());
    setHiddenHistory([]);
    setSelectedLayerName(null);
  }, []);

  // Voice playback
  const handlePlayVoice = useCallback(() => {
    const urls = getCharacterVoiceUrls(selectedCharacter, audioLanguage);
    if (urls.length === 0) return;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const randomUrl = urls[Math.floor(Math.random() * urls.length)];
    const audio = new Audio(randomUrl);
    audioRef.current = audio;
    setIsVoicePlaying(true);

    audio.onended = () => setIsVoicePlaying(false);
    audio.onerror = () => setIsVoicePlaying(false);
    audio.play().catch(() => setIsVoicePlaying(false));
  }, [selectedCharacter, audioLanguage]);

  // Download Transparent PNG Screenshot from the WebGL canvas specifically
  const handleTakeScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas.spine-player-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `${activeGame}_${selectedCharacter.charName}_${selectedCharacter.costumeName}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [activeGame, selectedCharacter]);

  const handleTabChange = (tab: 'roster' | 'layers' | 'effects') => {
    if (!isDesktop && activeTab === tab && isMobileDrawerOpen) {
      setIsMobileDrawerOpen(false);
      return;
    }
    setActiveTab(tab);
    setIsMobileDrawerOpen(true);
  };

  const renderDrawerContent = () => {
    if (activeTab === 'roster') {
      return (
        <CharacterDrawer
          activeGame={activeGame}
          characters={activeRoster}
          selectedCharacter={selectedCharacter}
          onSelectCharacter={handleSelectCharacter}
          activeCategory={activeCategory}
          onSelectCategory={handleSelectCategory}
        />
      );
    }
    if (activeTab === 'layers') {
      return (
        <LayerDrawer
          layers={layers}
          hiddenLayers={hiddenLayers}
          selectedLayerName={selectedLayerName}
          onSelectLayer={handleSelectLayer}
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onDeleteLayer={handleDeleteLayer}
          onUndoDelete={handleUndoDelete}
          onResetAllLayers={handleResetAllLayers}
        />
      );
    }
    return (
      <EffectsPanel
        filters={filters}
        onChangeFilters={(updates) => setFilters((prev) => ({ ...prev, ...updates }))}
        currentEnvironment={currentEnvironment}
        onChangeEnvironment={(env) => setCurrentEnvironment(env)}
      />
    );
  };

  // Compute non-destructive CSS filter string for the WebGL canvas only
  const canvasFilterStyle = React.useMemo(() => {
    const parts: string[] = [];
    if (filters.brightness !== 1) parts.push(`brightness(${filters.brightness})`);
    if (filters.contrast !== 1) parts.push(`contrast(${filters.contrast})`);
    if (filters.saturation !== 1) parts.push(`saturate(${filters.saturation})`);
    if (filters.colorFilter === 'cyberpunk') parts.push('hue-rotate(15deg) saturate(1.35)');
    else if (filters.colorFilter === 'warm_gold') parts.push('sepia(0.28) saturate(1.25)');
    else if (filters.colorFilter === 'gothic_cool') parts.push('hue-rotate(-15deg) contrast(1.1)');
    else if (filters.colorFilter === 'retro_anime') parts.push('contrast(1.12) saturate(1.2)');
    else if (filters.colorFilter === 'monochrome') parts.push('grayscale(1)');
    return parts.length > 0 ? parts.join(' ') : undefined;
  }, [filters]);

  return (
    <div className="w-screen h-[100dvh] flex flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* 3-Zone Top App Bar */}
      <TopNav
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        onOpenExport={handleTakeScreenshot}
        layerCount={layers.length}
        hiddenCount={hiddenLayers.size}
        characterCount={activeRoster.length}
        activeGame={activeGame}
        onSelectGame={handleSelectGame}
        isGameSwitching={isGameSwitching}
      />

      {/* Main Studio Viewport */}
      <div className="flex-1 flex overflow-hidden relative pb-16 lg:pb-0">
        {/* Desktop Sidebar Panel */}
        {isDesktop && <div className="h-full">{renderDrawerContent()}</div>}

        {/* Mobile Collapsible Bottom Drawer */}
        {!isDesktop && isMobileDrawerOpen && (
          <div className="fixed inset-x-0 bottom-16 z-40 h-[58vh] max-h-[58vh] bg-slate-900 border-t border-slate-800 shadow-2xl rounded-t-3xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-slate-950/70 shrink-0">
              <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                {activeTab === 'roster'
                  ? gameMeta.rosterLabel
                  : activeTab === 'layers'
                  ? 'Layer Stack & Delete'
                  : 'Shaders'}
              </span>
              <button
                onClick={() => setIsMobileDrawerOpen(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white"
                aria-label="Close drawer"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {renderDrawerContent()}
            </div>
          </div>
        )}

        {/* Mobile Drawer Re-open Button if closed */}
        {!isDesktop && !isMobileDrawerOpen && (
          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="fixed bottom-20 right-4 z-40 p-3 rounded-full bg-sky-600 text-white shadow-2xl flex items-center justify-center border border-sky-400"
            title="Open Menu"
          >
            <ChevronUp className="w-6 h-6" />
          </button>
        )}

        {/* Live Interactive Character Canvas (Spine or Live2D) */}
        <main className="flex-1 min-w-0 min-h-0 h-full relative overflow-hidden bg-slate-950">
          {currentEnvironment.bgUrl && (
            <div
              className="absolute inset-0 bg-cover bg-center pointer-events-none z-0 opacity-80"
              style={{ backgroundImage: `url(${currentEnvironment.bgUrl})` }}
            />
          )}

          {filters.vignette > 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                background: `radial-gradient(circle at center, transparent 40%, rgba(0,0,0,${filters.vignette * 0.9}) 100%)`,
              }}
            />
          )}

          {filters.scanlines && (
            <div
              className="absolute inset-0 pointer-events-none z-20 opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.4) 50%)',
                backgroundSize: '100% 4px',
              }}
            />
          )}

          <div
            className="w-full h-full"
            style={canvasFilterStyle ? { filter: canvasFilterStyle } : undefined}
          >
            <ErrorBoundary resetKey={`${selectedCharacter.id}:${activeCategory}`}>
              <SpineViewer
                character={selectedCharacter}
                category={activeCategory}
                animationSpeed={animationSpeed}
                isPlaying={isPlaying}
                activeAnimation={activeAnimation}
                onAnimationsLoaded={handleAnimationsLoaded}
                onLayersLoaded={handleLayersLoaded}
                hiddenLayers={hiddenLayers}
                onDeleteLayer={handleDeleteLayer}
                onUndoDelete={handleUndoDelete}
                onResetAllLayers={handleResetAllLayers}
                selectedLayerName={selectedLayerName}
                onSelectLayer={handleSelectLayer}
                hasHiddenLayers={hiddenLayers.size > 0}
                onPlayVoice={handlePlayVoice}
                isVoicePlaying={isVoicePlaying}
              />
            </ErrorBoundary>
          </div>

          {/* Floating Control Toolbar */}
          <ControlToolbar
            animations={animations}
            activeAnimation={activeAnimation}
            onSelectAnimation={(a) => setActiveAnimation(a)}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            animationSpeed={animationSpeed}
            onChangeSpeed={(s) => setAnimationSpeed(s)}
            audioLanguage={audioLanguage}
            onToggleLanguage={() => setAudioLanguage((l) => (l === 'JP' ? 'KR' : 'JP'))}
            onPlayVoice={handlePlayVoice}
            isVoicePlaying={isVoicePlaying}
            hasAudio={Boolean(selectedCharacter.audio)}
            onTakeScreenshot={handleTakeScreenshot}
          />
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <MobileBottomBar
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        layerCount={layers.length}
        hiddenCount={hiddenLayers.size}
        activeGame={activeGame}
      />
    </div>
  );
}
