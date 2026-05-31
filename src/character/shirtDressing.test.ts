import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  auditAssemblyStrain,
  auditBodyNotFloatingOverArms,
  auditEdgeCapsuleClearance,
  auditPerCapsuleClearance,
  auditShirtSdfClearance,
  auditTriangleCapsuleClearance,
  auditTriangleQuality,
  closestCapsuleSignedDistance,
  projectToExteriorShell,
  SHIRT_SDF_CLEARANCE,
  signedDistanceToCapsule,
} from './shirtDressing.ts';

const clearance = SHIRT_SDF_CLEARANCE;

describe('shirt SDF dressing utilities', () => {
  it('reports negative signed distance for points inside a capsule', () => {
    const capsules = [{
      start: [0, 0, 0] as const,
      end: [0, 1, 0] as const,
      radius: 0.1,
      name: 'torso',
    }];
    const inside = closestCapsuleSignedDistance(new THREE.Vector3(0, 0.5, 0), capsules);
    assert.ok(inside.distance < 0);
  });

  it('projects an interior point outside a single capsule', () => {
    const capsules = [{
      start: [0, 0, 0] as const,
      end: [0, 1, 0] as const,
      radius: 0.1,
      name: 'torso',
    }];
    const pushed = projectToExteriorShell(new THREE.Vector3(0, 0.5, 0), capsules, clearance);
    const sample = closestCapsuleSignedDistance(pushed, capsules);
    assert.ok(sample.distance >= clearance - 0.0001);
  });

  it('projects a point outside overlapping torso and arm capsules', () => {
    const capsules = [
      {
        start: [0, 0.8, 0] as const,
        end: [0, 1.2, 0] as const,
        radius: 0.12,
        name: 'spine2',
      },
      {
        start: [0.05, 1.1, 0] as const,
        end: [0.45, 1.05, 0] as const,
        radius: 0.06,
        name: 'leftarm',
      },
    ];
    const pushed = projectToExteriorShell(new THREE.Vector3(0.12, 1.08, 0), capsules, clearance);
    const report = auditShirtSdfClearance([{ position: [pushed.x, pushed.y, pushed.z] }], capsules, clearance);
    assert.equal(report.penetrationCount, 0);
    assert.ok(report.minSignedDistance >= clearance - 0.0001);
  });

  it('clears every vertex against every capsule in a per-capsule audit', () => {
    const capsules = [
      { start: [0, 0.7, 0] as const, end: [0, 1.3, 0] as const, radius: 0.11, name: 'spine' },
      { start: [-0.35, 1.15, 0] as const, end: [-0.7, 1.1, 0] as const, radius: 0.05, name: 'leftarm' },
      { start: [0.35, 1.15, 0] as const, end: [0.7, 1.1, 0] as const, radius: 0.05, name: 'rightarm' },
    ];
    const rawVertices = [];
    for (let x = -0.4; x <= 0.4; x += 0.08) {
      for (let y = 0.75; y <= 1.25; y += 0.08) {
        rawVertices.push(new THREE.Vector3(x, y, 0));
      }
    }

    const dressedVertices = rawVertices.map((point) => {
      const projected = projectToExteriorShell(point, capsules, clearance);
      return { position: [projected.x, projected.y, projected.z] as [number, number, number] };
    });

    const unionReport = auditShirtSdfClearance(dressedVertices, capsules, clearance);
    const perCapsuleReport = auditPerCapsuleClearance(dressedVertices, capsules, clearance);
    assert.equal(unionReport.penetrationCount, 0);
    assert.equal(perCapsuleReport.failureCount, 0);
    assert.ok(unionReport.minSignedDistance >= clearance - 0.0001);
    assert.ok(unionReport.averageClearance > clearance);
  });

  it('does not leave body vertices floating above horizontal arm capsules', () => {
    const armCapsules = [
      { start: [-0.05, 1.12, 0] as const, end: [-0.55, 1.1, 0] as const, radius: 0.06, name: 'leftarm' },
      { start: [0.05, 1.12, 0] as const, end: [0.55, 1.1, 0] as const, radius: 0.06, name: 'rightarm' },
    ];
    const capsules = [
      { start: [0, 0.8, 0] as const, end: [0, 1.2, 0] as const, radius: 0.12, name: 'spine2' },
      ...armCapsules,
    ];

    const bodyVertices = [];
    for (let x = -0.18; x <= 0.18; x += 0.06) {
      for (let y = 1.05; y <= 1.18; y += 0.04) {
        for (const z of [-0.12, 0.12]) {
          bodyVertices.push({
            patchId: z < 0 ? 'front-panel' : 'back-panel',
            uv: [x < 0 ? 0.2 : 0.8, 0.85] as [number, number],
            position: projectToExteriorShell(new THREE.Vector3(x, y, z), capsules, clearance),
          });
        }
      }
    }

    const drapeReport = auditBodyNotFloatingOverArms(bodyVertices, armCapsules, clearance);
    assert.equal(drapeReport.floatingOverArmCount, 0);
    assert.ok(drapeReport.maxFloatHeight <= 0.015);
  });

  it('reports per-capsule failures when a vertex penetrates one capsule but not the closest', () => {
    const capsules = [
      { start: [0, 0.8, 0] as const, end: [0, 1.2, 0] as const, radius: 0.12, name: 'spine2' },
      { start: [0.05, 1.1, 0] as const, end: [0.45, 1.05, 0] as const, radius: 0.06, name: 'leftarm' },
    ];
    const point = new THREE.Vector3(0.12, 1.08, 0);
    assert.ok(signedDistanceToCapsule(point, capsules[1]!) < clearance);
    const report = auditPerCapsuleClearance([{ position: [point.x, point.y, point.z] }], capsules, clearance);
    assert.ok(report.failureCount > 0);
  });

  it('catches an edge crossing a capsule even when both endpoints are outside', () => {
    const assembly = {
      vertices: [
        { id: 0, patchId: 'front-panel', localId: 0, position: [-0.2, 0.5, 0] as const, uv: [0, 0] as const },
        { id: 1, patchId: 'front-panel', localId: 1, position: [0.2, 0.5, 0] as const, uv: [1, 0] as const },
      ],
      faces: [],
      edges: [{ id: 0, a: 0, b: 1, kind: 'structural' as const, restLength: 0.4, sourceId: 'front-panel' }],
      stitchEdges: [],
    };
    const capsules = [{ start: [0, 0, 0] as const, end: [0, 1, 0] as const, radius: 0.08, name: 'torso' }];
    const vertexReport = auditPerCapsuleClearance(assembly.vertices, capsules, clearance);
    const edgeReport = auditEdgeCapsuleClearance(assembly, capsules, clearance);
    assert.equal(vertexReport.failureCount, 0);
    assert.ok(edgeReport.failureCount > 0);
  });

  it('catches a triangle pierced by a capsule axis', () => {
    const assembly = {
      vertices: [
        { id: 0, patchId: 'front-panel', localId: 0, position: [-0.2, 0.45, -0.1] as const, uv: [0, 0] as const },
        { id: 1, patchId: 'front-panel', localId: 1, position: [0.2, 0.45, -0.1] as const, uv: [1, 0] as const },
        { id: 2, patchId: 'front-panel', localId: 2, position: [0, 0.45, 0.2] as const, uv: [0.5, 1] as const },
      ],
      faces: [{ id: 0, vertices: [0, 1, 2] as const, source: 'patch' as const }],
      edges: [
        { id: 0, a: 0, b: 1, kind: 'structural' as const, restLength: 0.4, sourceId: 'front-panel' },
        { id: 1, a: 1, b: 2, kind: 'structural' as const, restLength: 0.36, sourceId: 'front-panel' },
        { id: 2, a: 2, b: 0, kind: 'structural' as const, restLength: 0.36, sourceId: 'front-panel' },
      ],
      stitchEdges: [],
    };
    const capsules = [{ start: [0, 0.2, 0] as const, end: [0, 0.8, 0] as const, radius: 0.02, name: 'spine' }];
    const report = auditTriangleCapsuleClearance(assembly, capsules, clearance);
    assert.ok(report.failureCount > 0);
  });

  it('reports strain and degenerate triangle quality', () => {
    const assembly = {
      vertices: [
        { id: 0, patchId: 'front-panel', localId: 0, position: [0, 0, 0] as const, uv: [0, 0] as const },
        { id: 1, patchId: 'front-panel', localId: 1, position: [2, 0, 0] as const, uv: [1, 0] as const },
        { id: 2, patchId: 'front-panel', localId: 2, position: [4, 0, 0] as const, uv: [1, 1] as const },
      ],
      faces: [{ id: 0, vertices: [0, 1, 2] as const, source: 'patch' as const }],
      edges: [{ id: 0, a: 0, b: 1, kind: 'structural' as const, restLength: 1, sourceId: 'front-panel' }],
      stitchEdges: [],
    };
    const strain = auditAssemblyStrain(assembly, 0.1);
    const quality = auditTriangleQuality(assembly);
    assert.equal(strain.overLimitCount, 1);
    assert.equal(quality.degenerateCount, 1);
  });
});
