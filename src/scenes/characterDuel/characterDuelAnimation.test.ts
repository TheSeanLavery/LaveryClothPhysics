import assert from 'node:assert/strict';
import test from 'node:test';
import { getProfile } from '../../animations/characterAnimationProfile.ts';
import {
  buildCharacterDuelAnimationSetup,
  getDefaultCharacterDuelAnimationSetup,
} from './characterDuelAnimation.ts';

test('buildCharacterDuelAnimationSetup copies both fighter profiles', () => {
  const setup = buildCharacterDuelAnimationSetup(
    getProfile('duel-fighter'),
    getProfile('duel-brawler'),
  );
  assert.equal(setup.version, 1);
  assert.equal(setup.fighterA.profile.id, 'duel-fighter');
  assert.equal(setup.fighterB.profile.id, 'duel-brawler');
  assert.ok(setup.fighterA.profile.states.walk.clips[0]?.file?.includes('ZombieWalk'));
});

test('getDefaultCharacterDuelAnimationSetup uses duel fighter and brawler', () => {
  const setup = getDefaultCharacterDuelAnimationSetup();
  assert.equal(setup.fighterA.profile.id, 'duel-fighter');
  assert.equal(setup.fighterB.profile.id, 'duel-brawler');
});
