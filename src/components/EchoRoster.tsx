import React, { useEffect, useMemo, useState } from 'react';
import { BD2Character } from '../types/bd2';
import { Search, ChevronDown, ChevronRight, Shirt, User, Sparkles, X } from 'lucide-react';

interface EchoRosterProps {
  characters: BD2Character[];
  selectedCharacter: BD2Character;
  onSelectCharacter: (char: BD2Character) => void;
}

type Section = 'characters' | 'npc' | 'collab' | 'battle' | 'scene' | 'unnamed';

const SECTION_LABEL: Record<Section, string> = {
  characters: 'Characters',
  npc: 'NPCs',
  collab: 'Collab',
  battle: 'Battle',
  scene: 'Scenes',
  unnamed: 'Unnamed',
};

const RARITY_TONE: Record<string, string> = {
  SSR: 'text-amber-300',
  UR: 'text-fuchsia-300',
  MR: 'text-rose-300',
  SR: 'text-violet-300',
  R: 'text-sky-300',
};

function sectionFor(char: BD2Character): Section {
  if (char.kind === 'npc') return 'npc';
  if (char.kind === 'collab') return 'collab';
  if (char.kind === 'battle') return 'battle';
  if (char.kind === 'scene') return 'scene';
  if (char.named === false || (char.confidence === 'none' && !char.faction)) return 'unnamed';
  return 'characters';
}

interface Group {
  baseId: string;
  representative: BD2Character;
  members: BD2Character[];
  section: Section;
}

