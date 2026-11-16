import React, { useEffect, useMemo, useState } from 'react';
import { BD2Character } from '../types/bd2';
import { Search, ChevronDown, ChevronRight, Shirt, User, Film, Sparkles, AlertCircle } from 'lucide-react';

/**
 * Echocalypse roster browser.
 *
 * The catalog models every exported spine, but what people actually browse is
 * *characters*. So this groups exports under their base character: one card per
 * character, showing the portrait, name, rarity and faction, with a collapsed
 * row of that character's costumes underneath. Unnamed exports are kept - they
 * are real models - but they live in their own clearly-labelled section instead
 * of being presented as if they were identified characters.
 */
interface EchoRosterProps {
  characters: BD2Character[];
  selectedCharacter: BD2Character;
  onSelectCharacter: (char: BD2Character) => void;
}

type Section = 'characters' | 'npc' | 'collab' | 'battle' | 'scene' | 'unnamed';

const SECTION_LABEL: Record<Section, string> = {
  characters: 'Characters',
  npc: 'Story NPCs',
  collab: 'Collab Guests',
  battle: 'Battle Variants',
  scene: 'Scene Assets',
  unnamed: 'Unnamed (unreleased)',
};

const RARITY_TONE: Record<string, string> = {
  SSR: 'text-amber-300 bg-amber-500/15 border-amber-500/40',
  UR: 'text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/40',
  MR: 'text-rose-300 bg-rose-500/15 border-rose-500/40',
  SR: 'text-violet-300 bg-violet-500/15 border-violet-500/40',
  R: 'text-sky-300 bg-sky-500/15 border-sky-500/40',
};

const FACTION_TONE: Record<string, string> = {
  Bifrost: 'text-cyan-300',
  Empire: 'text-rose-300',
  Nebu: 'text-emerald-300',
  Eastrise: 'text-amber-300',
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

  // Group by base character; the base spine (costumeIndex 0) represents the group.
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
      // Named characters alphabetically, everything else by id.
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

  // Auto-expand the group of whatever is selected so its costumes are reachable.
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

  return (
    <div className="w-full lg:w-96 h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 select-none overflow-hidden">
      <div className="w-10 h-1.5 bg-slate-700 rounded-full mx-auto my-2 shrink-0 lg:hidden" />

      <div className="p-3.5 sm:p-4 border-b border-slate-800 flex flex-col gap-3 shrink-0 bg-slate-900/90">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white tracking-wide">Echocalypse</h2>
          </div>
          <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full border text-emerald-400 bg-emerald-950/80 border-emerald-800/60">
            {counts.get('characters') ?? 0} Characters
          </span>
        </div>

        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search Levia, Valiant, 李瑾, or an id…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
          <select
            value={rarity}
            onChange={(e) => setRarity(e.target.value)}
            className="min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500"
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
            className="min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            {factions.map((f) => (
              <option key={f} value={f}>
                {f === 'all' ? 'All factions' : f}
              </option>
            ))}
          </select>
          <span className="ml-auto text-slate-500 font-mono">
            {visible.length} shown
          </span>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {(Object.keys(SECTION_LABEL) as Section[])
            .filter((s) => (counts.get(s) ?? 0) > 0)
            .map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  section === s
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {SECTION_LABEL[s]} <span className="opacity-60">{counts.get(s)}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {visible.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Nothing matches “{query}”
          </div>
        ) : (
          visible.map((group) => {
            const char = group.representative;
            const isOpen = expanded.has(group.baseId);
            const isActiveGroup = (selectedCharacter.baseId || selectedCharacter.spine) === group.baseId;
            return (
              <div
                key={group.baseId}
                className={`rounded-2xl border transition-colors ${
                  isActiveGroup
                    ? 'bg-slate-800/70 border-emerald-500/60'
                    : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div
                  onClick={() => onSelectCharacter(char)}
                  className="min-h-[64px] p-2.5 flex items-center gap-3 cursor-pointer"
                >
                  <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 relative">
                    <Portrait char={char} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-xs font-bold text-white truncate">{char.charName}</h3>
                      {char.rarity && (
                        <span
                          className={`px-1 py-0.5 rounded border text-[9px] font-bold leading-none shrink-0 ${
                            RARITY_TONE[char.rarity] ?? 'text-slate-300 bg-slate-700/40 border-slate-600'
                          }`}
                        >
                          {char.rarity}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      {char.nameZh ? `${char.nameZh} · ` : ''}
                      {char.faction || (char.named === false ? 'name unknown' : '')}
                      {char.role ? ` · ${char.role}` : ''}
                    </p>
                    <p className="text-[10px] font-mono text-slate-600 truncate">
                      #{group.baseId} · {group.members.length}{' '}
                      {group.members.length === 1 ? 'export' : 'exports'}
                    </p>
                  </div>

                  {group.members.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(group.baseId);
                      }}
                      className="w-7 h-7 rounded-lg hover:bg-slate-700/60 text-slate-400 flex items-center justify-center shrink-0"
                      aria-label={isOpen ? 'Hide costumes' : 'Show costumes'}
                    >
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>

                {isOpen && group.members.length > 1 && (
                  <div className="px-2.5 pb-2.5 flex flex-col gap-1">
                    {group.members.map((member) => {
                      const active = member.id === selectedCharacter.id;
                      return (
                        <button
                          key={member.id}
                          onClick={() => onSelectCharacter(member)}
                          className={`min-h-[34px] px-2.5 rounded-xl flex items-center gap-2 text-left transition-colors ${
                            active
                              ? 'bg-emerald-600/90 text-white'
                              : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          {member.costumeIndex === 0 ? (
                            <User className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          ) : (
                            <Shirt className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          )}
                          <span className="text-[11px] font-semibold truncate">
                            {member.costumeName}
                          </span>
                          <span className="ml-auto text-[10px] font-mono opacity-60 shrink-0">
                            {member.modelType === 'character' ? 'base' : member.modelType}
                            {member.hasBackdropSpine ? ' · bg' : ''}
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
      <div className="w-full h-full bg-gradient-to-tr from-emerald-600 to-teal-700 flex items-center justify-center text-white text-[10px] font-black">
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
