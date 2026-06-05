import * as THREE from 'three';
import { normalizedBoneKey } from './characterSdfSchema.ts';

export interface SdfSquashCapsule {
  readonly id: number;
  readonly name: string;
  readonly parentName: string;
  readonly radius: number;
  readonly length: number;
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
}

export interface SdfSquashConfig {
  readonly enabled: boolean;
  /** Desired air gap between effective capsule surfaces (meters). */
  readonly sdfGap: number;
  /** Converts overlap depth into radius loss (meters per meter). */
  readonly squashGain: number;
  /** Maximum radius reduction per capsule (meters). */
  readonly maxSquash: number;
  /** Minimum fraction of authored radius after squash. */
  readonly minRadiusScale: number;
  /** Blend toward target squash each application (0–1). */
  readonly smoothing: number;
  /** Blend toward zero squash when no overlap (0–1). */
  readonly recovery: number;
}

export const DEFAULT_SDF_SQUASH_CONFIG: SdfSquashConfig = {
  enabled: true,
  sdfGap: 0.006,
  squashGain: 0.9,
  maxSquash: 0.028,
  minRadiusScale: 0.58,
  smoothing: 0.42,
  recovery: 0.18,
};

export interface SdfSquashPairReport {
  readonly nameA: string;
  readonly nameB: string;
  readonly overlap: number;
  readonly squashA: number;
  readonly squashB: number;
  readonly policy: 'ignore' | 'joint' | 'cross';
}

export interface SdfSquashReport {
  readonly activePairCount: number;
  readonly maxOverlap: number;
  readonly squashedCapsuleCount: number;
  readonly meanSquash: number;
  readonly topPairs: readonly SdfSquashPairReport[];
}

export interface SdfSquashResult {
  readonly capsules: SdfSquashCapsule[];
  readonly report: SdfSquashReport;
}

type SdfBodyGroup =
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'head'
  | 'softExtra'
  | 'other';

interface ClassifiedCapsule {
  readonly capsule: SdfSquashCapsule;
  readonly group: SdfBodyGroup;
  readonly chainIndex: number;
  readonly shrinkWeight: number;
}

interface PairPolicy {
  readonly ignore: boolean;
  readonly gainMul: number;
  readonly splitA: number;
  readonly splitB: number;
  readonly policy: 'ignore' | 'joint' | 'cross';
}

export class SdfSquashTracker {
  private readonly squashByKey = new Map<string, number>();

  reset(): void {
    this.squashByKey.clear();
  }

  apply(
    capsules: readonly SdfSquashCapsule[],
    config: SdfSquashConfig,
  ): SdfSquashResult {
    if (!config.enabled || capsules.length === 0) {
      return {
        capsules: capsules.map((capsule) => ({ ...capsule })),
        report: emptySquashReport(),
      };
    }

    const classified = capsules.map(classifyCapsule);
    const targetSquash = new Map<string, number>();
    const pairReports: SdfSquashPairReport[] = [];

    for (let i = 0; i < classified.length; i += 1) {
      for (let j = i + 1; j < classified.length; j += 1) {
        const a = classified[i]!;
        const b = classified[j]!;
        const policy = resolvePairPolicy(a, b);
        if (policy.ignore) {
          continue;
        }

        const segmentDistance = closestSegmentSegmentDistance(
          a.capsule.start,
          a.capsule.end,
          b.capsule.start,
          b.capsule.end,
        );
        const overlap = a.capsule.radius + b.capsule.radius + config.sdfGap - segmentDistance;
        if (overlap <= 0) {
          continue;
        }

        const squashA = Math.min(
          config.maxSquash,
          overlap * config.squashGain * policy.gainMul * policy.splitA * a.shrinkWeight,
        );
        const squashB = Math.min(
          config.maxSquash,
          overlap * config.squashGain * policy.gainMul * policy.splitB * b.shrinkWeight,
        );

        targetSquash.set(a.capsule.name, Math.max(targetSquash.get(a.capsule.name) ?? 0, squashA));
        targetSquash.set(b.capsule.name, Math.max(targetSquash.get(b.capsule.name) ?? 0, squashB));
        pairReports.push({
          nameA: a.capsule.name,
          nameB: b.capsule.name,
          overlap,
          squashA,
          squashB,
          policy: policy.policy,
        });
      }
    }

    const smoothedSquash = new Map<string, number>();
    let squashedCapsuleCount = 0;
    let squashSum = 0;

    for (const capsule of capsules) {
      const key = capsule.name;
      const previous = this.squashByKey.get(key) ?? 0;
      const target = targetSquash.get(key) ?? 0;
      const blend = target > previous ? config.smoothing : config.recovery;
      const next = previous + (target - previous) * THREE.MathUtils.clamp(blend, 0, 1);
      const clamped = Math.max(0, Math.min(config.maxSquash, next));
      smoothedSquash.set(key, clamped);
      this.squashByKey.set(key, clamped);
      if (clamped > 0.0005) {
        squashedCapsuleCount += 1;
        squashSum += clamped;
      }
    }

    const squashedCapsules = capsules.map((capsule) => {
      const squash = smoothedSquash.get(capsule.name) ?? 0;
      const minRadius = capsule.radius * config.minRadiusScale;
      const effectiveRadius = Math.max(minRadius, capsule.radius - squash);
      return {
        ...capsule,
        radius: effectiveRadius,
      };
    });

    pairReports.sort((left, right) => right.overlap - left.overlap);
    const activePairs = pairReports.filter((pair) => pair.overlap > 0.0005);

    return {
      capsules: squashedCapsules,
      report: {
        activePairCount: activePairs.length,
        maxOverlap: activePairs[0]?.overlap ?? 0,
        squashedCapsuleCount,
        meanSquash: squashedCapsuleCount > 0 ? squashSum / squashedCapsuleCount : 0,
        topPairs: activePairs.slice(0, 8),
      },
    };
  }
}

