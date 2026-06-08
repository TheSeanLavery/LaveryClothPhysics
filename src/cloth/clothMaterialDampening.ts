import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import {
  MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
  type MultiMaterialLibraryPatchBinding,
} from './clothMaterialBend.ts';

/**
 * Per-particle velocity retention multiplier relative to the scene dampening uniform.
 */
export function materialDampeningScale(
  material: ClothMaterialDefinition,
  baseDampening: number,
): number {
  const base = Math.max(baseDampening, 1e-6);
  const dampening = material.settings.dampening ?? baseDampening;
  return Math.max(dampening / base, 0.5);
}

export function buildMaterialDampeningScaleByPatchKey(
  library: ClothMaterialLibrary,
  baseSettings: InextensibleFlagSettings,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): Record<string, number> {
  const byName = new Map(library.materials.map((material) => [material.name, material]));
  const scales: Record<string, number> = {};
  for (const binding of bindings) {
    const material = byName.get(binding.libraryMaterialName);
    if (!material) {
      continue;
    }
    scales[binding.patchKey] = materialDampeningScale(material, baseSettings.dampening);
  }
  return scales;
}
