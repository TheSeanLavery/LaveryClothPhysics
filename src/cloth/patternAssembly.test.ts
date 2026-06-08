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

test('default T-shirt neckline stays crew-neck sized, not boat-neck wide', () => {
  const shirt = createTShirtAssembly({
    bodyWidth: 0.66,
    torsoHeight: 0.74,
    sleeveLength: 0.24,
    sleeveOpening: 0.26,
    depth: 0.25,
    bodySegmentsX: 38,
    bodySegmentsY: 38,
    sleeveSegmentsX: 6,
  });

  const bodySegmentsX = 38;
  const neckHalfSegments = Math.max(2, Math.round(bodySegmentsX * 0.09));
  const neckLeftU = (Math.floor(bodySegmentsX * 0.5) - neckHalfSegments) / bodySegmentsX;
  const neckRightU = (Math.ceil(bodySegmentsX * 0.5) + neckHalfSegments) / bodySegmentsX;
  const neckline = shirt.vertices.filter(
    (vertex) =>
      vertex.patchId === 'tshirt-front'
      && vertex.uv[1] > 0.99
      && vertex.uv[0] >= neckLeftU - 0.01
      && vertex.uv[0] <= neckRightU + 0.01,
  );
  const xs = neckline.map((vertex) => vertex.position[0]);
  const neckWidth = Math.max(...xs) - Math.min(...xs);
  const shoulderWidth = 0.66 * 0.84;

  assert.ok(neckWidth < shoulderWidth * 0.24, `neck width ${neckWidth.toFixed(3)} too wide`);
  assert.ok(neckWidth > shoulderWidth * 0.1, `neck width ${neckWidth.toFixed(3)} too narrow`);
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

test('marks quad patch internal diagonals as shear edges', () => {
  const patch = createQuadPatch({
    id: 'quad',
    corners: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    segmentsU: 2,
    segmentsV: 2,
  });
  const assembly = buildClothAssembly({ patches: [patch] });

  const shearCount = assembly.edges.filter((edge) => edge.kind === 'shear').length;
  const structuralCount = assembly.edges.filter((edge) => edge.kind === 'structural').length;

  assert.equal(shearCount, 4);
  assert.equal(structuralCount, 12);
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
