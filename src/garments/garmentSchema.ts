import type { TShirtAssemblyOptions } from '../cloth/patternAssembly.ts';

export const GARMENT_PRESET_KIND = 'lavery-garment-generator-preset';
export const CURRENT_GARMENT_SCHEMA_VERSION = 5;

export type GarmentType = 'tshirt' | 'skirt' | 'pleatedSkirt' | 'elasticShorts' | 'trousers' | 'jeans';
export type PleatType = 'knife' | 'box' | 'invertedBox';
export type PleatedWaistFinish = 'plainBand' | 'wideBand' | 'elasticBand' | 'yoke';

export interface GarmentGeneratorParamsByType {
  tshirt: TShirtGarmentParams;
  skirt: SkirtGarmentParams;
  pleatedSkirt: PleatedSkirtGarmentParams;
  elasticShorts: ElasticShortsGarmentParams;
  trousers: TrousersGarmentParams;
  jeans: JeansGarmentParams;
}

export type GarmentGeneratorParams = GarmentGeneratorParamsByType[GarmentType];

export interface TShirtGarmentParams extends TShirtAssemblyOptions {
  readonly garmentType: 'tshirt';
  readonly gridSpacing: number;
}

export interface SkirtGarmentParams {
  readonly garmentType: 'skirt';
  readonly gridSpacing: number;
  readonly waistRadius: number;
  readonly hemRadius: number;
  readonly length: number;
  readonly panelCount: number;
  readonly segmentsHeight: number;
}

export interface PleatedSkirtGarmentParams extends SkirtGarmentParams {
  readonly garmentType: 'pleatedSkirt';
  readonly pleatType: PleatType;
  readonly pleatDepth: number;
  readonly pleatCount: number;
  readonly hemPleatRelease: number;
  readonly waistFinish: PleatedWaistFinish;
  readonly waistbandHeight: number;
  readonly waistbandStiffness: number;
  readonly yokeHeight: number;
  readonly pleatTackDepth: number;
  readonly waistCompression: number;
}

export interface LowerBodyBlockParams {
  readonly gridSpacing: number;
  readonly waistCircumference: number;
  readonly hipCircumference: number;
  readonly rise: number;
  readonly inseam: number;
  readonly thighCircumference: number;
  readonly kneeCircumference: number;
  readonly hemCircumference: number;
  readonly hipEase: number;
  readonly seatEase: number;
}

export interface ElasticShortsGarmentParams extends LowerBodyBlockParams {
  readonly garmentType: 'elasticShorts';
  readonly elasticWidth: number;
  readonly elasticRatio: number;
  readonly casingHeight: number;
  readonly hemAllowance: number;
}

export interface TrousersGarmentParams extends LowerBodyBlockParams {
  readonly garmentType: 'trousers';
  readonly waistbandHeight: number;
  readonly flyLength: number;
  readonly frontPleatDepth: number;
}

export interface JeansGarmentParams extends LowerBodyBlockParams {
  readonly garmentType: 'jeans';
  readonly waistbandHeight: number;
  readonly flyLength: number;
  readonly yokeHeight: number;
  readonly frontPocketOpening: number;
  readonly backPocketWidth: number;
  readonly backPocketHeight: number;
  readonly beltLoopCount: number;
}

export interface GarmentPresetEnvelopeV5<T extends GarmentType = GarmentType> {
  readonly kind: typeof GARMENT_PRESET_KIND;
  readonly schemaVersion: typeof CURRENT_GARMENT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly garmentType: T;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly generatorVersion: string;
  readonly params: GarmentGeneratorParamsByType[T];
}

export type GarmentPresetEnvelope = GarmentPresetEnvelopeV5;

export interface GarmentPresetEnvelopeV1 {
  readonly kind: typeof GARMENT_PRESET_KIND;
  readonly schemaVersion: 1;
  readonly id?: string;
  readonly name?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly garmentType?: GarmentType;
  readonly params?: Record<string, unknown>;
}

