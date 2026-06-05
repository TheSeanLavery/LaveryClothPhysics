import type { ClothSimulation } from '../cloth';
import type { ClothAssembly } from '../cloth/patternAssembly.ts';
import {
  auditAssemblyStrain,
  auditBodyNotFloatingOverArms,
  auditPerCapsuleClearance,
  auditShirtSdfClearance,
  auditTriangleQuality,
  auditTShirtDressAlignment,
  DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  placeCharacterTShirtAssembly,
  SHIRT_SDF_CLEARANCE,
  type AssemblyStrainReport,
  type BodyArmDrapeReport,
  type CharacterTShirtGenerationOptions,
  type PerCapsuleClearanceReport,
  type ShirtSdfClearanceReport,
  type TShirtDressAlignmentOptions,
  type TShirtDressAlignmentReport,
  type TriangleQualityReport,
} from './shirtDressing.ts';
import type { BoneSdfCapsuleSample } from './shirtDressing.ts';
import type { CharacterAnimationPlayer } from '../animations/CharacterAnimationPlayer.ts';
import type { AnimatedCharacterSceneRig } from './AnimatedCharacter.ts';
import { mergeBoneSdfCapsules } from './mergeBoneSdfCapsules.ts';

/** Extra time after crossfade ends for bones/SDFs to settle before shirt placement. */
export const SHIRT_DRESS_POSE_SETTLE_SEC = 0.25;

const CHARACTER_SHIRT_COLLISION_MARGIN = 0.018;
const CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD = 999_999;
const CHARACTER_SHIRT_TEAR_PROTECTION_MS = 1_000;

export function settleRigForShirtDressing(rig: AnimatedCharacterSceneRig): void {
  rig.settleShirtTpose();
}

export function dressTShirtOnRig(
  rig: AnimatedCharacterSceneRig,
  params: CharacterTShirtGenerationOptions = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
): ClothAssembly {
  return placeCharacterTShirtAssembly(rig, params);
}

/** Dress-time validation: torso forward, sleeve side, and arm proximity. */
export function auditRigTShirtDressAlignment(
  rig: AnimatedCharacterSceneRig,
  params: CharacterTShirtGenerationOptions = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  options: TShirtDressAlignmentOptions = {},
): TShirtDressAlignmentReport {
  rig.root.updateMatrixWorld(true);
  const assembly = dressTShirtOnRig(rig, params);
  return auditTShirtDressAlignment(assembly, rig.getCharacterAnchors(), rig.getBoneSdfSummary(), {
    forwardYawRad: rig.measureForwardYaw(),
    ...options,
  });
}

export interface RigShirtPlacementReport {
  readonly vertex: ShirtSdfClearanceReport;
  readonly perCapsule: PerCapsuleClearanceReport;
  readonly floating: BodyArmDrapeReport;
  readonly strain: AssemblyStrainReport;
  readonly triangle: TriangleQualityReport;
}

export function filterArmSdfCapsules(
  capsules: readonly BoneSdfCapsuleSample[],
): readonly BoneSdfCapsuleSample[] {
  return capsules.filter((capsule) => {
    const key = (capsule.name ?? '').toLowerCase();
    return /(left|right)(shoulder|arm|forearm)/.test(key);
  });
}

export interface AuditRigTShirtPlacementOptions {
  /** When true, blend to embedded T-pose before measuring (offline dress pipeline). */
  readonly resetToTpose?: boolean;
}

/** Dress shirt on the rig and audit clearance / drape (no sim load). */
export function auditRigTShirtPlacement(
  rig: AnimatedCharacterSceneRig,
  options: CharacterTShirtGenerationOptions = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  auditOptions: AuditRigTShirtPlacementOptions = {},
): RigShirtPlacementReport {
  if (auditOptions.resetToTpose ?? false) {
    settleRigForShirtDressing(rig);
  }
  rig.root.updateMatrixWorld(true);
  const assembly = dressTShirtOnRig(rig, options);
  const sdfs = rig.getBoneSdfSummary();
  const armCapsules = filterArmSdfCapsules(sdfs);
  return {
    vertex: auditShirtSdfClearance(assembly.vertices, sdfs, SHIRT_SDF_CLEARANCE),
    perCapsule: auditPerCapsuleClearance(assembly.vertices, sdfs, SHIRT_SDF_CLEARANCE),
    floating: auditBodyNotFloatingOverArms(assembly.vertices, armCapsules, SHIRT_SDF_CLEARANCE),
    strain: auditAssemblyStrain(assembly),
    triangle: auditTriangleQuality(assembly),
  };
}

