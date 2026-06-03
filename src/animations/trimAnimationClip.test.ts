import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { trimAnimationClip } from './trimAnimationClip.ts';

test('trimAnimationClip shortens clip duration to the requested range', () => {
  const tracks = [
    new THREE.QuaternionKeyframeTrack(
      'mixamorigHips.quaternion',
      [0, 1, 2, 3],
      new Array(16).fill(0).map((_, index) => (index % 4 === 3 ? 1 : 0)),
    ),
  ];
  const source = new THREE.AnimationClip('Source', 3, tracks);
  const trimmed = trimAnimationClip(source, {
    name: 'Jab',
    startSec: 0.5,
    endSec: 1.5,
    fps: 30,
  });
  assert.ok(trimmed.duration >= 0.95 && trimmed.duration <= 1.05);
  assert.equal(trimmed.name, 'Jab');
});
