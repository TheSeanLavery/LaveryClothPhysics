import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClothMaterialDefinition } from './clothMaterialSchema.ts';
import {
  buildAssemblyMaterialMaps,
  buildPatchSegmentColorsFromLibrary,
  materialBendStiffness,
  materialCompressionScale,
  materialDampening,
  materialStructuralScale,
  materialTearThreshold,
} from './clothMaterialPhysics.ts';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';

const PRESET_DAMPENING = 0.9925;
const PRESET_BEND = 0.01;
const PRESET_TEAR = 4;

const sampleMaterial = (
  settings: Partial<ClothMaterialDefinition['settings']>,
  physics: Partial<ClothMaterialDefinition['physics']> = {},
): ClothMaterialDefinition => ({
  id: 'sample',
  name: 'sample',
  color: '#ffffff',
  createdAt: 0,
  updatedAt: 0,
  settings: {
    dampening: PRESET_DAMPENING,
    bendStiffness: PRESET_BEND,
    tearStretchThreshold: PRESET_TEAR,
    ...settings,
  },
  physics: {
    structuralScale: 1,
    compressionScale: 1,
    friction: 0.85,
    damageRate: 1,
    maxHealth: 1,
    ...physics,
  },
});

test('materialTearThreshold uses absolute per-material strain ratio', () => {
  const fragile = sampleMaterial({ tearStretchThreshold: 2 });
  const tough = sampleMaterial({ tearStretchThreshold: 8 });

  assert.ok(materialTearThreshold(fragile, PRESET_TEAR) < materialTearThreshold(tough, PRESET_TEAR) - 0.5);
  assert.equal(materialTearThreshold(fragile, PRESET_TEAR), 2);
});

test('materialDampening and materialBendStiffness return absolute solver values', () => {
  const soft = sampleMaterial({ dampening: 0.9988, bendStiffness: 0.02 });
  assert.equal(materialDampening(soft, PRESET_DAMPENING), 0.9988);
  assert.equal(materialBendStiffness(soft, PRESET_BEND), 0.02);
});

test('buildAssemblyMaterialMaps exposes distinct dangle dampening and tear thresholds', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const maps = buildAssemblyMaterialMaps(library, {
    dampening: PRESET_DAMPENING,
    bendStiffness: PRESET_BEND,
    tearStretchThreshold: PRESET_TEAR,
  });

  assert.ok(maps.dampening['dangle-soft']! > maps.dampening['dangle-stiff']! + 0.005);
  assert.ok(maps.tearThreshold['dangle-soft']! >= 0.5);
  assert.equal(maps.structural['dangle-soft'], maps.structural['dangle-stiff']);
  assert.equal(maps.structural['banner-a'], materialStructuralScale(
    library.materials.find((material) => material.name === 'Banner A')!,
  ));
  assert.equal(maps.compression['banner-b'], materialCompressionScale(
    library.materials.find((material) => material.name === 'Banner B')!,
  ));
  assert.ok(maps.tearThreshold['dangle-soft']! < maps.tearThreshold['dangle-stiff']! - 1);
});

test('buildPatchSegmentColorsFromLibrary maps library materials to stable patch keys', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const colors = buildPatchSegmentColorsFromLibrary(library);

  assert.equal(colors['banner-a'], '#4fa3ff');
  assert.equal(colors['dangle-stiff'], '#ffdc5a');
});
