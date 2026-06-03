import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forwardYawToXZDirection,
  meshBindYawFromMeasuredForward,
  wrapAngleRad,
} from './rigForwardMeasure.ts';

test('meshBindYaw negates measured bind forward', () => {
  assert.ok(Math.abs(meshBindYawFromMeasuredForward(Math.PI / 2) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(meshBindYawFromMeasuredForward(0)) < 1e-9);
});

test('forwardYawToXZDirection matches atan2 convention', () => {
  const dir = forwardYawToXZDirection(Math.PI / 2);
  assert.ok(Math.abs(dir.x - 1) < 1e-9);
  assert.ok(Math.abs(dir.z) < 1e-9);
});

test('wrapAngleRad normalizes to (-pi, pi]', () => {
  assert.ok(Math.abs(wrapAngleRad(Math.PI * 3) - Math.PI) < 1e-6);
});
