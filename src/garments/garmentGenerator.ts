import {
  buildClothAssembly,
  createQuadPatch,
  createTShirtAssembly,
  validateClothAssembly,
  type AssemblyVec3,
  type AssemblyVec2,
  type ClothAssembly,
  type ClothPatchDefinition,
  type StitchDefinition,
} from '../cloth/patternAssembly.ts';
import type {
  GarmentGeneratorParams,
  GarmentPresetEnvelope,
  ElasticShortsGarmentParams,
  JeansGarmentParams,
  LowerBodyBlockParams,
  PleatedSkirtGarmentParams,
  SkirtGarmentParams,
  TrousersGarmentParams,
} from './garmentSchema.ts';

export interface GeneratedGarment {
  readonly preset: GarmentPresetEnvelope;
  readonly assembly: ClothAssembly;
  readonly stats: GarmentAssemblyStats;
}

export interface GarmentAssemblyStats {
  readonly garmentType: string;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly edgeCount: number;
  readonly stitchEdgeCount: number;
  readonly patchCount: number;
  readonly validationIssueCount: number;
  readonly finishedWaistCircumference?: number;
  readonly flatWaistMaterialLength?: number;
  readonly materialFullnessRatio?: number;
}

export function generateGarmentAssembly(params: GarmentGeneratorParams): ClothAssembly {
  if (params.garmentType === 'tshirt') {
    return createTShirtAssembly(applyTShirtGridSpacing(params));
  }
  if (params.garmentType === 'elasticShorts' || params.garmentType === 'trousers' || params.garmentType === 'jeans') {
    return createLowerBodyAssembly(params);
  }
  if (params.garmentType === 'pleatedSkirt') {
    return createSkirtAssembly(params);
  }
  return createSkirtAssembly(params);
}

export function summarizeGarmentAssembly(
  garmentType: string,
  assembly: ClothAssembly,
): GarmentAssemblyStats {
  return {
    garmentType,
    vertexCount: assembly.vertices.length,
    faceCount: assembly.faces.length,
    edgeCount: assembly.edges.length,
    stitchEdgeCount: assembly.stitchEdges.length,
    patchCount: new Set(assembly.vertices.map((vertex) => vertex.patchId)).size,
    validationIssueCount: validateClothAssembly(assembly).length,
  };
}

export interface PleatedSkirtMaterialReport {
  readonly pleatType: string;
  readonly pleatCount: number;
  readonly finishedWaistCircumference: number;
  readonly flatWaistMaterialLength: number;
  readonly materialFullnessRatio: number;
  readonly hiddenFoldLength: number;
}

export function measurePleatedSkirtMaterial(params: PleatedSkirtGarmentParams): PleatedSkirtMaterialReport {
  const pleatCount = Math.max(4, Math.round(params.pleatCount));
  const finishedWaistCircumference = Math.PI * 2 * params.waistRadius;
  const hiddenFoldLength = pleatCount * params.pleatDepth * 2;
  const flatWaistMaterialLength = finishedWaistCircumference + hiddenFoldLength;
  return {
    pleatType: params.pleatType,
    pleatCount,
    finishedWaistCircumference,
    flatWaistMaterialLength,
    materialFullnessRatio: flatWaistMaterialLength / finishedWaistCircumference,
    hiddenFoldLength,
  };
}

export function generateGarmentPresetAssembly(preset: GarmentPresetEnvelope): GeneratedGarment {
  const assembly = generateGarmentAssembly(preset.params);
  const baseStats = summarizeGarmentAssembly(preset.garmentType, assembly);
  const stats = preset.params.garmentType === 'pleatedSkirt'
    ? {
        ...baseStats,
        ...measurePleatedSkirtMaterial(preset.params),
      }
    : baseStats;
  return {
    preset,
    assembly,
    stats,
  };
}

type LowerBodyParams = ElasticShortsGarmentParams | TrousersGarmentParams | JeansGarmentParams;
type LegSide = 'left' | 'right';
type LegFace = 'front' | 'back';

interface LowerBodyDraft {
  readonly totalLength: number;
  readonly crotchV: number;
  readonly segmentsV: number;
  readonly segmentsU: number;
  readonly hipWidth: number;
  readonly innerGap: number;
}

