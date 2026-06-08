import * as THREE from 'three';
import {
  buildClothAssembly,
  validateClothAssembly,
  type AssemblyVec2,
  type AssemblyVec3,
  type ClothAssembly,
  type ClothPatchDefinition,
  type StitchDefinition,
} from '../cloth/patternAssembly.ts';
import {
  auditMeshEdgeSpacing,
  buildArcLengthKnots,
  buildMatchedArcLengthKnots,
  createQuadGridPatch,
  segmentsForChordLength,
} from '../cloth/surfaceGrid.ts';
import type { AnimatedCharacterSceneRig, CharacterAnchors } from '../character/AnimatedCharacter.ts';
import {
  auditShirtSdfClearance,
  projectToExteriorShell,
  resolveCharacterDressAxes,
  SHIRT_SDF_CLEARANCE,
  type BoneSdfCapsuleSample,
  type CharacterDressAxes,
} from '../character/shirtDressing.ts';

export type WrappedGarmentProofKind =
  | 'torso'
  | 'torsoTube'
  | 'leftArm'
  | 'rightArm'
  | 'torsoAndArms'
  | 'torsoAndArmsLoose';

export interface WrappedGarmentBuilderOptions {
  readonly gridSpacing?: number;
  readonly clearance?: number;
  readonly bottomLift?: number;
  readonly topDrop?: number;
  readonly armLengthScale?: number;
  /** Extra structural edge rest-length ratio (0.08 = 8% longer than frozen wrap). */
  readonly looseness?: number;
}

export interface WrappedGarmentProofReport {
  readonly proof: WrappedGarmentProofKind;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly patchIds: readonly string[];
  readonly stitchEdgeCount: number;
  readonly validationIssueCount: number;
  readonly penetrationCount: number;
  readonly minSignedDistance: number;
  readonly torsoVertexCount: number;
  readonly leftArmVertexCount: number;
  readonly rightArmVertexCount: number;
  readonly maxStitchGap: number;
  readonly maxEdgeLength: number;
  readonly percentile95EdgeLength: number;
  readonly longEdgeCount: number;
}

const DEFAULT_GRID_SPACING = 0.044;
const SHOULDER_STITCH_SAMPLES = 6;
const MIN_ARM_RING_SEGMENTS = Math.max(10, SHOULDER_STITCH_SAMPLES * 2);
/** Curved SDF wraps tolerate ~3× spacing at p95; median stays near target. */
const GRID_SPACING_TOLERANCE = 2;

interface TorsoPanelKnots {
  readonly uKnots: readonly number[];
  readonly vKnots: readonly number[];
}

interface WrapContext {
  readonly anchors: CharacterAnchors;
  readonly sdfs: readonly BoneSdfCapsuleSample[];
  readonly axes: CharacterDressAxes;
  readonly clearance: number;
  readonly gridSpacing: number;
  readonly bottomLift: number;
  readonly topDrop: number;
  readonly armLengthScale: number;
  readonly looseness: number;
  torsoPanelKnots?: TorsoPanelKnots;
}

interface ArmCapsuleTarget {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly radius: number;
  readonly name?: string;
}

interface ArmDressTarget {
  readonly path: readonly THREE.Vector3[];
  readonly capsules: readonly ArmCapsuleTarget[];
  readonly frontAxis: THREE.Vector3;
  readonly fallbackSideAxis: THREE.Vector3;
  readonly pathLength: number;
}

interface WrappedBuildResult {
  readonly patches: ClothPatchDefinition[];
  readonly stitches: StitchDefinition[];
}

export function buildWrappedGarmentAssembly(
  rig: AnimatedCharacterSceneRig,
  proof: WrappedGarmentProofKind,
  options: WrappedGarmentBuilderOptions = {},
): ClothAssembly {
  rig.root.updateMatrixWorld(true);
  return buildWrappedGarmentAssemblyFromAnchors(
    rig.getCharacterAnchors(),
    rig.getBoneSdfSummary(),
    proof,
    resolveProofOptions(proof, options),
    rig.measureForwardYaw(),
  );
}

export function buildWrappedGarmentAssemblyFromAnchors(
  anchors: CharacterAnchors,
  sdfs: readonly BoneSdfCapsuleSample[],
  proof: WrappedGarmentProofKind,
  options: WrappedGarmentBuilderOptions = {},
  forwardYawRad: number | null = null,
): ClothAssembly {
  const resolved = resolveProofOptions(proof, options);
  const context = createWrapContext(anchors, sdfs, resolved, forwardYawRad);
  const { patches, stitches } = collectWrappedPatchesAndStitches(proof, context);
  if (patches.length === 0) {
    throw new Error(`No wrapped patches generated for proof "${proof}"`);
  }

  let alignedPatches = stitches.length > 0
    ? alignStitchBoundariesInPatches(patches, stitches, context.sdfs, context.clearance)
    : patches;
  alignedPatches = resyncArmTubeSeamsInPatches(alignedPatches);

  let assembly = buildClothAssembly({
    patches: alignedPatches,
    stitches,
    renderStitches: stitches.length > 0,
  });

  if (stitches.length > 0) {
    assembly = weldStitchBoundaryVertices(assembly, context.sdfs, context.clearance);
  }

  assembly = freezePlacedRestLengths(assembly);

  if (context.looseness > 0) {
    assembly = applyWrappedGarmentLooseness(assembly, context.looseness);
  }

  return assembly;
}

