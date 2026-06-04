import assert from 'node:assert/strict';
import test from 'node:test';
import { getProfile } from './characterAnimationProfile.ts';
import { resolveRigDressTiming } from './rigDressSequence.ts';

test('resolveRigDressTiming uses instant fade and profile settle by default', () => {
  const profile = getProfile('duel-fighter');
  const timing = resolveRigDressTiming(profile);
  assert.equal(timing.poseFadeSec, 0);
  assert.equal(timing.poseSettleSec, 0.35);
  assert.ok(timing.settleSteps >= 20);
});

test('resolveRigDressTiming honors option overrides', () => {
  const profile = getProfile('duel-fighter');
  const timing = resolveRigDressTiming(profile, { poseFadeSec: 0.2, poseSettleSec: 0.5 });
  assert.equal(timing.poseFadeSec, 0.2);
  assert.equal(timing.poseSettleSec, 0.5);
});
