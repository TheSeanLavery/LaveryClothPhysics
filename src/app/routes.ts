export type AppMode =
  | 'flag'
  | 'plane'
  | 'tube'
  | 'character'
  | 'character-duel'
  | 'character-sdf'
  | 'garment'
  | 'animations';

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
    mode: 'character-duel',
    label: 'Character Duel',
    href: '/?mode=character-duel',
    description: 'Two characters with GPU cloth shirts fighting',
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
  {
    mode: 'animations',
    label: 'Animations',
    href: '/?mode=animations',
    description: 'Animation browser and rating studio',
  },
];

export function getAppMode(search = window.location.search): AppMode {
  const mode = new URLSearchParams(search).get('mode');
  if (
    mode === 'plane' ||
    mode === 'tube' ||
    mode === 'character' ||
    mode === 'character-duel' ||
    mode === 'character-sdf' ||
    mode === 'garment' ||
    mode === 'animations'
  ) {
    return mode;
  }
  return 'flag';
}