export function auditWrappedGarmentProof(
  assembly: ClothAssembly,
  proof: WrappedGarmentProofKind,
  sdfs: readonly BoneSdfCapsuleSample[],
  clearance = SHIRT_SDF_CLEARANCE,
  gridSpacing = DEFAULT_GRID_SPACING,
): WrappedGarmentProofReport {
  const failures: string[] = [];
  const validationIssues = validateClothAssembly(assembly);
  if (validationIssues.length > 0) {
    failures.push(`assembly validation: ${validationIssues.map((issue) => issue.message).join('; ')}`);
  }

  const patchIds = [...new Set(assembly.vertices.map((vertex) => vertex.patchId))];
  const torsoVertexCount = assembly.vertices.filter((vertex) => vertex.patchId.includes('wrapped-torso')).length;
  const leftArmVertexCount = assembly.vertices.filter((vertex) => vertex.patchId === 'wrapped-arm-left').length;
  const rightArmVertexCount = assembly.vertices.filter((vertex) => vertex.patchId === 'wrapped-arm-right').length;
  const stitchEdgeCount = assembly.stitchEdges.length;

  if (proof === 'torso' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
    if (torsoVertexCount < 80) {
      failures.push(`torso vertex count ${torsoVertexCount} below minimum 80`);
    }
    if (!patchIds.some((id) => id.includes('wrapped-torso-front'))) {
      failures.push('missing wrapped-torso-front patch');
    }
    if (!patchIds.some((id) => id.includes('wrapped-torso-back'))) {
      failures.push('missing wrapped-torso-back patch');
    }
  }
  if (proof === 'torsoTube') {
    if (!patchIds.includes('wrapped-torso-tube')) {
      failures.push('missing wrapped-torso-tube patch');
    }
    if (torsoVertexCount < 60) {
      failures.push(`torso tube vertex count ${torsoVertexCount} below minimum 60`);
    }
    if (stitchEdgeCount < 4) {
      failures.push(`torso tube seam stitch count ${stitchEdgeCount} too low`);
    }
  }
  if (proof === 'leftArm' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
    if (leftArmVertexCount < 40) {
      failures.push(`left arm vertex count ${leftArmVertexCount} below minimum 40`);
    }
    if (proof === 'leftArm' && stitchEdgeCount < 4) {
      failures.push(`left arm tube seam stitch count ${stitchEdgeCount} too low`);
    }
  }
  if (proof === 'rightArm' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
    if (rightArmVertexCount < 40) {
      failures.push(`right arm vertex count ${rightArmVertexCount} below minimum 40`);
    }
    if (proof === 'rightArm' && stitchEdgeCount < 4) {
      failures.push(`right arm tube seam stitch count ${stitchEdgeCount} too low`);
    }
  }
  if (proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
    const expectedShoulderStitches = 4 * (SHOULDER_STITCH_SAMPLES - 1);
    if (stitchEdgeCount < expectedShoulderStitches) {
      failures.push(`stitch count ${stitchEdgeCount} below expected shoulder minimum ${expectedShoulderStitches}`);
    }
  }
  if (proof === 'torso' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
    if (stitchEdgeCount < 4) {
      failures.push(`torso side seam stitch count ${stitchEdgeCount} below minimum 4`);
    }
  }

  const clearanceReport = auditShirtSdfClearance(assembly.vertices, sdfs, clearance);
  if (clearanceReport.penetrationCount > 0) {
    failures.push(
      `SDF penetration count ${clearanceReport.penetrationCount} (min signed distance ${clearanceReport.minSignedDistance.toFixed(4)})`,
    );
  }

  const maxStitchGap = measureMaxStitchGap(assembly);
  if (assembly.stitchEdges.length > 0 && maxStitchGap > 0.002) {
    failures.push(`stitch edges not coincident (max gap ${maxStitchGap.toFixed(4)}m)`);
  }

  const spacingAudit = auditMeshEdgeSpacing(
    assembly.vertices.map((vertex) => vertex.position),
    assembly.edges.filter((edge) => edge.kind === 'structural'),
    gridSpacing,
    GRID_SPACING_TOLERANCE,
  );
  const maxAllowedEdge = gridSpacing * (1 + GRID_SPACING_TOLERANCE);
  if (spacingAudit.percentile95EdgeLength > maxAllowedEdge) {
    failures.push(
      `structural edges exceed grid spacing (`
        + `p95 ${spacingAudit.percentile95EdgeLength.toFixed(4)}m > ${maxAllowedEdge.toFixed(4)}m)`,
    );
  }

  return {
    proof,
    passed: failures.length === 0,
    failures,
    vertexCount: assembly.vertices.length,
    faceCount: assembly.faces.length,
    patchIds,
    stitchEdgeCount,
    validationIssueCount: validationIssues.length,
    penetrationCount: clearanceReport.penetrationCount,
    minSignedDistance: clearanceReport.minSignedDistance,
    torsoVertexCount,
    leftArmVertexCount,
    rightArmVertexCount,
    maxStitchGap,
    maxEdgeLength: spacingAudit.maxEdgeLength,
    percentile95EdgeLength: spacingAudit.percentile95EdgeLength,
    longEdgeCount: spacingAudit.longEdgeCount,
  };
}

