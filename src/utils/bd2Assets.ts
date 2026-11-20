import characterMap from '../data/bd2_character_list';
import { SKIN_RELEASE_META } from '../data/bd2_skin_order';
import { BD2Character, AnimationCategory, GameId, GameDescriptor } from '../types/bd2';
import { prefetchSpineAssets } from './spineAssetCache';

export const CDN_SPINE_BASE = '/api/bd2-spine';
export const CDN_ICON_BASE = '/char_icons';
export const CDN_AUDIO_BASE = '/api/bd2-audio';
export const DAICORE_BASE = '/api/daicore';
export const HAZE_SPINE_BASE = '/api/haze-spine';
export const AL_SPINE_BASE = '/api/al-spine';
export const AL_ICON_BASE = '/api/al-icon';
export const MAD_SPINE_BASE = '/api/mad-spine';
export const MAD_ICON_BASE = '/api/mad-icon';
export const GS_LIVE2D_BASE = '/api/gs-live2d';
export const ECHO_SPINE_BASE = '/api/echo-spine';
export const ECHO_ICON_BASE = '/api/echo-pic';
export const DC_LIVE2D_BASE = '/api/dc-live2d';

export const GAME_LIST: GameDescriptor[] = [
  {
    id: 'bd2',
    shortCode: 'BD2',
    name: 'Brown Dust 2',
    studioName: 'BD2 Live2D & Spine Studio',
    rosterLabel: 'BD2 Roster',
    engineLabel: 'Spine 4.1 · 236 Skins',
    accentGradient: 'from-sky-500 to-indigo-600 shadow-sky-500/20',
    accentText: 'text-sky-400',
  },
  {
    id: 'daicore',
    shortCode: 'DC',
    name: 'Daiblos Core',
    studioName: 'Daiblos Core Spine Studio',
    rosterLabel: 'Daiblos Core Roster',
    engineLabel: 'Spine 4.2 · 451 Skins & CGs',
    accentGradient: 'from-fuchsia-500 to-rose-600 shadow-fuchsia-500/20',
    accentText: 'text-fuchsia-400',
  },
  {
    id: 'hazereverb',
    shortCode: 'HZ',
    name: 'Haze Reverb',
    studioName: 'Haze Reverb Spine Studio',
    rosterLabel: 'Haze Reverb Roster',
    engineLabel: 'Spine 3.8 HD · 405 Drivers & Skins',
    accentGradient: 'from-rose-500 to-amber-500 shadow-rose-500/20',
    accentText: 'text-rose-400',
  },
  {
    id: 'azurlane',
    shortCode: 'AL',
    name: 'Azur Lane Dynamic',
    studioName: 'Azur Lane Dynamic Spine Studio',
    rosterLabel: 'Azur Lane Dynamic Roster',
    engineLabel: 'Spine 3.8 HD · 119 Dynamic Spines',
    accentGradient: 'from-cyan-500 to-indigo-600 shadow-cyan-500/20',
    accentText: 'text-cyan-400',
  },
  {
    id: 'mad',
    shortCode: 'MAD',
    name: 'MAke Drama: MAD',
    studioName: 'MAke Drama Spine Studio',
    rosterLabel: 'MAD Roster',
    engineLabel: 'Spine 4.1 · 145 Skins',
    accentGradient: 'from-violet-500 to-pink-600 shadow-violet-500/20',
    accentText: 'text-violet-400',
  },
  {
    id: 'girlssymphony',
    shortCode: 'DGS',
    name: 'Dragon & Girls Symphony',
    studioName: 'Idle Huntress Live2D Studio',
    rosterLabel: 'DGS Roster',
    engineLabel: 'Cubism 4 Live2D · 398 Skins',
    accentGradient: 'from-amber-500 to-rose-600 shadow-amber-500/20',
    accentText: 'text-amber-400',
  },
  {
    id: 'echocalypse',
    shortCode: 'EC',
    name: 'Echocalypse',
    studioName: 'Echocalypse Spine Studio',
    rosterLabel: 'Echocalypse Roster',
    engineLabel: 'Spine 3.8 · Full Rip',
    accentGradient: 'from-orange-500 to-red-600 shadow-orange-500/20',
    accentText: 'text-orange-400',
  },
  {
    id: 'destinychild',
    shortCode: 'DCH',
    name: 'Destiny Child',
    studioName: 'Destiny Child Live2D Studio',
    rosterLabel: 'Destiny Child Roster',
    engineLabel: 'Cubism 2 Live2D · 2,464 Models',
    accentGradient: 'from-pink-500 to-red-600 shadow-pink-500/20',
    accentText: 'text-pink-400',
  },
];