function createLowerBodyAssembly(params: LowerBodyParams): ClothAssembly {
  const draft = createLowerBodyDraft(params);
  const patches: ClothPatchDefinition[] = [
    createLegPanel(params, draft, 'front', 'left'),
    createLegPanel(params, draft, 'back', 'left'),
    createLegPanel(params, draft, 'front', 'right'),
    createLegPanel(params, draft, 'back', 'right'),
  ];
  const stitches: StitchDefinition[] = [
    stitchPair('left-inseam', 'front-left-leg', 'inseam', 'back-left-leg', 'inseam', false),
    stitchPair('right-inseam', 'front-right-leg', 'inseam', 'back-right-leg', 'inseam', false),
    stitchPair('left-outseam', 'front-left-leg', 'outseam', 'back-left-leg', 'outseam', false),
    stitchPair('right-outseam', 'front-right-leg', 'outseam', 'back-right-leg', 'outseam', false),
    stitchPair('front-crotch', 'front-left-leg', 'crotch', 'front-right-leg', 'crotch', false),
    stitchPair('back-crotch', 'back-left-leg', 'crotch', 'back-right-leg', 'crotch', false),
  ];

  addWaistTreatment(params, draft, patches, stitches);
  if (params.garmentType === 'trousers' || params.garmentType === 'jeans') {
    addFlyPieces(params, draft, patches, stitches);
  }
  if (params.garmentType === 'jeans') {
    addJeansDetailPieces(params, draft, patches, stitches);
  }

  return buildClothAssembly({ patches, stitches, renderStitches: true });
}

function createLowerBodyDraft(params: LowerBodyParams): LowerBodyDraft {
  const totalLength = params.rise + params.inseam;
  const segmentsV = segmentsForLength(totalLength * 1.25, params.gridSpacing, 8, 128);
  const crotchV = Math.max(2, Math.min(segmentsV - 2, Math.round((params.inseam / totalLength) * segmentsV)));
  const halfHip = (params.hipCircumference + params.hipEase + params.seatEase) / Math.PI / 2;
  const maxQuarterCircumference = Math.max(
    params.thighCircumference,
    params.kneeCircumference,
    params.hemCircumference,
  ) * 0.25;
  return {
    totalLength,
    crotchV,
    segmentsV,
    segmentsU: segmentsForLength(maxQuarterCircumference * 3, params.gridSpacing, 6, 64),
    hipWidth: halfHip,
    innerGap: Math.max(0.035, halfHip * 0.22),
  };
}

function createLegPanel(
  params: LowerBodyParams,
  draft: LowerBodyDraft,
  face: LegFace,
  side: LegSide,
): ClothPatchDefinition {
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const idx = (u: number, v: number) => u * (draft.segmentsV + 1) + v;

  for (let u = 0; u <= draft.segmentsU; u++) {
    const tu = u / draft.segmentsU;
    for (let v = 0; v <= draft.segmentsV; v++) {
      vertices.push(lowerBodyPoint(params, draft, face, side, tu, v / draft.segmentsV));
      uvs.push([tu, v / draft.segmentsV]);
    }
  }

  for (let u = 0; u < draft.segmentsU; u++) {
    for (let v = 0; v < draft.segmentsV; v++) {
      const i00 = idx(u, v);
      const i10 = idx(u + 1, v);
      const i01 = idx(u, v + 1);
      const i11 = idx(u + 1, v + 1);
      faces.push([i00, i10, i01], [i10, i11, i01]);
    }
  }

  return {
    id: `${face}-${side}-leg`,
    label: `${face} ${side} leg`,
    vertices,
    uvs,
    faces,
    boundaries: {
      hem: range(0, draft.segmentsU).map((u) => idx(u, 0)),
      waist: range(0, draft.segmentsU).map((u) => idx(u, draft.segmentsV)),
      outseam: range(0, draft.segmentsV).map((v) => idx(draft.segmentsU, v)),
      inseam: range(0, draft.crotchV).map((v) => idx(0, v)),
      crotch: range(draft.crotchV, draft.segmentsV).map((v) => idx(0, v)),
      fly: range(Math.max(draft.crotchV, draft.segmentsV - flyRows(params, draft)), draft.segmentsV).map((v) => idx(0, v)),
      upperBack: range(Math.max(draft.crotchV, draft.segmentsV - yokeRows(params, draft)), draft.segmentsV).map((v) => idx(0, v)),
      pocketAnchor: range(
        Math.max(1, Math.floor(draft.segmentsU * 0.25)),
        Math.min(draft.segmentsU - 1, Math.ceil(draft.segmentsU * 0.75)),
      ).map((u) => idx(u, Math.min(draft.segmentsV - 1, Math.max(draft.crotchV + 1, Math.floor(draft.segmentsV * 0.72))))),
    },
  };
}