export function applyWrappedGarmentLooseness(
  assembly: ClothAssembly,
  loosenessRatio: number,
): ClothAssembly {
  if (loosenessRatio <= 0) {
    return assembly;
  }

  const scale = 1 + loosenessRatio;
  const edges = assembly.edges.map((edge) => (
    edge.kind === 'structural'
      ? { ...edge, restLength: edge.restLength * scale }
      : edge
  ));
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));

  return {
    ...assembly,
    edges,
    stitchEdges: assembly.stitchEdges.map((edge) => edgeById.get(edge.id) ?? edge),
  };
}

function reorderAndSnapArmShoulder(
  torsoPatch: ClothPatchDefinition,
  armPatch: ClothPatchDefinition,
  torsoBoundaryName: string,
  armBoundaryName: string,
): void {
  const torsoBoundary = torsoPatch.boundaries[torsoBoundaryName];
  const armBoundary = armPatch.boundaries[armBoundaryName];
  if (!torsoBoundary || !armBoundary || torsoBoundary.length !== armBoundary.length) {
    return;
  }

  const armVertices = armPatch.vertices as AssemblyVec3[];
  const torsoVertices = torsoPatch.vertices as AssemblyVec3[];
  const torsoSorted = [...torsoBoundary].sort(
    (a, b) => torsoVertices[a]![1] - torsoVertices[b]![1],
  );
  const armSorted = [...armBoundary].sort(
    (a, b) => armVertices[a]![1] - armVertices[b]![1],
  );
  const reorderedTorsoBoundary: number[] = [];
  const reorderedArmBoundary: number[] = [];

  for (let i = 0; i < torsoSorted.length; i++) {
    const torsoIndex = torsoSorted[i]!;
    const armIndex = armSorted[i]!;
    const torsoPos = torsoVertices[torsoIndex]!;
    reorderedTorsoBoundary.push(torsoIndex);
    reorderedArmBoundary.push(armIndex);
    armVertices[armIndex] = [...torsoPos] as AssemblyVec3;
  }

  (torsoPatch.boundaries as Record<string, number[]>)[torsoBoundaryName] = reorderedTorsoBoundary;
  (armPatch.boundaries as Record<string, number[]>)[armBoundaryName] = reorderedArmBoundary;
}

function resyncArmTubeSeamColumn(armPatch: ClothPatchDefinition): void {
  const seamStart = armPatch.boundaries.seamStart;
  const seamEnd = armPatch.boundaries.seamEnd;
  if (!seamStart || !seamEnd || seamStart.length !== seamEnd.length) {
    return;
  }

  const vertices = armPatch.vertices as AssemblyVec3[];
  for (let i = 0; i < seamStart.length; i++) {
    vertices[seamEnd[i]!] = [...vertices[seamStart[i]!]!] as AssemblyVec3;
  }
}

function resyncArmTubeSeamsInPatches(
  patches: readonly ClothPatchDefinition[],
): ClothPatchDefinition[] {
  return patches.map((patch) => {
    if (!patch.id.startsWith('wrapped-arm-')) {
      return patch;
    }
    const cloned = clonePatchDefinition(patch);
    resyncArmTubeSeamColumn(cloned);
    return cloned;
  });
}

function alignStitchBoundariesInPatches(
  patches: readonly ClothPatchDefinition[],
  stitches: readonly StitchDefinition[],
  sdfs: readonly BoneSdfCapsuleSample[],
  clearance: number,
): ClothPatchDefinition[] {
  const mutable = patches.map((patch) => clonePatchDefinition(patch));
  const patchById = new Map(mutable.map((patch) => [patch.id, patch]));

  for (const stitch of stitches) {
    const patchA = patchById.get(stitch.a.patchId);
    const patchB = patchById.get(stitch.b.patchId);
    if (!patchA || !patchB) {
      throw new Error(`Unknown patch in stitch "${stitch.id}"`);
    }

    const boundaryA = patchA.boundaries[stitch.a.boundary];
    const boundaryB = patchB.boundaries[stitch.b.boundary];
    if (!boundaryA || !boundaryB) {
      throw new Error(`Unknown boundary in stitch "${stitch.id}"`);
    }
    if (boundaryA.length !== boundaryB.length) {
      throw new Error(
        `Stitch "${stitch.id}" boundary counts differ (${boundaryA.length} vs ${boundaryB.length})`,
      );
    }

    for (let i = 0; i < boundaryA.length; i++) {
      const indexA = boundaryA[stitch.a.reversed ? boundaryA.length - 1 - i : i]!;
      const indexB = boundaryB[stitch.b.reversed ? boundaryB.length - 1 - i : i]!;
      const posA = new THREE.Vector3(...patchA.vertices[indexA]!);
      const posB = new THREE.Vector3(...patchB.vertices[indexB]!);
      const welded = projectToExteriorShell(
        posA.clone().add(posB).multiplyScalar(0.5),
        sdfs,
        clearance,
      );
      const weldedPos: AssemblyVec3 = [welded.x, welded.y, welded.z];
      (patchA.vertices as AssemblyVec3[])[indexA] = weldedPos;
      (patchB.vertices as AssemblyVec3[])[indexB] = weldedPos;
    }
  }

  return mutable;
}

function clonePatchDefinition(patch: ClothPatchDefinition): ClothPatchDefinition {
  return {
    ...patch,
    vertices: patch.vertices.map((vertex) => [...vertex] as AssemblyVec3),
    uvs: patch.uvs?.map((uv) => [...uv] as AssemblyVec2),
    faces: patch.faces.map((face) => [...face] as [number, number, number]),
    boundaries: Object.fromEntries(
      Object.entries(patch.boundaries).map(([name, indices]) => [name, [...indices]]),
    ),
  };
}

