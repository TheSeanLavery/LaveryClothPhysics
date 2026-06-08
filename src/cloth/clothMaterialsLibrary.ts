import { getMyPresetSettings } from './myPresetDefaults.ts';
import {
  createClothMaterialDefinition,
  duplicateClothMaterial,
  emptyClothMaterialLibrary,
  normalizeClothMaterialLibrary,
  type ClothMaterialDefinition,
  type ClothMaterialLibrary,
} from './clothMaterialSchema.ts';

const API_PATH = '/__cloth/materials';

let cachedLibrary: ClothMaterialLibrary | null = null;

export async function fetchClothMaterialLibrary(): Promise<ClothMaterialLibrary> {
  const response = await fetch(API_PATH);
  if (!response.ok) {
    throw new Error(`Failed to load cloth materials (${response.status})`);
  }
  const library = normalizeClothMaterialLibrary(await response.json());
  cachedLibrary = library;
  return library;
}

export async function saveClothMaterialLibrary(library: ClothMaterialLibrary): Promise<void> {
  const response = await fetch(API_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(library),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `Failed to save cloth materials (${response.status})`);
  }
  cachedLibrary = library;
}

export function getCachedClothMaterialLibrary(): ClothMaterialLibrary | null {
  return cachedLibrary;
}

export async function upsertClothMaterial(material: ClothMaterialDefinition): Promise<ClothMaterialLibrary> {
  const library = cachedLibrary ?? await fetchClothMaterialLibrary();
  const materials = library.materials.filter((entry) => entry.id !== material.id);
  materials.push({ ...material, updatedAt: Date.now() });
  const next: ClothMaterialLibrary = { ...library, materials };
  await saveClothMaterialLibrary(next);
  return next;
}

export async function deleteClothMaterial(materialId: string): Promise<ClothMaterialLibrary> {
  const library = cachedLibrary ?? await fetchClothMaterialLibrary();
  const next: ClothMaterialLibrary = {
    ...library,
    materials: library.materials.filter((entry) => entry.id !== materialId),
  };
  await saveClothMaterialLibrary(next);
  return next;
}

export async function duplicateClothMaterialById(
  materialId: string,
  newName: string,
): Promise<ClothMaterialLibrary> {
  const library = cachedLibrary ?? await fetchClothMaterialLibrary();
  const source = library.materials.find((entry) => entry.id === materialId);
  if (!source) {
    throw new Error(`Unknown cloth material "${materialId}"`);
  }
  return upsertClothMaterial(duplicateClothMaterial(source, newName));
}

export function buildDefaultClothMaterialLibrarySeed(): ClothMaterialLibrary {
  const base = getMyPresetSettings();
  return {
    type: 'lavery-cloth-material-library',
    version: 1,
    materials: [
      createClothMaterialDefinition('My preset', {
        settings: base,
        color: base.flagColor,
      }),
      createClothMaterialDefinition('Banner A', {
        settings: { ...base, flagColor: '#4fa3ff', dampening: base.dampening },
        color: '#4fa3ff',
        physics: { tearThresholdScale: 1, bendScale: 1, friction: 0.85, damageRate: 1, maxHealth: 1, structuralScale: 1, compressionScale: 1 },
      }),
      createClothMaterialDefinition('Banner B', {
        settings: { ...base, flagColor: '#ff6b4a', dampening: 0.99 },
        color: '#ff6b4a',
        physics: { tearThresholdScale: 1, bendScale: 1, friction: 0.85, damageRate: 1, maxHealth: 1, structuralScale: 1, compressionScale: 1 },
      }),
      createClothMaterialDefinition('Banner C', {
        settings: { ...base, flagColor: '#7ee787', dampening: 0.9945 },
        color: '#7ee787',
        physics: { tearThresholdScale: 1, bendScale: 1, friction: 0.85, damageRate: 1, maxHealth: 1, structuralScale: 1, compressionScale: 1 },
      }),
      createClothMaterialDefinition('Dangle soft', {
        settings: { ...base, flagColor: '#d2a8ff', dampening: 0.9988 },
        color: '#d2a8ff',
        physics: { tearThresholdScale: 1, bendScale: 1, friction: 0.85, damageRate: 1, maxHealth: 1, structuralScale: 1, compressionScale: 1 },
      }),
      createClothMaterialDefinition('Dangle stiff', {
        settings: { ...base, flagColor: '#ffdc5a', dampening: 0.986 },
        color: '#ffdc5a',
        physics: { tearThresholdScale: 1, bendScale: 1, friction: 0.85, damageRate: 1, maxHealth: 1, structuralScale: 1, compressionScale: 1 },
      }),
    ],
  };
}

const SEEDED_MATERIAL_NAMES = new Set([
  'My preset',
  'Banner A',
  'Banner B',
  'Banner C',
  'Dangle soft',
  'Dangle stiff',
]);

export async function ensureClothMaterialLibrarySeeded(): Promise<ClothMaterialLibrary> {
  const seed = buildDefaultClothMaterialLibrarySeed();
  const library = await fetchClothMaterialLibrary();
  if (library.materials.length === 0) {
    await saveClothMaterialLibrary(seed);
    return seed;
  }

  const byName = new Map(library.materials.map((material) => [material.name, material]));
  let changed = false;
  for (const material of seed.materials) {
    if (!SEEDED_MATERIAL_NAMES.has(material.name)) {
      continue;
    }
    if (!byName.has(material.name)) {
      byName.set(material.name, material);
      changed = true;
    }
  }

  if (!changed) {
    return library;
  }

  const next: ClothMaterialLibrary = {
    ...library,
    materials: [...byName.values()],
  };
  await saveClothMaterialLibrary(next);
  return next;
}

export { emptyClothMaterialLibrary };