export const GAME_MAP: Record<GameId, GameDescriptor> = GAME_LIST.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<GameId, GameDescriptor>
);

const AVAILABLE_LOCAL_ICON_IDS = new Set([
  '000101', '000102', '000103', '000104', '000105', '000106',
  '000201', '000202', '000203', '000204', '000206', '000296',
  '000301', '000303', '000304', '000306', '000396',
  '000401', '000402', '000403', '000406',
  '000501', '000502', '000504', '000506',
  '000601', '000604',
  '000701', '000706', '000707', '000708',
  '000801', '000804', '000806', '000807',
  '001001', '001002', '001004', '001006', '001092',
  '001101', '001103', '001106', '001107', '001197',
  '001201', '001206', '001207', '001297',
  '002401', '002403', '002406',
  '003001', '003101',
  '003201', '003202', '003203',
  '003301', '003302', '003303', '003392',
  '003401', '003402', '003403',
  '003501',
  '003601', '003602', '003603', '003604',
  '003701', '003702', '003703', '003793',
  '003801', '003802', '003803', '003892',
  '003901', '003902',
  '004001', '004002', '004091',
  '004101', '004102', '004192',
  '004201', '004202',
  '004301', '004302',
  '020001', '020002', '020101', '020102', '020201', '020301', '020401', '020501',
  '020601', '020701', '020801', '020901', '021001', '021101', '021201', '021291',
  '021301', '021391',
  '060301', '060302', '060402', '060403', '060501', '060502', '060601', '060602',
  '060701', '060702', '060706', '060801', '060802', '060804', '061001', '061002',
  '061003', '061092', '061101', '061102', '061103', '061302', '061305', '061306',
  '061392', '061402', '061404', '061492', '062001', '062002', '063001', '063301',
  '063401', '065102', '065103', '065193', '065802', '066401', '066402', '066403',
  '066801', '066802', '066803', '066902', '066906', '066907', '067002', '067003',
  '067004', '067101', '067102', '067103', '067104', '067201', '067202', '067301',
  '067302', '067303', '067401', '067402', '067403', '067491', '067502', '067503',
  '067504', '067601', '067603', '067604', '067701', '067702', '067801', '067803',
  '067901', '067902', '068001',
  '100101', '100201', '100301', '100401', '100501', '100502', '100601', '100801',
  '101101', '101102', '101103', '101201', '101202', '101301', '101302', '101401',
  '101402', '101501', '101502', '101601',
  '103201', '103301', '103401', '103501', '103601', '103701',
]);

// Sorted separately per individual skin from most recent release to least recent
export const ALL_CHARACTERS: BD2Character[] = Object.entries(characterMap)
  .map(([id, data]) => {
    const iconId = data.icon || id;
    const releaseMeta = SKIN_RELEASE_META.get(id);
    return {
      id,
      game: 'bd2' as const,
      charName: data.charName,
      costumeName: data.costumeName,
      spine: data.spine,
      cutscene: data.cutscene || '',
      dating: data.dating || '',
      audio: data.audio || '',
      icon: data.icon,
      displayMode: data.displayMode,
      iconUrl: AVAILABLE_LOCAL_ICON_IDS.has(iconId)
        ? `/char_icons/icon_char${iconId}.png`
        : '/char_icons/icon_charunknown.png',
      hasCutscene: Boolean(data.cutscene && data.cutscene.trim() !== ''),
      hasDating: Boolean(data.dating && data.dating.trim() !== ''),
      releaseOrder: releaseMeta ? releaseMeta.order : Number.MAX_SAFE_INTEGER,
      releaseLabel: releaseMeta ? releaseMeta.releasedAt : 'Classic',
    };
  })
  .sort((a, b) => a.releaseOrder - b.releaseOrder);

export const DEFAULT_CHARACTER = ALL_CHARACTERS.find((c) => c.id === '000201') || ALL_CHARACTERS[0];

const LOCAL_PRELOADED_SPINES = new Set(['000201', '000301', '000101']);

