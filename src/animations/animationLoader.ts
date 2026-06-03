import catalogJson from './animationCatalog.json';

export interface AnimationEntry {
  readonly name: string;
  readonly file: string;
  readonly loop: boolean;
  readonly downloaded: boolean;
}

export interface AnimationCatalog {
  readonly format: string;
  readonly rig: string;
  readonly inPlace: boolean;
  readonly source: string;
  readonly categories: Record<string, AnimationEntry[]>;
  readonly stats: {
    readonly totalAnimations: number;
    readonly downloaded: number;
    readonly pending: number;
    readonly categories: number;
  };
}

export const ANIMATION_BASE_PATH = '/assets/characters';

export function loadCatalog(): AnimationCatalog {
  return catalogJson as AnimationCatalog;
}

/** Get all animations that have been downloaded and are available. */
export function getAvailableAnimations(): AnimationEntry[] {
  const catalog = loadCatalog();
  const available: AnimationEntry[] = [];
  for (const entries of Object.values(catalog.categories)) {
    for (const entry of entries) {
      if (entry.downloaded) {
        available.push(entry);
      }
    }
  }
  return available;
}

/** Get all animations in a specific category. */
export function getAnimationsByCategory(category: string): AnimationEntry[] {
  const catalog = loadCatalog();
  return catalog.categories[category] ?? [];
}

/** Get the full URL for an animation file. */
export function getAnimationUrl(entry: AnimationEntry): string {
  return `${ANIMATION_BASE_PATH}/${entry.file}`;
}

/** Get all category names. */
export function getCategoryNames(): string[] {
  return Object.keys(loadCatalog().categories);
}

/** Get a flat list of all animations across all categories. */
export function getAllAnimations(): (AnimationEntry & { category: string })[] {
  const catalog = loadCatalog();
  const all: (AnimationEntry & { category: string })[] = [];
  for (const [category, entries] of Object.entries(catalog.categories)) {
    for (const entry of entries) {
      all.push({ ...entry, category });
    }
  }
  return all;
}
