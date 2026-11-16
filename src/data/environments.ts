import { EnvironmentPreset } from '../types';

// Procedurally generated high quality SVG backgrounds to guarantee 0ms load time & 0 broken external links!
const createGradientSVG = (stop1: string, stop2: string, stop3: string, pattern: string = '') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${stop1}" />
        <stop offset="50%" stop-color="${stop2}" />
        <stop offset="100%" stop-color="${stop3}" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="40%" r="50%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.15)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0)" />
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#bgGrad)" />
    <rect width="1920" height="1080" fill="url(#glow)" />
    ${pattern}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const sacredTemplePattern = `<g opacity="0.12" stroke="#ffffff" stroke-width="1.5" fill="none">
  <circle cx="960" cy="540" r="380" stroke-dasharray="10 15" />
  <circle cx="960" cy="540" r="280" />
  <polygon points="960,180 1270,720 650,720" />
  <polygon points="960,900 1270,360 650,360" />
</g>`;

const cyberCityPattern = `<g opacity="0.15" stroke="#38bdf8" stroke-width="1" fill="none">
  <path d="M 0 900 L 1920 900 M 0 950 L 1920 950 M 0 1000 L 1920 1000" />
  <line x1="960" y1="540" x2="100" y2="1080" />
  <line x1="960" y1="540" x2="400" y2="1080" />
  <line x1="960" y1="540" x2="700" y2="1080" />
  <line x1="960" y1="540" x2="1220" y2="1080" />
  <line x1="960" y1="540" x2="1520" y2="1080" />
  <line x1="960" y1="540" x2="1820" y2="1080" />
</g>`;

const gothicNightPattern = `<g opacity="0.2" fill="#ffffff">
  <circle cx="1400" cy="240" r="120" fill="#fef08a" opacity="0.8" />
  <circle cx="1360" cy="220" r="110" fill="#090d16" />
  <path d="M0,800 Q480,750 960,820 T1920,780 L1920,1080 L0,1080 Z" fill="#0f172a" opacity="0.6" />
</g>`;

const beachSunsetPattern = `<g opacity="0.4">
  <circle cx="960" cy="650" r="200" fill="#fdba74" opacity="0.6" />
  <path d="M0,750 Q480,720 960,760 T1920,730 L1920,1080 L0,1080 Z" fill="#0284c7" opacity="0.4" />
</g>`;

export const ENVIRONMENTS: EnvironmentPreset[] = [
  {
    id: 'env_sacred_temple',
    name: 'Sacred Sanctuary (Light)',
    category: 'BD2 Special',
    bgUrl: createGradientSVG('#090d16', '#1e1b4b', '#312e81', sacredTemplePattern),
    particleType: 'light_rays',
  },
  {
    id: 'env_gothic_night',
    name: 'Moonlit Castle Ruins',
    category: 'Anime Fantasy',
    bgUrl: createGradientSVG('#020617', '#0f172a', '#1e293b', gothicNightPattern),
    particleType: 'embers',
  },
  {
    id: 'env_cyber_district',
    name: 'Neo City Code Room',
    category: 'Futuristic',
    bgUrl: createGradientSVG('#030712', '#0f172a', '#0c4a6e', cyberCityPattern),
    particleType: 'cyber_dots',
  },
  {
    id: 'env_beach_sunset',
    name: 'Summer Paradise Sunset',
    category: 'Anime Fantasy',
    bgUrl: createGradientSVG('#451a03', '#7c2d12', '#9a3412', beachSunsetPattern),
    particleType: 'sakura',
  },
  {
    id: 'env_studio_dark',
    name: 'Dark Studio (Neutral)',
    category: 'Studio / Clean',
    bgUrl: createGradientSVG('#020617', '#090d16', '#0f172a'),
    particleType: 'none',
  },
  {
    id: 'env_transparent_alpha',
    name: 'Transparent PNG Alpha',
    category: 'Studio / Clean',
    bgUrl: '',
    particleType: 'none',
  },
];
