import React, { useState, useMemo, useEffect } from 'react';
import { BD2Character, AnimationCategory, GameId } from '../types/bd2';
import { GAME_MAP, prefetchCharacterModel } from '../utils/bd2Assets';
import {
  Search,
  Film,
  User,
  Heart,
  Sparkles,
  Check,
  ArrowDownUp,
  BookOpen,
} from 'lucide-react';

interface CharacterDrawerProps {
  activeGame: GameId;
  characters: BD2Character[];
  selectedCharacter: BD2Character;
  onSelectCharacter: (char: BD2Character) => void;
  activeCategory: AnimationCategory;
  onSelectCategory: (category: AnimationCategory) => void;
}

type FilterOption = 'all' | 'cutscene' | 'dating' | 'character' | 'archive' | 'skin';

export const CharacterDrawer: React.FC<CharacterDrawerProps> = ({
  activeGame,
  characters,
  selectedCharacter,
  onSelectCharacter,
  activeCategory,
  onSelectCategory,
}) => {
  const gameMeta = GAME_MAP[activeGame];
  const isBd2 = activeGame === 'bd2';
  const isDaiCore = activeGame === 'daicore';
  const isHaze = activeGame === 'hazereverb';
  const isAzurLane = activeGame === 'azurlane';
  const isGirlWars = activeGame === 'girlwars';
  const hasModelCategories = isBd2 || isGirlWars;
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<FilterOption>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [displayCount, setDisplayCount] = useState(25);
  const [showSkills, setShowSkills] = useState(false);

  useEffect(() => {
    setSearchTerm('');
    setFilterType('all');
    setSortOrder('newest');
    setDisplayCount(25);
    setShowSkills(false);
  }, [activeGame]);

  useEffect(() => {
    setDisplayCount(25);
  }, [searchTerm, filterType, sortOrder]);

  useEffect(() => {
    setShowSkills(false);
  }, [selectedCharacter.id]);

  const filteredCharacters = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = characters.filter((c) => {
      if (query) {
        const matchesSearch =
          c.charName.toLowerCase().includes(query) ||
          c.costumeName.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query) ||
          (c.modelType && c.modelType.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      if (filterType === 'cutscene') return c.hasCutscene;
      if (filterType === 'dating') return c.hasDating;
      if (filterType === 'character') return c.modelType === 'character';
      if (filterType === 'archive') return c.modelType === 'archive';
      if (filterType === 'skin') return c.modelType === 'skin';
      return true;
    });

    return filtered.sort((a, b) =>
      sortOrder === 'newest'
        ? a.releaseOrder - b.releaseOrder
        : b.releaseOrder - a.releaseOrder
    );
  }, [characters, searchTerm, filterType, sortOrder]);

  const visibleCharacters = useMemo(() => {
    return filteredCharacters.slice(0, displayCount);
  }, [filteredCharacters, displayCount]);

  const hasSkills = Boolean(selectedCharacter.skills && selectedCharacter.skills.length > 0);

  const searchPlaceholder = isDaiCore
    ? 'Search Alps, Osiris, Lobera, Archive CG...'
    : isHaze
    ? 'Search Lulula, Julius, Alice, Lilith, Heige...'
    : isAzurLane
    ? 'Search New Jersey, Shinano, Musashi, Albion...'
    : activeGame === 'mad'
    ? 'Search MAke Drama characters & scenes...'

    : activeGame === 'girlssymphony'
    ? 'Search Aphrodite, Athena, Live2D skins...'
    : activeGame === 'destinychild'
    ? 'Search Mona, Lisa, Davi, Chang’e...'
    : activeGame === 'girlwars'
    ? 'Search Tsurihime, Maeve, UR EX...'
    : activeGame === 'love3'
    ? 'Search Akira, Iori, Nodoka, Adult...'
    : 'Search Justia, Schera, Lathel, Teresse...';

  return (
    <div className="w-full lg:w-96 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none overflow-hidden">
      {/* Mobile Grab Bar */}
      <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto my-2 shrink-0 lg:hidden" />

      {/* Header */}
      <div className="p-3.5 sm:p-4 border-b border-slate-800 flex flex-col gap-3 shrink-0 bg-slate-900/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className={`w-4 h-4 ${gameMeta.accentText}`} />
            <h2 className="text-sm font-bold text-white tracking-wide">
              {gameMeta.rosterLabel}
            </h2>
          </div>
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full border text-sky-400 bg-sky-950/80 border-sky-800/60">
            {characters.length} Models
          </span>
        </div>

        {/* Search */}
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
          />
        </div>

        {/* Filter & Sort Controls */}
        <div className="flex items-center justify-between gap-1.5 text-xs flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterType('all')}
              className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all ${
                filterType === 'all'
                  ? 'bg-sky-600 text-white font-bold'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>

            {isBd2 && (
              <>
                <button
                  onClick={() => setFilterType('cutscene')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'cutscene'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Cutscene</span>
                </button>
                <button
                  onClick={() => setFilterType('dating')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'dating'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  <span>Dating</span>
                </button>
              </>
            )}

            {isDaiCore && (
              <>
                <button
                  onClick={() => setFilterType('character')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'character'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>Skins</span>
                </button>
                <button
                  onClick={() => setFilterType('archive')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'archive'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Archive CG</span>
                </button>
              </>
            )}

            {(isHaze || isAzurLane) && (
              <>
                <button
                  onClick={() => setFilterType('skin')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'skin'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Skins</span>
                </button>
                <button
                  onClick={() => setFilterType('character')}
                  className={`min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 ${
                    filterType === 'character'
                      ? 'bg-sky-600 text-white font-bold'
                      : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <User className="w-3.5 h-3.5" />
                  <span>{isHaze ? 'Drivers' : 'Ships'}</span>
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => setSortOrder((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
            title="Toggle sort order"
            className="min-h-[36px] px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1 bg-slate-950 border border-slate-800 text-sky-400 hover:border-sky-500/60"
          >
            <ArrowDownUp className="w-3 h-3" />
            <span>{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
          </button>
        </div>
      </div>

      {/* Active Character Model Category Switcher */}
      <div className="p-3 bg-slate-950/80 border-b border-slate-800/80 flex flex-col gap-2 shrink-0">
        <span className="text-[11px] font-semibold text-slate-400 flex items-center justify-between gap-2">
          <span className="truncate">
            Active: {selectedCharacter.charName} ({selectedCharacter.costumeName})
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasSkills && (
              <button
                onClick={() => setShowSkills((s) => !s)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors flex items-center gap-1 ${
                  showSkills
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <BookOpen className="w-3 h-3" />
                <span>Skills ({selectedCharacter.skills!.length})</span>
              </button>
            )}
            <span className="text-[10px] font-mono text-sky-400">ID: {selectedCharacter.id}</span>
          </div>
        </span>

        {hasModelCategories ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs font-semibold">
            <button
              onClick={() => onSelectCategory('character')}
              onMouseEnter={() => prefetchCharacterModel(selectedCharacter, 'character')}
              className={`min-h-[36px] py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                activeCategory === 'character'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Standing</span>
            </button>

            <button
              onClick={() => onSelectCategory('cutscene')}
              onMouseEnter={() => {
                if (selectedCharacter.hasCutscene) {
                  prefetchCharacterModel(selectedCharacter, 'cutscene');
                }
              }}
              disabled={!selectedCharacter.hasCutscene}
              className={`min-h-[36px] py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed ${
                activeCategory === 'cutscene'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Cutscene</span>
            </button>

            {selectedCharacter.hasDating && (
              <button
                onClick={() => onSelectCategory('dating')}
                onMouseEnter={() => prefetchCharacterModel(selectedCharacter, 'dating')}
                className={`min-h-[36px] py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeCategory === 'dating'
                    ? 'bg-sky-600 text-white shadow-md'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Heart className="w-3.5 h-3.5" />
                <span>Dating</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-[11px] text-slate-300">
            <span className="font-semibold">
              {selectedCharacter.live2dModelUrl ? 'Interactive Live2D Model' : 'Interactive Spine Model'}
            </span>
            <span className="font-mono text-sky-300">
              {selectedCharacter.releaseLabel}
            </span>
          </div>
        )}

        {showSkills && hasSkills && (
          <div className="mt-1 max-h-36 overflow-y-auto rounded-xl bg-slate-900/90 border border-slate-800 p-2.5 flex flex-col gap-2 text-[11px]">
            {selectedCharacter.skills!.map((sk, idx) => (
              <div key={`${sk.name}-${idx}`} className="flex flex-col gap-0.5">
                <span className="font-bold text-amber-300">{sk.name}</span>
                <p className="text-slate-300 leading-relaxed whitespace-pre-line">{sk.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Character Cards List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {filteredCharacters.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No character found matching "{searchTerm}"
          </div>
        ) : (
          <>
            {visibleCharacters.map((char) => {
              const isSelected = char.id === selectedCharacter.id;
              return (
                <div
                  key={char.id}
                  onClick={() => onSelectCharacter(char)}
                  onMouseEnter={() => prefetchCharacterModel(char, 'character')}
                  onFocus={() => prefetchCharacterModel(char, 'character')}
                  className={`min-h-[64px] p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                    isSelected
                      ? 'bg-slate-800 border-sky-400 shadow-lg shadow-sky-500/10 ring-1 ring-sky-400'
                      : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/40 hover:border-slate-700'
                  }`}
                >
                  {/* Official Icon Thumbnail or Styled Emblem */}
                  <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative">
                    {char.iconUrl ? (
                      <img
                        src={char.iconUrl}
                        alt={char.charName}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const img = e.target as HTMLImageElement;
                          if (!img.src.endsWith('icon_charunknown.png')) {
                            img.src = '/char_icons/icon_charunknown.png';
                          }
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        className={`w-full h-full bg-gradient-to-tr flex items-center justify-center text-white text-xs font-black ${gameMeta.accentGradient}`}
                      >
                        {char.charName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    {hasModelCategories && char.hasCutscene && (
                      <span className="absolute bottom-0 right-0 p-0.5 bg-sky-600 rounded-tl text-[8px] text-white">
                        <Film className="w-2.5 h-2.5" />
                      </span>
                    )}
                    {isDaiCore && char.modelType === 'archive' && (
                      <span className="absolute bottom-0 right-0 p-0.5 bg-fuchsia-600 rounded-tl text-[8px] text-white">
                        <Film className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>

                  {/* Character Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h3 className="text-xs font-bold text-white truncate">{char.charName}</h3>
                        {char.displayMode === 'new' && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold uppercase tracking-wider shrink-0 leading-none">
                            New
                          </span>
                        )}
                        {char.uncensored && (
                          <span className="px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/40 text-[9px] font-bold uppercase tracking-wider shrink-0 leading-none">
                            Uncensored
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {char.releaseLabel}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 truncate">{char.costumeName}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 truncate">
                      <span className="font-mono text-slate-500">#{char.id}</span>
                      {hasModelCategories ? (
                        <>
                          {(char.hasCutscene || char.hasDating) && <span>·</span>}
                          {char.hasCutscene && <span className="text-sky-400">{isBd2 ? 'Skill Cutscene' : 'Cutscene'}</span>}
                          {char.hasCutscene && char.hasDating && <span>·</span>}
                          {char.hasDating && <span className="text-pink-400">Dating Scene</span>}
                        </>
                      ) : (
                        <>
                          {char.modelType && (
                            <>
                              <span>·</span>
                              <span className="text-sky-300 capitalize">{char.modelType}</span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-sky-500 flex items-center justify-center text-white shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              );
            })}

            {visibleCharacters.length < filteredCharacters.length && (
              <button
                onClick={() => setDisplayCount((prev) => prev + 30)}
                className="w-full py-2.5 my-2 rounded-xl bg-slate-950 border border-slate-800 text-sky-400 hover:text-sky-300 text-xs font-bold transition-colors"
              >
                Load More ({filteredCharacters.length - visibleCharacters.length} remaining)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
