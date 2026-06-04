import type GUI from 'lil-gui';
import * as THREE from 'three';
import type { ClothAssembly, ClothSimulation } from '../cloth';
import type { AnimatedCharacterSceneRig, ShirtAnchorReport } from './AnimatedCharacter';
import {
  generateGarmentPresetAssembly,
  measurePleatedSkirtMaterial,
  summarizeGarmentAssembly,
  type GarmentAssemblyStats,
} from '../garments/garmentGenerator';
import {
  createGarmentPresetEnvelope,
  type GarmentPresetEnvelope,
} from '../garments/garmentSchema';
import type { AssemblyVertex } from '../cloth/patternAssembly';
import {
  auditAssemblyStrain,
  auditBodyNotFloatingOverArms,
  auditEdgeCapsuleClearance,
  auditPerCapsuleClearance,
  auditShirtSdfClearance,
  auditTriangleCapsuleClearance,
  auditTriangleQuality,
  DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  placeCharacterTShirtAssembly,
  projectToExteriorShell,
  SHIRT_SDF_CLEARANCE,
  type AssemblyStrainReport,
  type BodyArmDrapeReport,
  type CharacterTShirtGenerationOptions,
  type EdgeCapsuleClearanceReport,
  type PerCapsuleClearanceReport,
  type ShirtSdfClearanceReport,
  type TriangleCapsuleClearanceReport,
  type TriangleQualityReport,
} from './shirtDressing';

const CHARACTER_SHIRT_COLLISION_MARGIN = 0.018;
const CHARACTER_SHIRT_TEAR_PROTECTION_MS = 1_000;
const CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD = 999_999;
const LEFT_FIT_COLOR = 0x45a3ff;
const RIGHT_FIT_COLOR = 0xff7a45;
const WAIST_FIT_COLOR = 0xffe66d;

export interface CharacterShirtSurfaceReport {
  readonly vertex: ShirtSdfClearanceReport;
  readonly perCapsule: PerCapsuleClearanceReport;
  readonly edge: EdgeCapsuleClearanceReport;
  readonly triangle: TriangleCapsuleClearanceReport;
  readonly strain: AssemblyStrainReport;
  readonly quality: TriangleQualityReport;
}

export interface CharacterGarmentFitReport {
  readonly garmentType: string;
  readonly vertexCount: number;
  readonly fixedVertexCount: number;
  readonly waistVertexCount: number;
  readonly waistCenterY: number;
  readonly waistDropFromHips: number;
  readonly maxWaistRadius: number;
  readonly leftHemCenterX: number | null;
  readonly rightHemCenterX: number | null;
  readonly hemBottomY: number | null;
  readonly targetHemBottomY: number | null;
  readonly minLeftRightHemGap: number | null;
  readonly leftFootX: number | null;
  readonly rightFootX: number | null;
  readonly leftHemToLeftFoot: number | null;
  readonly leftHemToRightFoot: number | null;
  readonly rightHemToRightFoot: number | null;
  readonly rightHemToLeftFoot: number | null;
  readonly minHemOpeningDistance: number | null;
  readonly hemAssignment: 'correct' | 'swapped' | 'ambiguous' | 'unavailable';
}

export class CharacterGarmentFlow {
  readonly options: CharacterTShirtGenerationOptions = { ...DEFAULT_CHARACTER_T_SHIRT_OPTIONS };

  private assembly: ClothAssembly;
  private activePreset: GarmentPresetEnvelope;
  private activeStats: GarmentAssemblyStats | null = null;
  private activeFitReport: CharacterGarmentFitReport | null = null;
  private readonly fitDebugGroup = new THREE.Group();
  private readonly dressTimeSdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>;
  private readonly dressTimeAnchors: ReturnType<AnimatedCharacterSceneRig['getCharacterAnchors']>;
  private tearProtectionTimeout: ReturnType<typeof window.setTimeout> | null = null;
  private tearProtectionRestoreThreshold: number;

  constructor(
    private readonly cloth: ClothSimulation,
    private readonly rig: AnimatedCharacterSceneRig,
    private readonly particlesEl?: HTMLElement,
  ) {
    this.dressTimeSdfs = rig.getBoneSdfSummary();
    this.dressTimeAnchors = rig.getCharacterAnchors();
    this.fitDebugGroup.name = 'character-garment-fit-debug';
    this.fitDebugGroup.visible = false;
    this.cloth.scene.add(this.fitDebugGroup);
    this.activePreset = createGarmentPresetEnvelope('Character T-shirt', 'tshirt', this.options);
    this.assembly = this.fitPresetAssembly(this.activePreset);
    this.tearProtectionRestoreThreshold = cloth.settings.tearStretchThreshold;
  }

  getAssembly(): ClothAssembly {
    return this.assembly;
  }

  async load(): Promise<void> {
    await this.loadPresetForSimulation(this.activePreset);
  }

