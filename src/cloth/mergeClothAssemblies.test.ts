import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClothAssembly, createQuadPatch, validateClothAssembly } from './patternAssembly.ts';
import { mergeClothAssemblies } from './mergeClothAssemblies.ts';

function quadAssembly(id: string, xOffset: number) {
  return buildClothAssembly({
    patches: [
      createQuadPatch({
        id,
        corners: [
          [xOffset, 0, 0],
          [xOffset + 0.4, 0, 0],
          [xOffset + 0.4, 0.5, 0],
          [xOffset, 0.5, 0],
        ],
        segmentsU: 3,
        segmentsV: 4,
      }),
    ],
  });
}

test('mergeClothAssemblies remaps vertex and edge ids without validation issues', () => {
  const left = quadAssembly('left', 0);
  const right = quadAssembly('right', 0.5);
  const merged = mergeClothAssemblies([left, right]);

  assert.equal(merged.vertices.length, left.vertices.length + right.vertices.length);
  assert.equal(merged.faces.length, left.faces.length + right.faces.length);
  assert.equal(merged.edges.length, left.edges.length + right.edges.length);
  assert.equal(validateClothAssembly(merged).length, 0);

  const vertexIds = new Set(merged.vertices.map((vertex) => vertex.id));
  assert.equal(vertexIds.size, merged.vertices.length);
  assert.ok(merged.vertices.some((vertex) => vertex.patchId.endsWith('@0')));
  assert.ok(merged.vertices.some((vertex) => vertex.patchId.endsWith('@1')));

  for (const face of merged.faces) {
    for (const vertexIndex of face.vertices) {
      assert.ok(vertexIds.has(vertexIndex));
    }
  }
});

test('mergeClothAssemblies returns the sole assembly unchanged', () => {
  const solo = quadAssembly('solo', 0);
  assert.equal(mergeClothAssemblies([solo]), solo);
});
