import assert from 'node:assert/strict';
import test from 'node:test';
import {
  forwardYawToXZDirection,
  meshBindYawFromMeasuredForward,
  nearestEquivalentAngleRad,
  shortestAngleDelta,
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

test('shortestAngleDelta uses the small arc when target differs by almost 2pi', () => {
  const from = 0.1;
  const to = 0.1 + Math.PI * 2 - 0.2;
  const delta = shortestAngleDelta(from, to);
  assert.ok(Math.abs(delta) < 0.3, `expected ~0.2 rad, got ${delta}`);
  assert.ok(Math.abs(delta) < Math.PI);
});

test('nearestEquivalentAngleRad stays within pi of wrapped base', () => {
  const base = 14.5;
  const wrapped = wrapAngleRad(base);
  const to = wrapped + 0.2 + 6 * Math.PI * 2;
  const nearest = nearestEquivalentAngleRad(base, to);
  assert.ok(Math.abs(nearest - wrapped) < 0.3);
  assert.ok(Math.abs(shortestAngleDelta(wrapped, nearest) - shortestAngleDelta(wrapped, wrapAngleRad(to))) < 1e-6);
});