export interface RigAnimationDriver {
  readonly rig: AnimatedCharacterSceneRig;
  readonly player: CharacterAnimationPlayer;
}

/** Advance mixer + bone SDFs until crossfade and pose settle complete. */
export async function waitForRigsAnimationSettle(
  drivers: readonly RigAnimationDriver[],
  durationSec: number,
  onFrame?: () => void,
): Promise<void> {
  const stepSec = 1 / 60;
  const steps = Math.max(1, Math.ceil(durationSec / stepSec));
  for (let i = 0; i < steps; i += 1) {
    for (const { rig, player } of drivers) {
      rig.update(stepSec);
      player.update(stepSec);
    }
    for (const { rig } of drivers) {
      rig.root.updateMatrixWorld(true);
    }
    onFrame?.();
    await waitForAnimationFrames(1);
  }
}

export async function waitForAnimationFrames(count: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let remaining = count;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

export interface ShirtSimSettleCriteria {
  readonly timeoutMs?: number;
  readonly minVertices?: number;
  readonly maxPenetrations?: number;
  readonly minClearance?: number;
  readonly framesPerStep?: number;
}

/** Poll GPU cloth readback until SDF clearance stabilizes (sim must be stepping). */
export async function waitForShirtSimSettle(
  poll: () => Promise<{
    readonly vertexCount: number;
    readonly penetrationCount: number;
    readonly minSignedDistance: number;
  }>,
  step: () => Promise<void>,
  criteria: ShirtSimSettleCriteria = {},
): Promise<void> {
  const timeoutMs = criteria.timeoutMs ?? 4_000;
  const minVertices = criteria.minVertices ?? 500;
  const maxPenetrations = criteria.maxPenetrations ?? 0;
  const minClearance = criteria.minClearance ?? 0.008;
  const framesPerStep = criteria.framesPerStep ?? 12;
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    await step();
    const report = await poll();
    const okVertices = report.vertexCount >= minVertices;
    const okPen = report.penetrationCount <= maxPenetrations;
    const okClear = !okVertices || report.minSignedDistance >= minClearance;
    if (okVertices && okPen && okClear) {
      return;
    }
    await waitForAnimationFrames(framesPerStep);
  }
}

export async function warmupCharacterClothCollision(
  cloth: ClothSimulation,
  rigs: readonly AnimatedCharacterSceneRig[],
  tearRestoreThreshold: number,
  onFrame?: () => void,
): Promise<void> {
  cloth.settings.tearStretchThreshold = CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD;
  cloth.applySettings();
  for (let i = 0; i < 6; i += 1) {
    onFrame?.();
    await waitForAnimationFrames(1);
  }
  for (const margin of [
    CHARACTER_SHIRT_COLLISION_MARGIN * 0.25,
    CHARACTER_SHIRT_COLLISION_MARGIN * 0.6,
    CHARACTER_SHIRT_COLLISION_MARGIN,
  ]) {
    cloth.settings.mannequinMargin = margin;
    cloth.applySettings();
    cloth.setBoneSdfCapsules(mergeBoneSdfCapsules(rigs.map((rig) => rig.getBoneSdfSummaryForCloth())));
    for (let i = 0; i < 6; i += 1) {
      onFrame?.();
      await waitForAnimationFrames(1);
    }
  }
  window.setTimeout(() => {
    cloth.settings.tearStretchThreshold = tearRestoreThreshold;
    cloth.applySettings();
  }, CHARACTER_SHIRT_TEAR_PROTECTION_MS);
}
