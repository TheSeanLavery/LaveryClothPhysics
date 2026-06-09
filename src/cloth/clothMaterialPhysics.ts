import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import {
  MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
  SEGMENT_COLOR_PATCH_KEYS,
  type MultiMaterialLibraryPatchBinding,
} from './clothMaterialBend.ts';

export { SEGMENT_COLOR_PATCH_KEYS };

export interface AssemblyMaterialMaps {
  readonly dampening: Record<string, number>;
  readonly bendStiffness: Record<string, number>;
  readonly structural: Record<string, number>;
  readonly compression: Record<string, number>;
  readonly tearThreshold: Record<string, number>;
}

/** @deprecated Use {@link AssemblyMaterialMaps}. */
export type AssemblyMaterialScaleMaps = AssemblyMaterialMaps;

export function materialDampening(
  material: ClothMaterialDefinition,
  fallbackDampening: number,
): number {
  return material.settings.dampening ?? fallbackDampening;
}

export function materialBendStiffness(
  material: ClothMaterialDefinition,
  fallbackBendStiffness: number,
): number {
  return Math.max(material.settings.bendStiffness ?? fallbackBendStiffness, 0);
}

/** Absolute edge strain ratio before tearing (rest length multiplier). */
export function materialTearThreshold(
  material: ClothMaterialDefinition,
  fallbackTearStretchThreshold: number,
): number {
  const strain = material.settings.tearStretchThreshold ?? fallbackTearStretchThreshold;
  return Math.max(strain, 0.5);
}

export function materialStructuralScale(material: ClothMaterialDefinition): number {
  return Math.max(material.physics.structuralScale, 0.05);
}

export function materialCompressionScale(material: ClothMaterialDefinition): number {
  return Math.max(material.physics.compressionScale, 0.05);
}

function materialByPatchBindings(
  library: ClothMaterialLibrary,
  bindings: readonly MultiMaterialLibraryPatchBinding[],
): Map<string, ClothMaterialDefinition> {
  const byName = new Map(library.materials.map((material) => [material.name, material]));
  const byPatch = new Map<string, ClothMaterialDefinition>();
  for (const binding of bindings) {
    const material = byName.get(binding.libraryMaterialName);
    if (material) {
      byPatch.set(binding.patchKey, material);
    }
  }
  return byPatch;
}

export function buildPatchSegmentColorsFromLibrary(
  library: ClothMaterialLibrary,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): Record<string, string> {
  const byName = new Map(library.materials.map((material) => [material.name, material]));
  const colors: Record<string, string> = {};
  for (const binding of bindings) {
    const material = byName.get(binding.libraryMaterialName);
    if (material) {
      colors[binding.patchKey] = material.color;
    }
  }
  return colors;
}

export function buildAssemblyMaterialMaps(
  library: ClothMaterialLibrary,
  sceneFallbacks: Pick<InextensibleFlagSettings, 'dampening' | 'bendStiffness' | 'tearStretchThreshold'>,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): AssemblyMaterialMaps {
  const byPatch = materialByPatchBindings(library, bindings);
  const dampening: Record<string, number> = {};
  const bendStiffness: Record<string, number> = {};
  const structural: Record<string, number> = {};
  const compression: Record<string, number> = {};
  const tearThreshold: Record<string, number> = {};

  for (const [patchKey, material] of byPatch) {
    dampening[patchKey] = materialDampening(material, sceneFallbacks.dampening);
    bendStiffness[patchKey] = materialBendStiffness(material, sceneFallbacks.bendStiffness);
    structural[patchKey] = materialStructuralScale(material);
    compression[patchKey] = materialCompressionScale(material);
    tearThreshold[patchKey] = materialTearThreshold(material, sceneFallbacks.tearStretchThreshold);
  }

  return { dampening, bendStiffness, structural, compression, tearThreshold };
}

/** @deprecated Use {@link buildAssemblyMaterialMaps}. */
export const buildAssemblyMaterialScaleMaps = buildAssemblyMaterialMaps;
