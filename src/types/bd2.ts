export type GameId = 'bd2' | 'daicore' | 'hazereverb' | 'azurlane' | 'mad' | 'anchorpanic' | 'girlssymphony' | 'echocalypse' | 'snowbreak' | 'nikke';

export type AnimationCategory = 'character' | 'cutscene' | 'dating';

export interface GameDescriptor {
  id: GameId;
  shortCode: string;
  name: string;
  studioName: string;
  rosterLabel: string;
  engineLabel: string;
  accentGradient: string;
  accentText: string;
}

export interface CharacterSkill {
  name: string;
  desc: string;
}

export interface BD2CharacterRaw {
  charName: string;
  costumeName: string;
  spine: string;
  cutscene: string;
  dating: string;
  audio: string;
  icon?: string;
  displayMode?: 'new' | 'updated';
}

export interface BD2Character extends BD2CharacterRaw {
  id: string;
  game?: GameId;
  iconUrl: string;
  hasCutscene: boolean;
  hasDating: boolean;
  hasAim?: boolean;
  hasCover?: boolean;
  aimSpine?: string;
  coverSpine?: string;
  skeletonUrl?: string;
  atlasUrl?: string;
  skeletonFormat?: 'skel' | 'json';
  spineVersion?: string;
  /** Live2D (Cubism) models: URL to the .model3.json the runtime loads. */
  live2dModelUrl?: string;
  /** Cubism API version for Live2D models. */
  cubismApi?: 'cubism4';
  modelType?: string;
  rarity?: string;
  manufacturer?: string;
  classType?: string;
  squad?: string;
  isPlayable?: boolean;
  skills?: CharacterSkill[];
  releaseOrder: number;
  releaseLabel: string;

  // ---- multi-game catalog fields -------------------------------------------
  /** 6-digit character id this spine belongs to (costumes share their base's id). */
  baseId?: string;
  /** 0 for a character's base spine, 01/02/... for its costumes. */
  costumeIndex?: number;
  /** Every export available for this character, base first. */
  costumes?: string[];
  /** Localised names beyond the primary English one. */
  nameZh?: string;
  aliases?: string[];
  element?: string;
  faction?: string;
  role?: string;
  /** Researched confidence for the display name; "none" means the id is unlabelled. */
  confidence?: string;
  /** False when no source names this spine yet. */
  named?: boolean;
  /** Playable character vs npc/scene/collab/battle variant. */
  kind?: string;
  /** Skin served from an uncensored (Google Store) build. */
  uncensored?: boolean;
  /** Upstream file sizes, used to warn before a large download. */
  bytes?: { skeleton: number; atlas: number; textures: number };
  /** True when the export ships a separate backdrop spine (<id>_bg). */
  hasBackdropSpine?: boolean;
  /**
   * Which backend serves this row. "game-cdn" rows come from the live game's own
   * update packages, which carry the newer heroes the third-party rip lacks.
   */
  source?: 'rip' | 'game-cdn';
}

export interface SpineSlotLayer {
  name: string;
  visible: boolean;
  color?: { r: number; g: number; b: number; a: number };
}

export interface SpineViewerSettings {
  animationCategory: AnimationCategory;
  animationSpeed: number;
  playing: boolean;
  backgroundColor: string;
  audioLanguage: 'JP' | 'KR';
  layerSelectionEnabled: boolean;
}
