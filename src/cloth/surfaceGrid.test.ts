import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  auditMeshEdgeSpacing,
  buildArcLengthKnots,
  buildMatchedArcLengthKnots,
  createQuadGridPatch,
  segmentsForChordLength,
} from './surfaceGrid.ts';

test('buildArcLengthKnots spaces samples evenly on a quarter circle', () => {
  const radius = 0.2;
  const gridSpacing = 0.05;
  const knots = buildArcLengthKnots(
    (t) => new THREE.Vector3(
      Math.cos(t * Math.PI * 0.5) * radius,
      Math.sin(t * Math.PI * 0.5) * radius,
      0,
    ),
    { gridSpacing, minSegments: 3, maxSegments: 24 },
  );

  const points = knots.map((t) => new THREE.Vector3(
    Math.cos(t * Math.PI * 0.5) * radius,
    Math.sin(t * Math.PI * 0.5) * radius,
    0,
  ));
  const edgeLengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    edgeLengths.push(points[i - 1]!.distanceTo(points[i]!));
  }

  const mean = edgeLengths.reduce((sum, length) => sum + length, 0) / edgeLengths.length;
  for (const length of edgeLengths) {
    assert.ok(Math.abs(length - mean) < gridSpacing * 0.35, `edge ${length} deviates from mean ${mean}`);
  }
});

test('createQuadGridPatch keeps quad edges near target spacing on a bent sheet', () => {
  const gridSpacing = 0.04;
  const uKnots = buildArcLengthKnots(
    (u) => new THREE.Vector3(u * 0.5, 0, 0),
    { gridSpacing, minSegments: 4, maxSegments: 16 },
  );
  const vKnots = buildArcLengthKnots(
    (v) => new THREE.Vector3(0, v * 0.6, Math.sin(v * Math.PI) * 0.08),
    { gridSpacing, minSegments: 4, maxSegments: 16 },
  );
  const patch = createQuadGridPatch({
    id: 'bent-sheet',
    uKnots,
    vKnots,
    sample: (u, v) => [u * 0.5, v * 0.6, Math.sin(v * Math.PI) * 0.08],
  });

  const edges: { a: number; b: number }[] = [];
  const index = (u: number, v: number) => u * (vKnots.length) + v;
  const segmentsU = uKnots.length - 1;
  const segmentsV = vKnots.length - 1;
  for (let u = 0; u <= segmentsU; u++) {
    for (let v = 0; v <= segmentsV; v++) {
      if (u < segmentsU) {
        edges.push({ a: index(u, v), b: index(u + 1, v) });
      }
      if (v < segmentsV) {
        edges.push({ a: index(u, v), b: index(u, v + 1) });
      }
    }
  }

  const audit = auditMeshEdgeSpacing(patch.vertices, edges, gridSpacing, 0.55);
  assert.ok(audit.longEdgeCount === 0, `long edges ${audit.longEdgeCount}, max ${audit.maxEdgeLength}`);
  assert.ok(audit.maxAspectRatio < 1.8, `aspect ratio ${audit.maxAspectRatio}`);
});

test('segmentsForChordLength matches ceil(length / spacing)', () => {
  assert.equal(segmentsForChordLength(0.22, 0.05, 1, 32), 5);
  assert.equal(segmentsForChordLength(0.2, 0.05, 1, 32), 4);
});

test('buildMatchedArcLengthKnots follows the longest boundary curve', () => {
  const short = (t: number) => new THREE.Vector3(t * 0.1, 0, 0);
  const long = (t: number) => new THREE.Vector3(t * 0.5, Math.sin(t * Math.PI) * 0.12, 0);
  const knots = buildMatchedArcLengthKnots([short, long], {
    gridSpacing: 0.05,
    minSegments: 4,
    maxSegments: 24,
  });
  const points = knots.map((t) => long(t));
  const edgeLengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    edgeLengths.push(points[i - 1]!.distanceTo(points[i]!));
  }
  const mean = edgeLengths.reduce((sum, length) => sum + length, 0) / edgeLengths.length;
  assert.ok(knots.length >= 6);
  assert.ok(Math.max(...edgeLengths) < mean * 1.6);
});
