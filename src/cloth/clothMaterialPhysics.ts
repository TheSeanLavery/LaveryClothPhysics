import type { ClothMaterialDefinition, ClothMaterialLibrary } from './clothMaterialSchema.ts';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import { materialBendScale, MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS, type MultiMaterialLibraryPatchBinding } from './clothMaterialBend.ts';
import { materialDampeningScale } from './clothMaterialDampening.ts';

export interface AssemblyMaterialScaleMaps {
  readonly dampening: Record<string, number>;
  readonly bend: Record<string, number>;
  readonly structural: Record<string, number>;
  readonly compression: Record<string, number>;
  readonly tearThreshold: Record<string, number>;
}

/** Absolute edge strain ratio before tearing (rest length multiplier). */
export function materialAbsoluteTearThreshold(
  material: ClothMaterialDefinition,
  globalTearStretchThreshold: number,
): number {
  const strain = material.settings.tearStretchThreshold ?? globalTearStretchThreshold;
  return Math.max(strain * material.physics.tearThresholdScale, 0.5);
}

/** Relative tear strain multiplier vs the scene tearStretchThreshold uniform. */
export function materialTearThresholdScale(
  material: ClothMaterialDefinition,
  baseTearStretchThreshold: number,
): number {
  const base = Math.max(baseTearStretchThreshold, 1e-6);
  return materialAbsoluteTearThreshold(material, baseTearStretchThreshold) / base;
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

export function buildAssemblyMaterialScaleMaps(
  library: ClothMaterialLibrary,
  baseSettings: InextensibleFlagSettings,
  bindings: readonly MultiMaterialLibraryPatchBinding[] = MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS,
): AssemblyMaterialScaleMaps {
  const byPatch = materialByPatchBindings(library, bindings);
  const dampening: Record<string, number> = {};
  const bend: Record<string, number> = {};
  const structural: Record<string, number> = {};
  const compression: Record<string, number> = {};
  const tearThreshold: Record<string, number> = {};

  for (const [patchKey, material] of byPatch) {
    dampening[patchKey] = materialDampeningScale(material, baseSettings.dampening);
    bend[patchKey] = materialBendScale(material, baseSettings.bendStiffness);
    structural[patchKey] = materialStructuralScale(material);
    compression[patchKey] = materialCompressionScale(material);
    tearThreshold[patchKey] = materialAbsoluteTearThreshold(material, baseSettings.tearStretchThreshold);
  }

  return { dampening, bend, structural, compression, tearThreshold };
}
