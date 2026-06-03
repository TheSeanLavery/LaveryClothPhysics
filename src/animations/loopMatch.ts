import * as THREE from 'three';

export interface LoopMatchOptions {
  readonly startSec: number;
  readonly searchStartSec: number;
  readonly searchEndSec: number;
  readonly minLoopSec?: number;
  readonly fps?: number;
  readonly poseWeight?: number;
  readonly velocityWeight?: number;
}

export interface LoopMatchResult {
  readonly endSec: number;
  readonly score: number;
  readonly poseScore: number;
  readonly velocityScore: number;
  readonly samples: number;
}

export interface LoopBlendOptions {
  readonly blendSec: number;
  readonly fps?: number;
}

const TMP_Q = new THREE.Quaternion();
const TMP_QA = new THREE.Quaternion();
const TMP_QB = new THREE.Quaternion();
const TMP_DQ = new THREE.Quaternion();

function isQuaternionTrack(track: THREE.KeyframeTrack): boolean {
  return track.name.endsWith('.quaternion') && track.getValueSize() === 4;
}

function sampleQuaternionTrack(track: THREE.KeyframeTrack, time: number, target: THREE.Quaternion): void {
  const valueSize = 4;
  const times = track.times;
  if (times.length === 0) {
    target.set(0, 0, 0, 1);
    return;
  }
  if (time <= times[0]!) {
    target.fromArray(track.values, 0);
    return;
  }
  const lastIndex = times.length - 1;
  if (time >= times[lastIndex]!) {
    target.fromArray(track.values, lastIndex * valueSize);
    return;
  }

  let index = 0;
  while (index < lastIndex && times[index + 1]! < time) {
    index += 1;
  }
  const t0 = times[index]!;
  const t1 = times[index + 1]!;
  const alpha = (time - t0) / Math.max(t1 - t0, 1e-8);
  TMP_QA.fromArray(track.values, index * valueSize);
  TMP_QB.fromArray(track.values, (index + 1) * valueSize);
  target.copy(TMP_QA).slerp(TMP_QB, alpha);
}

function sampleBoneQuaternions(clip: THREE.AnimationClip, time: number): Map<string, THREE.Quaternion> {
  const pose = new Map<string, THREE.Quaternion>();
  for (const track of clip.tracks) {
    if (!isQuaternionTrack(track)) {
      continue;
    }
    const boneName = track.name.slice(0, -'.quaternion'.length);
    const quaternion = new THREE.Quaternion();
    sampleQuaternionTrack(track, time, quaternion);
    pose.set(boneName, quaternion);
  }
  return pose;
}

function poseDistance(a: Map<string, THREE.Quaternion>, b: Map<string, THREE.Quaternion>): number {
  let total = 0;
  let count = 0;
  for (const [bone, qa] of a) {
    const qb = b.get(bone);
    if (!qb) {
      continue;
    }
    const dot = Math.abs(qa.dot(qb));
    total += 1 - Math.min(1, dot);
    count += 1;
  }
  return count > 0 ? total / count : 1;
}

function angularVelocityAt(
  clip: THREE.AnimationClip,
  time: number,
  dt: number,
): Map<string, THREE.Quaternion> {
  const before = sampleBoneQuaternions(clip, Math.max(0, time - dt));
  const after = sampleBoneQuaternions(clip, time + dt);
  const velocity = new Map<string, THREE.Quaternion>();

  for (const [bone, qb] of before) {
    const qa = after.get(bone);
    if (!qa) {
      continue;
    }
    TMP_DQ.copy(qb).invert().multiply(qa);
    velocity.set(bone, TMP_DQ.clone());
  }
  return velocity;
}

function velocityDistance(a: Map<string, THREE.Quaternion>, b: Map<string, THREE.Quaternion>): number {
  let total = 0;
  let count = 0;
  for (const [bone, dqa] of a) {
    const dqb = b.get(bone);
    if (!dqb) {
      continue;
    }
    const angleA = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(dqa.w), -1, 1));
    const angleB = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(dqb.w), -1, 1));
    total += Math.abs(angleA - angleB);
    count += 1;
  }
  return count > 0 ? total / count : 1;
}

export function findBestLoopEnd(clip: THREE.AnimationClip, options: LoopMatchOptions): LoopMatchResult {
  const fps = options.fps ?? 30;
  const dt = 1 / fps;
  const poseWeight = options.poseWeight ?? 1;
  const velocityWeight = options.velocityWeight ?? 0.85;
  const minLoopSec = options.minLoopSec ?? 0.35;

  const startPose = sampleBoneQuaternions(clip, options.startSec);
  const startVelocity = angularVelocityAt(clip, options.startSec, dt);

  const searchStart = Math.max(
    options.startSec + minLoopSec,
    options.searchStartSec,
  );
  const searchEnd = Math.min(options.searchEndSec, clip.duration);
  const step = dt;

  let bestEnd = searchEnd;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestPose = 1;
  let bestVel = 1;
  let samples = 0;

  for (let candidate = searchStart; candidate <= searchEnd; candidate += step) {
    const endPose = sampleBoneQuaternions(clip, candidate);
    const endVelocity = angularVelocityAt(clip, candidate, dt);
    const poseScore = poseDistance(startPose, endPose);
    const velocityScore = velocityDistance(startVelocity, endVelocity);
    const score = poseWeight * poseScore + velocityWeight * velocityScore;
    samples += 1;
    if (score < bestScore) {
      bestScore = score;
      bestEnd = candidate;
      bestPose = poseScore;
      bestVel = velocityScore;
    }
  }

  return {
    endSec: bestEnd,
    score: bestScore,
    poseScore: bestPose,
    velocityScore: bestVel,
    samples,
  };
}

function rewriteTrackValues(track: THREE.KeyframeTrack, times: number[], values: number[]): THREE.KeyframeTrack {
  const TrackCtor = track.constructor as new (
    name: string,
    times: number[],
    values: number[],
  ) => THREE.KeyframeTrack;
  return new TrackCtor(track.name, times, values);
}

export function applyLoopEndBlend(clip: THREE.AnimationClip, options: LoopBlendOptions): THREE.AnimationClip {
  const blendSec = Math.max(0, options.blendSec);
  if (blendSec <= 1e-6 || clip.duration <= blendSec) {
    return clip;
  }

  const startPose = sampleBoneQuaternions(clip, 0);
  const blendStart = clip.duration - blendSec;
  const tracks = clip.tracks.map((track) => {
    if (!isQuaternionTrack(track)) {
      return track;
    }
    const boneName = track.name.slice(0, -'.quaternion'.length);
    const target = startPose.get(boneName);
    if (!target) {
      return track;
    }

    const valueSize = 4;
    const times = [...track.times];
    const values = [...track.values];
    for (let index = 0; index < times.length; index += 1) {
      const time = times[index]!;
      if (time < blendStart) {
        continue;
      }
      const alpha = (time - blendStart) / blendSec;
      TMP_Q.fromArray(values, index * valueSize);
      TMP_Q.slerp(target, alpha);
      values[index * valueSize] = TMP_Q.x;
      values[index * valueSize + 1] = TMP_Q.y;
      values[index * valueSize + 2] = TMP_Q.z;
      values[index * valueSize + 3] = TMP_Q.w;
    }
    return rewriteTrackValues(track, times, values);
  });

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