function lowerBodyPoint(
  params: LowerBodyParams,
  draft: LowerBodyDraft,
  face: LegFace,
  side: LegSide,
  tu: number,
  tv: number,
): AssemblyVec3 {
  const sideSign = side === 'left' ? -1 : 1;
  const faceSign = face === 'front' ? 1 : -1;
  const y = -params.inseam + draft.totalLength * tv;
  const legT = tv <= params.inseam / draft.totalLength
    ? tv / (params.inseam / draft.totalLength)
    : 1;
  const bodyT = tv <= params.inseam / draft.totalLength
    ? 0
    : (tv - params.inseam / draft.totalLength) / (1 - params.inseam / draft.totalLength);
  const lowerCircumference = interpolateLegCircumference(params, legT);
  const lowerHalfWidth = lowerCircumference * 0.25;
  const upperHalfWidth = lerp(params.thighCircumference * 0.25, draft.hipWidth, smoothstep(bodyT));
  const panelWidth = lerp(lowerHalfWidth, upperHalfWidth, smoothstep(tv));
  const frontBackDepth = lerp(params.hemCircumference * 0.16, (params.hipCircumference + params.seatEase) * 0.16, smoothstep(tv));
  const backSeatExtra = face === 'back' ? params.seatEase * 0.25 * smoothstep(bodyT) : 0;
  const crotchRatio = params.inseam / draft.totalLength;
  const innerX = tv >= crotchRatio ? 0 : draft.innerGap * (1 - smoothstep(legT));
  const outerX = Math.max(innerX + params.gridSpacing, panelWidth);
  const x = sideSign * lerp(innerX, outerX, tu);
  const z = faceSign * (frontBackDepth + backSeatExtra) * Math.sin(Math.PI * tu);
  const crotchScoop = (1 - tu) * smoothstep(bodyT) * params.rise * (face === 'back' ? 0.18 : 0.08);
  return [x, y - crotchScoop, z];
}

function interpolateLegCircumference(params: LowerBodyParams, legT: number): number {
  if (legT < 0.55) {
    return lerp(params.hemCircumference, params.kneeCircumference, smoothstep(legT / 0.55));
  }
  return lerp(params.kneeCircumference, params.thighCircumference, smoothstep((legT - 0.55) / 0.45));
}

function addWaistTreatment(
  params: LowerBodyParams,
  draft: LowerBodyDraft,
  patches: ClothPatchDefinition[],
  stitches: StitchDefinition[],
): void {
  const bandHeight = params.garmentType === 'elasticShorts' ? params.casingHeight : params.waistbandHeight;
  const topScale = 1;
  for (const id of ['front-left-leg', 'front-right-leg', 'back-left-leg', 'back-right-leg']) {
    const lower = patchById(patches, id).boundaries.waist.map((localId) => patchById(patches, id).vertices[localId]!);
    const bandId = `${id}-${params.garmentType === 'elasticShorts' ? 'elastic-casing' : 'waistband'}`;
    patches.push(createBandPatch(bandId, lower, bandHeight, topScale, params.gridSpacing));
    stitches.push(stitchPair(`${bandId}-attach`, id, 'waist', bandId, 'bottom', false));
  }

}

function addFlyPieces(
  params: TrousersGarmentParams | JeansGarmentParams,
  draft: LowerBodyDraft,
  patches: ClothPatchDefinition[],
  stitches: StitchDefinition[],
): void {
  const flyLength = Math.min(params.flyLength, draft.totalLength * 0.45);
  for (const [legId, label, zOffset] of [
    ['front-left-leg', 'fly-facing', 0.012],
    ['front-right-leg', 'fly-shield', 0.018],
  ] as const) {
    const leg = patchById(patches, legId);
    const boundary = leg.boundaries.fly.map((localId) => leg.vertices[localId]!);
    const flyId = `${legId}-${label}`;
    patches.push(createFlyPatch(flyId, boundary, flyLength * 0.28, zOffset));
    stitches.push(stitchPair(`${flyId}-attach`, legId, 'fly', flyId, 'inner', false));
  }
}

function addJeansDetailPieces(
  params: JeansGarmentParams,
  draft: LowerBodyDraft,
  patches: ClothPatchDefinition[],
  stitches: StitchDefinition[],
): void {
  for (const side of ['left', 'right'] as const) {
    const back = patchById(patches, `back-${side}-leg`);
    const front = patchById(patches, `front-${side}-leg`);
    const yokeBoundary = back.boundaries.upperBack.map((localId) => back.vertices[localId]!);
    const yokeId = `jeans-${side}-back-yoke`;
    patches.push(createBandPatch(yokeId, yokeBoundary, params.yokeHeight, 0.9, params.gridSpacing, -0.018));
    stitches.push(stitchPair(`${yokeId}-attach`, back.id, 'upperBack', yokeId, 'bottom', false));

    const pocketId = `jeans-${side}-back-pocket`;
    patches.push(createPocketPatch(pocketId, back.boundaries.pocketAnchor.map((localId) => back.vertices[localId]!), params.backPocketHeight, -0.02, params.gridSpacing));
    stitches.push(stitchPair(`${pocketId}-topstitch`, back.id, 'pocketAnchor', pocketId, 'top', false));

    const frontPocketId = `jeans-${side}-front-pocket-bag`;
    patches.push(createPocketPatch(frontPocketId, front.boundaries.pocketAnchor.map((localId) => front.vertices[localId]!), params.frontPocketOpening * 0.9, 0.02, params.gridSpacing));
    stitches.push(stitchPair(`${frontPocketId}-opening`, front.id, 'pocketAnchor', frontPocketId, 'top', false));
  }

  for (let i = 0; i < params.beltLoopCount; i++) {
    const t = params.beltLoopCount === 1 ? 0.5 : i / (params.beltLoopCount - 1);
    const loopId = `jeans-belt-loop-${i + 1}`;
    patches.push(createBeltLoopPatch(loopId, t, params));
  }
}

