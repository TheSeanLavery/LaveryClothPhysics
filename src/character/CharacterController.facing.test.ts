import assert from 'node:assert/strict';
import test from 'node:test';
import { wrapAngleRad } from './rigForwardMeasure.ts';

/** Documented ~90° failure when walk meshBindYaw used for look-at. */
test('meshBindYaw look-at error is ~90° for typical opponent bearing', () => {
  const meshBindYaw = -Math.PI / 2;
  const dx = 0;
  const dz = -1;
  const intentMeshYaw = Math.atan2(dx, dz);
  const walkStyleRoot = Math.atan2(dx, dz) + meshBindYaw;
  const errDeg = (wrapAngleRad(intentMeshYaw - walkStyleRoot) * 180) / Math.PI;
  assert.ok(Math.abs(errDeg - 90) < 5 || Math.abs(errDeg + 90) < 5);
});