function weldStitchBoundaryVertices(
  assembly: ClothAssembly,
  sdfs: readonly BoneSdfCapsuleSample[],
  clearance: number,
): ClothAssembly {
  let weldedAssembly = assembly;

  for (let pass = 0; pass < 4; pass++) {
    const positions = weldedAssembly.vertices.map((vertex) => new THREE.Vector3(...vertex.position));

    for (const edge of weldedAssembly.stitchEdges) {
      const a = positions[edge.a]!;
      const b = positions[edge.b]!;
      const midpoint = a.clone().add(b).multiplyScalar(0.5);
      const shell = projectToExteriorShell(midpoint, sdfs, clearance);
      positions[edge.a]!.copy(shell);
      positions[edge.b]!.copy(shell);
    }

    weldedAssembly = {
      ...weldedAssembly,
      vertices: weldedAssembly.vertices.map((vertex, index) => ({
        ...vertex,
        position: [
          positions[index]!.x,
          positions[index]!.y,
          positions[index]!.z,
        ] as AssemblyVec3,
      })),
    };

    if (measureMaxStitchGap(weldedAssembly) < 1e-6) {
      break;
    }
  }

  return weldedAssembly;
}

function measureMaxStitchGap(assembly: ClothAssembly): number {
  let maxGap = 0;
  for (const edge of assembly.stitchEdges) {
    const a = assembly.vertices[edge.a]!.position;
    const b = assembly.vertices[edge.b]!.position;
    maxGap = Math.max(
      maxGap,
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    );
  }
  return maxGap;
}

function createWrapContext(
  anchors: CharacterAnchors,
  sdfs: readonly BoneSdfCapsuleSample[],
  options: WrappedGarmentBuilderOptions,
  forwardYawRad: number | null,
): WrapContext {
  return {
    anchors,
    sdfs,
    axes: resolveCharacterDressAxes(anchors, forwardYawRad),
    clearance: options.clearance ?? SHIRT_SDF_CLEARANCE,
    gridSpacing: options.gridSpacing ?? DEFAULT_GRID_SPACING,
    bottomLift: options.bottomLift ?? 0.04,
    topDrop: options.topDrop ?? 0.05,
    armLengthScale: options.armLengthScale ?? 0.82,
    looseness: options.looseness ?? 0,
  };
}

function collectWrappedPatchesAndStitches(
  proof: WrappedGarmentProofKind,
  context: WrapContext,
): WrappedBuildResult {
  const patches: ClothPatchDefinition[] = [];
  const stitches: StitchDefinition[] = [];
  const includeTorsoPanels = proof === 'torso' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose';
  const includeTorsoTube = proof === 'torsoTube';
  const includeLeftArm = proof === 'leftArm' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose';
  const includeRightArm = proof === 'rightArm' || proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose';
  const stitchShoulders = proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose';

  let frontTorso: ClothPatchDefinition | null = null;
  let backTorso: ClothPatchDefinition | null = null;
  let leftArm: ClothPatchDefinition | null = null;
  let rightArm: ClothPatchDefinition | null = null;

  if (includeTorsoTube) {
    patches.push(createWrappedTorsoTube(context));
    stitches.push({
      id: 'wrapped-torso-tube-seam',
      a: { patchId: 'wrapped-torso-tube', boundary: 'seamStart' },
      b: { patchId: 'wrapped-torso-tube', boundary: 'seamEnd', reversed: true },
      restLength: 0,
    });
  }
  if (includeTorsoPanels) {
    frontTorso = createWrappedTorsoPanel('front', context);
    backTorso = createWrappedTorsoPanel('back', context);
    patches.push(frontTorso, backTorso);
  }
  if (includeLeftArm) {
    leftArm = createWrappedArmTube('left', context);
    patches.push(leftArm);
    stitches.push({
      id: 'wrapped-arm-left-seam',
      a: { patchId: 'wrapped-arm-left', boundary: 'seamStart' },
      b: { patchId: 'wrapped-arm-left', boundary: 'seamEnd' },
      restLength: 0,
    });
  }
  if (includeRightArm) {
    rightArm = createWrappedArmTube('right', context);
    patches.push(rightArm);
    stitches.push({
      id: 'wrapped-arm-right-seam',
      a: { patchId: 'wrapped-arm-right', boundary: 'seamStart' },
      b: { patchId: 'wrapped-arm-right', boundary: 'seamEnd' },
      restLength: 0,
    });
  }

  if (includeTorsoPanels && frontTorso && backTorso) {
    const sideSeamSamples = frontTorso.boundaries.leftLowerSide?.length ?? 0;
    if (sideSeamSamples >= 2) {
      stitches.push(
        sideSeamStitch('wrapped-left-side-seam', 'wrapped-torso-front', 'leftLowerSide', 'wrapped-torso-back', 'leftLowerSide'),
        sideSeamStitch('wrapped-right-side-seam', 'wrapped-torso-front', 'rightLowerSide', 'wrapped-torso-back', 'rightLowerSide'),
      );
    }
  }

  if (stitchShoulders && frontTorso && backTorso && leftArm && rightArm) {
    reorderAndSnapArmShoulder(frontTorso, leftArm, 'leftShoulder', 'innerFrontHalf');
    reorderAndSnapArmShoulder(frontTorso, rightArm, 'rightShoulder', 'innerFrontHalf');
    reorderAndSnapArmShoulder(backTorso, leftArm, 'leftShoulder', 'innerBackHalf');
    reorderAndSnapArmShoulder(backTorso, rightArm, 'rightShoulder', 'innerBackHalf');
    resyncArmTubeSeamColumn(leftArm);
    resyncArmTubeSeamColumn(rightArm);
    stitches.push(
      shoulderStitch('wrapped-front-left-shoulder', 'wrapped-torso-front', 'leftShoulder', 'wrapped-arm-left', 'innerFrontHalf'),
      shoulderStitch('wrapped-back-left-shoulder', 'wrapped-torso-back', 'leftShoulder', 'wrapped-arm-left', 'innerBackHalf'),
      shoulderStitch('wrapped-front-right-shoulder', 'wrapped-torso-front', 'rightShoulder', 'wrapped-arm-right', 'innerFrontHalf'),
      shoulderStitch('wrapped-back-right-shoulder', 'wrapped-torso-back', 'rightShoulder', 'wrapped-arm-right', 'innerBackHalf'),
    );
  }

  return { patches, stitches };
}