function createBandPatch(
  id: string,
  lower: readonly AssemblyVec3[],
  height: number,
  topScale: number,
  gridSpacing: number,
  zOffset = 0,
): ClothPatchDefinition {
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const segmentsU = lower.length - 1;
  const segmentsV = segmentsForLength(height, gridSpacing, 1, 16);
  const idx = (u: number, v: number) => u * (segmentsV + 1) + v;
  const center = averageVec3(lower);

  for (let u = 0; u <= segmentsU; u++) {
    const base = lower[u]!;
    const top: AssemblyVec3 = [
      center[0] + (base[0] - center[0]) * topScale,
      base[1] + height,
      center[2] + (base[2] - center[2]) * topScale + zOffset,
    ];
    for (let v = 0; v <= segmentsV; v++) {
      const t = v / segmentsV;
      vertices.push([
        lerp(base[0], top[0], t),
        lerp(base[1], top[1], t),
        lerp(base[2], top[2], t),
      ]);
      uvs.push([u / Math.max(1, segmentsU), t]);
    }
  }

  for (let u = 0; u < segmentsU; u++) {
    for (let v = 0; v < segmentsV; v++) {
      faces.push([idx(u, v), idx(u + 1, v), idx(u, v + 1)], [idx(u + 1, v), idx(u + 1, v + 1), idx(u, v + 1)]);
    }
  }

  return {
    id,
    label: id,
    vertices,
    uvs,
    faces,
    boundaries: {
      bottom: range(0, segmentsU).map((u) => idx(u, 0)),
      top: range(0, segmentsU).map((u) => idx(u, segmentsV)),
      sideStart: range(0, segmentsV).map((v) => idx(0, v)),
      sideEnd: range(0, segmentsV).map((v) => idx(segmentsU, v)),
    },
  };
}

function createFlyPatch(
  id: string,
  inner: readonly AssemblyVec3[],
  width: number,
  zOffset: number,
): ClothPatchDefinition {
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const segmentsV = inner.length - 1;
  const idx = (u: number, v: number) => u * (segmentsV + 1) + v;
  for (let u = 0; u <= 1; u++) {
    for (let v = 0; v <= segmentsV; v++) {
      const base = inner[v]!;
      vertices.push([base[0] + width * u, base[1], base[2] + zOffset]);
      uvs.push([u, v / Math.max(1, segmentsV)]);
    }
  }
  for (let v = 0; v < segmentsV; v++) {
    faces.push([idx(0, v), idx(1, v), idx(0, v + 1)], [idx(1, v), idx(1, v + 1), idx(0, v + 1)]);
  }
  return {
    id,
    vertices,
    faces,
    uvs,
    boundaries: {
      inner: range(0, segmentsV).map((v) => idx(0, v)),
      outer: range(0, segmentsV).map((v) => idx(1, v)),
      top: [idx(0, segmentsV), idx(1, segmentsV)],
      bottom: [idx(0, 0), idx(1, 0)],
    },
  };
}

function createPocketPatch(
  id: string,
  top: readonly AssemblyVec3[],
  height: number,
  zOffset: number,
  gridSpacing: number,
): ClothPatchDefinition {
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const segmentsU = top.length - 1;
  const segmentsV = segmentsForLength(height, gridSpacing, 1, 16);
  const idx = (u: number, v: number) => u * (segmentsV + 1) + v;
  for (let u = 0; u <= segmentsU; u++) {
    const upper = top[u]!;
    const lower: AssemblyVec3 = [upper[0] * 0.96, upper[1] - height, upper[2] + zOffset];
    for (let v = 0; v <= segmentsV; v++) {
      const t = v / segmentsV;
      vertices.push([
        lerp(upper[0], lower[0], t),
        lerp(upper[1], lower[1], t),
        lerp(upper[2], lower[2], t),
      ]);
      uvs.push([u / Math.max(1, segmentsU), 1 - t]);
    }
  }
  for (let u = 0; u < segmentsU; u++) {
    for (let v = 0; v < segmentsV; v++) {
      faces.push([idx(u, v), idx(u + 1, v), idx(u, v + 1)], [idx(u + 1, v), idx(u + 1, v + 1), idx(u, v + 1)]);
    }
  }
  return {
    id,
    label: id,
    vertices,
    uvs,
    faces,
    boundaries: {
      top: range(0, segmentsU).map((u) => idx(u, 0)),
      bottom: range(0, segmentsU).map((u) => idx(u, segmentsV)),
      left: range(0, segmentsV).map((v) => idx(0, v)),
      right: range(0, segmentsV).map((v) => idx(segmentsU, v)),
    },
  };
}