export const DEFAULT_TSHIRT_PARAMS: TShirtGarmentParams = {
  garmentType: 'tshirt',
  bodyWidth: 0.66,
  torsoHeight: 0.74,
  sleeveLength: 0.24,
  sleeveOpening: 0.26,
  sleeveTubeRadius: 0.088,
  depth: 0.25,
  bodySegmentsX: 12,
  bodySegmentsY: 18,
  sleeveSegmentsX: 5,
  gridSpacing: 0.04,
  restLengthMode: 'placed',
  sleeveHangScale: 0.25,
  sleeveLiftScale: 0.18,
  sleeveVerticalRadiusScale: 0.34,
};

export const DEFAULT_SKIRT_PARAMS: SkirtGarmentParams = {
  garmentType: 'skirt',
  waistRadius: 0.26,
  hemRadius: 0.34,
  length: 0.62,
  panelCount: 8,
  segmentsHeight: 16,
  gridSpacing: 0.04,
};

export const DEFAULT_PLEATED_SKIRT_PARAMS: PleatedSkirtGarmentParams = {
  ...DEFAULT_SKIRT_PARAMS,
  garmentType: 'pleatedSkirt',
  hemRadius: 0.42,
  panelCount: 12,
  pleatType: 'knife',
  pleatDepth: 0.045,
  pleatCount: 12,
  hemPleatRelease: 0.55,
  waistFinish: 'yoke',
  waistbandHeight: 0.055,
  waistbandStiffness: 0.65,
  yokeHeight: 0.12,
  pleatTackDepth: 0.22,
  waistCompression: 0.92,
};

export const DEFAULT_ELASTIC_SHORTS_PARAMS: ElasticShortsGarmentParams = {
  garmentType: 'elasticShorts',
  gridSpacing: 0.04,
  waistCircumference: 0.78,
  hipCircumference: 0.96,
  rise: 0.29,
  inseam: 0.22,
  thighCircumference: 0.58,
  kneeCircumference: 0.48,
  hemCircumference: 0.56,
  hipEase: 0.1,
  seatEase: 0.08,
  elasticWidth: 0.035,
  elasticRatio: 0.86,
  casingHeight: 0.055,
  hemAllowance: 0.025,
};

export const DEFAULT_TROUSERS_PARAMS: TrousersGarmentParams = {
  garmentType: 'trousers',
  gridSpacing: 0.04,
  waistCircumference: 0.82,
  hipCircumference: 1.0,
  rise: 0.3,
  inseam: 0.82,
  thighCircumference: 0.6,
  kneeCircumference: 0.48,
  hemCircumference: 0.42,
  hipEase: 0.06,
  seatEase: 0.06,
  waistbandHeight: 0.04,
  flyLength: 0.16,
  frontPleatDepth: 0.015,
};

export const DEFAULT_JEANS_PARAMS: JeansGarmentParams = {
  garmentType: 'jeans',
  gridSpacing: 0.035,
  waistCircumference: 0.82,
  hipCircumference: 0.98,
  rise: 0.28,
  inseam: 0.78,
  thighCircumference: 0.57,
  kneeCircumference: 0.43,
  hemCircumference: 0.36,
  hipEase: 0.035,
  seatEase: 0.04,
  waistbandHeight: 0.04,
  flyLength: 0.17,
  yokeHeight: 0.075,
  frontPocketOpening: 0.16,
  backPocketWidth: 0.13,
  backPocketHeight: 0.15,
  beltLoopCount: 5,
};