function shoulderStitch(
  id: string,
  torsoPatchId: string,
  torsoBoundary: string,
  armPatchId: string,
  armBoundary: string,
  reversed = false,
): StitchDefinition {
  return {
    id,
    a: { patchId: torsoPatchId, boundary: torsoBoundary },
    b: { patchId: armPatchId, boundary: armBoundary, reversed },
    restLength: 0,
  };
}

function sideSeamStitch(
  id: string,
  frontPatchId: string,
  frontBoundary: string,
  backPatchId: string,
  backBoundary: string,
): StitchDefinition {
  return {
    id,
    a: { patchId: frontPatchId, boundary: frontBoundary },
    b: { patchId: backPatchId, boundary: backBoundary, reversed: true },
    restLength: 0,
  };
}

function projectWrappedPoint(scaffold: THREE.Vector3, context: WrapContext): THREE.Vector3 {
  return projectToExteriorShell(scaffold, context.sdfs, context.clearance);
}

function createWrappedTorsoTube(context: WrapContext): ClothPatchDefinition {
  const shoulderWidth = estimateShoulderWidth(context.anchors);
  const uKnots = buildMatchedArcLengthKnots(
    [
      (tu) => projectWrappedPoint(torsoTubeScaffoldPoint(tu, 0, context, shoulderWidth), context),
      (tu) => projectWrappedPoint(torsoTubeScaffoldPoint(tu, 1, context, shoulderWidth), context),
    ],
    { gridSpacing: context.gridSpacing, minSegments: 16, maxSegments: 48 },
  );
  const vKnots = buildMatchedArcLengthKnots(
    [
      (tv) => projectWrappedPoint(torsoTubeScaffoldPoint(0, tv, context, shoulderWidth), context),
      (tv) => projectWrappedPoint(torsoTubeScaffoldPoint(0.5, tv, context, shoulderWidth), context),
    ],
    { gridSpacing: context.gridSpacing, minSegments: 10, maxSegments: 48 },
  );
  const segmentsAround = uKnots.length - 1;
  const patch = createQuadGridPatch({
    id: 'wrapped-torso-tube',
    label: 'wrapped-torso-tube',
    uKnots,
    vKnots,
    sample: (tu, tv) => {
      const scaffold = torsoTubeScaffoldPoint(tu, tv, context, shoulderWidth);
      const wrapped = projectToExteriorShell(scaffold, context.sdfs, context.clearance);
      return [wrapped.x, wrapped.y, wrapped.z];
    },
    boundaries: {
      seamStart: (_uCount, _vCount, index) => range(0, vKnots.length - 1).map((v) => index(0, v)),
      seamEnd: (_uCount, _vCount, index) => range(0, vKnots.length - 1).map((v) => index(segmentsAround, v)),
    },
  });

  const vertices = patch.vertices as AssemblyVec3[];
  const idx = (u: number, v: number) => u * (vKnots.length) + v;
  for (let v = 0; v < vKnots.length; v++) {
    vertices[idx(segmentsAround, v)] = [...vertices[idx(0, v)]!];
  }
  return patch;
}

function resolveTorsoPanelKnots(context: WrapContext, shoulderWidth: number): TorsoPanelKnots {
  if (context.torsoPanelKnots) {
    return context.torsoPanelKnots;
  }

  const uSamples: ((tu: number) => THREE.Vector3)[] = [];
  for (const panel of ['front', 'back'] as const) {
    for (const tv of [0, 0.35, 0.7, 1]) {
      uSamples.push(
        (tu) => projectWrappedPoint(torsoScaffoldPoint(panel, tu, tv, context, shoulderWidth), context),
      );
    }
  }

  const vSamples: ((tv: number) => THREE.Vector3)[] = [
    (tv) => projectWrappedPoint(lateralSideScaffoldPoint('left', tv, context, shoulderWidth), context),
    (tv) => projectWrappedPoint(lateralSideScaffoldPoint('right', tv, context, shoulderWidth), context),
  ];
  for (const panel of ['front', 'back'] as const) {
    vSamples.push(
      (tv) => projectWrappedPoint(torsoScaffoldPoint(panel, 0.5, tv, context, shoulderWidth), context),
    );
  }

  context.torsoPanelKnots = {
    uKnots: buildMatchedArcLengthKnots(uSamples, {
      gridSpacing: context.gridSpacing,
      minSegments: 8,
      maxSegments: 64,
    }),
    vKnots: buildMatchedArcLengthKnots(vSamples, {
      gridSpacing: context.gridSpacing,
      minSegments: 10,
      maxSegments: 64,
    }),
  };
  return context.torsoPanelKnots;
}

