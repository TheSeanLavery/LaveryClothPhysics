export const CHARACTER_SDF_PRESET_KIND = 'lavery-character-sdf-preset';
export const CURRENT_CHARACTER_SDF_SCHEMA_VERSION = 1;

export interface CharacterSdfBoneOverride {
  readonly boneName: string;
  readonly enabled?: boolean;
  readonly segmentCount?: number;
  readonly radiusScale?: number;
  readonly radiusBias?: number;
  readonly t0?: number;
  readonly t1?: number;
}

export interface CharacterSdfManualCapsule {
  readonly id: string;
  readonly name: string;
  readonly parentName: string;
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly radius: number;
  readonly enabled?: boolean;
}

export interface CharacterSdfVertexRule {
  readonly meshName: string;
  readonly vertexIndex: number;
  readonly action: 'include' | 'exclude' | 'pin';
  readonly boneName?: string;
  readonly capsuleName?: string;
}

export interface CharacterSdfPresetEnvelopeV1 {
  readonly kind: typeof CHARACTER_SDF_PRESET_KIND;
  readonly schemaVersion: typeof CURRENT_CHARACTER_SDF_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly characterId: string;
  readonly assetUrl: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly targetHeight: number;
  readonly globalRadiusScale: number;
  readonly globalRadiusBias: number;
  readonly surfaceBand: number;
  readonly boneOverrides: readonly CharacterSdfBoneOverride[];
  readonly manualCapsules: readonly CharacterSdfManualCapsule[];
  readonly vertexRules: readonly CharacterSdfVertexRule[];
}

export type CharacterSdfPresetEnvelope = CharacterSdfPresetEnvelopeV1;

export function createCharacterSdfPresetEnvelope(
  name: string,
  characterId: string,
  assetUrl: string,
  partial: Partial<CharacterSdfPresetEnvelope> = {},
): CharacterSdfPresetEnvelope {
  const now = Date.now();
  const existing = isCharacterSdfPreset(partial) ? partial : null;
  return {
    kind: CHARACTER_SDF_PRESET_KIND,
    schemaVersion: CURRENT_CHARACTER_SDF_SCHEMA_VERSION,
    id: existing?.id ?? crypto.randomUUID(),
    name,
    characterId,
    assetUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    targetHeight: finiteNumber(partial.targetHeight, 1.75),
    globalRadiusScale: finiteNumber(partial.globalRadiusScale, 1),
    globalRadiusBias: finiteNumber(partial.globalRadiusBias, 0),
    surfaceBand: finiteNumber(partial.surfaceBand, 0.035),
    boneOverrides: [...(partial.boneOverrides ?? [])].map(normalizeBoneOverride),
    manualCapsules: [...(partial.manualCapsules ?? [])].map(normalizeManualCapsule),
    vertexRules: [...(partial.vertexRules ?? [])].map(normalizeVertexRule),
  };
}

export function upgradeCharacterSdfPreset(raw: unknown): CharacterSdfPresetEnvelope {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid character SDF preset');
  }
  const input = raw as Partial<CharacterSdfPresetEnvelope> & Record<string, unknown>;
  if (input.kind !== CHARACTER_SDF_PRESET_KIND && input.kind !== undefined) {
    throw new Error('Unsupported character SDF preset kind');
  }
  return createCharacterSdfPresetEnvelope(
    stringOr(input.name, 'Character SDF preset'),
    stringOr(input.characterId, 'default-character'),
    stringOr(input.assetUrl, ''),
    input,
  );
}

export function isCharacterSdfPreset(value: unknown): value is CharacterSdfPresetEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as CharacterSdfPresetEnvelope).kind === CHARACTER_SDF_PRESET_KIND,
  );
}

export function normalizedBoneKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function normalizeBoneOverride(raw: CharacterSdfBoneOverride): CharacterSdfBoneOverride {
  return {
    boneName: raw.boneName,
    enabled: raw.enabled,
    segmentCount: raw.segmentCount === undefined
      ? undefined
      : Math.max(1, Math.min(8, Math.round(finiteNumber(raw.segmentCount, 1)))),
    radiusScale: raw.radiusScale === undefined ? undefined : finiteNumber(raw.radiusScale, 1),
    radiusBias: raw.radiusBias === undefined ? undefined : finiteNumber(raw.radiusBias, 0),
    t0: raw.t0 === undefined ? undefined : clamp(finiteNumber(raw.t0, 0), 0, 1),
    t1: raw.t1 === undefined ? undefined : clamp(finiteNumber(raw.t1, 1), 0, 1),
  };
}

function normalizeManualCapsule(raw: CharacterSdfManualCapsule): CharacterSdfManualCapsule {
  return {
    id: raw.id || crypto.randomUUID(),
    name: raw.name,
    parentName: raw.parentName,
    start: vectorTuple(raw.start),
    end: vectorTuple(raw.end),
    radius: Math.max(0, finiteNumber(raw.radius, 0)),
    enabled: raw.enabled,
  };
}

function normalizeVertexRule(raw: CharacterSdfVertexRule): CharacterSdfVertexRule {
  return {
    meshName: raw.meshName,
    vertexIndex: Math.max(0, Math.round(finiteNumber(raw.vertexIndex, 0))),
    action: raw.action,
    boneName: raw.boneName,
    capsuleName: raw.capsuleName,
  };
}

function vectorTuple(value: readonly [number, number, number]): [number, number, number] {
  return [
    finiteNumber(value[0], 0),
    finiteNumber(value[1], 0),
    finiteNumber(value[2], 0),
  ];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
