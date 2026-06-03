export type AppMode = 'flag' | 'plane' | 'tube' | 'character' | 'character-sdf' | 'garment';

export interface AppModeLink {
  mode: AppMode;
  label: string;
  href: string;
  description: string;
}

export const APP_MODE_LINKS: readonly AppModeLink[] = [
  {
    mode: 'flag',
    label: 'Flag',
    href: '/',
    description: 'Main inextensible GPU flag simulation',
  },
  {
    mode: 'plane',
    label: 'Fabric Plane',
    href: '/?mode=plane',
    description: 'Material and fabric preview plane',
  },
  {
    mode: 'tube',
    label: 'Tube',
    href: '/?mode=tube',
    description: 'Zero gravity tube solver',
  },
  {
    mode: 'character',
    label: 'Character Cloth',
    href: '/?mode=character',
    description: 'Animated character cloth simulation',
  },
  {
    mode: 'character-sdf',
    label: 'SDF Tool',
    href: '/?mode=character-sdf',
    description: 'Standalone character SDF authoring tool',
  },
  {
    mode: 'garment',
    label: 'Garment Studio',
    href: '/?mode=garment',
    description: 'Garment generation and fitting studio',
  },
];

export function getAppMode(search = window.location.search): AppMode {
  const mode = new URLSearchParams(search).get('mode');
  if (mode === 'plane' || mode === 'tube' || mode === 'character' || mode === 'character-sdf' || mode === 'garment') {
    return mode;
  }
  return 'flag';
}
