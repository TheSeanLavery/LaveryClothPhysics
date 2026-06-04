import * as THREE from 'three';

export type PhysicsPoseBoneClass = 'spine' | 'arm' | 'hand' | 'leg' | 'head' | 'default';

export interface PhysicsPoseBonePair {
  readonly display: THREE.Bone;
  readonly target: THREE.Bone;
  readonly boneClass: PhysicsPoseBoneClass;
}

export interface PhysicsPoseRigConfig {
  /** When false, display bones snap to target each frame (no lag). */
  enabled: boolean;
  /** Scales how strongly display chases target (0 = frozen, 1 = full spring). */
  globalFollow: number;
  stiffnessSpine: number;
  dampingSpine: number;
  maxAngularSpeedSpine: number;
  stiffnessArm: number;
  dampingArm: number;
  maxAngularSpeedArm: number;
  stiffnessHand: number;
  dampingHand: number;
  maxAngularSpeedHand: number;
  stiffnessLeg: number;
  dampingLeg: number;
  maxAngularSpeedLeg: number;
  stiffnessHead: number;
  dampingHead: number;
  maxAngularSpeedHead: number;
  stiffnessDefault: number;
  dampingDefault: number;
  maxAngularSpeedDefault: number;
}

export interface PhysicsPoseRigStats {
  readonly enabled: boolean;
  readonly pairCount: number;
  readonly maxTargetDisplayAngleRad: number;
  readonly maxTargetDisplayAngleDeg: number;
  readonly lastStepSec: number;
}

export const DEFAULT_PHYSICS_POSE_RIG_CONFIG: Readonly<PhysicsPoseRigConfig> = {
  enabled: true,
  globalFollow: 1,
  stiffnessSpine: 42,
  dampingSpine: 14,
  maxAngularSpeedSpine: 5.5,
  stiffnessArm: 28,
  dampingArm: 11,
  maxAngularSpeedArm: 8,
  stiffnessHand: 22,
  dampingHand: 9,
  maxAngularSpeedHand: 10,
  stiffnessLeg: 32,
  dampingLeg: 12,
  maxAngularSpeedLeg: 7,
  stiffnessHead: 36,
  dampingHead: 13,
  maxAngularSpeedHead: 6,
  stiffnessDefault: 30,
  dampingDefault: 11,
  maxAngularSpeedDefault: 7,
};

export function normalizePhysicsBoneKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

export function classifyPhysicsPoseBone(name: string): PhysicsPoseBoneClass {
  const key = normalizePhysicsBoneKey(name);
  if (/head|neck/.test(key)) {
    return 'head';
  }
  if (/spine|hips|shoulder/.test(key) && !/arm|hand|leg|foot|toe/.test(key)) {
    return 'spine';
  }
  if (/hand|wrist|finger|thumb/.test(key)) {
    return 'hand';
  }
  if (/arm|forearm|elbow/.test(key)) {
    return 'arm';
  }
  if (/leg|thigh|knee|foot|toe|ankle/.test(key)) {
    return 'leg';
  }
  return 'default';
}

export function cloneAnimationTargetSkeleton(displayBones: readonly THREE.Bone[]): {
  readonly targetRoot: THREE.Group;
  readonly targetBones: THREE.Bone[];
  readonly pairs: PhysicsPoseBonePair[];
} {
  const targetRoot = new THREE.Group();
  targetRoot.name = 'animation-target-rig';
  targetRoot.visible = false;

  const targetByDisplayName = new Map<string, THREE.Bone>();
  const pairs: PhysicsPoseBonePair[] = [];

  for (const displayBone of displayBones) {
    const targetBone = new THREE.Bone();
    targetBone.name = displayBone.name;
    targetBone.position.copy(displayBone.position);
    targetBone.quaternion.copy(displayBone.quaternion);
    targetBone.scale.copy(displayBone.scale);
    targetByDisplayName.set(displayBone.name, targetBone);
    pairs.push({
      display: displayBone,
      target: targetBone,
      boneClass: classifyPhysicsPoseBone(displayBone.name),
    });
  }

  const targetBones: THREE.Bone[] = [];
  for (const pair of pairs) {
    const parent = pair.display.parent;
    if (parent instanceof THREE.Bone) {
      const targetParent = targetByDisplayName.get(parent.name);
      if (targetParent) {
        targetParent.add(pair.target);
      } else {
        targetRoot.add(pair.target);
      }
    } else {
      targetRoot.add(pair.target);
    }
    targetBones.push(pair.target);
  }

  return { targetRoot, targetBones, pairs };
}

