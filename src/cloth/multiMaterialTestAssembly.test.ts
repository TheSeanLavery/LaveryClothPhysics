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
  assert.equal(assembly.stitchEdges.length, 21);
  assert.ok(assembly.vertices.length > 80);
});

test('sews each dangle top edge to its host banner bottom edge', () => {
  const assembly = createMultiMaterialTestAssembly();
  const hoistY = 0.35;
  const attachY = 0;
  const dangleStitches = assembly.stitchEdges.filter((edge) => edge.sourceId?.includes('-dangle-'));
  assert.equal(dangleStitches.length, 11);
  assert.equal(
    new Set(dangleStitches.map((edge) => edge.sourceId)).size,
    5,
  );
  for (const edge of dangleStitches) {
    const a = assembly.vertices[edge.a]!;
    const b = assembly.vertices[edge.b]!;
    assert.ok(Math.abs(a.position[1] - hoistY) > 0.1, 'banner stitch vertex must not be on hoist edge');
    assert.ok(Math.abs(b.position[1] - hoistY) > 0.1, 'dangle stitch vertex must not be on hoist edge');
    assert.ok(Math.abs(a.position[1] - attachY) < 1e-5, 'banner stitch vertex must sit on attachment row');
    assert.ok(Math.abs(a.position[1] - b.position[1]) < 1e-5, 'stitch pair must share attachment Y');
  }
});

test('maps patch ids to material library keys', () => {
  assert.equal(patchIdToMaterialKey('banner-b'), 'banner-b');
  assert.equal(patchIdToMaterialKey('dangle-soft-dangle-2'), 'dangle-soft');
  assert.equal(patchIdToMaterialKey('dangle-stiff-dangle-4'), 'dangle-stiff');
});