  async loadPreset(preset: GarmentPresetEnvelope): Promise<GarmentAssemblyStats> {
    await this.loadPresetForSimulation(preset);
    return this.getStats();
  }

  private async loadPresetForSimulation(preset: GarmentPresetEnvelope): Promise<void> {
    this.startTearProtection();
    this.cloth.setBoneSdfCapsules([]);
    this.activePreset = preset;
    this.assembly = this.fitPresetAssembly(preset);
    this.activeStats = null;
    this.activeFitReport = null;
    if (this.fitDebugGroup.visible) {
      this.updateFitDebugVisuals();
    }
    await this.cloth.loadClothAssembly(this.assembly);
    await this.warmupCollision();
    this.finishTearProtectionAfterDelay();
    this.updateParticleLabel();
  }

  getActivePreset(): GarmentPresetEnvelope {
    return this.activePreset;
  }

  getStats(): GarmentAssemblyStats {
    this.activeStats ??= this.statsForAssembly(this.activePreset, this.assembly);
    return this.activeStats;
  }

  getFitReport(): CharacterGarmentFitReport {
    this.activeFitReport ??= createFitReport(this.activePreset, this.assembly, this.dressTimeAnchors, this.dressTimeSdfs);
    return this.activeFitReport;
  }

  setFitDebugVisible(visible: boolean): void {
    if (visible && this.fitDebugGroup.children.length === 0) {
      this.updateFitDebugVisuals();
    }
    this.fitDebugGroup.visible = visible;
  }

  isFitDebugVisible(): boolean {
    return this.fitDebugGroup.visible;
  }

  setTearThreshold(threshold: number): void {
    if (this.tearProtectionTimeout === null) {
      this.tearProtectionRestoreThreshold = threshold;
      this.cloth.settings.tearStretchThreshold = threshold;
    } else {
      this.tearProtectionRestoreThreshold = threshold;
    }
    this.cloth.applySettings();
  }

  tearProtectionReport(): {
    active: boolean;
    restoreThreshold: number;
    currentThreshold: number;
  } {
    return {
      active: this.tearProtectionTimeout !== null,
      restoreThreshold: this.tearProtectionRestoreThreshold,
      currentThreshold: this.cloth.settings.tearStretchThreshold,
    };
  }

  sdfClearanceReport(): ShirtSdfClearanceReport {
    return auditShirtSdfClearance(this.assembly.vertices, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE);
  }

  perCapsuleClearanceReport(): PerCapsuleClearanceReport {
    return auditPerCapsuleClearance(this.assembly.vertices, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE);
  }

  edgeClearanceReport(): EdgeCapsuleClearanceReport {
    return auditEdgeCapsuleClearance(this.assembly, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE);
  }

  triangleClearanceReport(): TriangleCapsuleClearanceReport {
    return auditTriangleCapsuleClearance(this.assembly, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE);
  }

  strainReport(): AssemblyStrainReport {
    return auditAssemblyStrain(this.assembly);
  }

  triangleQualityReport(): TriangleQualityReport {
    return auditTriangleQuality(this.assembly);
  }

  bodyArmDrapeReport(): BodyArmDrapeReport {
    const armCapsules = this.dressTimeSdfs.filter((capsule) => /arm|shoulder|forearm/i.test(capsule.name));
    return auditBodyNotFloatingOverArms(this.assembly.vertices, armCapsules, SHIRT_SDF_CLEARANCE);
  }

  async settledSurfaceReport(): Promise<CharacterShirtSurfaceReport> {
    const settledAssembly = await this.cloth.readCurrentClothAssembly(this.assembly);
    return {
      vertex: auditShirtSdfClearance(settledAssembly.vertices, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE),
      perCapsule: auditPerCapsuleClearance(settledAssembly.vertices, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE),
      edge: auditEdgeCapsuleClearance(settledAssembly, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE),
      triangle: auditTriangleCapsuleClearance(settledAssembly, this.dressTimeSdfs, SHIRT_SDF_CLEARANCE),
      strain: auditAssemblyStrain(settledAssembly, 0.18),
      quality: auditTriangleQuality(settledAssembly),
    };
  }

  async settledFitReport(): Promise<CharacterGarmentFitReport> {
    const settledAssembly = await this.cloth.readCurrentClothAssembly(this.assembly);
    return createFitReport(this.activePreset, settledAssembly, this.dressTimeAnchors, this.dressTimeSdfs);
  }