interface DaiCoreCatalogEntry {
  id: string;
  modelId: number;
  roleId: number;
  charName: string;
  costumeName: string;
  modelType: 'character' | 'archive';
  jsonPath: string;
  atlasPath: string;
  previewPath?: string;
  spineVersion?: string;
}

interface HazeReverbCatalogEntry {
  id: string;
  rawId?: string;
  charName: string;
  costumeName: string;
  modelType: 'skin' | 'character';
  jsonPath: string;
  atlasPath: string;
  iconPath?: string;
  isPeak?: boolean;
}

interface MadCatalogEntry {
  id: string;
  charName: string;
  costumeName: string;
  modelType: 'skin';
  jsonPath: string;
  atlasPath: string;
  iconPath?: string;
  spineVersion?: string;
  kind?: string;
  uncensored?: boolean;
  stores?: string[];
  hasBg?: boolean;
}

interface AzurLaneCatalogEntry {
  id: string;
  charName: string;
  costumeName: string;
  modelType: 'skin' | 'character';
  jsonPath: string;
  atlasPath: string;
  iconPath?: string;
}

interface Live2DCatalogEntry {
  id: string;
  charName: string;
  costumeName: string;
  modelType: string;
  jsonPath: string;
  iconPath?: string;
  api: 'cubism2' | 'cubism4';
  region?: 'kr' | 'gl';
  uncensored?: boolean;
  kind?: string;
  named?: boolean;
}





interface EchoCatalogEntry {
  id: string;
  modelId: string;
  bucket: string;
  charName: string;
  costumeName: string;
  kind: string;
  modelType?: string;
  spineVersion?: string;
  jsonPath: string;
  atlasPath: string;
  iconPath?: string;
}

const rosterCache = new Map<GameId, BD2Character[]>();
const inflightRoster = new Map<GameId, Promise<BD2Character[]>>();

function encodeProxyPath(base: string, relPath: string): string {
  const encoded = relPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `${base}/${encoded}`;
}

export function getCachedGameRoster(gameId: GameId): BD2Character[] {
  if (gameId === 'bd2') return ALL_CHARACTERS;
  return rosterCache.get(gameId) || [];
}

