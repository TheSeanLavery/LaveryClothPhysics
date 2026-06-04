import * as THREE from 'three';
import { CharacterAnimationStateMachine } from '../animations/CharacterAnimationStateMachine.ts';
import { CharacterAnimationPlayer } from '../animations/CharacterAnimationPlayer.ts';
import {
  DEFAULT_MESH_BIND_YAW,
  getDefaultProfileId,
  getProfile,
  resolveProfileFacingParameters,
  type CharacterAnimationProfile,
  type FsmStateId,
} from '../animations/characterAnimationProfile.ts';
import type { RigDressSequenceOptions, RigDressSequenceResult } from '../animations/rigDressSequence.ts';
import type { AnimatedCharacterSceneRig } from './AnimatedCharacter.ts';
import { shortestAngleDelta, wrapAngleRad } from './rigForwardMeasure.ts';

export type CharacterControllerState = FsmStateId;

export type CharacterInputMode = 'human' | 'ai';

export type FacingDebugMode = 'walk' | 'idle' | 'hold' | 'attack';

export interface FacingDebugSnapshot {
  readonly desiredYaw: number;
  readonly actualYaw: number;
  readonly mode: FacingDebugMode;
  readonly intentDirX: number;
  readonly intentDirZ: number;
  readonly meshForwardYaw: number | null;
  readonly intentMeshYaw: number;
  /** `wrap(intentMeshYaw - meshForwardYaw)` — ~±90° when meshBindYaw path used wrongly. */
  readonly meshAlignErrorDeg: number | null;
  /** Walk: locked target from first frame of this input direction (see facingTurnAudit). */
  readonly walkLockedTargetYaw: number | null;
}

export interface CharacterControllerOptions {
  readonly onStateEntered?: (state: FsmStateId) => void | Promise<void>;
}

export class CharacterController {
  readonly root: THREE.Group;
  readonly player: CharacterAnimationPlayer;
  readonly fsm: CharacterAnimationStateMachine;

  private moveInput = new THREE.Vector2();
  private facingYaw = 0;
  private attackCooldown = 0;
  private readonly tmpTarget = new THREE.Vector3();
  private aiWanderTimer = 0;
  private aiMoveBias = new THREE.Vector2();
  /** Last opponent world position from `update` — used to re-snap facing when attack clip starts. */
  private readonly lastOpponent = new THREE.Vector3();
  private hasLastOpponent = false;
  /** Locked WASD direction for walk. */
  private hasLockedWalkDir = false;
  private lockedWalkDirX = 0;
  private lockedWalkDirZ = 0;
  private facingDebug: FacingDebugSnapshot = {
    desiredYaw: 0,
    actualYaw: 0,
    mode: 'hold',
    intentDirX: 0,
    intentDirZ: -1,
    meshForwardYaw: null,
    intentMeshYaw: 0,
    meshAlignErrorDeg: null,
    walkLockedTargetYaw: null,
  };

  constructor(
    readonly rig: AnimatedCharacterSceneRig,
    profile: CharacterAnimationProfile = getProfile(getDefaultProfileId()),
    options: CharacterControllerOptions = {},
  ) {
    this.root = rig.root;
    const mixer = rig.getMixer();
    const animationRoot = rig.getAnimationRoot();
    const animationBones = rig.getAnimationBones();
    if (!mixer || !animationRoot || animationBones.length === 0) {
      throw new Error('CharacterController requires a loaded rig with animation target');
    }
    this.player = new CharacterAnimationPlayer(mixer, animationRoot, animationBones, { fadeDuration: 0.45 });
    rig.muteEmbeddedAnimations();
    this.fsm = new CharacterAnimationStateMachine(profile, {
      rig,
      player: this.player,
      onStateEntered: async (state) => {
        if (state === 'attack' && this.hasLastOpponent) {
          this.snapFaceToward(this.lastOpponent);
        }
        await options.onStateEntered?.(state);
      },
    });
    this.player.onFinished(() => {
      if (this.fsm.getState() === 'attack') {
        void this.fsm.trigger('attackDone');
      }
    });
    this.facingYaw = wrapAngleRad(this.root.rotation.y);
    this.root.rotation.y = this.facingYaw;
  }

  private applyFacingYaw(yaw: number): void {
    this.facingYaw = wrapAngleRad(yaw);
    this.root.rotation.y = this.facingYaw;
  }