  anchorReport(): ShirtAnchorReport {
    const stats = this.cloth.getStats();
    const namedAnchors = Object.entries(this.dressTimeAnchors)
      .filter(([, value]) => value !== null)
      .map(([name]) => name);
    const neckTarget = this.dressTimeAnchors.neck ?? this.dressTimeAnchors.chest ?? new THREE.Vector3();
    const neckVertices = this.assembly.vertices.filter((vertex) => vertex.patchId.includes('neck-binding'));
    const shirtNeck = averageAssemblyPosition(neckVertices.length > 0 ? neckVertices : this.assembly.vertices);
    return {
      hasRequiredAnchors: Boolean(
        this.dressTimeAnchors.hips &&
        this.dressTimeAnchors.chest &&
        this.dressTimeAnchors.neck &&
        this.dressTimeAnchors.leftArm &&
        this.dressTimeAnchors.rightArm
      ),
      visible: true,
      bodyWidth: this.estimateActiveWidth(),
      torsoHeight: this.estimateActiveHeight(),
      sleeveLength: this.activePreset.garmentType === 'tshirt' ? this.options.sleeveLength : 0,
      sleeveOpening: this.activePreset.garmentType === 'tshirt' ? this.options.sleeveOpening : 0,
      vertexCount: this.assembly.vertices.length,
      faceCount: this.assembly.faces.length,
      stitchEdgeCount: this.assembly.stitchEdges.length,
      center: [stats.centerX, stats.centerY, stats.centerZ],
      neckGap: shirtNeck.distanceTo(neckTarget),
      anchorNames: namedAnchors,
    };
  }

  private fitPresetAssembly(preset: GarmentPresetEnvelope): ClothAssembly {
    if (preset.garmentType === 'tshirt') {
      Object.assign(this.options, preset.params);
      return placeCharacterTShirtAssembly(this.rig, SHIRT_SDF_CLEARANCE, this.options);
    }

    const generated = generateGarmentPresetAssembly(preset);
    const fitted = fitGeneratedAssemblyToCharacter(
      generated.assembly,
      preset.garmentType === 'skirt' || preset.garmentType === 'pleatedSkirt'
        ? 'skirt'
        : preset.garmentType === 'elasticShorts'
          ? 'shorts'
          : 'longPants',
      this.dressTimeAnchors,
      this.dressTimeSdfs,
    );
    return fitted;
  }

  private statsForAssembly(preset: GarmentPresetEnvelope, assembly: ClothAssembly): GarmentAssemblyStats {
    const baseStats = summarizeGarmentAssembly(preset.garmentType, assembly);
    return {
      ...baseStats,
      ...(preset.garmentType === 'pleatedSkirt' ? measurePleatedSkirtMaterial(preset.params) : {}),
    };
  }

  private estimateActiveWidth(): number {
    const bounds = assemblyBounds(this.assembly);
    return bounds.size.x;
  }

  private estimateActiveHeight(): number {
    const bounds = assemblyBounds(this.assembly);
    return bounds.size.y;
  }

  private clearTearProtection(): void {
    if (this.tearProtectionTimeout !== null) {
      window.clearTimeout(this.tearProtectionTimeout);
      this.tearProtectionTimeout = null;
    }
  }

  private startTearProtection(): void {
    this.clearTearProtection();
    if (this.cloth.settings.tearStretchThreshold < CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD) {
      this.tearProtectionRestoreThreshold = this.cloth.settings.tearStretchThreshold;
    }
    this.cloth.settings.tearStretchThreshold = CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD;
    this.cloth.applySettings();
  }

  private finishTearProtectionAfterDelay(): void {
    this.clearTearProtection();
    this.tearProtectionTimeout = window.setTimeout(() => {
      this.tearProtectionTimeout = null;
      this.cloth.settings.tearStretchThreshold = this.tearProtectionRestoreThreshold;
      this.cloth.applySettings();
    }, CHARACTER_SHIRT_TEAR_PROTECTION_MS);
  }

  private async warmupCollision(): Promise<void> {
    await waitForAnimationFrames(6);
    for (const margin of [
      CHARACTER_SHIRT_COLLISION_MARGIN * 0.25,
      CHARACTER_SHIRT_COLLISION_MARGIN * 0.6,
      CHARACTER_SHIRT_COLLISION_MARGIN,
    ]) {
      this.cloth.settings.mannequinMargin = margin;
      this.cloth.applySettings();
      this.cloth.setBoneSdfCapsules(this.rig.getBoneSdfSummary());
      await waitForAnimationFrames(6);
    }
  }

  private updateParticleLabel(): void {
    if (this.particlesEl) {
      this.particlesEl.textContent =
        `character ${this.activePreset.garmentType} particles: ${this.cloth.getStats().particleCount}`;
    }
  }