export function defaultGarmentParams<T extends GarmentType>(
  garmentType: T,
): GarmentGeneratorParamsByType[T] {
  if (garmentType === 'skirt') {
    return structuredClone(DEFAULT_SKIRT_PARAMS) as GarmentGeneratorParamsByType[T];
  }
  if (garmentType === 'pleatedSkirt') {
    return structuredClone(DEFAULT_PLEATED_SKIRT_PARAMS) as GarmentGeneratorParamsByType[T];
  }
  if (garmentType === 'elasticShorts') {
    return structuredClone(DEFAULT_ELASTIC_SHORTS_PARAMS) as GarmentGeneratorParamsByType[T];
  }
  if (garmentType === 'trousers') {
    return structuredClone(DEFAULT_TROUSERS_PARAMS) as GarmentGeneratorParamsByType[T];
  }
  if (garmentType === 'jeans') {
    return structuredClone(DEFAULT_JEANS_PARAMS) as GarmentGeneratorParamsByType[T];
  }
  return structuredClone(DEFAULT_TSHIRT_PARAMS) as GarmentGeneratorParamsByType[T];
}

export function normalizeGarmentParams<T extends GarmentType>(
  garmentType: T,
  partial: Partial<GarmentGeneratorParamsByType[T]> | undefined,
): GarmentGeneratorParamsByType[T] {
  const base = defaultGarmentParams(garmentType);
  const merged = { ...base, ...(partial ?? {}), garmentType } as GarmentGeneratorParamsByType[T];
  return clampGarmentParams(merged);
}

export function createGarmentPresetEnvelope<T extends GarmentType>(
  name: string,
  garmentType: T,
  params: Partial<GarmentGeneratorParamsByType[T]> | undefined,
  existing?: Pick<GarmentPresetEnvelope, 'id' | 'createdAt'>,
): GarmentPresetEnvelopeV5<T> {
  const now = Date.now();
  return {
    kind: GARMENT_PRESET_KIND,
    schemaVersion: CURRENT_GARMENT_SCHEMA_VERSION,
    id: existing?.id ?? crypto.randomUUID(),
    name: requirePresetName(name),
    garmentType,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    generatorVersion: 'garment-generator-v5',
    params: normalizeGarmentParams(garmentType, params),
  };
}

export function upgradeGarmentPreset(raw: unknown): GarmentPresetEnvelope {
  if (!isRecord(raw)) {
    throw new Error('Garment preset must be a JSON object');
  }
  if (raw.kind !== GARMENT_PRESET_KIND) {
    throw new Error('Unsupported garment preset kind');
  }

  if (raw.schemaVersion === CURRENT_GARMENT_SCHEMA_VERSION) {
    const garmentType = parseGarmentType(raw.garmentType);
    return {
      kind: GARMENT_PRESET_KIND,
      schemaVersion: CURRENT_GARMENT_SCHEMA_VERSION,
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      name: requirePresetName(typeof raw.name === 'string' ? raw.name : 'Imported garment'),
      garmentType,
      createdAt: finiteNumber(raw.createdAt, Date.now()),
      updatedAt: finiteNumber(raw.updatedAt, Date.now()),
      generatorVersion: typeof raw.generatorVersion === 'string' ? raw.generatorVersion : 'garment-generator-v5',
      params: normalizeGarmentParams(garmentType, isRecord(raw.params) ? raw.params : undefined),
    };
  }

  if (raw.schemaVersion === 1 || raw.schemaVersion === 2 || raw.schemaVersion === 3 || raw.schemaVersion === 4) {
    return upgradeGarmentPresetV1(raw as GarmentPresetEnvelopeV1);
  }

  throw new Error(`Unsupported garment preset schema version: ${String(raw.schemaVersion)}`);
}

function upgradeGarmentPresetV1(raw: GarmentPresetEnvelopeV1): GarmentPresetEnvelope {
  const garmentType = parseGarmentType(raw.garmentType ?? raw.params?.garmentType);
  return createGarmentPresetEnvelope(
    raw.name ?? 'Imported v1 garment',
    garmentType,
    raw.params as Partial<GarmentGeneratorParamsByType[typeof garmentType]> | undefined,
    {
      id: raw.id ?? crypto.randomUUID(),
      createdAt: raw.createdAt ?? Date.now(),
    },
  );
}

