import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_SDF_SQUASH_CONFIG,
  SdfSquashTracker,
  type SdfSquashCapsule,
  type SdfSquashConfig,
} from './sdfSquashResolver.ts';

function makeCapsule(
  name: string,
  parentName: string,
  radius: number,
  start: [number, number, number],
  end: [number, number, number],
  id = 0,
): SdfSquashCapsule {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  return {
    id,
    name,
    parentName,
    radius,
    length: Math.hypot(dx, dy, dz),
    start,
    end,
  };
}

const aggressiveConfig: SdfSquashConfig = {
  ...DEFAULT_SDF_SQUASH_CONFIG,
  enabled: true,
  sdfGap: 0.01,
  squashGain: 1.2,
  maxSquash: 0.04,
  smoothing: 1,
  recovery: 1,
  minRadiusScale: 0.5,
};

describe('sdfSquashResolver', () => {
  it('squashes cross-body overlaps such as hand vs thigh', () => {
    const tracker = new SdfSquashTracker();
    const hand = makeCapsule(
      'mixamorigLeftHand',
      'mixamorigLeftForeArm',
      0.05,
      [0.12, 0.92, 0.04],
      [0.14, 1.02, 0.05],
      1,
    );
    const thigh = makeCapsule(
      'mixamorigLeftUpLeg',
      'mixamorigHips',
      0.09,
      [0.12, 0.95, 0.02],
      [0.14, 0.55, 0.04],
      2,
    );
    const result = tracker.apply([hand, thigh], aggressiveConfig);
    assert.ok(result.report.activePairCount >= 1);
    assert.ok(result.report.topPairs[0]?.policy === 'cross');
    assert.ok(result.capsules[0]!.radius < hand.radius);
    assert.ok(result.capsules[1]!.radius < thigh.radius);
    assert.ok(result.capsules[1]!.radius > result.capsules[0]!.radius);
  });

  it('ignores adjacent segments on the same limb chain', () => {
    const tracker = new SdfSquashTracker();
    const upperArm = makeCapsule(
      'mixamorigLeftArm',
      'mixamorigLeftShoulder',
      0.06,
      [0.2, 1.45, 0],
      [0.45, 1.42, 0],
      1,
    );
    const forearm = makeCapsule(
      'mixamorigLeftForeArm',
      'mixamorigLeftArm',
      0.055,
      [0.45, 1.42, 0],
      [0.7, 1.38, 0],
      2,
    );
    const result = tracker.apply([upperArm, forearm], aggressiveConfig);
    assert.equal(result.report.activePairCount, 0);
    assert.equal(result.capsules[0]!.radius, upperArm.radius);
    assert.equal(result.capsules[1]!.radius, forearm.radius);
  });

  it('classifies shoulder-torso overlaps as joint neighbors', () => {
    const tracker = new SdfSquashTracker();
    const shoulder = makeCapsule(
      'mixamorigLeftShoulder',
      'mixamorigSpine2',
      0.07,
      [0.06, 1.32, 0],
      [0.16, 1.3, 0],
      1,
    );
    const torso = makeCapsule(
      'mixamorigSpine2',
      'mixamorigSpine1',
      0.11,
      [0, 1.35, 0],
      [0, 1.05, 0.02],
      2,
    );
    const result = tracker.apply([shoulder, torso], aggressiveConfig);
    assert.equal(result.report.topPairs[0]?.policy, 'joint');
    assert.ok(result.capsules[0]!.radius <= shoulder.radius);
    assert.ok(result.capsules[1]!.radius <= torso.radius);
  });

  it('respects maxSquash and minRadiusScale caps', () => {
    const tracker = new SdfSquashTracker();
    const a = makeCapsule('mixamorigLeftHand', 'mixamorigLeftForeArm', 0.05, [0, 1, 0], [0, 1.1, 0], 1);
    const b = makeCapsule('mixamorigRightUpLeg', 'mixamorigHips', 0.1, [0, 0.95, 0], [0, 0.5, 0], 2);
    const result = tracker.apply([a, b], {
      ...aggressiveConfig,
      maxSquash: 0.01,
      minRadiusScale: 0.8,
    });
    assert.ok(a.radius - result.capsules[0]!.radius <= 0.0101);
    assert.ok(result.capsules[0]!.radius >= a.radius * 0.8 - 1e-6);
    assert.ok(result.capsules[1]!.radius >= b.radius * 0.8 - 1e-6);
  });
});
