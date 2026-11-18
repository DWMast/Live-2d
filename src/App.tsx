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
import { SpineViewer, SpineViewerHandle } from './components/SpineViewer';
import { Live2DViewer } from './components/Live2DViewer';
import { EchoSpineViewer } from './components/EchoSpineViewer';
import { EchoRoster } from './components/EchoRoster';
import { CinematicPlayer, CinematicLauncher } from './components/CinematicPlayer';
import { ShotSequence } from './types/shot';
import { buildCharacterSequence, buildDatingSequence } from './utils/shotSequencer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CharacterDrawer } from './components/CharacterDrawer';
import { LayerDrawer } from './components/LayerDrawer';
import { EffectsPanel } from './components/EffectsPanel';
import { ControlToolbar } from './components/ControlToolbar';
import { MobileBottomBar } from './components/MobileBottomBar';
import {
  RenderDiagnostics,
  DEFAULT_DIAGNOSTIC_TOGGLES,
  DiagnosticToggles,
  PoseShotSummary,
} from './components/RenderDiagnostics';
import { ChevronDown, ChevronUp, Bug } from 'lucide-react';

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

  // Cinematic shot sequencing (BD2-style standing -> dialogue framing)
  const viewerRef = useRef<SpineViewerHandle | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [modelFrame, setModelFrame] = useState<
    { x: number; y: number; width: number; height: number } | null
  >(null);
  const [activeSequence, setActiveSequence] = useState<ShotSequence | null>(null);

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
  /**
   * Neutral by default.
   *
   * These used to ship as contrast 1.05 / saturation 1.1 / vignette 0.2. Applied
   * as a CSS filter over the whole canvas, `contrast(1.05)` pushes every dark
   * texel toward black, and the vignette lays a radial black gradient straight
   * over the character. On art that already has shaded creases (under brows, in
   * eye sockets, between fingers) the two compound into hard black marks that
   * look like a rendering bug but are added *on top of* the model. Defaults are
   * neutral so the raw model is what you see until you opt in.
   */
  const [filters, setFilters] = useState<ScreenFilters>({
    bloom: 0,
    vignette: 0,
    chromaticAberration: 0,
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    scanlines: false,
    colorFilter: 'none',
  });

  // On-device render diagnostics (see RenderDiagnostics.tsx for why these exist)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagToggles, setDiagToggles] = useState<DiagnosticToggles>(DEFAULT_DIAGNOSTIC_TOGGLES);
  const handleChangeDiagToggles = useCallback((updates: Partial<DiagnosticToggles>) => {
    setDiagToggles((prev) => ({ ...prev, ...updates }));
  }, []);
  const [diagShots, setDiagShots] = useState<PoseShotSummary[]>([]);
  const [diagNotice, setDiagNotice] = useState<string | null>(null);

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

  // Cinematic sequences: drive the camera through a scripted list of shots
  const handlePlayCutscene = useCallback(() => {
    setActiveSequence(buildCharacterSequence(selectedCharacter.charName));
  }, [selectedCharacter]);

  const handlePlayDating = useCallback(() => {
    setActiveSequence(buildDatingSequence(selectedCharacter.charName));
  }, [selectedCharacter]);

  const handleExitCinematic = useCallback(() => {
    setActiveSequence(null);
  }, []);

  // Any character/category change invalidates a running sequence
  useEffect(() => {
    setActiveSequence(null);
    setModelFrame(null);
  }, [selectedCharacter.id, activeCategory]);

  // Download Transparent PNG Screenshot from the active WebGL canvas
  const handleTakeScreenshot = useCallback(() => {
    const canvas = (viewportRef.current?.querySelector('canvas.spine-player-canvas') ||
      viewportRef.current?.querySelector('canvas') ||
      document.querySelector('canvas.spine-player-canvas')) as HTMLCanvasElement | null;
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
    if (activeTab === 'roster' && activeGame === 'echocalypse') {
      return (
        <EchoRoster
          characters={activeRoster}
          selectedCharacter={selectedCharacter}
          onSelectCharacter={handleSelectCharacter}
        />
      );
    }
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

  // Compute non-destructive CSS filter string for the WebGL canvas only.
  // The diagnostics "raw canvas" switch bypasses all of it.
  const canvasFilterStyle = React.useMemo(() => {
    if (diagToggles.rawCanvas) return undefined;
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
  }, [filters, diagToggles.rawCanvas]);

  /**
   * Human-readable snapshot of everything that could plausibly darken the model.
   * Reading the *live* DOM rather than React state means the user's report
   * reflects what the browser is actually compositing.
   */
  const diagnosticReport = React.useMemo(() => {
    const lines: string[] = [];
    const canvas =
      viewportRef.current?.querySelector('canvas') ??
      document.querySelector('canvas');
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 0;

    lines.push(
      `character : ${selectedCharacter?.charName ?? '?'} / ${selectedCharacter?.costumeName ?? '?'} (${selectedCharacter?.id ?? '?'})`
    );
    lines.push(`game      : ${activeGame}`);
    lines.push(`category  : ${activeCategory}`);
    lines.push(`dpr       : ${dpr}`);
    if (canvas) {
      lines.push(`canvas css: ${canvas.clientWidth}x${canvas.clientHeight}`);
      lines.push(`canvas buf: ${canvas.width}x${canvas.height}`);
      const eff = canvas.width / Math.max(1, canvas.clientWidth);
      lines.push(`scale     : ${eff.toFixed(2)}x (${eff < 1.5 ? 'LOW - likely pixelation' : 'ok'})`);
    } else {
      lines.push('canvas    : not found');
    }
    lines.push(`cssFilter : ${diagToggles.rawCanvas ? 'BYPASSED (raw canvas)' : canvasFilterStyle ?? 'none'}`);
    lines.push(`vignette  : ${diagToggles.rawCanvas ? 'off (raw)' : filters.vignette.toFixed(2)}`);
    lines.push(`scanlines : ${filters.scanlines ? 'on' : 'off'}`);
    lines.push(`hidden    : ${hiddenLayers.size} layer(s)`);
    lines.push('--- toggles ---');
    (Object.keys(diagToggles) as Array<keyof DiagnosticToggles>).forEach((k) => {
      lines.push(`${k.padEnd(12)}: ${diagToggles[k] ? 'ON' : 'off'}`);
    });
    return lines.join('\n');
  }, [
    selectedCharacter,
    activeGame,
    activeCategory,
    diagToggles,
    canvasFilterStyle,
    filters.vignette,
    filters.scanlines,
    hiddenLayers.size,
  ]);

  /**
   * Capture the character as it is right now.
   *
   * Each shot records the pose it was taken at, because "the marks appear when
   * zoomed in" and "the marks appear at default zoom" are different bugs and the
   * only way to tell them apart later is to have the numbers attached.
   */
  const handleCaptureShot = useCallback(() => {
    const shot = viewerRef.current?.capturePoseShot();
    if (!shot) {
      setDiagNotice('Nothing to capture yet - wait for the character to load.');
      return;
    }
    const pose = viewerRef.current?.getPose();
    const name = selectedCharacter?.charName ?? 'character';
    const detail = [
      `${shot.image.width}x${shot.image.height}px @${shot.pixelRatio}x`,
      `model ${selectedCharacter?.id ?? '?'}/${activeCategory}`,
      pose ? `zoom ${pose.zoom.toFixed(3)}` : 'zoom ?',
      `atlas ${shot.atlasPages.map((p) => p.split('/').pop()).join(', ') || '?'}`,
      `mipmaps ${diagToggles.noMipmaps ? 'off' : 'on'}`,
      `filter ${diagToggles.rawCanvas ? 'raw' : 'css'}`,
    ].join(' · ');
    setDiagShots((prev) => [
      ...prev.slice(-5),
      { label: `${name} — ${new Date().toLocaleTimeString()}`, dataUrl: shot.dataUrl, detail },
    ]);
    setDiagNotice(null);
  }, [selectedCharacter, activeCategory, diagToggles.noMipmaps, diagToggles.rawCanvas]);

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
            className="fixed bottom-20 left-4 z-40 h-10 px-3.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 text-slate-100 shadow-2xl flex items-center gap-1.5 border border-slate-700/80 backdrop-blur-md text-xs font-semibold"
            title="Open Panel"
          >
            <ChevronUp className="w-4 h-4 text-sky-400" />
            <span>{activeTab === 'roster' ? 'Roster' : activeTab === 'layers' ? 'Layers' : 'VFX'}</span>
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

          {filters.vignette > 0 && !diagToggles.rawCanvas && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{
                background: `radial-gradient(circle at center, transparent 40%, rgba(0,0,0,${filters.vignette * 0.9}) 100%)`,
              }}
            />
          )}

          {filters.scanlines && !diagToggles.rawCanvas && (
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
            ref={viewportRef}
            className="w-full h-full"
            style={canvasFilterStyle ? { filter: canvasFilterStyle } : undefined}
          >
            <ErrorBoundary resetKey={`${selectedCharacter.id}:${activeCategory}`}>
              {activeGame === 'girlssymphony' ? (
                <Live2DViewer
                  character={selectedCharacter}
                  isPlaying={isPlaying}
                  animationSpeed={animationSpeed}
                  activeAnimation={activeAnimation}
                  onAnimationsLoaded={handleAnimationsLoaded}
                  onLayersLoaded={handleLayersLoaded}
                />
              ) : activeGame === 'echocalypse' ? (
                <EchoSpineViewer
                  ref={viewerRef as unknown as React.Ref<never>}
                  character={selectedCharacter}
                  isPlaying={isPlaying}
                  animationSpeed={animationSpeed}
                  activeAnimation={activeAnimation}
                  onAnimationsLoaded={handleAnimationsLoaded}
                  onLayersLoaded={handleLayersLoaded}
                  hiddenLayers={hiddenLayers}
                  onDeleteLayer={handleDeleteLayer}
                  onUndoDelete={handleUndoDelete}
                  onResetAllLayers={handleResetAllLayers}
                  selectedLayerName={selectedLayerName}
                  onSelectLayer={handleSelectLayer}
                />
              ) : (
              <SpineViewer
                ref={viewerRef}
                cameraLocked={activeSequence !== null}
                onReady={setModelFrame}
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
                diagnosticNoMipmaps={diagToggles.noMipmaps}
                diagnosticFlatShading={diagToggles.flatShading}
              />
              )}
            </ErrorBoundary>
          </div>

          {/* Echocalypse: switch outfits / variants without overlapping camera controls */}
          {activeGame === 'echocalypse' &&
            (selectedCharacter.costumes?.length ?? 0) > 1 && (
              <div className="absolute top-3 left-3 sm:left-1/2 sm:-translate-x-1/2 z-20 max-w-[calc(100%-8.75rem)] sm:max-w-[calc(100%-18rem)] overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-800/90 backdrop-blur-md shadow-xl w-max">
                  {selectedCharacter.costumes!.map((modelId) => {
                    const member = activeRoster.find((c) => c.spine === modelId);
                    if (!member) return null;
                    const active = member.id === selectedCharacter.id;
                    return (
                      <button
                        key={modelId}
                        onClick={() => handleSelectCharacter(member)}
                        className={`h-8 px-3 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                          active
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                        }`}
                      >
                        {member.costumeIndex === 0 ? 'Base' : member.costumeName}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Render diagnostics launcher + panel */}
          {!diagnosticsOpen && activeGame !== 'echocalypse' && (
            <button
              onClick={() => setDiagnosticsOpen(true)}
              className="absolute top-4 left-4 z-40 min-h-[36px] px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-amber-300 text-[11px] font-bold flex items-center gap-1.5 backdrop-blur-sm"
              title="Open render diagnostics"
            >
              <Bug className="w-3.5 h-3.5" />
              Diagnose
            </button>
          )}
          <RenderDiagnostics
            open={diagnosticsOpen}
            onClose={() => setDiagnosticsOpen(false)}
            toggles={diagToggles}
            onChangeToggles={handleChangeDiagToggles}
            shots={diagShots}
            onCapture={handleCaptureShot}
            onClearShots={() => setDiagShots([])}
            reportText={diagNotice ? `${diagNotice}\n\n${diagnosticReport}` : diagnosticReport}
          />

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

          {activeSequence ? (
            <CinematicPlayer
              sequence={activeSequence}
              viewerRef={viewerRef}
              viewportRef={viewportRef}
              modelFrame={modelFrame}
              onExit={handleExitCinematic}
            />
          ) : (
            <CinematicLauncher
              onPlayCutscene={handlePlayCutscene}
              onPlayDating={handlePlayDating}
              hasCutscene={activeGame === 'bd2'}
              hasDating={activeGame === 'bd2'}
            />
          )}
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