  private updateFitDebugVisuals(): void {
    this.fitDebugGroup.clear();
    const bounds = assemblyBounds(this.assembly);
    const waistVertices = this.assembly.vertices.filter((vertex) =>
      vertex.position[1] >= bounds.max.y - Math.max(0.035, bounds.size.y * 0.08) ||
      /waistband|elastic-casing/i.test(vertex.patchId)
    );
    const waistCenter = averageAssemblyPosition(waistVertices.length > 0 ? waistVertices : this.assembly.vertices);
    addDebugMarker(this.fitDebugGroup, waistCenter, WAIST_FIT_COLOR, 'garment-waist-center', 0.022);

    const leftFoot = footCenter('left', this.dressTimeSdfs);
    const rightFoot = footCenter('right', this.dressTimeSdfs);
    if (leftFoot) {
      addDebugMarker(this.fitDebugGroup, leftFoot, LEFT_FIT_COLOR, 'left-foot-target', 0.018);
    }
    if (rightFoot) {
      addDebugMarker(this.fitDebugGroup, rightFoot, RIGHT_FIT_COLOR, 'right-foot-target', 0.018);
    }

    const leftHem = hemVertices(this.assembly, 'left');
    const rightHem = hemVertices(this.assembly, 'right');
    if (leftHem.length > 0) {
      addDebugMarker(this.fitDebugGroup, averageAssemblyPosition(leftHem), LEFT_FIT_COLOR, 'left-hem-center', 0.014);
    }
    if (rightHem.length > 0) {
      addDebugMarker(this.fitDebugGroup, averageAssemblyPosition(rightHem), RIGHT_FIT_COLOR, 'right-hem-center', 0.014);
    }
  }
}

type CharacterFitKind = 'skirt' | 'shorts' | 'longPants';

function fitGeneratedAssemblyToCharacter(
  assembly: ClothAssembly,
  kind: CharacterFitKind,
  anchors: ReturnType<AnimatedCharacterSceneRig['getCharacterAnchors']>,
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
): ClothAssembly {
  const bounds = assemblyBounds(assembly);
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const chest = anchors.chest ?? new THREE.Vector3(0, 1.12, 0);
  const leftShoulder = anchors.leftShoulder;
  const rightShoulder = anchors.rightShoulder;
  const xAxis = leftShoulder && rightShoulder
    ? rightShoulder.clone().sub(leftShoulder)
    : new THREE.Vector3(1, 0, 0);
  xAxis.y = 0;
  if (xAxis.lengthSq() < 0.0001) {
    xAxis.set(1, 0, 0);
  }
  xAxis.normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = xAxis.clone().cross(yAxis).normalize();
  const shoulderWidth = leftShoulder && rightShoulder
    ? leftShoulder.distanceTo(rightShoulder)
    : Math.max(0.48, Math.abs(chest.y - hips.y) * 0.8);
  const targetWidth = kind === 'skirt' ? shoulderWidth * 0.78 : shoulderWidth * 0.86;
  const scaleXZ = THREE.MathUtils.clamp(targetWidth / Math.max(0.1, bounds.size.x), 0.72, 1.28);
  const targetTopY = hips.y + (kind === 'skirt' ? 0.055 : 0.035);
  const targetBottomY = lowerBodyHemTargetY(kind, hips, sdfs);
  const lowerBodyFitHeight = Math.max(0.12, targetTopY - targetBottomY);
  const scaleY = kind === 'skirt'
    ? 1
    : THREE.MathUtils.clamp(
        lowerBodyFitHeight / Math.max(0.12, bounds.size.y),
        kind === 'shorts' ? 0.3 : 0.18,
        1.35,
      );
  const targetCenter = hips.clone();
  const rawCenterX = (bounds.min.x + bounds.max.x) * 0.5;
  const rawCenterZ = (bounds.min.z + bounds.max.z) * 0.5;
  const leftLegRail = createSideLegRail('left', hips, sdfs, xAxis, zAxis, shoulderWidth);
  const rightLegRail = createSideLegRail('right', hips, sdfs, xAxis, zAxis, shoulderWidth);
  const leftRawCenter = rawSideCenter(assembly.vertices, 'left');
  const rightRawCenter = rawSideCenter(assembly.vertices, 'right');

  const fittedVertices = assembly.vertices.map((vertex) => {
    const side = kind === 'skirt' ? null : legSideForPatch(vertex.patchId);
    if (side) {
      const rawSide = side === 'left' ? leftRawCenter : rightRawCenter;
      const rawDescent = THREE.MathUtils.clamp(
        (bounds.max.y - vertex.position[1]) / Math.max(0.001, bounds.size.y),
        0,
        1,
      );
      const targetY = targetTopY - rawDescent * lowerBodyFitHeight;
      const railOffset = side === 'left'
        ? sampleSideLegRail(leftLegRail, targetY)
        : sampleSideLegRail(rightLegRail, targetY);
      const radialX = (vertex.position[0] - rawSide.x) * scaleXZ * 0.52;
      const radialZ = (vertex.position[2] - rawSide.z) * scaleXZ * 0.52;
      const shell = targetCenter
        .clone()
        .addScaledVector(xAxis, railOffset.x + radialX)
        .addScaledVector(yAxis, targetY - hips.y)
        .addScaledVector(zAxis, railOffset.z + radialZ);
      const clearance = projectToExteriorShell(shell, sdfs, SHIRT_SDF_CLEARANCE * 0.75);
      const minProjectedX = (side === 'left' ? -1 : 1) * Math.max(0.06, shoulderWidth * 0.2);
      const projectedX = clearance.clone().sub(hips).dot(xAxis);
      if ((side === 'left' && projectedX > minProjectedX) || (side === 'right' && projectedX < minProjectedX)) {
        clearance.addScaledVector(xAxis, minProjectedX - projectedX);
      }
      if (kind === 'longPants' && clearance.y < targetBottomY) {
        clearance.y = targetBottomY;
      }
      return {
        ...vertex,
        position: [clearance.x, clearance.y, clearance.z] as [number, number, number],
      };
    }

    const local = new THREE.Vector3(
      (vertex.position[0] - rawCenterX) * scaleXZ,
      (vertex.position[1] - bounds.max.y) * scaleY,
      (vertex.position[2] - rawCenterZ) * scaleXZ,
    );
    const world = targetCenter
      .clone()
      .addScaledVector(xAxis, local.x)
      .addScaledVector(yAxis, targetTopY - hips.y + local.y)
      .addScaledVector(zAxis, local.z);
    if (kind === 'longPants' && world.y < targetBottomY) {
      world.y = targetBottomY;
    }
    const shell = projectToExteriorShell(world, sdfs, kind === 'skirt' ? SHIRT_SDF_CLEARANCE : SHIRT_SDF_CLEARANCE * 0.75);
    if (kind === 'longPants' && shell.y < targetBottomY) {
      shell.y = targetBottomY;
    }
    return {
      ...vertex,
      position: [shell.x, shell.y, shell.z] as [number, number, number],
    };
  });

  const fittedEdges = restLengthEdgesFromVertices(assembly.edges, fittedVertices);
  if (kind === 'shorts' || kind === 'longPants') {
    fittedEdges.push(...createLegOpeningBraceEdges(fittedVertices, fittedEdges.length));
  }

  return {
    vertices: fittedVertices,
    faces: assembly.faces,
    edges: fittedEdges,
    stitchEdges: restLengthEdgesFromVertices(assembly.stitchEdges, fittedVertices),
  };
}

