export type BlendMode = 'source-over' | 'screen' | 'lighter' | 'multiply' | 'overlay' | 'color-dodge' | 'hard-light' | 'soft-light';

export type LayerType = 'background' | 'character_body' | 'outfit' | 'vfx' | 'foreground' | 'custom_image' | 'text' | 'particles';

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  src: string; // Data URL or Image path
  visible: boolean;
  locked: boolean;
  opacity: number; // 0 to 1
  blendMode: BlendMode;
  x: number; // center offset relative to canvas width (-50 to +50 %)
  y: number; // center offset relative to canvas height (-50 to +50 %)
  scale: number; // 0.1 to 3.0
  rotation: number; // in degrees
  zIndex: number;
  
  // Motion & Physics controls
  motionSwayAmount?: number; // Physics breathing/sway weight
  mouseFollowWeight?: number; // Cursor tracking influence
  pulseWithAudio?: boolean; // Beats to audio amplitude
  
  // Custom text layer properties if type === 'text'
  textProps?: {
    content: string;
    font: string;
    fontSize: number;
    color: string;
    glowColor?: string;
  };
}

export interface VoiceLine {
  id: string;
  title: string;
  japaneseTitle?: string;
  category: 'Greeting' | 'Skill Cutscene' | 'Touch' | 'Victory' | 'Special';
  audioUrl?: string; // Web Audio synthesized or sample audio
  text: string;
}

export interface CharacterSkin {
  id: string;
  name: string;
  title: string;
  rarity: 5 | 4 | 3;
  element: 'Fire' | 'Water' | 'Wind' | 'Light' | 'Dark';
  type: 'Live2D Cutscene' | 'Spine Battle' | 'Special Costume';
  defaultLayers: Omit<Layer, 'id'>[];
  voiceLines: VoiceLine[];
  bgmTrack?: {
    title: string;
    artist: string;
  };
  thumbnail: string;
}

export interface EnvironmentPreset {
  id: string;
  name: string;
  category: 'BD2 Special' | 'Anime Fantasy' | 'Futuristic' | 'Studio / Clean';
  bgUrl: string;
  gradient?: string;
  particleType?: 'embers' | 'snow' | 'sakura' | 'cyber_dots' | 'light_rays' | 'none';
}

export interface ScreenFilters {
  bloom: number; // 0 to 1
  vignette: number; // 0 to 1
  chromaticAberration: number; // 0 to 1
  brightness: number; // 0.5 to 1.5
  contrast: number; // 0.5 to 1.5
  saturation: number; // 0 to 2.0
  scanlines: boolean;
  colorFilter: 'none' | 'cyberpunk' | 'warm_gold' | 'gothic_cool' | 'retro_anime' | 'monochrome';
}

export interface CanvasPreset {
  id: string;
  name: string;
  createdAt: number;
  layers: Layer[];
  environmentId: string;
  filters: ScreenFilters;
}