function createWrappedTorsoPanel(
  panel: 'front' | 'back',
  context: WrapContext,
): ClothPatchDefinition {
  const shoulderWidth = estimateShoulderWidth(context.anchors);
  const patchId = panel === 'front' ? 'wrapped-torso-front' : 'wrapped-torso-back';
  const { uKnots, vKnots } = resolveTorsoPanelKnots(context, shoulderWidth);
  const segmentsU = uKnots.length - 1;
  const segmentsV = vKnots.length - 1;
  const shoulderStartV = segmentsV - (SHOULDER_STITCH_SAMPLES - 1);

  return createQuadGridPatch({
    id: patchId,
    label: patchId,
    uKnots,
    vKnots,
    sample: (tu, tv) => {
      const scaffold = tu <= uKnots[0]! + 1e-6
        ? lateralSideScaffoldPoint('left', tv, context, shoulderWidth)
        : tu >= uKnots[uKnots.length - 1]! - 1e-6
          ? lateralSideScaffoldPoint('right', tv, context, shoulderWidth)
          : torsoScaffoldPoint(panel, tu, tv, context, shoulderWidth);
      const wrapped = projectToExteriorShell(scaffold, context.sdfs, context.clearance);
      return [wrapped.x, wrapped.y, wrapped.z];
    },
    boundaries: {
      leftLowerSide: (_uCount, _vCount, index) => (
        shoulderStartV > 0
          ? range(0, shoulderStartV - 1).map((v) => index(0, v))
          : [index(0, 0)]
      ),
      rightLowerSide: (_uCount, _vCount, index) => (
        shoulderStartV > 0
          ? range(0, shoulderStartV - 1).map((v) => index(segmentsU, v))
          : [index(segmentsU, 0)]
      ),
      leftShoulder: (_uCount, _vCount, index) => range(shoulderStartV, segmentsV).map((v) => index(0, v)),
      rightShoulder: (_uCount, _vCount, index) => range(shoulderStartV, segmentsV).map((v) => index(segmentsU, v)),
    },
  });
}

function createWrappedArmTube(
  side: 'left' | 'right',
  context: WrapContext,
): ClothPatchDefinition {
  const patchId = side === 'left' ? 'wrapped-arm-left' : 'wrapped-arm-right';
  const target = createArmDressTarget(side, context);
  const projectArmPoint = (lengthT: number, ringT: number): THREE.Vector3 => (
    projectWrappedPoint(wrapArmPoint(target, lengthT, ringT, context.clearance), context)
  );
  const ringKnots = buildArcLengthKnots(
    (ringT) => projectArmPoint(0.42, ringT),
    { gridSpacing: context.gridSpacing, minSegments: MIN_ARM_RING_SEGMENTS, maxSegments: 48 },
  );
  const lengthKnots = buildMatchedArcLengthKnots(
    ringKnots.map((ringT) => (
      (lengthT) => projectArmPoint(lengthT, (ringT + 0.25) % 1)
    )),
    {
      gridSpacing: context.gridSpacing,
      minSegments: segmentsForChordLength(
        target.pathLength * context.armLengthScale,
        context.gridSpacing,
        5,
        32,
      ),
      maxSegments: 48,
    },
  );
  const segmentsAround = ringKnots.length - 1;
  const segmentsLength = lengthKnots.length - 1;
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const idx = (ring: number, length: number) => ring * (segmentsLength + 1) + length;

  // Grid ring 0 sits on the underarm; offset so shoulder opening faces the torso.
  const seamRing = 0;
  const shoulderRings = buildArmShoulderRings(segmentsAround, seamRing);

  for (let ring = 0; ring <= segmentsAround; ring++) {
    const ringT = (ringKnots[ring]! + 0.25) % 1;
    for (let length = 0; length <= segmentsLength; length++) {
      const lengthT = lengthKnots[length]!;
      const scaffold = wrapArmPoint(target, lengthT, ringT, context.clearance);
      const wrapped = projectToExteriorShell(scaffold, context.sdfs, context.clearance);
      vertices.push([wrapped.x, wrapped.y, wrapped.z]);
      uvs.push([lengthT, ring / segmentsAround]);
    }
  }

  for (let length = 0; length <= segmentsLength; length++) {
    vertices[idx(seamRing + segmentsAround, length)] = [...vertices[idx(seamRing, length)]!];
  }

  for (let ring = 0; ring < segmentsAround; ring++) {
    for (let length = 0; length < segmentsLength; length++) {
      const i00 = idx(ring, length);
      const i10 = idx(ring + 1, length);
      const i01 = idx(ring, length + 1);
      const i11 = idx(ring + 1, length + 1);
      faces.push([i00, i10, i01], [i10, i11, i01]);
    }
  }

  return {
    id: patchId,
    label: patchId,
    vertices,
    uvs,
    faces,
    boundaries: {
      innerFrontHalf: shoulderRings.map((ring) => idx(ring, 0)),
      innerBackHalf: shoulderRings.map((ring) => {
        const oppositeRing = (ring + Math.floor(segmentsAround / 2)) % (segmentsAround + 1);
        return idx(oppositeRing, 0);
      }),
      cuff: range(0, segmentsAround).map((ring) => idx(ring, segmentsLength)),
      seamStart: range(0, segmentsLength).map((length) => idx(seamRing, length)),
      seamEnd: range(0, segmentsLength).map((length) => idx(seamRing + segmentsAround, length)),
    },
  };
}