function emptySquashReport(): SdfSquashReport {
  return {
    activePairCount: 0,
    maxOverlap: 0,
    squashedCapsuleCount: 0,
    meanSquash: 0,
    topPairs: [],
  };
}

function classifyCapsule(capsule: SdfSquashCapsule): ClassifiedCapsule {
  const key = normalizedBoneKey(capsule.parentName || capsule.name);
  const group = classifyGroup(key, capsule.name);
  return {
    capsule,
    group,
    chainIndex: chainIndexForGroup(group, key, capsule.name),
    shrinkWeight: shrinkWeightForGroup(group),
  };
}

function classifyGroup(parentKey: string, name: string): SdfBodyGroup {
  const combined = `${parentKey} ${normalizedBoneKey(name)}`;
  if (/soft-/.test(name)) {
    return 'softExtra';
  }
  if (/head/.test(combined) && !/shoulder/.test(combined)) {
    return 'head';
  }
  if (/left/.test(combined) && /hand|forearm|arm|shoulder/.test(combined)) {
    return 'leftArm';
  }
  if (/right/.test(combined) && /hand|forearm|arm|shoulder/.test(combined)) {
    return 'rightArm';
  }
  if (/left/.test(combined) && /upleg|foot|thigh|calf/.test(combined)) {
    return 'leftLeg';
  }
  if (/right/.test(combined) && /upleg|foot|thigh|calf/.test(combined)) {
    return 'rightLeg';
  }
  if (/left/.test(combined) && /\bleg\b/.test(combined)) {
    return 'leftLeg';
  }
  if (/right/.test(combined) && /\bleg\b/.test(combined)) {
    return 'rightLeg';
  }
  if (/spine|chest/.test(combined)) {
    return 'torso';
  }
  if (/hips/.test(combined) && !/upleg|leg|foot/.test(combined)) {
    return 'torso';
  }
  if (/neck/.test(combined)) {
    return 'head';
  }
  return 'other';
}

function chainIndexForGroup(group: SdfBodyGroup, parentKey: string, name: string): number {
  const selfKey = normalizedBoneKey(name);
  const combined = `${parentKey} ${selfKey}`;
  switch (group) {
    case 'torso':
      if (/hips/.test(combined)) return 0;
      if (/spine2/.test(combined)) return 2;
      if (/spine1/.test(combined)) return 1;
      if (/spine/.test(combined)) return 1;
      if (/neck/.test(combined)) return 3;
      return 1;
    case 'leftArm':
    case 'rightArm':
      if (/shoulder/.test(selfKey)) return 0;
      if (/forearm/.test(selfKey)) return 2;
      if (/hand/.test(selfKey)) return 3;
      if (/^.*arm$/.test(selfKey) || (/arm/.test(selfKey) && !/forearm/.test(selfKey))) return 1;
      if (/shoulder/.test(combined)) return 0;
      if (/forearm/.test(combined)) return 2;
      if (/hand/.test(combined)) return 3;
      return 1;
    case 'leftLeg':
    case 'rightLeg':
      if (/upleg/.test(selfKey)) return 0;
      if (/foot/.test(selfKey)) return 2;
      if (/leg/.test(selfKey) && !/upleg/.test(selfKey)) return 1;
      if (/upleg|thigh/.test(combined)) return 0;
      if (/foot/.test(combined)) return 2;
      if (/leg|calf/.test(combined)) return 1;
      return 1;
    case 'head':
      if (/neck/.test(combined)) return 0;
      return 1;
    default:
      return 0;
  }
}