function clampGarmentParams<T extends GarmentGeneratorParams>(params: T): T {
  if (params.garmentType === 'tshirt') {
    return {
      ...params,
      bodyWidth: clamp(params.bodyWidth, 0.12, 1.2),
      torsoHeight: clamp(params.torsoHeight, 0.2, 1.2),
      sleeveLength: clamp(params.sleeveLength, 0, 0.7),
      sleeveOpening: clamp(params.sleeveOpening, 0.02, 0.55),
      sleeveTubeRadius: clamp(params.sleeveTubeRadius ?? DEFAULT_TSHIRT_PARAMS.sleeveTubeRadius!, 0.006, 0.22),
      depth: clamp(params.depth ?? DEFAULT_TSHIRT_PARAMS.depth!, 0.02, 0.45),
      gridSpacing: clamp(params.gridSpacing ?? DEFAULT_TSHIRT_PARAMS.gridSpacing, 0.018, 0.08),
      bodySegmentsX: Math.round(clamp(params.bodySegmentsX ?? 12, 4, 36)),
      bodySegmentsY: Math.round(clamp(params.bodySegmentsY ?? 18, 4, 48)),
      sleeveSegmentsX: Math.round(clamp(params.sleeveSegmentsX ?? 5, 2, 18)),
      restLengthMode: params.restLengthMode === 'flat' ? 'flat' : 'placed',
      sleeveHangScale: clamp(params.sleeveHangScale ?? 0.25, 0, 1),
      sleeveLiftScale: clamp(params.sleeveLiftScale ?? 0.18, 0, 1),
      sleeveVerticalRadiusScale: clamp(params.sleeveVerticalRadiusScale ?? 0.34, 0.02, 0.8),
    } as T;
  }

  if (params.garmentType === 'pleatedSkirt') {
    return {
      ...params,
      waistRadius: clamp(params.waistRadius, 0.045, 0.8),
      hemRadius: clamp(params.hemRadius, 0.065, 1.1),
      length: clamp(params.length, 0.15, 1.4),
      gridSpacing: clamp(params.gridSpacing ?? DEFAULT_PLEATED_SKIRT_PARAMS.gridSpacing, 0.018, 0.08),
      panelCount: Math.round(clamp(params.panelCount, 4, 48)),
      segmentsHeight: Math.round(clamp(params.segmentsHeight, 2, 64)),
      pleatType: parsePleatType(params.pleatType),
      pleatDepth: clamp(params.pleatDepth, 0, 0.18),
      pleatCount: Math.round(clamp(params.pleatCount, 4, 48)),
      hemPleatRelease: clamp(params.hemPleatRelease, 0, 1),
      waistFinish: parsePleatedWaistFinish(params.waistFinish),
      waistbandHeight: clamp(params.waistbandHeight ?? DEFAULT_PLEATED_SKIRT_PARAMS.waistbandHeight, 0.015, 0.18),
      waistbandStiffness: clamp(params.waistbandStiffness ?? DEFAULT_PLEATED_SKIRT_PARAMS.waistbandStiffness, 0, 1),
      yokeHeight: clamp(params.yokeHeight ?? DEFAULT_PLEATED_SKIRT_PARAMS.yokeHeight, 0, 0.35),
      pleatTackDepth: clamp(params.pleatTackDepth ?? DEFAULT_PLEATED_SKIRT_PARAMS.pleatTackDepth, 0, 0.8),
      waistCompression: clamp(params.waistCompression ?? DEFAULT_PLEATED_SKIRT_PARAMS.waistCompression, 0.55, 1.15),
    } as T;
  }

  if (params.garmentType === 'elasticShorts') {
    return clampLowerBodyParams(params, DEFAULT_ELASTIC_SHORTS_PARAMS, {
      elasticWidth: clamp(params.elasticWidth, 0.015, 0.08),
      elasticRatio: clamp(params.elasticRatio, 0.65, 1),
      casingHeight: clamp(params.casingHeight, 0.025, 0.12),
      hemAllowance: clamp(params.hemAllowance, 0.005, 0.08),
    }) as T;
  }

  if (params.garmentType === 'trousers') {
    return clampLowerBodyParams(params, DEFAULT_TROUSERS_PARAMS, {
      waistbandHeight: clamp(params.waistbandHeight, 0.02, 0.08),
      flyLength: clamp(params.flyLength, 0.08, 0.28),
      frontPleatDepth: clamp(params.frontPleatDepth, 0, 0.08),
    }) as T;
  }

  if (params.garmentType === 'jeans') {
    return clampLowerBodyParams(params, DEFAULT_JEANS_PARAMS, {
      waistbandHeight: clamp(params.waistbandHeight, 0.025, 0.075),
      flyLength: clamp(params.flyLength, 0.08, 0.28),
      yokeHeight: clamp(params.yokeHeight, 0.035, 0.14),
      frontPocketOpening: clamp(params.frontPocketOpening, 0.08, 0.26),
      backPocketWidth: clamp(params.backPocketWidth, 0.07, 0.2),
      backPocketHeight: clamp(params.backPocketHeight, 0.08, 0.24),
      beltLoopCount: Math.round(clamp(params.beltLoopCount, 4, 9)),
    }) as T;
  }

  return {
    ...params,
    waistRadius: clamp(params.waistRadius, 0.045, 0.8),
    hemRadius: clamp(params.hemRadius, 0.065, 1.1),
    length: clamp(params.length, 0.15, 1.4),
    gridSpacing: clamp(params.gridSpacing ?? DEFAULT_SKIRT_PARAMS.gridSpacing, 0.018, 0.08),
    panelCount: Math.round(clamp(params.panelCount, 4, 36)),
    segmentsHeight: Math.round(clamp(params.segmentsHeight, 2, 64)),
  } as T;
}