function lowerBodyHemTargetY(
  kind: CharacterFitKind,
  hips: THREE.Vector3,
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
): number {
  if (kind === 'skirt') {
    return hips.y - 0.58;
  }

  const footY = minCapsuleY(sdfs, /foot/i);
  const kneeY = minCapsuleY(sdfs, /leg|knee|calf/i);
  if (kind === 'shorts') {
    return Number.isFinite(kneeY) ? THREE.MathUtils.lerp(hips.y, kneeY, 0.58) : hips.y - 0.34;
  }
  return Number.isFinite(footY) ? footY + 0.055 : hips.y - 0.9;
}

function createLegOpeningBraceEdges(
  vertices: readonly AssemblyVertex[],
  startId: number,
): ClothAssembly['edges'] {
  const edges: ClothAssembly['edges'] = [];
  let nextId = startId;
  for (const side of ['left', 'right'] as const) {
    const ring = hemVertices({ vertices, faces: [], edges: [], stitchEdges: [] }, side);
    if (ring.length < 4) {
      continue;
    }
    const center = averageAssemblyPosition(ring);
    const sorted = [...ring].sort((a, b) =>
      Math.atan2(a.position[2] - center.z, a.position[0] - center.x) -
      Math.atan2(b.position[2] - center.z, b.position[0] - center.x)
    );
    const half = Math.floor(sorted.length / 2);
    for (let i = 0; i < half; i++) {
      const a = sorted[i]!;
      const b = sorted[(i + half) % sorted.length]!;
      if (a.id === b.id) {
        continue;
      }
      edges.push({
        id: nextId++,
        a: a.id,
        b: b.id,
        kind: 'structural',
        restLength: new THREE.Vector3(...a.position).distanceTo(new THREE.Vector3(...b.position)),
        sourceId: `character-${side}-cuff-brace`,
      });
    }
  }
  return edges;
}

function rawSideCenter(vertices: readonly AssemblyVertex[], side: 'left' | 'right'): { x: number; z: number } {
  const sideVertices = vertices.filter((vertex) => legSideForPatch(vertex.patchId) === side);
  if (sideVertices.length === 0) {
    return { x: side === 'left' ? -0.12 : 0.12, z: 0 };
  }
  const sum = sideVertices.reduce(
    (acc, vertex) => {
      acc.x += vertex.position[0];
      acc.z += vertex.position[2];
      return acc;
    },
    { x: 0, z: 0 },
  );
  return {
    x: sum.x / sideVertices.length,
    z: sum.z / sideVertices.length,
  };
}

interface LegRailSample {
  readonly y: number;
  readonly x: number;
  readonly z: number;
}

