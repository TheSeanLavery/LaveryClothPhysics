import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';
import {
  buildMaterialDampeningScaleByPatchKey,
  materialDampeningScale,
} from './clothMaterialDampening.ts';
import { getMyPresetSettings } from './myPresetDefaults.ts';

test('dangle soft retains more motion than dangle stiff', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const base = getMyPresetSettings();
  const scales = buildMaterialDampeningScaleByPatchKey(library, base);
  assert.ok(scales['dangle-soft']! > scales['dangle-stiff']! + 0.005);
});

test('materialDampeningScale is relative to the scene dampening uniform', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const soft = library.materials.find((entry) => entry.name === 'Dangle soft')!;
  const stiff = library.materials.find((entry) => entry.name === 'Dangle stiff')!;
  const base = getMyPresetSettings();
  assert.ok(
    materialDampeningScale(soft, base.dampening) > materialDampeningScale(stiff, base.dampening) + 0.005,
  );
});
