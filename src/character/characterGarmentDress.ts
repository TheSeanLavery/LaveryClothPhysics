import type { ClothSimulation } from '../cloth';
import type { ClothAssembly } from '../cloth/patternAssembly.ts';
import {
  DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  placeCharacterTShirtAssembly,
  SHIRT_SDF_CLEARANCE,
  type CharacterTShirtGenerationOptions,
} from './shirtDressing.ts';
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
  options: CharacterTShirtGenerationOptions = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
): ClothAssembly {
  return placeCharacterTShirtAssembly(rig, SHIRT_SDF_CLEARANCE, options);
}

export interface RigAnimationDriver {
  readonly rig: AnimatedCharacterSceneRig;
  readonly player: CharacterAnimationPlayer;
}

/** Advance mixer + bone SDFs until crossfade and pose settle complete. */
export async function waitForRigsAnimationSettle(
  drivers: readonly RigAnimationDriver[],
  durationSec: number,
): Promise<void> {
  const stepSec = 1 / 60;
  const steps = Math.max(1, Math.ceil(durationSec / stepSec));
  for (let i = 0; i < steps; i += 1) {
    for (const { rig, player } of drivers) {
      rig.update(stepSec);
      player.update(stepSec);
    }
    await waitForAnimationFrames(1);
  }
  for (const { rig } of drivers) {
    rig.root.updateMatrixWorld(true);
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

export async function warmupCharacterClothCollision(
  cloth: ClothSimulation,
  rigs: readonly AnimatedCharacterSceneRig[],
  tearRestoreThreshold: number,
): Promise<void> {
  cloth.settings.tearStretchThreshold = CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD;
  cloth.applySettings();
  await waitForAnimationFrames(6);
  for (const margin of [
    CHARACTER_SHIRT_COLLISION_MARGIN * 0.25,
    CHARACTER_SHIRT_COLLISION_MARGIN * 0.6,
    CHARACTER_SHIRT_COLLISION_MARGIN,
  ]) {
    cloth.settings.mannequinMargin = margin;
    cloth.applySettings();
    cloth.setBoneSdfCapsules(mergeBoneSdfCapsules(rigs.map((rig) => rig.getBoneSdfSummary())));
    await waitForAnimationFrames(6);
  }
  window.setTimeout(() => {
    cloth.settings.tearStretchThreshold = tearRestoreThreshold;
    cloth.applySettings();
  }, CHARACTER_SHIRT_TEAR_PROTECTION_MS);
}
