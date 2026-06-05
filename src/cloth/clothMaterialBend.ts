import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';

/**
 * GPU bend-edge stiffness multiplier (higher = stiffer bend constraints, less sag).
 */
export function materialBendScale(
  material: ClothMaterialDefinition,
  baseBendStiffness: number,
): number {
  const base = Math.max(baseBendStiffness, 1e-6);
  const bend = (material.settings.bendStiffness ?? baseBendStiffness) * material.physics.bendScale;
  return Math.max(bend / base, 0.05);
}

export interface MultiMaterialLibraryPatchBinding {
  readonly patchKey: string;
  readonly libraryMaterialName: string;
}

export const MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS: readonly MultiMaterialLibraryPatchBinding[] = [
  { patchKey: 'banner-a', libraryMaterialName: 'Banner A' },
  { patchKey: 'banner-b', libraryMaterialName: 'Banner B' },
  { patchKey: 'banner-c', libraryMaterialName: 'Banner C' },
  { patchKey: 'dangle-soft', libraryMaterialName: 'Dangle soft' },
  { patchKey: 'dangle-stiff', libraryMaterialName: 'Dangle stiff' },
];

export function buildMaterialBendScaleByPatchKey(
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
    scales[binding.patchKey] = materialBendScale(material, baseSettings.bendStiffness);
  }
  return scales;
}