function createBeltLoopPatch(id: string, placementT: number, params: JeansGarmentParams): ClothPatchDefinition {
  const waistRadius = params.waistCircumference / (Math.PI * 2);
  const angle = placementT * Math.PI * 2;
  const loopWidth = 0.018;
  const loopHeight = params.waistbandHeight * 1.45;
  const center: AssemblyVec3 = [
    Math.cos(angle) * waistRadius,
    params.rise + params.waistbandHeight * 0.45,
    Math.sin(angle) * waistRadius,
  ];
  const tangent: AssemblyVec3 = [-Math.sin(angle) * loopWidth, 0, Math.cos(angle) * loopWidth];
  return createQuadPatch({
    id,
    label: id,
    corners: [
      [center[0] - tangent[0], center[1] - loopHeight * 0.5, center[2] - tangent[2]],
      [center[0] + tangent[0], center[1] - loopHeight * 0.5, center[2] + tangent[2]],
      [center[0] + tangent[0], center[1] + loopHeight * 0.5, center[2] + tangent[2]],
      [center[0] - tangent[0], center[1] + loopHeight * 0.5, center[2] - tangent[2]],
    ],
    segmentsU: 1,
    segmentsV: 2,
  });
}

function patchById(patches: readonly ClothPatchDefinition[], id: string): ClothPatchDefinition {
  const patch = patches.find((candidate) => candidate.id === id);
  if (!patch) {
    throw new Error(`Missing patch "${id}"`);
  }
  return patch;
}

function stitchPair(
  id: string,
  patchA: string,
  boundaryA: string,
  patchB: string,
  boundaryB: string,
  reversed: boolean,
): StitchDefinition {
  return {
    id,
    a: { patchId: patchA, boundary: boundaryA },
    b: { patchId: patchB, boundary: boundaryB, reversed },
    renderFaces: true,
  };
}

function flyRows(params: LowerBodyParams, draft: LowerBodyDraft): number {
  if (params.garmentType === 'elasticShorts') {
    return 2;
  }
  return segmentsForLength(params.flyLength, params.gridSpacing, 2, draft.segmentsV);
}

function yokeRows(params: LowerBodyParams, draft: LowerBodyDraft): number {
  if (params.garmentType !== 'jeans') {
    return 2;
  }
  return segmentsForLength(params.yokeHeight, params.gridSpacing, 2, draft.segmentsV);
}

function averageVec3(points: readonly AssemblyVec3[]): AssemblyVec3 {
  const total: [number, number, number] = [0, 0, 0];
  for (const point of points) {
    total[0] += point[0];
    total[1] += point[1];
    total[2] += point[2];
  }
  const scale = points.length > 0 ? 1 / points.length : 1;
  return [total[0] * scale, total[1] * scale, total[2] * scale];
}

function createSkirtAssembly(params: SkirtGarmentParams | PleatedSkirtGarmentParams): ClothAssembly {
  if (params.garmentType === 'pleatedSkirt') {
    return createPleatedSkirtAssembly(params);
  }

  const panelCount = Math.max(4, Math.round(params.panelCount));
  const segmentsHeight = segmentsForLength(params.length, params.gridSpacing, 2, 96);
  const patches: ClothPatchDefinition[] = [];
  const stitches: StitchDefinition[] = [];
  const halfLength = params.length * 0.5;

  for (let i = 0; i < panelCount; i++) {
    const a0 = (i / panelCount) * Math.PI * 2;
    const a1 = ((i + 1) / panelCount) * Math.PI * 2;
    const top0 = skirtPoint(a0, params.waistRadius, halfLength);
    const top1 = skirtPoint(a1, params.waistRadius, halfLength);
    const bottom1 = skirtPoint(a1, params.hemRadius, -halfLength);
    const bottom0 = skirtPoint(a0, params.hemRadius, -halfLength);
    const maxPanelWidth = Math.max(distance3(bottom0, bottom1), distance3(top0, top1));

    patches.push(
      createQuadPatch({
        id: `${params.garmentType}-panel-${i}`,
        label: `${params.garmentType} panel ${i + 1}`,
        corners: [bottom0, bottom1, top1, top0],
        segmentsU: segmentsForLength(maxPanelWidth, params.gridSpacing, 1, 32),
        segmentsV: segmentsHeight,
      }),
    );
  }

  for (let i = 0; i < panelCount; i++) {
    stitches.push({
      id: `${params.garmentType}-side-seam-${i}`,
      a: { patchId: `${params.garmentType}-panel-${i}`, boundary: 'right' },
      b: { patchId: `${params.garmentType}-panel-${(i + 1) % panelCount}`, boundary: 'left' },
      renderFaces: true,
    });
  }

  return buildClothAssembly({ patches, stitches, renderStitches: true });
}

