import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';
import {
  buildMaterialBendScaleByPatchKey,
  materialBendScale,
} from './clothMaterialBend.ts';
import { getMyPresetSettings } from './myPresetDefaults.ts';

test('multi-material seed uses unified bend scales', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const base = getMyPresetSettings();
  const scales = buildMaterialBendScaleByPatchKey(library, base);
  for (const key of ['banner-a', 'banner-b', 'banner-c', 'dangle-soft', 'dangle-stiff']) {
    assert.ok(Math.abs(scales[key]! - 1) < 0.01, `${key} bend scale should stay at preset unity`);
  }
});

test('materialBendScale stays at unity when preset bend matches', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const banner = library.materials.find((entry) => entry.name === 'Banner A')!;
  const base = getMyPresetSettings();
  assert.ok(Math.abs(materialBendScale(banner, base.bendStiffness) - 1) < 0.01);
});
