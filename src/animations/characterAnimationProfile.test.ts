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
  assert.ok(resolveClipUrl(profile.states.walk.clips[0]!).includes('ZombieWalk_01_mixamo.fbx'));
});

test('duel-brawler profile uses alternate locomotion defaults', () => {
  const profile = getProfile('duel-brawler');
  assert.ok(profile.states.walk.clips[0]!.file.includes('StepForward'));
  assert.equal(profile.parameters.walkSpeed, 1.2);
});
