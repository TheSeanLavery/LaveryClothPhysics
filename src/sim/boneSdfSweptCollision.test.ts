import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sampleSweptCapsuleContact,
  transferredColliderMotion,
  type SweptCapsuleSample,
} from './boneSdfSweptCollision.ts';

describe('swept bone SDF collision math', () => {
  it('detects a rotating capsule path that final-pose collision misses', () => {
    const point = { x: 0, y: 0.2, z: 0 };
    const capsule: SweptCapsuleSample = {
      previousStart: { x: -0.5, y: 0.11, z: 0 },
      previousEnd: { x: -0.5, y: 0.41, z: 0 },
      currentStart: { x: 0.5, y: 0.11, z: 0 },
      currentEnd: { x: 0.5, y: 0.41, z: 0 },
      radius: 0.08,
    };

    const currentOnly = sampleSweptCapsuleContact(point, {
      ...capsule,
      previousStart: capsule.currentStart,
      previousEnd: capsule.currentEnd,
    });
    const swept = sampleSweptCapsuleContact(point, capsule, 3);

    assert.equal(currentOnly.signedDistance > 0, true);
    assert.equal(swept.signedDistance < 0, true);
  });

  it('adds collider motion only when the capsule moves into the cloth', () => {
    const intoContact = {
      signedDistance: -0.02,
      normal: { x: 1, y: 0, z: 0 },
      colliderMotion: { x: 0.08, y: 0, z: 0 },
    };
    const separating = {
      signedDistance: -0.02,
      normal: { x: 1, y: 0, z: 0 },
      colliderMotion: { x: -0.08, y: 0, z: 0 },
    };

    const transfer = transferredColliderMotion(intoContact);
    assert.equal(transfer.x > 0, true);
    assert.equal(transfer.x <= 0.035 * 0.65, true);
    assert.deepEqual(transferredColliderMotion(separating), { x: 0, y: 0, z: 0 });
  });
});