function torsoTubeScaffoldPoint(
  tu: number,
  tv: number,
  context: WrapContext,
  shoulderWidth: number,
): THREE.Vector3 {
  const hips = context.anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const neck = context.anchors.neck ?? context.anchors.chest ?? hips.clone().add(new THREE.Vector3(0, 0.55, 0));
  const bottomY = hips.y + context.bottomLift;
  const topY = neck.y - context.topDrop;
  const y = bottomY + tv * (topY - bottomY);
  const radius = THREE.MathUtils.lerp(shoulderWidth * 0.46, shoulderWidth * 0.5, smoothstep(tv));
  const angle = tu * Math.PI * 2;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return hips
    .clone()
    .addScaledVector(context.axes.xAxis, x)
    .addScaledVector(context.axes.yAxis, y - hips.y)
    .addScaledVector(context.axes.zAxis, z);
}

function lateralSideScaffoldPoint(
  side: 'left' | 'right',
  tv: number,
  context: WrapContext,
  shoulderWidth: number,
): THREE.Vector3 {
  const hips = context.anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const neck = context.anchors.neck ?? context.anchors.chest ?? hips.clone().add(new THREE.Vector3(0, 0.55, 0));
  const bottomY = hips.y + context.bottomLift;
  const topY = neck.y - context.topDrop;
  const y = bottomY + tv * (topY - bottomY);
  const width = THREE.MathUtils.lerp(shoulderWidth * 0.88, shoulderWidth * 0.98, smoothstep(tv));
  const sign = side === 'left' ? -1 : 1;
  const x = sign * width * 0.5;
  return hips
    .clone()
    .addScaledVector(context.axes.xAxis, x)
    .addScaledVector(context.axes.yAxis, y - hips.y);
}

function torsoScaffoldPoint(
  panel: 'front' | 'back',
  tu: number,
  tv: number,
  context: WrapContext,
  shoulderWidth: number,
): THREE.Vector3 {
  const hips = context.anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const neck = context.anchors.neck ?? context.anchors.chest ?? hips.clone().add(new THREE.Vector3(0, 0.55, 0));
  const bottomY = hips.y + context.bottomLift;
  const topY = neck.y - context.topDrop;
  const y = bottomY + tv * (topY - bottomY);
  const width = THREE.MathUtils.lerp(shoulderWidth * 0.88, shoulderWidth * 0.98, smoothstep(tv));
  const x = (tu - 0.5) * width;
  const zSign = panel === 'front' ? 1 : -1;
  const z = zSign * width * 0.1;
  return hips
    .clone()
    .addScaledVector(context.axes.xAxis, x)
    .addScaledVector(context.axes.yAxis, y - hips.y)
    .addScaledVector(context.axes.zAxis, z);
}

function createArmDressTarget(side: 'left' | 'right', context: WrapContext): ArmDressTarget {
  const shoulder = side === 'left' ? context.anchors.leftShoulder : context.anchors.rightShoulder;
  const fallbackSideAxis = side === 'left'
    ? context.axes.xAxis.clone().multiplyScalar(-1)
    : context.axes.xAxis.clone();
  const capsules = filterSideArmCapsules(context.sdfs, side).map((capsule) => ({
    start: new THREE.Vector3(...capsule.start),
    end: new THREE.Vector3(...capsule.end),
    radius: capsule.radius,
    name: capsule.name,
  }));

  const shoulderPoint = shoulder ?? context.anchors.chest ?? new THREE.Vector3(0, 1.1, 0);
  const points = [shoulderPoint.clone()];
  for (const capsule of capsules) {
    appendUniquePoint(points, capsule.start);
    appendUniquePoint(points, capsule.end);
  }
  points.sort((a, b) => a.distanceToSquared(shoulderPoint) - b.distanceToSquared(shoulderPoint));
  const path = points.length >= 2
    ? points
    : [shoulderPoint.clone(), shoulderPoint.clone().addScaledVector(fallbackSideAxis, 0.42)];

  return {
    path,
    capsules,
    frontAxis: context.axes.zAxis.clone(),
    fallbackSideAxis,
    pathLength: polylineLength(path),
  };
}

function wrapArmPoint(
  target: ArmDressTarget,
  lengthT: number,
  ringT: number,
  clearance: number,
): THREE.Vector3 {
  if (target.pathLength <= 0.0001) {
    return target.path[0]!.clone();
  }

  const centerSample = samplePolyline(target.path, target.pathLength * (0.08 + lengthT * 0.7));
  const aheadSample = samplePolyline(
    target.path,
    target.pathLength * Math.min(1, 0.12 + lengthT * 0.7),
  );
  const tangent = aheadSample.clone().sub(centerSample);
  if (tangent.lengthSq() < 0.000001) {
    tangent.copy(target.fallbackSideAxis);
  }
  tangent.normalize();

  let front = target.frontAxis.clone().addScaledVector(tangent, -target.frontAxis.dot(tangent));
  if (front.lengthSq() < 0.000001) {
    front.copy(target.fallbackSideAxis).addScaledVector(tangent, -target.fallbackSideAxis.dot(tangent));
  }
  if (front.lengthSq() < 0.000001) {
    front.set(0, 0, 1);
  }
  front.normalize();

  const upAroundArm = tangent.clone().cross(front).normalize();
  const angle = -Math.PI * 0.5 + ringT * Math.PI * 2;
  const radial = upAroundArm
    .multiplyScalar(Math.sin(angle))
    .addScaledVector(front, Math.cos(angle))
    .normalize();
  const nearestRadius = nearestCapsuleRadius(centerSample, target.capsules);
  return centerSample.addScaledVector(radial, nearestRadius + clearance + 0.03);
}