function createPleatedSkirtAssembly(params: PleatedSkirtGarmentParams): ClothAssembly {
  const pleatCount = Math.max(4, Math.round(params.pleatCount));
  const segmentsHeight = segmentsForLength(params.length, params.gridSpacing, 2, 128);
  const finishedWaistCircumference = Math.PI * 2 * params.waistRadius;
  const visiblePleatWidth = finishedWaistCircumference / pleatCount;
  const halfLength = params.length * 0.5;
  const columns = refineColumnsByGridSpacing(
    createPleatedWaistColumns(params, visiblePleatWidth, finishedWaistCircumference),
    params,
    finishedWaistCircumference,
  );
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const index = (u: number, v: number) => u * (segmentsHeight + 1) + v;

  for (let u = 0; u < columns.length; u++) {
    const column = columns[u]!;
    for (let v = 0; v <= segmentsHeight; v++) {
      const t = v / segmentsHeight;
      const y = -halfLength + params.length * t;
      vertices.push(pleatedSkirtPoint(params, column, t, y, finishedWaistCircumference));
      uvs.push([u / Math.max(1, columns.length - 1), t]);
    }
  }

  for (let u = 0; u < columns.length - 1; u++) {
    for (let v = 0; v < segmentsHeight; v++) {
      const i00 = index(u, v);
      const i10 = index(u + 1, v);
      const i01 = index(u, v + 1);
      const i11 = index(u + 1, v + 1);
      faces.push([i00, i10, i01], [i10, i11, i01]);
    }
  }

  const skirtPatch: ClothPatchDefinition = {
    id: 'pleated-skirt-folded-panel',
    label: `${params.pleatType} pleated skirt folded fabric`,
    vertices,
    uvs,
    faces,
    boundaries: {
      left: range(0, segmentsHeight).map((v) => index(0, v)),
      right: range(0, segmentsHeight).map((v) => index(columns.length - 1, v)),
      bottom: range(0, columns.length - 1).map((u) => index(u, 0)),
      top: range(0, columns.length - 1).map((u) => index(u, segmentsHeight)),
    },
  };

  const patches: ClothPatchDefinition[] = [skirtPatch];
  const stitches: StitchDefinition[] = [{
    id: 'pleated-skirt-back-seam',
    a: { patchId: skirtPatch.id, boundary: 'right' },
    b: { patchId: skirtPatch.id, boundary: 'left' },
    renderFaces: true,
  }];

  const topBoundary = skirtPatch.boundaries.top.map((localId) => skirtPatch.vertices[localId]!);
  const controlHeight = params.waistFinish === 'yoke'
    ? Math.max(params.yokeHeight, params.waistbandHeight)
    : params.waistbandHeight;
  const controlPatch = createPleatedWaistControlPatch(params, topBoundary, controlHeight);
  patches.push(controlPatch);
  stitches.push({
    id: `${controlPatch.id}-attach-pleats`,
    a: { patchId: skirtPatch.id, boundary: 'top' },
    b: { patchId: controlPatch.id, boundary: 'bottom' },
    renderFaces: true,
  });
  stitches.push({
    id: `${controlPatch.id}-back-seam`,
    a: { patchId: controlPatch.id, boundary: 'sideEnd' },
    b: { patchId: controlPatch.id, boundary: 'sideStart' },
    renderFaces: true,
  });

  const assembly = buildClothAssembly({
    patches,
    renderStitches: true,
    stitches,
  });
  return addPleatedConstructionEdges(assembly, params);
}

