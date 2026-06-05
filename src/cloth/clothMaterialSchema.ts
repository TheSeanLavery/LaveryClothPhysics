import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import { normalizeFlagSettings } from '../sim/settingsPreset.ts';

export const CLOTH_MATERIAL_LIBRARY_TYPE = 'lavery-cloth-material-library';
export const CLOTH_MATERIAL_LIBRARY_VERSION = 1;

/** Per-panel sim/render multipliers (GPU segment table will index these). */
export interface ClothMaterialPhysics {
  readonly tearThresholdScale: number;
  readonly structuralScale: number;
  readonly bendScale: number;
  readonly compressionScale: number;
  readonly friction: number;
  readonly damageRate: number;
  readonly maxHealth: number;
}

export interface ClothMaterialDefinition {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Base solver settings shared with flag sim (my-preset shape). */
  readonly settings: Partial<InextensibleFlagSettings>;
  readonly physics: ClothMaterialPhysics;
}

export interface ClothMaterialLibrary {
  readonly type: typeof CLOTH_MATERIAL_LIBRARY_TYPE;
  readonly version: typeof CLOTH_MATERIAL_LIBRARY_VERSION;
  readonly materials: readonly ClothMaterialDefinition[];
}

export const DEFAULT_CLOTH_MATERIAL_PHYSICS: Readonly<ClothMaterialPhysics> = {
  tearThresholdScale: 1,
  structuralScale: 1,
  bendScale: 1,
  compressionScale: 1,
  friction: 0.85,
  damageRate: 1,
  maxHealth: 1,
};

export function createClothMaterialId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'material'}-${Date.now().toString(36)}`;
}

export function createClothMaterialDefinition(
  name: string,
  options: {
    readonly settings?: Partial<InextensibleFlagSettings>;
    readonly physics?: Partial<ClothMaterialPhysics>;
    readonly color?: string;
    readonly id?: string;
  } = {},
): ClothMaterialDefinition {
  const now = Date.now();
  const settings = normalizeFlagSettings(options.settings ?? {});
  return {
    id: options.id ?? createClothMaterialId(name),
    name,
    color: options.color ?? settings.flagColor,
    createdAt: now,
    updatedAt: now,
    settings,
    physics: { ...DEFAULT_CLOTH_MATERIAL_PHYSICS, ...options.physics },
  };
}

export function duplicateClothMaterial(
  source: ClothMaterialDefinition,
  newName: string,
): ClothMaterialDefinition {
  const now = Date.now();
  return {
    ...structuredClone(source),
    id: createClothMaterialId(newName),
    name: newName,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeClothMaterialLibrary(raw: unknown): ClothMaterialLibrary {
  if (!raw || typeof raw !== 'object') {
    return emptyClothMaterialLibrary();
  }
  const record = raw as Record<string, unknown>;
  const materials = Array.isArray(record.materials)
    ? record.materials
        .filter((entry): entry is ClothMaterialDefinition => (
          Boolean(entry)
          && typeof entry === 'object'
          && typeof (entry as ClothMaterialDefinition).id === 'string'
          && typeof (entry as ClothMaterialDefinition).name === 'string'
        ))
        .map((entry) => ({
          ...entry,
          settings: normalizeFlagSettings(entry.settings ?? {}),
          physics: { ...DEFAULT_CLOTH_MATERIAL_PHYSICS, ...entry.physics },
        }))
    : [];
  return {
    type: CLOTH_MATERIAL_LIBRARY_TYPE,
    version: CLOTH_MATERIAL_LIBRARY_VERSION,
    materials,
  };
}

export function emptyClothMaterialLibrary(): ClothMaterialLibrary {
  return {
    type: CLOTH_MATERIAL_LIBRARY_TYPE,
    version: CLOTH_MATERIAL_LIBRARY_VERSION,
    materials: [],
  };
}
