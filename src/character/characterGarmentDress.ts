import type { ClothSimulation } from '../cloth';
import type { ClothAssembly } from '../cloth/patternAssembly.ts';
import {
  DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  placeCharacterTShirtAssembly,
  SHIRT_SDF_CLEARANCE,
  type CharacterTShirtGenerationOptions,
} from './shirtDressing.ts';
import type { AnimatedCharacterSceneRig } from './AnimatedCharacter.ts';
import { mergeBoneSdfCapsules } from './mergeBoneSdfCapsules.ts';

const CHARACTER_SHIRT_COLLISION_MARGIN = 0.018;
const CHARACTER_SHIRT_TEAR_PROTECTED_THRESHOLD = 999_999;
const CHARACTER_SHIRT_TEAR_PROTECTION_MS = 1_000;

export function dressTShirtOnRig(
  rig: AnimatedCharacterSceneRig,
  options: CharacterTShirtGenerationOptions = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
): ClothAssembly {
  return placeCharacterTShirtAssembly(rig, SHIRT_SDF_CLEARANCE, options);
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