function createPleatedWaistControlPatch(
  params: PleatedSkirtGarmentParams,
  pleatedTop: readonly AssemblyVec3[],
  height: number,
): ClothPatchDefinition {
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const segmentsV = segmentsForLength(height, params.gridSpacing, 1, 12);
  const segmentsU = Math.max(1, pleatedTop.length - 1);
  const idx = (u: number, v: number) => u * (segmentsV + 1) + v;
  const topY = Math.max(...pleatedTop.map((point) => point[1]));
  const finishName = params.waistFinish === 'yoke' ? 'yoke' : params.waistFinish;
  const waistRadius = params.waistRadius * params.waistCompression;
  const lowerRadius = params.waistFinish === 'yoke'
    ? Math.max(waistRadius, params.waistRadius * 1.06)
    : waistRadius;
  const upperRadius = params.waistFinish === 'wideBand'
    ? waistRadius * 0.96
    : params.waistFinish === 'elasticBand'
      ? waistRadius * 0.9
      : waistRadius;

  for (let u = 0; u <= segmentsU; u++) {
    const topPoint = pleatedTop[u]!;
    const angle = Math.atan2(topPoint[2], topPoint[0]);
    for (let v = 0; v <= segmentsV; v++) {
      const t = v / segmentsV;
      const radius = lerp(lowerRadius, upperRadius, t);
      vertices.push([
        Math.cos(angle) * radius,
        topY + height * t,
        Math.sin(angle) * radius,
      ]);
      uvs.push([u / segmentsU, t]);
    }
  }

  for (let u = 0; u < segmentsU; u++) {
    for (let v = 0; v < segmentsV; v++) {
      faces.push([idx(u, v), idx(u + 1, v), idx(u, v + 1)], [idx(u + 1, v), idx(u + 1, v + 1), idx(u, v + 1)]);
    }
  }

  return {
    id: `pleated-skirt-${finishName}`,
    label: `${finishName} controlling pleated waist`,
    vertices,
    uvs,
    faces,
    boundaries: {
      bottom: range(0, segmentsU).map((u) => idx(u, 0)),
      top: range(0, segmentsU).map((u) => idx(u, segmentsV)),
      sideStart: range(0, segmentsV).map((v) => idx(0, v)),
      sideEnd: range(0, segmentsV).map((v) => idx(segmentsU, v)),
    },
  };
}

function addPleatedConstructionEdges(
  assembly: ClothAssembly,
  params: PleatedSkirtGarmentParams,
): ClothAssembly {
  const extraEdges: ClothAssembly['edges'] = [];
  let nextId = assembly.edges.length;
  const topY = Math.max(...assembly.vertices.map((vertex) => vertex.position[1]));
  const tackCutoffY = topY - params.length * params.pleatTackDepth;
  const pleatRows = assembly.vertices
    .filter((vertex) => vertex.patchId === 'pleated-skirt-folded-panel' && vertex.position[1] >= tackCutoffY)
    .sort((a, b) => a.localId - b.localId);
  const rowGroups = new Map<number, typeof pleatRows>();
  for (const vertex of pleatRows) {
    const rowKey = Math.round(vertex.position[1] / Math.max(0.001, params.gridSpacing * 0.25));
    rowGroups.set(rowKey, [...(rowGroups.get(rowKey) ?? []), vertex]);
  }

  for (const row of rowGroups.values()) {
    const sorted = [...row].sort((a, b) => Math.atan2(a.position[2], a.position[0]) - Math.atan2(b.position[2], b.position[0]));
    const step = Math.max(2, Math.round(sorted.length / Math.max(4, params.pleatCount)));
    for (let i = 0; i + step < sorted.length; i += step) {
      const a = sorted[i]!;
      const b = sorted[i + step]!;
      extraEdges.push({
        id: nextId++,
        a: a.id,
        b: b.id,
        kind: 'structural',
        restLength: distance3(a.position, b.position) * lerp(1, 0.65, params.waistbandStiffness),
        sourceId: 'pleated-top-tack',
      });
    }
  }

  const controlVertices = assembly.vertices.filter((vertex) => /pleated-skirt-(plainBand|wideBand|elasticBand|yoke)/.test(vertex.patchId));
  const controlTopY = Math.max(...controlVertices.map((vertex) => vertex.position[1]));
  const controlTop = controlVertices.filter((vertex) => Math.abs(vertex.position[1] - controlTopY) < params.gridSpacing * 0.4);
  const center = averageVec3(controlTop.map((vertex) => vertex.position));
  const sortedTop = [...controlTop].sort((a, b) => Math.atan2(a.position[2] - center[2], a.position[0] - center[0]) - Math.atan2(b.position[2] - center[2], b.position[0] - center[0]));
  const half = Math.floor(sortedTop.length / 2);
  for (let i = 0; i < half; i++) {
    const a = sortedTop[i]!;
    const b = sortedTop[(i + half) % sortedTop.length]!;
    extraEdges.push({
      id: nextId++,
      a: a.id,
      b: b.id,
      kind: 'structural',
      restLength: distance3(a.position, b.position),
      sourceId: 'pleated-waist-control-brace',
    });
  }

  return {
    ...assembly,
    edges: [...assembly.edges, ...extraEdges],
  };
}

