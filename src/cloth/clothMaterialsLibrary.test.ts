import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultClothMaterialLibrarySeed } from './clothMaterialsLibrary.ts';

test('seed merge only adds missing preset materials without overwriting saved edits', () => {
  const seed = buildDefaultClothMaterialLibrarySeed();
  const savedDampening = 0.1234;
  const savedTear = 1.75;
  const existing = seed.materials.find((material) => material.name === 'Dangle soft');
  assert.ok(existing);

  const library = {
    ...seed,
    materials: seed.materials.map((material) => (
      material.name === 'Dangle soft'
        ? {
            ...material,
            settings: {
              ...material.settings,
              dampening: savedDampening,
              tearStretchThreshold: savedTear,
            },
          }
        : material
    )),
  };

  const byName = new Map(library.materials.map((material) => [material.name, material]));
  for (const material of seed.materials) {
    if (byName.has(material.name)) {
      continue;
    }
    byName.set(material.name, material);
  }

  const merged = byName.get('Dangle soft');
  assert.ok(merged);
  assert.equal(merged.settings.dampening, savedDampening);
  assert.equal(merged.settings.tearStretchThreshold, savedTear);
});
