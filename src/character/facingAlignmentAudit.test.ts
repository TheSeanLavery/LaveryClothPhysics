import assert from 'node:assert/strict';
import test from 'node:test';
import { auditFacingSuite, auditMeshAlignment, type FacingAlignmentSample } from './facingAlignmentAudit.ts';

test('auditMeshAlignment passes when orange tracks green', () => {
  const samples: FacingAlignmentSample[] = [];
  for (let i = 0; i < 10; i++) {
    samples.push({
      tMs: i * 50,
      yawRad: 0,
      desiredYawRad: 0,
      intentMeshYawRad: 0,
      mode: 'walk',
      meshForwardYawRad: 0.05,
      meshAlignErrorDeg: 2.8,
    });
  }
  const v = auditMeshAlignment(samples, { maxAlignErrorDeg: 28 });
  assert.equal(v.passed, true, v.failures.join('; '));
});

test('auditFacingSuite fails when walk mesh never aligns', () => {
  const walk: FacingAlignmentSample[] = [];
  for (let i = 0; i < 12; i++) {
    walk.push({
      tMs: i * 50,
      yawRad: 1,
      desiredYawRad: 1,
      intentMeshYawRad: 0,
      mode: 'walk',
      meshForwardYawRad: 1.4,
      meshAlignErrorDeg: 80,
    });
  }
  const suite = auditFacingSuite({
    idleSamples: [],
    walkSamples: walk,
    expectedWalkIntentMeshYawRad: 0,
  });
  assert.equal(suite.passed, false);
  assert.ok(suite.failures.some((f) => f.includes('mesh align')));
});