function freezePlacedRestLengths(assembly: ClothAssembly): ClothAssembly {
  const restLengthEdges = assembly.edges.map((edge) => {
    if (edge.kind === 'stitch') {
      return { ...edge, restLength: 0 };
    }
    const a = assembly.vertices[edge.a]!.position;
    const b = assembly.vertices[edge.b]!.position;
    return {
      ...edge,
      restLength: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    };
  });
  const edgeById = new Map(restLengthEdges.map((edge) => [edge.id, edge]));
  return {
    vertices: assembly.vertices,
    faces: assembly.faces,
    edges: restLengthEdges,
    stitchEdges: assembly.stitchEdges.map((edge) => edgeById.get(edge.id) ?? edge),
  };
}

function estimateShoulderWidth(anchors: CharacterAnchors): number {
  if (anchors.leftShoulder && anchors.rightShoulder) {
    return anchors.leftShoulder.distanceTo(anchors.rightShoulder);
  }
  return 0.48;
}

function estimateTorsoBandHeight(anchors: CharacterAnchors, bottomLift: number, topDrop: number): number {
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const neck = anchors.neck ?? anchors.chest ?? hips.clone().add(new THREE.Vector3(0, 0.55, 0));
  return Math.max(0.2, (neck.y - topDrop) - (hips.y + bottomLift));
}

function filterSideArmCapsules(
  capsules: readonly BoneSdfCapsuleSample[],
  side: 'left' | 'right',
): BoneSdfCapsuleSample[] {
  return capsules.filter((capsule) => {
    const key = (capsule.name ?? '').toLowerCase();
    return side === 'left'
      ? /left(shoulder|arm|forearm)/.test(key) && !/right/.test(key)
      : /right(shoulder|arm|forearm)/.test(key) && !/left/.test(key);
  });
}

function appendUniquePoint(points: THREE.Vector3[], candidate: THREE.Vector3): void {
  if (points.some((point) => point.distanceToSquared(candidate) < 0.0001)) {
    return;
  }
  points.push(candidate.clone());
}

function polylineLength(points: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += points[i - 1]!.distanceTo(points[i]!);
  }
  return length;
}

function samplePolyline(points: readonly THREE.Vector3[], distance: number): THREE.Vector3 {
  if (points.length === 0) {
    return new THREE.Vector3();
  }
  if (points.length === 1) {
    return points[0]!.clone();
  }

  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!;
    const end = points[i]!;
    const segmentLength = start.distanceTo(end);
    if (remaining <= segmentLength) {
      const t = segmentLength > 0 ? remaining / segmentLength : 0;
      return start.clone().lerp(end, t);
    }
    remaining -= segmentLength;
  }
  return points[points.length - 1]!.clone();
}

function nearestCapsuleRadius(point: THREE.Vector3, capsules: readonly ArmCapsuleTarget[]): number {
  let radius = 0.075;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const capsule of capsules) {
    const center = closestPointOnSegment(point, capsule.start, capsule.end);
    const distanceSq = center.distanceToSquared(point);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      radius = capsule.radius;
    }
  }
  return radius;
}

function closestPointOnSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq < 0.000001) {
    return start.clone();
  }
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
  return start.clone().addScaledVector(segment, t);
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function buildArmShoulderRings(segmentsAround: number, seamRing: number): number[] {
  const halfRingSegments = SHOULDER_STITCH_SAMPLES - 1;
  const seamEndRing = seamRing + segmentsAround;
  const shoulderRingStart = Math.floor(segmentsAround * 0.2);
  const candidate = range(shoulderRingStart, shoulderRingStart + halfRingSegments);
  const filtered = candidate.filter((ring) => {
    const oppositeRing = (ring + Math.floor(segmentsAround / 2)) % (segmentsAround + 1);
    return oppositeRing !== seamRing && oppositeRing !== seamEndRing;
  });

  if (filtered.length >= SHOULDER_STITCH_SAMPLES) {
    return filtered.slice(0, SHOULDER_STITCH_SAMPLES);
  }

  const extra = range(
    shoulderRingStart + halfRingSegments + 1,
    shoulderRingStart + halfRingSegments + (SHOULDER_STITCH_SAMPLES - filtered.length),
  );
  return [...filtered, ...extra].slice(0, SHOULDER_STITCH_SAMPLES);
}

function range(start: number, endInclusive: number): number[] {
  return Array.from({ length: endInclusive - start + 1 }, (_, index) => start + index);
}

function resolveProofOptions(
  proof: WrappedGarmentProofKind,
  options: WrappedGarmentBuilderOptions = {},
): WrappedGarmentBuilderOptions {
  if (proof === 'torsoAndArmsLoose') {
    return {
      ...options,
      looseness: options.looseness ?? 0.08,
    };
  }
  return options;
}
