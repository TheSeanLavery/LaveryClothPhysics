import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyLoopEndBlend, findBestLoopEnd } from './loopMatch.ts';

function makeSpinClip(duration: number, samples: number): THREE.AnimationClip {
  const times: number[] = [];
  const values: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const time = (index / (samples - 1)) * duration;
    times.push(time);
    const angle = (time / duration) * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    values.push(q.x, q.y, q.z, q.w);
  }
  const track = new THREE.QuaternionKeyframeTrack('mixamorigHips.quaternion', times, values);
  return new THREE.AnimationClip('Spin', duration, [track]);
}

test('findBestLoopEnd picks a cycle boundary for a repeating spin', () => {
  const clip = makeSpinClip(2, 61);
  const result = findBestLoopEnd(clip, {
    startSec: 0,
    searchStartSec: 0.5,
    searchEndSec: 2,
    fps: 30,
  });
  assert.ok(result.endSec > 1.7 && result.endSec <= 2);
  assert.ok(result.score < 0.15);
});

test('applyLoopEndBlend pulls the tail toward the first-frame pose', () => {
  const clip = makeSpinClip(1, 31);
  const blended = applyLoopEndBlend(clip, { blendSec: 0.2, fps: 30 });
  const start = new THREE.Quaternion();
  const end = new THREE.Quaternion();
  start.fromArray(blended.tracks[0]!.values, 0);
  const lastIndex = blended.tracks[0]!.times.length - 1;
  end.fromArray(blended.tracks[0]!.values, lastIndex * 4);
  const dot = Math.abs(start.dot(end));
  assert.ok(dot > 0.92);
});
