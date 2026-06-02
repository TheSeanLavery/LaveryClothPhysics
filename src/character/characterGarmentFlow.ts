import type GUI from 'lil-gui';
import * as THREE from 'three';
import type { ClothAssembly, ClothSimulation } from '../cloth';
import type { AnimatedCharacterSceneRig, ShirtAnchorReport } from './AnimatedCharacter';
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

export interface CharacterShirtSurfaceReport {
  readonly vertex: ShirtSdfClearanceReport;
  readonly perCapsule: PerCapsuleClearanceReport;
  readonly edge: EdgeCapsuleClearanceReport;
  readonly triangle: TriangleCapsuleClearanceReport;
  readonly strain: AssemblyStrainReport;
  readonly quality: TriangleQualityReport;
}

export class CharacterGarmentFlow {
  readonly options: CharacterTShirtGenerationOptions = { ...DEFAULT_CHARACTER_T_SHIRT_OPTIONS };

  private assembly: ClothAssembly;
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
    this.assembly = this.createPlacedAssembly();
    this.tearProtectionRestoreThreshold = cloth.settings.tearStretchThreshold;
  }

  getAssembly(): ClothAssembly {
    return this.assembly;
  }

  async load(): Promise<void> {
    this.startTearProtection();
    this.cloth.setBoneSdfCapsules([]);
    this.assembly = this.createPlacedAssembly();
    await this.cloth.loadClothAssembly(this.assembly);
    await this.warmupCollision();
    this.finishTearProtectionAfterDelay();
    this.updateParticleLabel();
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
      bodyWidth: this.options.bodyWidth,
      torsoHeight: this.options.torsoHeight,
      sleeveLength: this.options.sleeveLength,
      sleeveOpening: this.options.sleeveOpening,
      vertexCount: this.assembly.vertices.length,
      faceCount: this.assembly.faces.length,
      stitchEdgeCount: this.assembly.stitchEdges.length,
      center: [stats.centerX, stats.centerY, stats.centerZ],
      neckGap: shirtNeck.distanceTo(neckTarget),
      anchorNames: namedAnchors,
    };
  }

  private createPlacedAssembly(): ClothAssembly {
    return placeCharacterTShirtAssembly(this.rig, SHIRT_SDF_CLEARANCE, this.options);
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
    await waitForAnimationFrames(12);
    for (const margin of [
      CHARACTER_SHIRT_COLLISION_MARGIN * 0.25,
      CHARACTER_SHIRT_COLLISION_MARGIN * 0.6,
      CHARACTER_SHIRT_COLLISION_MARGIN,
    ]) {
      this.cloth.settings.mannequinMargin = margin;
      this.cloth.applySettings();
      this.cloth.setBoneSdfCapsules(this.rig.getBoneSdfSummary());
      await waitForAnimationFrames(10);
    }
  }

  private updateParticleLabel(): void {
    if (this.particlesEl) {
      this.particlesEl.textContent = `character cloth particles: ${this.cloth.getStats().particleCount}`;
    }
  }
}

export function createCharacterGarmentControls(
  gui: GUI,
  flow: CharacterGarmentFlow,
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
    folder.add(flow.options, property, min, max, step).name(label).onFinishChange(rebuild);
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
      Object.assign(flow.options, DEFAULT_CHARACTER_T_SHIRT_OPTIONS);
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