function createSideLegRail(
  side: 'left' | 'right',
  hips: THREE.Vector3,
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
  xAxis: THREE.Vector3,
  zAxis: THREE.Vector3,
  shoulderWidth: number,
): LegRailSample[] {
  const sidePattern = side === 'left' ? /left/i : /right/i;
  const legPattern = /(up)?leg|thigh|calf|foot/i;
  const samples: LegRailSample[] = [];
  for (const capsule of sdfs) {
    if (!sidePattern.test(capsule.name) || !legPattern.test(capsule.name)) {
      continue;
    }
    const center = new THREE.Vector3(
      (capsule.start[0] + capsule.end[0]) * 0.5,
      (capsule.start[1] + capsule.end[1]) * 0.5,
      (capsule.start[2] + capsule.end[2]) * 0.5,
    );
    const relative = center.clone().sub(hips);
    samples.push({
      y: center.y,
      x: relative.dot(xAxis),
      z: relative.dot(zAxis),
    });
  }

  const fallbackSign = side === 'left' ? -1 : 1;
  if (samples.length === 0) {
    return [
      { y: hips.y - shoulderWidth * 0.25, x: fallbackSign * shoulderWidth * 0.2, z: 0 },
      { y: hips.y - shoulderWidth * 1.55, x: fallbackSign * shoulderWidth * 0.16, z: 0 },
    ];
  }

  samples.sort((a, b) => b.y - a.y);
  const minSideOffset = shoulderWidth * 0.17;
  return samples.map((sample) => ({
    ...sample,
    x: sample.x * fallbackSign < minSideOffset ? fallbackSign * minSideOffset : sample.x,
  }));
}

function sampleSideLegRail(samples: readonly LegRailSample[], y: number): { x: number; z: number } {
  if (samples.length === 0) {
    return { x: 0, z: 0 };
  }
  if (y >= samples[0]!.y) {
    return samples[0]!;
  }
  const last = samples[samples.length - 1]!;
  if (y <= last.y) {
    return last;
  }
  for (let i = 0; i < samples.length - 1; i++) {
    const upper = samples[i]!;
    const lower = samples[i + 1]!;
    if (y <= upper.y && y >= lower.y) {
      const t = (upper.y - y) / Math.max(0.0001, upper.y - lower.y);
      return {
        x: THREE.MathUtils.lerp(upper.x, lower.x, t),
        z: THREE.MathUtils.lerp(upper.z, lower.z, t),
      };
    }
  }
  return last;
}

function legSideForPatch(patchId: string): 'left' | 'right' | null {
  if (/-left-|left-/i.test(patchId)) {
    return 'left';
  }
  if (/-right-|right-/i.test(patchId)) {
    return 'right';
  }
  return null;
}

