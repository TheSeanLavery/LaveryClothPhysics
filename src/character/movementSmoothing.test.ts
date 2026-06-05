import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveMovementSmoothingParams,
  smoothInput2D,
  smoothVelocity2D,
  stepAngularVelocity,
} from './movementSmoothing.ts';

test('resolveMovementSmoothingParams fills defaults from profile turnSpeed', () => {
  const params = resolveMovementSmoothingParams({
    meshBindYaw: 0,
    stanceYawOffset: 0,
    walkSpeed: 1.35,
    turnSpeed: 8,
    attackRange: 1,
    attackCooldownSeconds: 1,
    moveThreshold: 0.08,
  });
  assert.equal(params.maxTurnSpeed, 8);
  assert.equal(params.moveDecel, 2.5);
  assert.equal(params.attackStepRampSec, 0.15);
});

test('smoothVelocity2D coasts down when desired velocity is zero', () => {
  let vx = 1.35;
  let vz = 0;
  for (let i = 0; i < 120; i += 1) {
    const next = smoothVelocity2D(vx, vz, 0, 0, 1 / 60, 8, 2.5);
    vx = next.x;
    vz = next.z;
  }
  assert.ok(Math.hypot(vx, vz) < 0.05);
});

test('smoothInput2D eases toward target instead of stepping instantly', () => {
  const first = smoothInput2D(0, 0, 1, 0, 1 / 60, 0.1);
  assert.ok(first.x > 0 && first.x < 1);
  const settled = smoothInput2D(0.99, 0, 1, 0, 1 / 60, 0.1);
  assert.ok(settled.x > 0.99);
});

test('stepAngularVelocity limits per-frame yaw change', () => {
  const result = stepAngularVelocity(0, 0, Math.PI / 2, 1 / 60, {
    turnAccel: 10,
    turnDecel: 6,
    maxTurnSpeed: 8,
  });
  assert.ok(Math.abs(result.yaw) <= (8 / 60) + 1e-6);
});
