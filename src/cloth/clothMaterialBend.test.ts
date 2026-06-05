import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';
import {
  buildMaterialBendScaleByPatchKey,
  materialBendScale,
} from './clothMaterialBend.ts';
import { getMyPresetSettings } from './myPresetDefaults.ts';

test('dangle soft bends more than dangle stiff', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const base = getMyPresetSettings();
  const scales = buildMaterialBendScaleByPatchKey(library, base);
  assert.ok(scales['dangle-soft']! < scales['dangle-stiff']! * 0.5);
});

test('materialBendScale combines settings and physics multipliers', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const soft = library.materials.find((entry) => entry.name === 'Dangle soft')!;
  const stiff = library.materials.find((entry) => entry.name === 'Dangle stiff')!;
  const base = getMyPresetSettings();
  assert.ok(materialBendScale(soft, base.bendStiffness) < materialBendScale(stiff, base.bendStiffness) * 0.5);
});