function createFitReport(
  preset: GarmentPresetEnvelope,
  assembly: ClothAssembly,
  anchors: ReturnType<AnimatedCharacterSceneRig['getCharacterAnchors']>,
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
): CharacterGarmentFitReport {
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.78, 0);
  const xAxis = characterXAxis(anchors);
  const bounds = assemblyBounds(assembly);
  const waistVertices = assembly.vertices.filter((vertex) =>
    vertex.position[1] >= bounds.max.y - Math.max(0.035, bounds.size.y * 0.08) ||
    /waistband|elastic-casing/i.test(vertex.patchId)
  );
  const waistCenter = averageAssemblyPosition(waistVertices.length > 0 ? waistVertices : assembly.vertices);
  const maxWaistRadius = waistVertices.reduce((maxRadius, vertex) => {
    const dx = vertex.position[0] - hips.x;
    const dz = vertex.position[2] - hips.z;
    return Math.max(maxRadius, Math.hypot(dx, dz));
  }, 0);
  const leftHem = hemVertices(assembly, 'left');
  const rightHem = hemVertices(assembly, 'right');
  const leftHemCenter = leftHem.length > 0 ? averageAssemblyPosition(leftHem) : null;
  const rightHemCenter = rightHem.length > 0 ? averageAssemblyPosition(rightHem) : null;
  const leftHemProjectedX = leftHemCenter ? leftHemCenter.clone().sub(hips).dot(xAxis) : null;
  const rightHemProjectedX = rightHemCenter ? rightHemCenter.clone().sub(hips).dot(xAxis) : null;
  const zAxis = xAxis.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  const leftFoot = footCenter('left', sdfs);
  const rightFoot = footCenter('right', sdfs);
  const leftFootProjection = leftFoot ? projectRelativeXZ(leftFoot, hips, xAxis, zAxis) : null;
  const rightFootProjection = rightFoot ? projectRelativeXZ(rightFoot, hips, xAxis, zAxis) : null;
  const leftHemProjection = leftHemCenter ? projectRelativeXZ(leftHemCenter, hips, xAxis, zAxis) : null;
  const rightHemProjection = rightHemCenter ? projectRelativeXZ(rightHemCenter, hips, xAxis, zAxis) : null;
  const leftHemToLeftFoot = leftHemProjection && leftFootProjection
    ? distance2(leftHemProjection, leftFootProjection)
    : null;
  const leftHemToRightFoot = leftHemProjection && rightFootProjection
    ? distance2(leftHemProjection, rightFootProjection)
    : null;
  const rightHemToRightFoot = rightHemProjection && rightFootProjection
    ? distance2(rightHemProjection, rightFootProjection)
    : null;
  const rightHemToLeftFoot = rightHemProjection && leftFootProjection
    ? distance2(rightHemProjection, leftFootProjection)
    : null;
  const hemVerticesAll = [...leftHem, ...rightHem];
  const hemBottomY = hemVerticesAll.length > 0
    ? Math.min(...hemVerticesAll.map((vertex) => vertex.position[1]))
    : null;
  const targetHemBottomY =
    preset.garmentType === 'trousers' || preset.garmentType === 'jeans'
      ? lowerBodyHemTargetY('longPants', hips, sdfs)
      : preset.garmentType === 'elasticShorts'
        ? lowerBodyHemTargetY('shorts', hips, sdfs)
        : null;

  return {
    garmentType: preset.garmentType,
    vertexCount: assembly.vertices.length,
    fixedVertexCount: 0,
    waistVertexCount: waistVertices.length,
    waistCenterY: waistCenter.y,
    waistDropFromHips: hips.y - waistCenter.y,
    maxWaistRadius,
    leftHemCenterX: leftHemProjectedX,
    rightHemCenterX: rightHemProjectedX,
    hemBottomY,
    targetHemBottomY,
    minLeftRightHemGap:
      leftHemProjectedX !== null && rightHemProjectedX !== null ? rightHemProjectedX - leftHemProjectedX : null,
    leftFootX: leftFootProjection?.x ?? null,
    rightFootX: rightFootProjection?.x ?? null,
    leftHemToLeftFoot,
    leftHemToRightFoot,
    rightHemToRightFoot,
    rightHemToLeftFoot,
    minHemOpeningDistance: minProjectedDistance(leftHem, rightHem, hips, xAxis, zAxis),
    hemAssignment: classifyHemAssignment(
      leftHemToLeftFoot,
      leftHemToRightFoot,
      rightHemToRightFoot,
      rightHemToLeftFoot,
    ),
  };
}

function characterXAxis(anchors: ReturnType<AnimatedCharacterSceneRig['getCharacterAnchors']>): THREE.Vector3 {
  const leftShoulder = anchors.leftShoulder;
  const rightShoulder = anchors.rightShoulder;
  const xAxis = leftShoulder && rightShoulder
    ? rightShoulder.clone().sub(leftShoulder)
    : new THREE.Vector3(1, 0, 0);
  xAxis.y = 0;
  if (xAxis.lengthSq() < 0.0001) {
    xAxis.set(1, 0, 0);
  }
  return xAxis.normalize();
}

function footCenter(
  side: 'left' | 'right',
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
): THREE.Vector3 | null {
  const sidePattern = side === 'left' ? /left/i : /right/i;
  const footCapsules = sdfs.filter((capsule) => sidePattern.test(capsule.name) && /foot/i.test(capsule.name));
  if (footCapsules.length === 0) {
    return null;
  }
  const center = new THREE.Vector3();
  for (const capsule of footCapsules) {
    center.add(new THREE.Vector3(
      (capsule.start[0] + capsule.end[0]) * 0.5,
      (capsule.start[1] + capsule.end[1]) * 0.5,
      (capsule.start[2] + capsule.end[2]) * 0.5,
    ));
  }
  return center.multiplyScalar(1 / footCapsules.length);
}

function projectRelativeXZ(
  point: THREE.Vector3,
  origin: THREE.Vector3,
  xAxis: THREE.Vector3,
  zAxis: THREE.Vector3,
): { x: number; z: number } {
  const relative = point.clone().sub(origin);
  return {
    x: relative.dot(xAxis),
    z: relative.dot(zAxis),
  };
}

function distance2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function minProjectedDistance(
  left: readonly AssemblyVertex[],
  right: readonly AssemblyVertex[],
  origin: THREE.Vector3,
  xAxis: THREE.Vector3,
  zAxis: THREE.Vector3,
): number | null {
  if (left.length === 0 || right.length === 0) {
    return null;
  }
  let minDistance = Infinity;
  for (const leftVertex of left) {
    const leftPoint = projectRelativeXZ(new THREE.Vector3(...leftVertex.position), origin, xAxis, zAxis);
    for (const rightVertex of right) {
      const rightPoint = projectRelativeXZ(new THREE.Vector3(...rightVertex.position), origin, xAxis, zAxis);
      minDistance = Math.min(minDistance, distance2(leftPoint, rightPoint));
    }
  }
  return minDistance;
}