export async function loadGameRoster(gameId: GameId): Promise<BD2Character[]> {
  if (gameId === 'bd2') return ALL_CHARACTERS;
  const cached = rosterCache.get(gameId);
  if (cached) return cached;
  const pending = inflightRoster.get(gameId);
  if (pending) return pending;

  const work = (async () => {
    let mapped: BD2Character[] = [];

    if (gameId === 'daicore') {
      const res = await fetch('/data/daicore_catalog.json');
      if (!res.ok) throw new Error(`Failed to load Daiblos Core catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as DaiCoreCatalogEntry[];
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: 'daicore',
        charName: item.charName,
        costumeName: item.costumeName || 'Skin',
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        skeletonUrl: encodeProxyPath(DAICORE_BASE, item.jsonPath),
        atlasUrl: encodeProxyPath(DAICORE_BASE, item.atlasPath),
        skeletonFormat: 'json',
        spineVersion: item.spineVersion || '4.2.20',
        modelType: item.modelType,
        iconUrl: item.previewPath ? encodeProxyPath(DAICORE_BASE, item.previewPath) : '',
        hasCutscene: item.modelType === 'archive',
        hasDating: false,
        releaseOrder: idx,
        releaseLabel: item.modelType === 'archive' ? 'Archive CG' : 'Spine 4.2',
      }));
    } else if (gameId === 'hazereverb') {
      const res = await fetch('/data/hazereverb_catalog.json');
      if (!res.ok) throw new Error(`Failed to load Haze Reverb catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as HazeReverbCatalogEntry[];
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: 'hazereverb',
        charName: item.charName,
        costumeName: item.costumeName || 'Driver Illustration',
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        skeletonUrl: encodeProxyPath(HAZE_SPINE_BASE, item.jsonPath),
        atlasUrl: encodeProxyPath(HAZE_SPINE_BASE, item.atlasPath),
        skeletonFormat: 'skel',
        spineVersion: '3.8.99',
        modelType: item.modelType,
        iconUrl: item.iconPath ? encodeProxyPath(HAZE_SPINE_BASE, item.iconPath) : '',
        hasCutscene: false,
        hasDating: false,
        releaseOrder: idx,
        releaseLabel: item.modelType === 'skin' ? 'Skin Spine' : 'Driver Spine',
      }));
    } else if (gameId === 'mad') {
      const res = await fetch('/data/mad_catalog.json');
      if (!res.ok) throw new Error(`Failed to load MAke Drama catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as MadCatalogEntry[];
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: 'mad',
        charName: item.charName,
        costumeName: item.costumeName,
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        skeletonUrl: encodeProxyPath(MAD_SPINE_BASE, item.jsonPath),
        atlasUrl: encodeProxyPath(MAD_SPINE_BASE, item.atlasPath),
        skeletonFormat: 'skel',
        spineVersion: item.spineVersion || '4.1',
        modelType: item.modelType,
        iconUrl: item.iconPath ? encodeProxyPath(MAD_ICON_BASE, item.iconPath) : '',
        hasCutscene: item.kind === 'drama',
        hasDating: item.kind === 'affection' || item.kind === 'desire',
        releaseOrder: idx,
        releaseLabel: item.uncensored ? 'Uncensored available' : item.kind || 'Skin',
        uncensored: item.uncensored || undefined,
        named: true,
        kind: item.kind,
      }));
    } else if (gameId === 'azurlane') {
      const res = await fetch('/data/azurlane_catalog.json');
      if (!res.ok) throw new Error(`Failed to load Azur Lane catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as AzurLaneCatalogEntry[];
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: 'azurlane',
        charName: item.charName,
        costumeName: item.costumeName,
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        skeletonUrl: encodeProxyPath(AL_SPINE_BASE, item.jsonPath),
        atlasUrl: encodeProxyPath(AL_SPINE_BASE, item.atlasPath),
        skeletonFormat: 'skel',
        spineVersion: '3.8.99',
        modelType: item.modelType,
        iconUrl: item.iconPath ? encodeProxyPath(AL_ICON_BASE, item.iconPath) : '',
        hasCutscene: false,
        hasDating: false,
        releaseOrder: idx,
        releaseLabel: item.modelType === 'skin' ? 'Dynamic Skin' : 'Dynamic Spine',
        named: true,
      }));
    } else if (gameId === 'echocalypse') {
      const res = await fetch('/data/echocalypse_catalog.json');
      if (!res.ok) throw new Error(`Failed to load Echocalypse catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as EchoCatalogEntry[];
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: 'echocalypse',
        charName: item.charName,
        costumeName: item.costumeName,
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        skeletonUrl: encodeProxyPath(ECHO_SPINE_BASE, item.jsonPath),
        atlasUrl: encodeProxyPath(ECHO_SPINE_BASE, item.atlasPath),
        skeletonFormat: 'skel',
        spineVersion: item.spineVersion || '3.8.99',
        modelType: item.modelType || 'character',
        iconUrl: item.iconPath ? encodeProxyPath(ECHO_ICON_BASE, item.iconPath) : '',
        hasCutscene: false,
        hasDating: false,
        releaseOrder: idx,
        releaseLabel: item.bucket === 'knight_spine_remote' ? 'Remote Build' : item.kind,
        kind: item.kind,
        named: item.kind === 'character' || item.kind === 'costume',
        source: 'rip',
      }));
    } else if (gameId === 'girlssymphony' || gameId === 'destinychild') {
      const isDestinyChild = gameId === 'destinychild';
      const catalogName = isDestinyChild ? 'destinychild' : 'girlssymphony';
      const res = await fetch(`/data/${catalogName}_catalog.json`);
      if (!res.ok) throw new Error(`Failed to load ${catalogName} catalog (HTTP ${res.status})`);
      const rawList = (await res.json()) as Live2DCatalogEntry[];
      const assetBase = isDestinyChild ? DC_LIVE2D_BASE : GS_LIVE2D_BASE;
      mapped = rawList.map((item, idx) => ({
        id: item.id,
        game: gameId,
        charName: item.charName,
        costumeName: item.costumeName,
        spine: item.id,
        cutscene: '',
        dating: '',
        audio: '',
        live2dModelUrl: encodeProxyPath(assetBase, item.jsonPath),
        cubismApi: item.api,
        modelType: item.modelType,
        iconUrl: item.iconPath ? encodeProxyPath(assetBase, item.iconPath) : '',
        hasCutscene: item.modelType === 'cutscene',
        hasDating: false,
        releaseOrder: idx,
        releaseLabel: item.uncensored
          ? 'Uncensored available'
          : item.region === 'kr'
          ? 'KR Original'
          : item.region === 'gl'
          ? 'Global'
          : 'Cubism 4 Live2D',
        uncensored: item.uncensored || undefined,
        named: item.named ?? true,
        kind: item.kind,
      }));
    }

    rosterCache.set(gameId, mapped);
    return mapped;
  })();

  inflightRoster.set(gameId, work);
  try {
    return await work;
  } finally {
    inflightRoster.delete(gameId);
  }
}


export function pickDefaultCharacterForGame(gameId: GameId, roster: BD2Character[]): BD2Character {
  if (gameId === 'bd2') return DEFAULT_CHARACTER;
  if (gameId === 'daicore') {
    return roster.find((c) => c.modelType === 'character' && c.iconUrl) || roster[0];
  }
  if (gameId === 'hazereverb') {
    return (
      roster.find((c) => c.id === 'hz_10000001') ||
      roster.find((c) => c.modelType === 'skin' && c.iconUrl) ||
      roster[0]
    );
  }
  if (gameId === 'mad') {
    return roster.find((c) => c.kind === 'standing' && c.iconUrl) || roster.find((c) => c.kind === 'affection') || roster[0];
  }
  if (gameId === 'girlssymphony') {
    return roster.find((c) => c.id === 'gs_aphrodite_1') || roster.find((c) => c.iconUrl) || roster[0];
  }
  if (gameId === 'echocalypse') {
    return (
      roster.find((c) => c.iconUrl && (c.kind === 'character' || c.kind === 'knight') && c.releaseLabel !== 'Remote Build') ||
      roster.find((c) => c.iconUrl) ||
      roster[0]
    );
  }
  if (gameId === 'azurlane') {
    return (
      roster.find((c) => c.id === 'al_aerbien_4') ||
      roster.find((c) => c.id === 'al_xinzexi') ||
      roster.find((c) => c.modelType === 'skin' && c.iconUrl) ||
      roster[0]
    );
  }
  if (gameId === 'destinychild') {
    return (
      roster.find((c) => c.id === 'dc_c001_02') ||
      roster.find((c) => c.modelType === 'child' && c.iconUrl) ||
      roster[0]
    );
  }
  return roster[0] || DEFAULT_CHARACTER;
}

export function getSpineModelUrls(char: BD2Character, category: AnimationCategory): {
  skeletonUrl: string;
  atlasUrl: string;
  isJson: boolean;
} {
  if (char.skeletonUrl && char.atlasUrl) {
    return {
      skeletonUrl: char.skeletonUrl,
      atlasUrl: char.atlasUrl,
      isJson: char.skeletonFormat === 'json' || /\.json(\?.*)?$/i.test(char.skeletonUrl),
    };
  }

  let subPath = char.spine;
  const isLocal = LOCAL_PRELOADED_SPINES.has(char.id) && category === 'character';

  if (category === 'cutscene' && char.cutscene) {
    subPath = `cutscene/${char.cutscene}`;
  } else if (category === 'dating' && char.dating) {
    subPath = `dating/${char.dating}`;
  }

  const basePath = isLocal
    ? `/spines/${char.id}/${subPath}`
    : `${CDN_SPINE_BASE}/${char.id}/${subPath}`;

  return {
    skeletonUrl: `${basePath}.skel`,
    atlasUrl: `${basePath}.atlas`,
    isJson: false,
  };
}

export function prefetchCharacterModel(
  char: BD2Character,
  category: AnimationCategory = 'character'
): void {
  if (char.live2dModelUrl || (char.game !== 'bd2' && (!char.skeletonUrl || !char.atlasUrl))) {
    return;
  }
  const { skeletonUrl, atlasUrl } = getSpineModelUrls(char, category);
  prefetchSpineAssets(skeletonUrl, atlasUrl);
}

export function getCharacterVoiceUrls(char: BD2Character, lang: 'JP' | 'KR' = 'JP'): string[] {
  if (char.game !== 'bd2' || !char.audio) return [];
  return [1, 2, 3].map(
    (idx) => `${CDN_AUDIO_BASE}/${char.id}/${lang}/${char.audio}_${idx}.webm`
  );
}