export const EchoRoster: React.FC<EchoRosterProps> = ({
  characters,
  selectedCharacter,
  onSelectCharacter,
}) => {
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState<string>('all');
  const [faction, setFaction] = useState<string>('all');
  const [section, setSection] = useState<Section>('characters');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const byBase = new Map<string, BD2Character[]>();
    for (const char of characters) {
      const key = char.baseId || char.spine;
      const list = byBase.get(key) ?? [];
      list.push(char);
      byBase.set(key, list);
    }

    const out: Group[] = [];
    for (const [baseId, members] of byBase) {
      const sorted = [...members].sort((a, b) => (a.costumeIndex ?? 0) - (b.costumeIndex ?? 0));
      const representative = sorted[0];
      out.push({ baseId, representative, members: sorted, section: sectionFor(representative) });
    }
    out.sort((a, b) => {
      const an = a.representative.charName.toLowerCase();
      const bn = b.representative.charName.toLowerCase();
      if (a.section !== b.section) return 0;
      return an.localeCompare(bn) || a.baseId.localeCompare(b.baseId);
    });
    return out;
  }, [characters]);

  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) if (g.representative.rarity) set.add(g.representative.rarity);
    return ['all', ...['UR', 'MR', 'SSR', 'SR', 'R'].filter((r) => set.has(r)), ...set].filter(
      (v, i, arr) => arr.indexOf(v) === i
    );
  }, [groups]);

  const factions = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) if (g.representative.faction) set.add(g.representative.faction);
    return ['all', ...Array.from(set).sort()];
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      if (q) {
        const haystack = [
          g.representative.charName,
          g.representative.nameZh,
          g.baseId,
          ...(g.representative.aliases ?? []),
          ...g.members.map((m) => m.spine),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (rarity !== 'all' && g.representative.rarity !== rarity) return false;
      if (faction !== 'all' && g.representative.faction !== faction) return false;
      return true;
    });
  }, [groups, query, rarity, faction]);

  const counts = useMemo(() => {
    const map = new Map<Section, number>();
    for (const g of groups) map.set(g.section, (map.get(g.section) ?? 0) + 1);
    return map;
  }, [groups]);

  const visible = filtered.filter((g) => g.section === section);

  useEffect(() => {
    const base = selectedCharacter.baseId || selectedCharacter.spine;
    setExpanded((prev) => (prev.has(base) ? prev : new Set(prev).add(base)));
  }, [selectedCharacter]);

  const toggle = (baseId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });

  const availableSections = (Object.keys(SECTION_LABEL) as Section[]).filter(
    (s) => (counts.get(s) ?? 0) > 0
  );

  return (
    <div className="w-full lg:w-96 h-full bg-slate-900 border-r border-slate-800/90 flex flex-col shrink-0 select-none overflow-hidden">
      <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto my-2 shrink-0 lg:hidden" />

      <div className="px-4 pt-3.5 pb-2.5 border-b border-slate-800/90 flex flex-col gap-2.5 shrink-0 bg-slate-900">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-tight">Echocalypse</h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {visible.length} / {counts.get(section) ?? 0}
          </span>
        </div>

        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, alias, or model ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-950/90 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/80 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2 p-0.5 rounded-md text-slate-500 hover:text-slate-200"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <select
            value={rarity}
            onChange={(e) => setRarity(e.target.value)}
            className="min-h-[32px] px-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500/80"
          >
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r === 'all' ? 'All rarities' : r}
              </option>
            ))}
          </select>
          <select
            value={faction}
            onChange={(e) => setFaction(e.target.value)}
            className="min-h-[32px] px-2.5 rounded-lg bg-slate-950/90 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500/80"
          >
            {factions.map((f) => (
              <option key={f} value={f}>
                {f === 'all' ? 'All factions' : f}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {availableSections.map((s) => {
            const active = section === s;
            return (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`h-7 px-2 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1 shrink-0 ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <span>{SECTION_LABEL[s]}</span>
                <span className="text-[10px] font-mono opacity-65 tabular-nums">{counts.get(s)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
        {visible.length === 0 ? (
          <div className="py-14 px-6 text-center text-xs text-slate-500">
            No models match the current filter.
          </div>
        ) : (
          visible.map((group) => {
            const char = group.representative;
            const isOpen = expanded.has(group.baseId);
            const isActiveGroup = (selectedCharacter.baseId || selectedCharacter.spine) === group.baseId;
            return (
              <div
                key={group.baseId}
                className={`transition-colors ${
                  isActiveGroup ? 'bg-emerald-950/25' : 'hover:bg-slate-800/35'
                }`}
              >
                <div
                  onClick={() => onSelectCharacter(char)}
                  className={`min-h-[60px] px-4 py-2.5 flex items-center gap-3 cursor-pointer border-l-2 ${
                    isActiveGroup ? 'border-emerald-400' : 'border-transparent'
                  }`}
                >
                  <div className="w-11 h-11 rounded-xl bg-slate-950 border border-slate-800/90 overflow-hidden shrink-0">
                    <Portrait char={char} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-xs font-bold text-white truncate">{char.charName}</h3>
                      {char.rarity && (
                        <span
                          className={`text-[10px] font-mono font-bold shrink-0 ${
                            RARITY_TONE[char.rarity] ?? 'text-slate-400'
                          }`}
                        >
                          {char.rarity}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {[char.nameZh, char.faction || (char.named === false ? `#${group.baseId}` : ''), char.role]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  {group.members.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(group.baseId);
                      }}
                      className="h-7 px-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 flex items-center gap-1 text-[10px] font-mono tabular-nums shrink-0 transition-colors"
                      aria-label={isOpen ? 'Hide costumes' : 'Show costumes'}
                    >
                      <span>{group.members.length}</span>
                      {isOpen ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {isOpen && group.members.length > 1 && (
                  <div className="px-4 pb-2.5 pl-[4.25rem] flex flex-col gap-1">
                    {group.members.map((member) => {
                      const active = member.id === selectedCharacter.id;
                      return (
                        <button
                          key={member.id}
                          onClick={() => onSelectCharacter(member)}
                          className={`min-h-[32px] px-2.5 rounded-lg flex items-center gap-2 text-left transition-colors ${
                            active
                              ? 'bg-emerald-600/90 text-white'
                              : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {member.costumeIndex === 0 ? (
                            <User className="w-3 h-3 shrink-0 opacity-75" />
                          ) : (
                            <Shirt className="w-3 h-3 shrink-0 opacity-75" />
                          )}
                          <span className="text-[11px] font-medium truncate">
                            {member.costumeName}
                          </span>
                          <span className="ml-auto text-[10px] font-mono opacity-65 shrink-0">
                            {member.modelType === 'character' ? 'base' : member.modelType}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const Portrait: React.FC<{ char: BD2Character }> = ({ char }) => {
  const [failed, setFailed] = useState(false);

  if (failed || !char.iconUrl) {
    return (
      <div className="w-full h-full bg-gradient-to-tr from-emerald-700 to-teal-800 flex items-center justify-center text-white text-[10px] font-black">
        {char.charName.replace(/[^A-Za-z\u4e00-\u9fff]/g, '').slice(0, 2) || '?'}
      </div>
    );
  }

  return (
    <img
      src={char.iconUrl}
      alt={char.charName}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover object-top"
    />
  );
};
