export type AppMode = 'flag' | 'plane' | 'tube' | 'character' | 'garment';

export function getAppMode(search = window.location.search): AppMode {
  const mode = new URLSearchParams(search).get('mode');
  if (mode === 'plane' || mode === 'tube' || mode === 'character' || mode === 'garment') {
    return mode;
  }
  return 'flag';
}
