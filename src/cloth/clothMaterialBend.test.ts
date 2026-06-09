import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';
import { buildMaterialBendStiffnessByPatchKey } from './clothMaterialBend.ts';

test('multi-material seed uses absolute bend stiffness from preset', () => {
  const library = buildDefaultClothMaterialLibrarySeed();
  const bendStiffness = buildMaterialBendStiffnessByPatchKey(library, { bendStiffness: 0.01 });
  for (const key of ['banner-a', 'banner-b', 'banner-c', 'dangle-soft', 'dangle-stiff']) {
    assert.ok(Math.abs(bendStiffness[key]! - 0.01) < 0.001, `${key} bend stiffness should match preset`);
  }
});
