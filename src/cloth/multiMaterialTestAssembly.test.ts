import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMultiMaterialTestAssembly,
  patchIdToMaterialKey,
} from './multiMaterialTestAssembly.ts';

test('builds stitched banner strips and dangling patches', () => {
  const assembly = createMultiMaterialTestAssembly();
  const patchIds = new Set(assembly.vertices.map((vertex) => vertex.patchId));

  assert.ok(patchIds.has('banner-a'));
  assert.ok(patchIds.has('banner-b'));
  assert.ok(patchIds.has('banner-c'));
  assert.equal([...patchIds].filter((id) => id.includes('dangle')).length, 5);
  assert.equal(assembly.stitchEdges.length, 10);
  assert.ok(assembly.vertices.length > 80);
});

test('maps patch ids to material library keys', () => {
  assert.equal(patchIdToMaterialKey('banner-b'), 'banner-b');
  assert.equal(patchIdToMaterialKey('dangle-soft-dangle-2'), 'dangle-soft');
  assert.equal(patchIdToMaterialKey('dangle-stiff-dangle-4'), 'dangle-stiff');
});