interface PleatedColumn {
  readonly projectedDistance: number;
  readonly layer: number;
}

function createPleatedWaistColumns(
  params: PleatedSkirtGarmentParams,
  visiblePleatWidth: number,
  finishedWaistCircumference: number,
): PleatedColumn[] {
  const pleatCount = Math.max(4, Math.round(params.pleatCount));
  const columns: PleatedColumn[] = [{ projectedDistance: 0, layer: hiddenLayer(params, 0) }];
  for (let i = 0; i < pleatCount; i++) {
    const start = (i / pleatCount) * finishedWaistCircumference;
    const end = ((i + 1) / pleatCount) * finishedWaistCircumference;
    const middle = start + visiblePleatWidth * 0.5;
    const endLayer = i === pleatCount - 1 ? hiddenLayer(params, 0) : hiddenLayer(params, i + 1);

    if (params.pleatType === 'box' || params.pleatType === 'invertedBox') {
      const sign = params.pleatType === 'box' ? 1 : -1;
      columns.push(
        { projectedDistance: start, layer: 0 },
        { projectedDistance: middle, layer: sign },
        { projectedDistance: middle, layer: 0 },
        { projectedDistance: end, layer: 0 },
        { projectedDistance: end, layer: endLayer },
      );
    } else {
      columns.push(
        { projectedDistance: start, layer: 0 },
        { projectedDistance: end, layer: 0 },
        { projectedDistance: end, layer: endLayer },
      );
    }
  }
  return columns;
}

function refineColumnsByGridSpacing(
  columns: readonly PleatedColumn[],
  params: PleatedSkirtGarmentParams,
  finishedWaistCircumference: number,
): PleatedColumn[] {
  const refined: PleatedColumn[] = [];
  for (let i = 0; i < columns.length; i++) {
    const current = columns[i]!;
    if (i === 0) {
      refined.push(current);
      continue;
    }

    const previous = columns[i - 1]!;
    const topDistance = distance3(
      pleatedSkirtPoint(params, previous, 1, params.length * 0.5, finishedWaistCircumference),
      pleatedSkirtPoint(params, current, 1, params.length * 0.5, finishedWaistCircumference),
    );
    const bottomDistance = distance3(
      pleatedSkirtPoint(params, previous, 0, -params.length * 0.5, finishedWaistCircumference),
      pleatedSkirtPoint(params, current, 0, -params.length * 0.5, finishedWaistCircumference),
    );
    const subdivisions = segmentsForLength(Math.max(topDistance, bottomDistance), params.gridSpacing, 1, 24);
    for (let step = 1; step <= subdivisions; step++) {
      const t = step / subdivisions;
      refined.push({
        projectedDistance: lerp(previous.projectedDistance, current.projectedDistance, t),
        layer: lerp(previous.layer, current.layer, t),
      });
    }
  }
  return refined;
}

function pleatedSkirtPoint(
  params: PleatedSkirtGarmentParams,
  column: PleatedColumn,
  verticalT: number,
  y: number,
  finishedWaistCircumference: number,
): AssemblyVec3 {
  const baseRadius = lerp(params.hemRadius, params.waistRadius, verticalT);
  const depthAtHeight = params.pleatDepth * lerp(params.hemPleatRelease, 1, verticalT);
  const radius = Math.max(0.02, baseRadius + column.layer * depthAtHeight);
  const angle = (column.projectedDistance / finishedWaistCircumference) * Math.PI * 2;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function hiddenLayer(params: PleatedSkirtGarmentParams, index: number): number {
  if (params.pleatType === 'invertedBox') {
    return 1;
  }
  if (params.pleatType === 'box') {
    return index % 2 === 0 ? -1 : 1;
  }
  return -1;
}

function skirtPoint(angle: number, radius: number, y: number): AssemblyVec3 {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function applyTShirtGridSpacing(params: Extract<GarmentGeneratorParams, { garmentType: 'tshirt' }>) {
  return {
    ...params,
    bodySegmentsX: segmentsForLength(params.bodyWidth * 2.5, params.gridSpacing, 16, 96),
    bodySegmentsY: segmentsForLength(params.torsoHeight * 2.2, params.gridSpacing, 18, 96),
    sleeveSegmentsX: segmentsForLength(params.sleeveLength, params.gridSpacing, 5, 24),
  };
}

function segmentsForLength(length: number, gridSpacing: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, Math.ceil(length / Math.max(0.001, gridSpacing)))));
}

function distance3(a: AssemblyVec3, b: AssemblyVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function range(start: number, endInclusive: number): number[] {
  const result: number[] = [];
  for (let i = start; i <= endInclusive; i++) {
    result.push(i);
  }
  return result;
}