function shrinkWeightForGroup(group: SdfBodyGroup): number {
  switch (group) {
    case 'torso':
      return 0.35;
    case 'head':
      return 0.4;
    case 'leftLeg':
    case 'rightLeg':
      return 0.75;
    case 'leftArm':
    case 'rightArm':
      return 0.95;
    case 'softExtra':
      return 1.35;
    default:
      return 1;
  }
}

function resolvePairPolicy(a: ClassifiedCapsule, b: ClassifiedCapsule): PairPolicy {
  if (a.group === b.group) {
    const chainDistance = Math.abs(a.chainIndex - b.chainIndex);
    if (chainDistance <= 1) {
      return { ignore: true, gainMul: 0, splitA: 0, splitB: 0, policy: 'ignore' };
    }
    return { ignore: false, gainMul: 0.35, splitA: 0.5, splitB: 0.5, policy: 'joint' };
  }

  if (isJointNeighborPair(a, b)) {
    return { ignore: false, gainMul: 0.32, splitA: 0.45, splitB: 0.55, policy: 'joint' };
  }

  const priorityA = priorityForGroup(a.group);
  const priorityB = priorityForGroup(b.group);
  const prioritySum = Math.max(0.2, priorityA + priorityB);
  const splitA = (priorityB / prioritySum);
  const splitB = (priorityA / prioritySum);
  return { ignore: false, gainMul: 1, splitA, splitB, policy: 'cross' };
}

function priorityForGroup(group: SdfBodyGroup): number {
  switch (group) {
    case 'torso':
      return 1;
    case 'head':
      return 0.9;
    case 'leftLeg':
    case 'rightLeg':
      return 0.7;
    case 'leftArm':
    case 'rightArm':
      return 0.55;
    case 'softExtra':
      return 0.25;
    default:
      return 0.5;
  }
}

function isJointNeighborPair(a: ClassifiedCapsule, b: ClassifiedCapsule): boolean {
  const jointPairs: Array<[SdfBodyGroup, SdfBodyGroup]> = [
    ['torso', 'leftArm'],
    ['torso', 'rightArm'],
    ['torso', 'leftLeg'],
    ['torso', 'rightLeg'],
    ['head', 'torso'],
    ['leftArm', 'torso'],
    ['rightArm', 'torso'],
    ['leftLeg', 'torso'],
    ['rightLeg', 'torso'],
  ];
  return jointPairs.some(([left, right]) =>
    (a.group === left && b.group === right) || (a.group === right && b.group === left),
  );
}

function closestSegmentSegmentDistance(
  a0: readonly [number, number, number],
  a1: readonly [number, number, number],
  b0: readonly [number, number, number],
  b1: readonly [number, number, number],
): number {
  const p1 = new THREE.Vector3(...a0);
  const q1 = new THREE.Vector3(...a1);
  const p2 = new THREE.Vector3(...b0);
  const q2 = new THREE.Vector3(...b1);
  const closest = closestSegmentSegmentPoints(p1, q1, p2, q2);
  return closest.a.distanceTo(closest.b);
}

function closestSegmentSegmentPoints(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
): { readonly a: THREE.Vector3; readonly b: THREE.Vector3 } {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;

  if (a <= 1e-12 && e <= 1e-12) {
    return { a: p1.clone(), b: p2.clone() };
  }
  if (a <= 1e-12) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (denom !== 0) {
        s = THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1);
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }

  return {
    a: p1.clone().addScaledVector(d1, s),
    b: p2.clone().addScaledVector(d2, t),
  };
}

export function patchSdfSquashConfig(
  config: SdfSquashConfig,
  patch: Partial<SdfSquashConfig>,
): SdfSquashConfig {
  return { ...config, ...patch };
}
