import assert from 'node:assert/strict';
import test from 'node:test';
import { auditFacingTurn, type FacingSample } from './facingTurnAudit.ts';

test('auditFacingTurn passes monotonic 90° approach', () => {
  const samples: FacingSample[] = [];
  for (let i = 0; i <= 10; i++) {
    samples.push({
      tMs: i * 50,
      yawRad: 1.57 - (i / 10) * 1.4,
      desiredYawRad: 0.17,
      intentMeshYawRad: 0,
      mode: 'walk',
    });
  }
  const v = auditFacingTurn(samples, 0);
  assert.equal(v.passed, true, v.failures.join('; '));
});

test('auditFacingTurn fails wobble (sign flip)', () => {
  const samples: FacingSample[] = [
    { tMs: 0, yawRad: 1.2, desiredYawRad: 0.2, intentMeshYawRad: 0, mode: 'walk' },
    { tMs: 50, yawRad: 0.6, desiredYawRad: 0.2, intentMeshYawRad: 0, mode: 'walk' },
    { tMs: 100, yawRad: 1.0, desiredYawRad: 0.2, intentMeshYawRad: 0, mode: 'walk' },
    { tMs: 150, yawRad: 0.2, desiredYawRad: 0.2, intentMeshYawRad: 0, mode: 'walk' },
  ];
  const v = auditFacingTurn(samples, 0);
  assert.equal(v.passed, false);
  assert.ok(v.signFlipCount > 0);
});