function parseGarmentType(value: unknown): GarmentType {
  if (
    value === 'skirt' ||
    value === 'pleatedSkirt' ||
    value === 'tshirt' ||
    value === 'elasticShorts' ||
    value === 'trousers' ||
    value === 'jeans'
  ) {
    return value;
  }
  return 'tshirt';
}

function clampLowerBodyParams<T extends LowerBodyBlockParams>(
  params: T,
  defaults: T,
  garmentSpecific: Partial<T>,
): T {
  return {
    ...params,
    gridSpacing: clamp(params.gridSpacing ?? defaults.gridSpacing, 0.018, 0.08),
    waistCircumference: clamp(params.waistCircumference ?? defaults.waistCircumference, 0.24, 1.4),
    hipCircumference: clamp(params.hipCircumference ?? defaults.hipCircumference, 0.32, 1.7),
    rise: clamp(params.rise ?? defaults.rise, 0.16, 0.5),
    inseam: clamp(params.inseam ?? defaults.inseam, 0.06, 1.1),
    thighCircumference: clamp(params.thighCircumference ?? defaults.thighCircumference, 0.18, 1),
    kneeCircumference: clamp(params.kneeCircumference ?? defaults.kneeCircumference, 0.14, 0.9),
    hemCircumference: clamp(params.hemCircumference ?? defaults.hemCircumference, 0.1, 0.9),
    hipEase: clamp(params.hipEase ?? defaults.hipEase, -0.12, 0.22),
    seatEase: clamp(params.seatEase ?? defaults.seatEase, -0.12, 0.22),
    ...garmentSpecific,
  };
}

function parsePleatType(value: unknown): PleatType {
  if (value === 'box' || value === 'invertedBox' || value === 'knife') {
    return value;
  }
  return 'knife';
}

function parsePleatedWaistFinish(value: unknown): PleatedWaistFinish {
  if (value === 'wideBand' || value === 'elasticBand' || value === 'yoke' || value === 'plainBand') {
    return value;
  }
  return DEFAULT_PLEATED_SKIRT_PARAMS.waistFinish;
}

function requirePresetName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Garment preset name is required');
  }
  return trimmed;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
