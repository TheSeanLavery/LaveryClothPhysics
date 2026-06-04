import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  classifyPhysicsPoseBone,
  cloneAnimationTargetSkeleton,
  PhysicsPoseRig,
} from './physicsPoseRig.ts';

test('classifyPhysicsPoseBone maps limbs and spine', () => {
  assert.equal(classifyPhysicsPoseBone('mixamorigLeftHand'), 'hand');
  assert.equal(classifyPhysicsPoseBone('mixamorigSpine2'), 'spine');
  assert.equal(classifyPhysicsPoseBone('mixamorigLeftForeArm'), 'arm');
});

test('PhysicsPoseRig caps display rotation speed toward target', () => {
  const hips = new THREE.Bone();
  hips.name = 'mixamorigHips';
  const spine = new THREE.Bone();
  spine.name = 'mixamorigSpine';
  hips.add(spine);
  const displayBones = [hips, spine];

  const { pairs } = cloneAnimationTargetSkeleton(displayBones);
  const rig = new PhysicsPoseRig({
    enabled: true,
    globalFollow: 1,
    stiffnessSpine: 80,
    dampingSpine: 2,
    maxAngularSpeedSpine: 2,
  });
  rig.bind(pairs);

  const { target, display } = pairs[1]!;
  display.quaternion.set(0, 0, 0, 1);
  target.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);

  const dt = 1 / 60;
  const initialAngle = display.quaternion.angleTo(target.quaternion);
  const stats = rig.step(dt);
  const afterAngle = display.quaternion.angleTo(target.quaternion);
  const moved = initialAngle - afterAngle;
  const maxStep = 2 * dt;

  assert.ok(stats.maxTargetDisplayAngleRad > 0.5);
  assert.ok(afterAngle > 1, `display should lag target, remaining ${afterAngle} rad`);
  assert.ok(moved > 0.01, 'display should move toward target');
  assert.ok(moved <= maxStep + 0.02, `one frame should move at most ~${maxStep} rad, moved ${moved}`);
});

test('PhysicsPoseRig disabled snaps display to target', () => {
  const bone = new THREE.Bone();
  bone.name = 'mixamorigSpine';
  const { pairs } = cloneAnimationTargetSkeleton([bone]);
  const rig = new PhysicsPoseRig({ enabled: false });
  rig.bind(pairs);
  pairs[0]!.display.quaternion.set(0, 0, 0, 1);
  pairs[0]!.target.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8);
  rig.step(1 / 60);
  assert.ok(pairs[0]!.display.quaternion.angleTo(pairs[0]!.target.quaternion) < 1e-4);
});
