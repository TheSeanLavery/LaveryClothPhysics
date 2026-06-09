import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import { materialBendStiffness } from './clothMaterialPhysics.ts';

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

/** Stable GPU segment table index order for multi-material patch colors. */
export const SEGMENT_COLOR_PATCH_KEYS = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS.map(
  (binding) => binding.patchKey,
);

export function buildMaterialBendStiffnessByPatchKey(
  library: ClothMaterialLibrary,
  sceneFallbacks: Pick<InextensibleFlagSettings, 'bendStiffness'>,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): Record<string, number> {
  const byName = new Map(library.materials.map((material) => [material.name, material]));
  const values: Record<string, number> = {};
  for (const binding of bindings) {
    const material = byName.get(binding.libraryMaterialName);
    if (!material) {
      continue;
    }
    values[binding.patchKey] = materialBendStiffness(material, sceneFallbacks.bendStiffness);
  }
  return values;
}

/** @deprecated Use {@link buildMaterialBendStiffnessByPatchKey}. */
export const buildMaterialBendScaleByPatchKey = buildMaterialBendStiffnessByPatchKey;

/** @deprecated Use {@link materialBendStiffness} from clothMaterialPhysics. */
export function materialBendScale(
  material: ClothMaterialDefinition,
  baseBendStiffness: number,
): number {
  return materialBendStiffness(material, baseBendStiffness);
}
