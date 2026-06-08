import assert from 'node:assert/strict';
import test from 'node:test';
import { getMyPresetSettings } from './myPresetDefaults.ts';
import type { ClothMaterialDefinition } from './clothMaterialSchema.ts';
import {
  buildAssemblyMaterialScaleMaps,
  buildPatchSegmentColorsFromLibrary,
  materialCompressionScale,
  materialStructuralScale,
  materialTearThresholdScale,
} from './clothMaterialPhysics.ts';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';

const sampleMaterial = (
  settings: Partial<ClothMaterialDefinition['settings']>,
  physics: Partial<ClothMaterialDefinition['physics']>,
): ClothMaterialDefinition => ({
  id: 'sample',
  name: 'sample',
  color: '#ffffff',
  createdAt: 0,
  updatedAt: 0,
  settings: settings as ClothMaterialDefinition['settings'],
  physics: {
    tearThresholdScale: 1,
    structuralScale: 1,
    bendScale: 1,
    compressionScale: 1,
    friction: 0.85,
    damageRate: 1,
    maxHealth: 1,
    ...physics,
  },
});

test('materialTearThresholdScale combines per-material strain ratio and physics scale', () => {
  const base = getMyPresetSettings();
  const fragile = sampleMaterial({ tearStretchThreshold: 2 }, { tearThresholdScale: 0.5 });
  const tough = sampleMaterial({ tearStretchThreshold: 8 }, { tearThresholdScale: 1.5 });

  assert.ok(
    materialTearThresholdScale(fragile, base.tearStretchThreshold)
    < materialTearThresholdScale(tough, base.tearStretchThreshold) - 0.5,
  );
});

test('buildAssemblyMaterialScaleMaps exposes distinct dangle dampening and tear scales', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const base = getMyPresetSettings();
  const maps = buildAssemblyMaterialScaleMaps(library, base);

  assert.ok(maps.dampening['dangle-soft']! > maps.dampening['dangle-stiff']! + 0.005);
  assert.ok(maps.tearThreshold['dangle-soft']! >= 0.5);
  assert.equal(maps.structural['dangle-soft'], maps.structural['dangle-stiff']);
  assert.equal(maps.structural['banner-a'], materialStructuralScale(
    library.materials.find((material) => material.name === 'Banner A')!,
  ));
  assert.equal(maps.compression['banner-b'], materialCompressionScale(
    library.materials.find((material) => material.name === 'Banner B')!,
  ));
  assert.ok(maps.tearThreshold['dangle-soft']! > 0);
});

test('buildPatchSegmentColorsFromLibrary maps library materials to stable patch keys', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const colors = buildPatchSegmentColorsFromLibrary(library);

  assert.equal(colors['banner-a'], '#4fa3ff');
  assert.equal(colors['dangle-stiff'], '#ffdc5a');
});