function classifyHemAssignment(
  leftHemToLeftFoot: number | null,
  leftHemToRightFoot: number | null,
  rightHemToRightFoot: number | null,
  rightHemToLeftFoot: number | null,
): CharacterGarmentFitReport['hemAssignment'] {
  if (
    leftHemToLeftFoot === null ||
    leftHemToRightFoot === null ||
    rightHemToRightFoot === null ||
    rightHemToLeftFoot === null
  ) {
    return 'unavailable';
  }
  const leftCorrect = leftHemToLeftFoot < leftHemToRightFoot;
  const rightCorrect = rightHemToRightFoot < rightHemToLeftFoot;
  if (leftCorrect && rightCorrect) {
    return 'correct';
  }
  if (!leftCorrect && !rightCorrect) {
    return 'swapped';
  }
  return 'ambiguous';
}

function addDebugMarker(
  group: THREE.Group,
  position: THREE.Vector3,
  color: number,
  name: string,
  radius: number,
): void {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  marker.name = name;
  marker.position.copy(position);
  group.add(marker);
}

function hemVertices(assembly: ClothAssembly, side: 'left' | 'right'): AssemblyVertex[] {
  const sideVertices = assembly.vertices.filter((vertex) => legSideForPatch(vertex.patchId) === side);
  if (sideVertices.length === 0) {
    return [];
  }
  const minY = Math.min(...sideVertices.map((vertex) => vertex.position[1]));
  return sideVertices.filter((vertex) => vertex.position[1] <= minY + 0.035);
}

function minCapsuleY(
  sdfs: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>,
  pattern: RegExp,
): number {
  let minY = Infinity;
  for (const capsule of sdfs) {
    if (!pattern.test(capsule.name)) {
      continue;
    }
    minY = Math.min(minY, capsule.start[1], capsule.end[1]);
  }
  return minY;
}

function assemblyBounds(assembly: ClothAssembly): {
  readonly min: THREE.Vector3;
  readonly max: THREE.Vector3;
  readonly size: THREE.Vector3;
} {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const vertex of assembly.vertices) {
    min.min(new THREE.Vector3(...vertex.position));
    max.max(new THREE.Vector3(...vertex.position));
  }
  if (assembly.vertices.length === 0) {
    min.set(0, 0, 0);
    max.set(0, 0, 0);
  }
  return { min, max, size: max.clone().sub(min) };
}

function restLengthEdgesFromVertices(
  edges: readonly ClothAssembly['edges'][number][],
  vertices: readonly AssemblyVertex[],
): ClothAssembly['edges'] {
  return edges.map((edge) => {
    const a = new THREE.Vector3(...vertices[edge.a]!.position);
    const b = new THREE.Vector3(...vertices[edge.b]!.position);
    return { ...edge, restLength: a.distanceTo(b) };
  });
}

export interface CharacterGarmentOptionsHost {
  readonly options: CharacterTShirtGenerationOptions;
}

export function createCharacterGarmentControls(
  gui: GUI,
  host: CharacterGarmentOptionsHost,
  rebuild: () => void,
): void {
  const folder = gui.addFolder('T-shirt generation');
  const addSlider = (
    property: keyof CharacterTShirtGenerationOptions,
    min: number,
    max: number,
    step: number,
    label: string,
  ): void => {
    folder.add(host.options, property, min, max, step).name(label).onFinishChange(rebuild);
  };

  addSlider('bodyWidth', 0.2, 0.9, 0.01, 'Body width');
  addSlider('torsoHeight', 0.22, 0.95, 0.01, 'Torso height');
  addSlider('sleeveLength', 0, 0.45, 0.01, 'Sleeve length');
  addSlider('sleeveOpening', 0.035, 0.4, 0.005, 'Sleeve opening');
  addSlider('sleeveTubeRadius', 0.01, 0.16, 0.001, 'Sleeve tube radius');
  addSlider('depth', 0.035, 0.38, 0.005, 'Front/back depth');
  addSlider('sleeveHangScale', 0, 1, 0.01, 'Sleeve hang');
  addSlider('sleeveLiftScale', 0, 1, 0.01, 'Sleeve lift');
  addSlider('sleeveVerticalRadiusScale', 0.02, 0.7, 0.01, 'Sleeve vertical radius');

  folder.add({
    reset: () => {
      Object.assign(host.options, DEFAULT_CHARACTER_T_SHIRT_OPTIONS);
      folder.controllersRecursive().forEach((controller) => controller.updateDisplay());
      rebuild();
    },
  }, 'reset').name('Reset T-shirt shape');
}

function averageAssemblyPosition(vertices: readonly ClothAssembly['vertices'][number][]): THREE.Vector3 {
  const average = new THREE.Vector3();
  for (const vertex of vertices) {
    average.add(new THREE.Vector3(...vertex.position));
  }
  return vertices.length > 0 ? average.multiplyScalar(1 / vertices.length) : average;
}

async function waitForAnimationFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}
