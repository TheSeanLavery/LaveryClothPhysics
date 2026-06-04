import assert from 'node:assert/strict';
import test from 'node:test';
import { getDefaultProfileId, getProfile, resolveClipUrl } from './characterAnimationProfile.ts';

test('duel-fighter profile defines four states and combat transitions', () => {
  const profile = getProfile(getDefaultProfileId());
  assert.equal(profile.id, 'duel-fighter');
  assert.ok(profile.states.tpose.clips[0]);
  assert.ok(profile.states.idle.clips[0]);
  assert.ok(profile.states.walk.clips[0]);
  assert.equal(profile.states.attack.clips.length, 5);
  assert.equal(profile.states.attack.pick, 'random');
  assert.equal(profile.transitions.length, 6);
  assert.equal(profile.parameters.meshBindYaw, -Math.PI / 2);
  assert.ok(typeof profile.parameters.stanceYawOffset === 'number');
  assert.equal(profile.parameters.dressPoseFadeSec, 0);
  assert.equal(profile.parameters.dressPoseSettleSec, 0.35);
  assert.equal(profile.parameters.dressBlendToIdleSec, 0.85);
  assert.equal(profile.states.tpose.clips[0]!.fadeIn, 0);
  assert.equal(profile.states.idle.clips[0]!.fadeIn, 0.55);
  assert.ok(resolveClipUrl(profile.states.walk.clips[0]!).includes('ZombieWalk_01_mixamo.fbx'));
});

test('duel-brawler profile uses alternate locomotion defaults', () => {
  const profile = getProfile('duel-brawler');
  assert.ok(profile.states.walk.clips[0]!.file.includes('StepForward'));
  assert.equal(profile.parameters.walkSpeed, 1.2);
});
