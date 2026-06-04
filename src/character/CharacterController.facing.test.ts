import assert from 'node:assert/strict';
import test from 'node:test';
import { shortestAngleDelta, wrapAngleRad } from './rigForwardMeasure.ts';

/**
 * UNIT TESTS HERE ARE MATH-ONLY — they do NOT load Three.js, a rig, or the duel scene.
 * They cannot catch "press S rotates the wrong way" bugs. See:
 * - src/character/facingTurnAudit.test.ts (synthetic sample curves)
 * - tests/character-duel-facing.spec.ts (headed Playwright, real root.rotation.y)
 */

test('meshBindYaw look-at error is ~90° when walk bind used for pure look-at', () => {
  const meshBindYaw = -Math.PI / 2;
  const intentMeshYaw = Math.atan2(0, -1);
  const walkStyleRoot = Math.atan2(0, -1) + meshBindYaw;
  const errDeg = (wrapAngleRad(intentMeshYaw - walkStyleRoot) * 180) / Math.PI;
  assert.ok(Math.abs(errDeg - 90) < 5 || Math.abs(errDeg + 90) < 5);
});

test('walk bind formula for +Z movement is -π/2 (documentation only)', () => {
  const down = wrapAngleRad(Math.atan2(0, 1) + -Math.PI / 2);
  assert.ok(Math.abs(down + Math.PI / 2) < 1e-6);
});

test('shortestAngleDelta never exceeds π', () => {
  assert.ok(Math.abs(shortestAngleDelta(0.2, -3)) <= Math.PI + 1e-9);
});