interface BoneSpringParams {
  readonly stiffness: number;
  readonly damping: number;
  readonly maxAngularSpeed: number;
}

export class PhysicsPoseRig {
  readonly config: PhysicsPoseRigConfig;
  private pairs: PhysicsPoseBonePair[] = [];
  private lastMaxAngleRad = 0;
  private lastStepSec = 0;

  constructor(config: Partial<PhysicsPoseRigConfig> = {}) {
    this.config = { ...DEFAULT_PHYSICS_POSE_RIG_CONFIG, ...config };
  }

  bind(pairs: readonly PhysicsPoseBonePair[]): void {
    this.pairs = [...pairs];
    this.snapDisplayToTarget();
  }

  getPairCount(): number {
    return this.pairs.length;
  }

  snapDisplayToTarget(): void {
    for (const { display, target } of this.pairs) {
      display.position.copy(target.position);
      display.quaternion.copy(target.quaternion);
      display.scale.copy(target.scale);
    }
    this.lastMaxAngleRad = 0;
  }

  step(delta: number): PhysicsPoseRigStats {
    this.lastStepSec = delta;
    let maxAngle = 0;

    if (this.pairs.length === 0) {
      this.lastMaxAngleRad = 0;
      return this.buildStats();
    }

    if (!this.config.enabled || delta <= 0) {
      this.snapDisplayToTarget();
      return this.buildStats();
    }

    const follow = THREE.MathUtils.clamp(this.config.globalFollow, 0, 1);

    for (const pair of this.pairs) {
      const params = this.paramsForClass(pair.boneClass);
      const targetQ = pair.target.quaternion;
      const displayQ = pair.display.quaternion;
      const angle = displayQ.angleTo(targetQ);
      maxAngle = Math.max(maxAngle, angle);

      const springAlpha = 1 - Math.exp(-params.stiffness * delta);
      const dampScale = Math.exp(-params.damping * delta);
      let alpha = springAlpha * dampScale * follow;

      const maxStep = params.maxAngularSpeed * delta;
      if (angle > 1e-6) {
        alpha = Math.min(alpha, maxStep / angle);
      }

      if (alpha >= 1 - 1e-5) {
        displayQ.copy(targetQ);
      } else if (alpha > 1e-6) {
        displayQ.slerp(targetQ, alpha);
      }

      displayQ.normalize();
      pair.display.position.copy(pair.target.position);
      pair.display.scale.copy(pair.target.scale);
    }

    this.lastMaxAngleRad = maxAngle;
    return this.buildStats();
  }

  getStats(): PhysicsPoseRigStats {
    let maxAngle = 0;
    for (const { display, target } of this.pairs) {
      maxAngle = Math.max(maxAngle, display.quaternion.angleTo(target.quaternion));
    }
    return this.buildStats(maxAngle);
  }

  private buildStats(maxAngleRad = this.lastMaxAngleRad): PhysicsPoseRigStats {
    return {
      enabled: this.config.enabled,
      pairCount: this.pairs.length,
      maxTargetDisplayAngleRad: maxAngleRad,
      maxTargetDisplayAngleDeg: THREE.MathUtils.radToDeg(maxAngleRad),
      lastStepSec: this.lastStepSec,
    };
  }

  private paramsForClass(boneClass: PhysicsPoseBoneClass): BoneSpringParams {
    const c = this.config;
    switch (boneClass) {
      case 'spine':
        return { stiffness: c.stiffnessSpine, damping: c.dampingSpine, maxAngularSpeed: c.maxAngularSpeedSpine };
      case 'arm':
        return { stiffness: c.stiffnessArm, damping: c.dampingArm, maxAngularSpeed: c.maxAngularSpeedArm };
      case 'hand':
        return { stiffness: c.stiffnessHand, damping: c.dampingHand, maxAngularSpeed: c.maxAngularSpeedHand };
      case 'leg':
        return { stiffness: c.stiffnessLeg, damping: c.dampingLeg, maxAngularSpeed: c.maxAngularSpeedLeg };
      case 'head':
        return { stiffness: c.stiffnessHead, damping: c.dampingHead, maxAngularSpeed: c.maxAngularSpeedHead };
      default:
        return {
          stiffness: c.stiffnessDefault,
          damping: c.dampingDefault,
          maxAngularSpeed: c.maxAngularSpeedDefault,
        };
    }
  }
}
