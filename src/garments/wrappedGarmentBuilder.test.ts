import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { CharacterAnchors } from '../character/AnimatedCharacter.ts';
import {
  applyWrappedGarmentLooseness,
  auditWrappedGarmentProof,
  buildWrappedGarmentAssemblyFromAnchors,
  type WrappedGarmentProofKind,
} from './wrappedGarmentBuilder.ts';

const mockAnchors: CharacterAnchors = {
  hips: new THREE.Vector3(0, 0.82, 0),
  chest: new THREE.Vector3(0, 1.12, 0),
  neck: new THREE.Vector3(0, 1.36, 0),
  leftShoulder: new THREE.Vector3(-0.2, 1.3, 0),
  rightShoulder: new THREE.Vector3(0.2, 1.3, 0),
  leftArm: new THREE.Vector3(-0.42, 1.14, 0),
  rightArm: new THREE.Vector3(0.42, 1.14, 0),
};

const mockSdfs = [
  {
    start: [0, 0.75, 0] as const,
    end: [0, 1.35, 0] as const,
    radius: 0.13,
    name: 'spine2',
  },
  {
    start: [-0.05, 1.22, 0] as const,
    end: [-0.42, 1.12, 0] as const,
    radius: 0.055,
    name: 'leftarm',
  },
  {
    start: [0.05, 1.22, 0] as const,
    end: [0.42, 1.12, 0] as const,
    radius: 0.055,
    name: 'rightarm',
  },
] as const;

const proofs: WrappedGarmentProofKind[] = [
  'torso',
  'torsoTube',
  'leftArm',
  'rightArm',
  'torsoAndArms',
  'torsoAndArmsLoose',
];

for (const proof of proofs) {
  test(`builds valid wrapped ${proof} assembly on mock anchors`, () => {
    const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, proof, {
      gridSpacing: 0.05,
      clearance: 0.008,
    });
    const report = auditWrappedGarmentProof(assembly, proof, mockSdfs, 0.008, 0.05);

    assert.ok(assembly.vertices.length > 0, `${proof} should have vertices`);
    assert.ok(assembly.faces.length > 0, `${proof} should have faces`);
    assert.equal(report.validationIssueCount, 0, report.failures.join('; '));
    assert.equal(report.penetrationCount, 0, `penetrations: ${report.penetrationCount}`);
    assert.equal(report.passed, true, report.failures.join('; '));
  });
}

test('torso panels stitch front and back side seams', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torso', {
    gridSpacing: 0.05,
  });
  assert.ok(assembly.stitchEdges.length >= 4);
  assert.ok(assembly.stitchEdges.some((edge) => edge.sourceId === 'wrapped-left-side-seam'));
});

test('torsoAndArms welds shoulder stitches to sleeves', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torsoAndArms', {
    gridSpacing: 0.05,
  });
  const report = auditWrappedGarmentProof(assembly, 'torsoAndArms', mockSdfs, 0.008, 0.05);
  assert.ok(assembly.stitchEdges.length >= 20);
  assert.ok(assembly.stitchEdges.some((edge) => edge.sourceId === 'wrapped-front-left-shoulder'));
  assert.ok(assembly.stitchEdges.every((edge) => edge.restLength === 0));
  assert.ok(report.maxStitchGap < 0.002, `stitch gap ${report.maxStitchGap}`);
});

test('torso tube forms a closed band around the body', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torsoTube', {
    gridSpacing: 0.05,
  });
  const verts = assembly.vertices.filter((vertex) => vertex.patchId === 'wrapped-torso-tube');
  const xs = verts.map((vertex) => vertex.position[0]);
  const zs = verts.map((vertex) => vertex.position[2]);
  const radial = verts.map((vertex) => Math.hypot(vertex.position[0], vertex.position[2]));
  assert.ok(Math.max(...xs) > 0.04);
  assert.ok(Math.min(...xs) < -0.04);
  assert.ok(Math.max(...radial) > 0.08);
  assert.ok(Math.min(...zs) < Math.max(...zs));
});

test('looseness increases average edge rest length', () => {
  const tight = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torso', {
    gridSpacing: 0.05,
  });
  const loose = applyWrappedGarmentLooseness(tight, 0.1);
  const tightAvg = averageEdgeLength(tight);
  const looseAvg = averageEdgeLength(loose);
  assert.ok(looseAvg > tightAvg * 1.08, `loose ${looseAvg} should exceed tight ${tightAvg}`);
});

test('torso wrap spans hips to neck height band', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torso', {
    gridSpacing: 0.05,
  });
  const torsoVerts = assembly.vertices.filter((vertex) => vertex.patchId.includes('wrapped-torso'));
  const ys = torsoVerts.map((vertex) => vertex.position[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  assert.ok(minY >= mockAnchors.hips!.y + 0.02, `torso bottom ${minY} too low`);
  assert.ok(maxY <= mockAnchors.neck!.y + 0.02, `torso top ${maxY} too high`);
  assert.ok(maxY - minY > 0.25, 'torso band should cover meaningful height');
});

test('arm wrap vertices stay near arm capsules', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'leftArm', {
    gridSpacing: 0.05,
  });
  const armVerts = assembly.vertices.filter((vertex) => vertex.patchId === 'wrapped-arm-left');
  const meanX = armVerts.reduce((sum, vertex) => sum + vertex.position[0], 0) / armVerts.length;
  assert.ok(meanX < -0.04, `left arm mean x ${meanX} should be negative`);
});

test('wrapped proofs keep structural edges near grid spacing', () => {
  const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, 'torsoAndArms', {
    gridSpacing: 0.05,
  });
  const report = auditWrappedGarmentProof(assembly, 'torsoAndArms', mockSdfs, 0.008, 0.05);
  assert.ok(report.percentile95EdgeLength <= 0.05 * 3, `p95 edge ${report.percentile95EdgeLength}`);
});

test('arm tubes close the underarm seam so sleeves do not pop open', () => {
  for (const proof of ['leftArm', 'rightArm'] as const) {
    const assembly = buildWrappedGarmentAssemblyFromAnchors(mockAnchors, mockSdfs, proof, {
      gridSpacing: 0.05,
    });
    const report = auditWrappedGarmentProof(assembly, proof, mockSdfs, 0.008, 0.05);
    assert.ok(assembly.stitchEdges.some((edge) => edge.sourceId.includes('arm') && edge.sourceId.includes('seam')));
    assert.ok(report.maxStitchGap < 0.002, `${proof} seam gap ${report.maxStitchGap}`);
    assert.equal(report.penetrationCount, 0);
  }
});

function averageEdgeLength(assembly: ReturnType<typeof buildWrappedGarmentAssemblyFromAnchors>): number {
  const structural = assembly.edges.filter((edge) => edge.kind === 'structural');
  const total = structural.reduce((sum, edge) => sum + edge.restLength, 0);
  return total / Math.max(1, structural.length);
}
