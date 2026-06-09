export const CLOTH_MATERIAL_LIBRARY_TYPE = 'lavery-cloth-material-library';
export const CLOTH_MATERIAL_LIBRARY_VERSION = 1;

/** Absolute per-material solver values used by the GPU assembly path. */
export interface ClothMaterialSolverSettings {
  readonly dampening: number;
  readonly bendStiffness: number;
  readonly tearStretchThreshold: number;
}

/** Reserved multipliers for future per-material collision / duel wiring. */
export interface ClothMaterialPhysics {
  readonly structuralScale: number;
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
  readonly settings: ClothMaterialSolverSettings;
  readonly physics: ClothMaterialPhysics;
}

export interface ClothMaterialLibrary {
  readonly type: typeof CLOTH_MATERIAL_LIBRARY_TYPE;
  readonly version: typeof CLOTH_MATERIAL_LIBRARY_VERSION;
  readonly materials: readonly ClothMaterialDefinition[];
}

/** Matches {@link getMyPresetSettings} defaults from my-preset.json. */
export const DEFAULT_CLOTH_MATERIAL_SOLVER_SETTINGS = (): ClothMaterialSolverSettings => ({
  dampening: 0.9925,
  bendStiffness: 0.01,
  tearStretchThreshold: 4,
});

export const DEFAULT_CLOTH_MATERIAL_PHYSICS: Readonly<ClothMaterialPhysics> = {
  structuralScale: 1,
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

export function normalizeClothMaterialSolverSettings(
  raw: unknown,
  defaults: ClothMaterialSolverSettings = DEFAULT_CLOTH_MATERIAL_SOLVER_SETTINGS(),
): ClothMaterialSolverSettings {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    dampening: typeof record.dampening === 'number' ? record.dampening : defaults.dampening,
    bendStiffness: typeof record.bendStiffness === 'number' ? record.bendStiffness : defaults.bendStiffness,
    tearStretchThreshold: typeof record.tearStretchThreshold === 'number'
      ? record.tearStretchThreshold
      : defaults.tearStretchThreshold,
  };
}

export function createClothMaterialDefinition(
  name: string,
  options: {
    readonly settings?: Partial<ClothMaterialSolverSettings>;
    readonly physics?: Partial<ClothMaterialPhysics>;
    readonly color?: string;
    readonly id?: string;
  } = {},
): ClothMaterialDefinition {
  const now = Date.now();
  const defaults = DEFAULT_CLOTH_MATERIAL_SOLVER_SETTINGS();
  const settings = normalizeClothMaterialSolverSettings(options.settings, defaults);
  return {
    id: options.id ?? createClothMaterialId(name),
    name,
    color: options.color ?? '#ffffff',
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
  const defaults = DEFAULT_CLOTH_MATERIAL_SOLVER_SETTINGS();
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
          settings: normalizeClothMaterialSolverSettings(entry.settings, defaults),
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
