import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClothAssembly,
  createOctagonalTubeAssembly,
  createPyramidAssembly,
  createQuadPatch,
  createStitchedBoxAssembly,
  createTShirtAssembly,
  validateClothAssembly,
} from './patternAssembly.ts';

test('builds a stitched box with all twelve edges paired', () => {
  const box = createStitchedBoxAssembly({
    width: 1,
    height: 1,
    depth: 1,
    segments: 2,
  });

  assert.equal(box.stitchEdges.length, 12 * 3);
  assert.equal(validateClothAssembly(box).length, 0);
  assert.ok(box.faces.some((face) => face.source === 'stitch-render'));
  assertStitchesAreCoincident(box);
});

test('builds an octagonal tube from eight stitched panels', () => {
  const tube = createOctagonalTubeAssembly({
    radius: 0.5,
    height: 1,
    segmentsHeight: 4,
  });

  assert.equal(tube.stitchEdges.length, 8 * 5);
  assert.equal(validateClothAssembly(tube).length, 0);
  assert.equal(new Set(tube.stitchEdges.map((edge) => edge.sourceId)).size, 8);
  assertStitchesAreCoincident(tube);
});

test('builds a closed pyramid with side and base stitches', () => {
  const pyramid = createPyramidAssembly({
    baseSize: 1,
    height: 1,
    includeBase: true,
  });

  assert.equal(pyramid.stitchEdges.length, 8 * 2);
  assert.equal(validateClothAssembly(pyramid).length, 0);
  assert.ok(pyramid.faces.some((face) => face.stitchId === 'pyramid-base-front'));
  assertStitchesAreCoincident(pyramid);
});

test('builds a stitched T-shirt with welded seams and open neck/hem/cuffs', () => {
  const shirt = createTShirtAssembly({
    bodyWidth: 0.8,
    torsoHeight: 0.9,
    sleeveLength: 0.32,
    sleeveOpening: 0.32,
    depth: 0.12,
    bodySegmentsX: 12,
    bodySegmentsY: 18,
    sleeveSegmentsX: 5,
  });

  assert.equal(validateClothAssembly(shirt).length, 0);
  assert.equal(new Set(shirt.vertices.map((vertex) => vertex.patchId)).size, 6);
  assert.ok(shirt.stitchEdges.length > 80);
  assert.ok(shirt.faces.some((face) => face.stitchId === 'tshirt-left-sleeve-underarm'));
  assert.ok(shirt.stitchEdges.every((edge) => edge.restLength === 0));
  assert.ok(Math.max(...shirt.edges.filter((edge) => edge.kind === 'structural').map((edge) => edge.restLength)) < 0.12);
});

test('rejects stitches with mismatched boundary sample counts', () => {
  const coarse = createQuadPatch({
    id: 'coarse',
    corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    segmentsU: 1,
    segmentsV: 1,
  });
  const dense = createQuadPatch({
    id: 'dense',
    corners: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
    segmentsU: 1,
    segmentsV: 3,
  });

  assert.throws(
    () =>
      buildClothAssembly({
        patches: [coarse, dense],
        stitches: [
          {
            id: 'bad-count',
            a: { patchId: 'coarse', boundary: 'right' },
            b: { patchId: 'dense', boundary: 'left' },
          },
        ],
      }),
    /boundary counts differ/,
  );
});

function assertStitchesAreCoincident(assembly: ReturnType<typeof createStitchedBoxAssembly>): void {
  for (const edge of assembly.stitchEdges) {
    const a = assembly.vertices[edge.a]!.position;
    const b = assembly.vertices[edge.b]!.position;
    assert.ok(
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6,
      `${edge.sourceId} stitches non-coincident vertices ${edge.a} and ${edge.b}`,
    );
  }
}
