import * as THREE from 'three';
import { normalizeBoneName } from '../animations/animationRetarget.ts';

const TMP_HIPS = new THREE.Vector3();
const TMP_SPINE = new THREE.Vector3();
const TMP_LEFT = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_RIGHT_AXIS = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();

function findBone(bones: readonly THREE.Bone[], keys: readonly string[]): THREE.Bone | null {
  for (const key of keys) {
    const normalizedKey = normalizeBoneName(key);
    const exact = bones.find((bone) => normalizeBoneName(bone.name).endsWith(normalizedKey));
    if (exact) return exact;
    const partial = bones.find((bone) => normalizeBoneName(bone.name).includes(normalizedKey));
    if (partial) return partial;
  }
  return null;
}

/** World XZ yaw (radians) of visual forward from hips / shoulders at current bone pose. */
export function measureBonesForwardYaw(
  bones: readonly THREE.Bone[],
  root: THREE.Object3D,
): number | null {
  root.updateMatrixWorld(true);

  const hips = findBone(bones, ['hips']);
  const spine = findBone(bones, ['spine2', 'spine1', 'spine']);
  const leftShoulder = findBone(bones, ['leftshoulder', 'leftarm']);
  const rightShoulder = findBone(bones, ['rightshoulder', 'rightarm']);

  if (hips && spine && leftShoulder && rightShoulder) {
    hips.getWorldPosition(TMP_HIPS);
    spine.getWorldPosition(TMP_SPINE);
    leftShoulder.getWorldPosition(TMP_LEFT);
    rightShoulder.getWorldPosition(TMP_RIGHT);
    TMP_UP.copy(TMP_SPINE).sub(TMP_HIPS).normalize();
    TMP_RIGHT_AXIS.copy(TMP_RIGHT).sub(TMP_LEFT).normalize();
    TMP_FORWARD.crossVectors(TMP_UP, TMP_RIGHT_AXIS).normalize();
    TMP_FORWARD.y = 0;
    if (TMP_FORWARD.lengthSq() > 1e-6) {
      TMP_FORWARD.normalize();
      return Math.atan2(TMP_FORWARD.x, TMP_FORWARD.z);
    }
  }

  if (hips) {
    hips.getWorldQuaternion(TMP_Q);
    TMP_FORWARD.set(0, 0, -1).applyQuaternion(TMP_Q);
    TMP_FORWARD.y = 0;
    if (TMP_FORWARD.lengthSq() > 1e-6) {
      TMP_FORWARD.normalize();
      return Math.atan2(TMP_FORWARD.x, TMP_FORWARD.z);
    }
  }

  return null;
}

export function wrapAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Signed shortest rotation from `fromRad` to `toRad` (always in [-π, π]). */
export function shortestAngleDelta(fromRad: number, toRad: number): number {
  return Math.atan2(Math.sin(toRad - fromRad), Math.cos(toRad - fromRad));
}

/** `toRad` plus a multiple of 2π closest to `baseRad` — avoids long-path turns. */
export function nearestEquivalentAngleRad(baseRad: number, toRad: number): number {
  const base = wrapAngleRad(baseRad);
  return base + shortestAngleDelta(base, toRad);
}

/** `root.rotation.y` so visual forward matches world direction (dx, dz) on XZ. */
export function meshBindYawFromMeasuredForward(measuredForwardYawRad: number): number {
  return -measuredForwardYawRad;
}

export interface RigForwardMeasureSource {
  readonly root: THREE.Object3D;
  getBones(): readonly THREE.Bone[];
  getLoadedRoot(): THREE.Object3D | null;
}

/** Unit XZ direction from `measureBonesForwardYaw` / `measureRigForwardYaw` result. */
export function forwardYawToXZDirection(yawRad: number): { readonly x: number; readonly z: number } {
  return { x: Math.sin(yawRad), z: Math.cos(yawRad) };
}

export function measureRigForwardYaw(rig: RigForwardMeasureSource): number | null {
  const loadedRoot = rig.getLoadedRoot();
  if (!loadedRoot) {
    return null;
  }
  return measureBonesForwardYaw(rig.getBones(), rig.root);
}