  /**
   * Walk only: fixed root from velocity + meshBindYaw.
   * Do not use bone measure here — it includes root.y and stride motion, which
   * creates a feedback loop (rotate → measure changes → target flips → wobble).
   */
  private walkRootYawFromVelocity(dx: number, dz: number): number {
    const { meshBindYaw } = this.facingParams();
    return wrapAngleRad(Math.atan2(dx, dz) + (meshBindYaw ?? DEFAULT_MESH_BIND_YAW));
  }

  private clearWalkFacingLock(): void {
    this.hasLockedWalkDir = false;
  }

  /**
   * Walk: lock WASD direction; each frame align root so bone forward → intent (green ≈ orange).
   */
  private walkFacingTargetForDirection(dx: number, dz: number): number {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      return this.facingYaw;
    }
    const nx = dx / len;
    const nz = dz / len;
    const dirChanged = !this.hasLockedWalkDir
      || Math.hypot(nx - this.lockedWalkDirX, nz - this.lockedWalkDirZ) > 0.2;
    if (dirChanged) {
      this.hasLockedWalkDir = true;
      this.lockedWalkDirX = nx;
      this.lockedWalkDirZ = nz;
    }
    const intentMeshYaw = this.meshIntentYawFromDirection(this.lockedWalkDirX, this.lockedWalkDirZ);
    const meshYaw = this.rig.measureForwardYaw();
    if (meshYaw !== null) {
      return wrapAngleRad(this.facingYaw + wrapAngleRad(intentMeshYaw - meshYaw));
    }
    return this.walkRootYawFromVelocity(this.lockedWalkDirX, this.lockedWalkDirZ);
  }

  /** Idle / attack / spawn: steer root until bone forward matches intent. */
  private rootYawToMatchMeshIntent(dx: number, dz: number): number {
    const intentMeshYaw = this.meshIntentYawFromDirection(dx, dz);
    const meshYaw = this.rig.measureForwardYaw();
    if (meshYaw === null) {
      return this.walkRootYawFromVelocity(dx, dz);
    }
    return wrapAngleRad(this.facingYaw + wrapAngleRad(intentMeshYaw - meshYaw));
  }

  getProfile(): CharacterAnimationProfile {
    return this.fsm.getProfile();
  }

  applyProfile(profile: CharacterAnimationProfile): void {
    this.fsm.setProfile(profile);
  }

  getState(): CharacterControllerState {
    return this.fsm.getState();
  }

  getWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.root.position);
  }

  getFacingYaw(): number {
    return this.facingYaw;
  }

  getFacingDebug(): FacingDebugSnapshot {
    return this.facingDebug;
  }

  private facingParams() {
    return resolveProfileFacingParameters(this.fsm.getProfile().parameters);
  }

  /** Where the mesh should point on XZ (green arrow). */
  private meshIntentYawFromDirection(dx: number, dz: number): number {
    return Math.atan2(dx, dz);
  }

  private meshAlignErrorDeg(intentMeshYaw: number, meshForwardYaw: number | null): number | null {
    if (meshForwardYaw === null) {
      return null;
    }
    return (wrapAngleRad(intentMeshYaw - meshForwardYaw) * 180) / Math.PI;
  }

  private refreshFacingDebug(
    opponent: THREE.Vector3 | undefined,
    moveLength: number,
    moveThreshold: number,
  ): void {
    const state = this.fsm.getState();
    let desiredYaw = this.facingYaw;
    let mode: FacingDebugMode = 'hold';
    let intentDirX = Math.sin(this.facingYaw);
    let intentDirZ = -Math.cos(this.facingYaw);
    let intentMeshYaw = Math.atan2(intentDirX, intentDirZ);
    const meshForwardYaw = this.rig.measureForwardYaw();

    if (state === 'attack' && opponent) {
      mode = 'attack';
      const position = this.getWorldPosition(this.tmpTarget);
      const dx = opponent.x - position.x;
      const dz = opponent.z - position.z;
      const len = Math.hypot(dx, dz);
      if (len >= 1e-6) {
        intentDirX = dx / len;
        intentDirZ = dz / len;
        intentMeshYaw = Math.atan2(dx, dz);
        desiredYaw = this.rootYawToMatchMeshIntent(dx, dz);
      }
    } else if (moveLength > moveThreshold) {
      mode = 'walk';
      const normalized = this.moveInput.clone().divideScalar(moveLength);
      intentDirX = normalized.x;
      intentDirZ = normalized.y;
      intentMeshYaw = Math.atan2(intentDirX, intentDirZ);
      desiredYaw = this.walkFacingTargetForDirection(normalized.x, normalized.y);
    } else if (opponent && state === 'idle') {
      mode = 'idle';
      const position = this.getWorldPosition(this.tmpTarget);
      const dx = opponent.x - position.x;
      const dz = opponent.z - position.z;
      const len = Math.hypot(dx, dz);
      if (len >= 1e-6) {
        intentDirX = dx / len;
        intentDirZ = dz / len;
        intentMeshYaw = Math.atan2(dx, dz);
        desiredYaw = this.rootYawToMatchMeshIntent(dx, dz);
      }
    }

    this.facingDebug = {
      desiredYaw,
      actualYaw: this.facingYaw,
      mode,
      intentDirX,
      intentDirZ,
      meshForwardYaw,
      intentMeshYaw,
      meshAlignErrorDeg: this.meshAlignErrorDeg(intentMeshYaw, meshForwardYaw),
      walkLockedTargetYaw: mode === 'walk' ? desiredYaw : null,
    };
  }

  async preloadLocomotion(): Promise<void> {
    await this.fsm.preload();
  }

  holdTpose(): void {
    void this.fsm.holdTpose();
  }

  /** FSM rig dress sequence — T-pose, settle, hold for shirt placement. */
  async prepareRigForGarmentDress(
    options?: RigDressSequenceOptions,
  ): Promise<RigDressSequenceResult> {
    return this.fsm.runRigDressSequence(options);
  }

  isRigDressReady(): boolean {
    return this.fsm.isRigDressReady();
  }

  async startIdle(): Promise<void> {
    await this.fsm.trigger('start');
  }

  setMoveInput(x: number, z: number): void {
    this.moveInput.set(x, z);
  }

  private turnTowardYaw(desiredYaw: number, delta: number): void {
    const turnSpeed = this.fsm.getProfile().parameters.turnSpeed;
    const deltaYaw = shortestAngleDelta(this.facingYaw, desiredYaw);
    this.applyFacingYaw(
      this.facingYaw
        + THREE.MathUtils.clamp(deltaYaw, -turnSpeed * delta, turnSpeed * delta),
    );
  }

  /** Instant mesh-aligned facing (attack start, spawn sync). */
  snapFaceToward(target: THREE.Vector3): void {
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    this.applyFacingYaw(this.rootYawToMatchMeshIntent(dx, dz));
  }

  faceToward(target: THREE.Vector3, delta: number): void {
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    this.turnTowardYaw(this.rootYawToMatchMeshIntent(dx, dz), delta);
  }

  canAttackNow(): boolean {
    return this.attackCooldown <= 0 && this.fsm.getState() !== 'attack';
  }

  private combatSpacing(params: CharacterAnimationProfile['parameters']): {
    engageRange: number;
    strikeDistance: number;
    minSeparation: number;
  } {
    const engageRange = params.attackRange * (params.attackEngageFactor ?? 0.85);
    const minSeparation = params.attackMinSeparation ?? 0.75;
    const strikeDistance = Math.max(
      minSeparation,
      params.attackStrikeDistance ?? params.attackRange * 0.9,
    );
    return { engageRange, strikeDistance, minSeparation };
  }

  async playAttackToward(target: THREE.Vector3): Promise<boolean> {
    const params = this.fsm.getProfile().parameters;
    if (!this.canAttackNow()) {
      return false;
    }
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const dist = Math.hypot(dx, dz);
    this.snapFaceToward(target);
    this.moveInput.set(0, 0);
    let started = await this.fsm.trigger('attack');
    if (!started) {
      await this.fsm.forceState('attack');
      started = true;
    }
    if (started) {
      this.snapFaceToward(target);
      this.attackCooldown = params.attackCooldownSeconds;
      const stepMeters = params.attackStepMeters ?? 0;
      if (stepMeters > 0 && dist > 1e-6) {
        const { strikeDistance } = this.combatSpacing(params);
        const step = Math.min(stepMeters, Math.max(0, dist - strikeDistance));
        this.root.position.x += (dx / dist) * step;
        this.root.position.z += (dz / dist) * step;
      }
    }
    return started;
  }

  update(
    delta: number,
    options: {
      inputMode: CharacterInputMode;
      opponent?: THREE.Vector3;
      boundsRadius?: number;
    },
  ): void {
    const params = this.fsm.getProfile().parameters;
    if (options.opponent) {
      this.lastOpponent.copy(options.opponent);
      this.hasLastOpponent = true;
    }
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.rig.update(delta);
    this.player.update(delta);
    this.fsm.tick(delta);

    if (options.inputMode === 'ai') {
      this.updateAiInput(delta, options.opponent, options.boundsRadius ?? 4);
    }

    const moveLength = this.moveInput.length();
    const state = this.fsm.getState();

    if (state === 'attack') {
      this.refreshFacingDebug(options.opponent, moveLength, params.moveThreshold);
      const attackTarget = options.opponent ?? (this.hasLastOpponent ? this.lastOpponent : null);
      if (attackTarget) {
        this.faceToward(attackTarget, delta);
        const lungeSpeed = params.attackLungeSpeed ?? 0;
        if (lungeSpeed > 0) {
          const position = this.getWorldPosition(this.tmpTarget);
          const dx = attackTarget.x - position.x;
          const dz = attackTarget.z - position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-6) {
            const { strikeDistance, minSeparation } = this.combatSpacing(params);
            if (dist < minSeparation) {
              const push = Math.min(minSeparation - dist, lungeSpeed * delta);
              this.root.position.x -= (dx / dist) * push;
              this.root.position.z -= (dz / dist) * push;
            } else if (dist > strikeDistance) {
              const step = Math.min(dist - strikeDistance, lungeSpeed * delta);
              this.root.position.x += (dx / dist) * step;
              this.root.position.z += (dz / dist) * step;
            }
          }
        }
      }
      return;
    }

    this.refreshFacingDebug(options.opponent, moveLength, params.moveThreshold);

    if (moveLength > params.moveThreshold) {
      if (state !== 'walk') {
        void this.fsm.trigger('moveStart');
      }
      const normalized = this.moveInput.clone().divideScalar(moveLength);
      this.turnTowardYaw(
        this.walkFacingTargetForDirection(normalized.x, normalized.y),
        delta,
      );
      this.root.position.x += normalized.x * params.walkSpeed * delta;
      this.root.position.z += normalized.y * params.walkSpeed * delta;
    } else if (state === 'walk') {
      this.clearWalkFacingLock();
      void this.fsm.trigger('moveStop');
    } else if (options.opponent && state === 'idle') {
      this.faceToward(options.opponent, delta);
    }
  }

  private updateAiInput(delta: number, opponent: THREE.Vector3 | undefined, boundsRadius: number): void {
    const params = this.fsm.getProfile().parameters;
    const { engageRange, minSeparation } = this.combatSpacing(params);
    const position = this.getWorldPosition(this.tmpTarget);

    let moveX = 0;
    let moveZ = 0;

    if (opponent) {
      const toOpponentX = opponent.x - position.x;
      const toOpponentZ = opponent.z - position.z;
      const dist = Math.hypot(toOpponentX, toOpponentZ);
      const towardX = toOpponentX / Math.max(dist, 0.001);
      const towardZ = toOpponentZ / Math.max(dist, 0.001);

      if (dist > engageRange) {
        moveX = towardX;
        moveZ = towardZ;
      } else if (dist < minSeparation) {
        moveX = -towardX;
        moveZ = -towardZ;
      } else {
        moveX = 0;
        moveZ = 0;
        if (this.canAttackNow()) {
          void this.playAttackToward(opponent);
        }
      }
    } else {
      this.aiWanderTimer -= delta;
      if (this.aiWanderTimer <= 0) {
        this.aiWanderTimer = 1.2 + Math.random() * 1.8;
        const angle = Math.random() * Math.PI * 2;
        this.aiMoveBias.set(Math.sin(angle), Math.cos(angle));
      }
      moveX = this.aiMoveBias.x;
      moveZ = this.aiMoveBias.y;
    }

    const distFromCenter = Math.hypot(position.x, position.z);
    if (distFromCenter > boundsRadius * 0.9) {
      moveX += -position.x / Math.max(distFromCenter, 0.001);
      moveZ += -position.z / Math.max(distFromCenter, 0.001);
    }

    this.setMoveInput(moveX, moveZ);
  }
}
