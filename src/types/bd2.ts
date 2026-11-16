export type GameId = 'bd2' | 'daicore' | 'hazereverb' | 'echocalypse' | 'azurlane';

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
  modelType?: string;
  rarity?: string;
  manufacturer?: string;
  classType?: string;
  squad?: string;
  isPlayable?: boolean;
  skills?: CharacterSkill[];
  releaseOrder: number;
  releaseLabel: string;
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
