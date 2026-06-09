import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import {
  MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
  type MultiMaterialLibraryPatchBinding,
} from './clothMaterialBend.ts';
import { materialDampening } from './clothMaterialPhysics.ts';

export function buildMaterialDampeningByPatchKey(
  library: ClothMaterialLibrary,
  sceneFallbacks: Pick<InextensibleFlagSettings, 'dampening'>,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): Record<string, number> {
  const byName = new Map(library.materials.map((material) => [material.name, material]));
  const values: Record<string, number> = {};
  for (const binding of bindings) {
    const material = byName.get(binding.libraryMaterialName);
    if (!material) {
      continue;
    }
    values[binding.patchKey] = materialDampening(material, sceneFallbacks.dampening);
  }
  return values;
}

/** @deprecated Use {@link buildMaterialDampeningByPatchKey}. */
export const buildMaterialDampeningScaleByPatchKey = buildMaterialDampeningByPatchKey;

/** @deprecated Use {@link materialDampening} from clothMaterialPhysics. */
export function materialDampeningScale(
  material: ClothMaterialDefinition,
  baseDampening: number,
): number {
  return materialDampening(material, baseDampening);
}
