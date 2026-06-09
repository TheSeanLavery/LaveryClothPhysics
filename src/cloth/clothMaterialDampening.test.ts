import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';
import { buildMaterialDampeningByPatchKey } from './clothMaterialDampening.ts';

test('dangle soft retains more motion than dangle stiff', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const dampening = buildMaterialDampeningByPatchKey(library, { dampening: 0.9925 });
  assert.ok(dampening['dangle-soft']! > dampening['dangle-stiff']! + 0.005);
});

test('material dampening values are absolute, not ratios', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const soft = library.materials.find((entry) => entry.name === 'Dangle soft')!;
  const stiff = library.materials.find((entry) => entry.name === 'Dangle stiff')!;
  assert.ok(soft.settings.dampening > stiff.settings.dampening + 0.005);
});
