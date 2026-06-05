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
import {
  resolveMovementSmoothingParams,
  smoothInput2D,
  smoothVelocity2D,
  stepAngularVelocity,
  type MovementSmoothingParams,
} from './movementSmoothing.ts';
import { shortestAngleDelta, wrapAngleRad } from './rigForwardMeasure.ts';

export type CharacterControllerState = FsmStateId;

export type CharacterInputMode = 'human' | 'ai';

export type FacingDebugMode = 'walk' | 'idle' | 'hold' | 'attack';

export interface MovementDebugSnapshot {
  readonly rawInputX: number;
  readonly rawInputZ: number;
  readonly smoothedInputX: number;
  readonly smoothedInputZ: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly speed: number;
  readonly angularVelocity: number;
}

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
  private smoothedMoveInput = new THREE.Vector2();
  private worldVelocity = new THREE.Vector2();
  private smoothedWalkDir = new THREE.Vector2(0, 0);
  private hasSmoothedWalkDir = false;
  private angularVelocity = 0;
  private attackStepBudget = 0;
  private attackStepApplied = 0;
  private attackStepDirX = 0;
  private attackStepDirZ = 0;
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
  private movementDebug: MovementDebugSnapshot = {
    rawInputX: 0,
    rawInputZ: 0,
    smoothedInputX: 0,
    smoothedInputZ: 0,
    velocityX: 0,
    velocityZ: 0,
    speed: 0,
    angularVelocity: 0,
  };
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
    this.hasSmoothedWalkDir = false;
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

  getMovementDebug(): MovementDebugSnapshot {
    return this.movementDebug;
  }

  private movementParams(): MovementSmoothingParams {
    return resolveMovementSmoothingParams(this.fsm.getProfile().parameters);
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

  private refreshMovementDebug(): void {
    const speed = this.worldVelocity.length();
    this.movementDebug = {
      rawInputX: this.moveInput.x,
      rawInputZ: this.moveInput.y,
      smoothedInputX: this.smoothedMoveInput.x,
      smoothedInputZ: this.smoothedMoveInput.y,
      velocityX: this.worldVelocity.x,
      velocityZ: this.worldVelocity.y,
      speed,
      angularVelocity: this.angularVelocity,
    };
  }

  private smoothLocomotionInput(delta: number): void {
    const { inputSmoothTau } = this.movementParams();
    const smoothed = smoothInput2D(
      this.smoothedMoveInput.x,
      this.smoothedMoveInput.y,
      this.moveInput.x,
      this.moveInput.y,
      delta,
      inputSmoothTau,
    );
    this.smoothedMoveInput.set(smoothed.x, smoothed.z);
  }

  private turnTowardYaw(
    desiredYaw: number,
    delta: number,
    maxTurnSpeed?: number,
    direct = false,
  ): void {
    const cap = maxTurnSpeed ?? this.fsm.getProfile().parameters.turnSpeed;
    if (direct) {
      const deltaYaw = shortestAngleDelta(this.facingYaw, desiredYaw);
      this.angularVelocity = 0;
      this.applyFacingYaw(
        this.facingYaw + THREE.MathUtils.clamp(deltaYaw, -cap * delta, cap * delta),
      );
      return;
    }
    const movement = this.movementParams();
    const turnParams = maxTurnSpeed === undefined
      ? movement
      : { ...movement, maxTurnSpeed: cap };
    const stepped = stepAngularVelocity(
      this.angularVelocity,
      this.facingYaw,
      desiredYaw,
      delta,
      turnParams,
    );
    this.angularVelocity = stepped.angularVelocity;
    this.applyFacingYaw(stepped.yaw);
  }

  private integrateWorldVelocity(
    desiredVelocityX: number,
    desiredVelocityZ: number,
    delta: number,
  ): void {
    const { moveAccel, moveDecel } = this.movementParams();
    const next = smoothVelocity2D(
      this.worldVelocity.x,
      this.worldVelocity.y,
      desiredVelocityX,
      desiredVelocityZ,
      delta,
      moveAccel,
      moveDecel,
    );
    this.worldVelocity.set(next.x, next.z);
    this.root.position.x += this.worldVelocity.x * delta;
    this.root.position.z += this.worldVelocity.y * delta;
  }

  private snapWalkDirection(dx: number, dz: number): { x: number; z: number } {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      return { x: this.smoothedWalkDir.x, z: this.smoothedWalkDir.y };
    }
    const nx = dx / len;
    const nz = dz / len;
    this.smoothedWalkDir.set(nx, nz);
    this.hasSmoothedWalkDir = true;
    return { x: nx, z: nz };
  }

  private smoothWalkDirection(dx: number, dz: number, delta: number): { x: number; z: number } {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      return { x: this.smoothedWalkDir.x, z: this.smoothedWalkDir.y };
    }
    const targetX = dx / len;
    const targetZ = dz / len;
    if (!this.hasSmoothedWalkDir) {
      return this.snapWalkDirection(dx, dz);
    }
    const dot = this.smoothedWalkDir.x * targetX + this.smoothedWalkDir.y * targetZ;
    if (dot < 0.2) {
      return this.snapWalkDirection(dx, dz);
    }
    const { walkDirectionSmoothTau } = this.movementParams();
    const smoothed = smoothInput2D(
      this.smoothedWalkDir.x,
      this.smoothedWalkDir.y,
      targetX,
      targetZ,
      delta,
      walkDirectionSmoothTau,
    );
    const smoothedLen = Math.hypot(smoothed.x, smoothed.z);
    if (smoothedLen > 1e-6) {
      this.smoothedWalkDir.set(smoothed.x / smoothedLen, smoothed.z / smoothedLen);
      this.hasSmoothedWalkDir = true;
    }
    return { x: this.smoothedWalkDir.x, z: this.smoothedWalkDir.y };
  }

  private applyRampedAttackStep(delta: number): void {
    const remaining = this.attackStepBudget - this.attackStepApplied;
    if (remaining <= 1e-6) {
      return;
    }
    const rampSec = this.movementParams().attackStepRampSec;
    const rate = rampSec > 0 ? this.attackStepBudget / rampSec : this.attackStepBudget / delta;
    const step = Math.min(remaining, rate * delta);
    this.root.position.x += this.attackStepDirX * step;
    this.root.position.z += this.attackStepDirZ * step;
    this.attackStepApplied += step;
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

  faceToward(
    target: THREE.Vector3,
    delta: number,
    turnSpeed?: number,
    direct = false,
  ): void {
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    this.turnTowardYaw(this.rootYawToMatchMeshIntent(dx, dz), delta, turnSpeed, direct);
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
    const { attackFacingTurnSpeed } = this.movementParams();
    if (attackFacingTurnSpeed <= 0) {
      this.snapFaceToward(target);
    }
    this.moveInput.set(0, 0);
    this.smoothedMoveInput.set(0, 0);
    this.worldVelocity.set(0, 0);
    let started = await this.fsm.trigger('attack');
    if (!started) {
      await this.fsm.forceState('attack');
      started = true;
    }
    if (started) {
      this.attackCooldown = params.attackCooldownSeconds;
      const stepMeters = params.attackStepMeters ?? 0;
      this.attackStepBudget = 0;
      this.attackStepApplied = 0;
      if (stepMeters > 0 && dist > 1e-6) {
        const { strikeDistance } = this.combatSpacing(params);
        const step = Math.min(stepMeters, Math.max(0, dist - strikeDistance));
        this.attackStepBudget = step;
        this.attackStepApplied = 0;
        this.attackStepDirX = dx / dist;
        this.attackStepDirZ = dz / dist;
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

    this.smoothLocomotionInput(delta);
    const smoothedMoveLength = this.smoothedMoveInput.length();
    const speed = this.worldVelocity.length();
    const { moveStopSpeed } = this.movementParams();
    const state = this.fsm.getState();

    if (state === 'attack') {
      this.refreshFacingDebug(options.opponent, smoothedMoveLength, params.moveThreshold);
      this.refreshMovementDebug();
      const attackTarget = options.opponent ?? (this.hasLastOpponent ? this.lastOpponent : null);
      if (attackTarget) {
        const { attackFacingTurnSpeed } = this.movementParams();
        if (attackFacingTurnSpeed <= 0) {
          this.snapFaceToward(attackTarget);
        } else {
          this.faceToward(attackTarget, delta, attackFacingTurnSpeed);
        }
        this.applyRampedAttackStep(delta);
        const lungeSpeed = params.attackLungeSpeed ?? 0;
        if (lungeSpeed > 0) {
          const position = this.getWorldPosition(this.tmpTarget);
          const dx = attackTarget.x - position.x;
          const dz = attackTarget.z - position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 1e-6) {
            const { strikeDistance, minSeparation } = this.combatSpacing(params);
            const desiredLungeX = dist < minSeparation
              ? -(dx / dist) * lungeSpeed
              : dist > strikeDistance
                ? (dx / dist) * lungeSpeed
                : 0;
            const desiredLungeZ = dist < minSeparation
              ? -(dz / dist) * lungeSpeed
              : dist > strikeDistance
                ? (dz / dist) * lungeSpeed
                : 0;
            this.integrateWorldVelocity(desiredLungeX, desiredLungeZ, delta);
          }
        }
      }
      return;
    }

    this.refreshFacingDebug(options.opponent, smoothedMoveLength, params.moveThreshold);

    const hasMoveIntent = smoothedMoveLength > params.moveThreshold;
    const isCoasting = speed > moveStopSpeed;
    if (hasMoveIntent || (state === 'walk' && isCoasting)) {
      if (hasMoveIntent && state !== 'walk') {
        void this.fsm.trigger('moveStart');
      }
      let dirX = 0;
      let dirZ = 0;
      if (hasMoveIntent) {
        const invLen = 1 / Math.max(smoothedMoveLength, 1e-6);
        dirX = this.smoothedMoveInput.x * invLen;
        dirZ = this.smoothedMoveInput.y * invLen;
      } else {
        const invSpeed = 1 / Math.max(speed, 1e-6);
        dirX = this.worldVelocity.x * invSpeed;
        dirZ = this.worldVelocity.y * invSpeed;
      }
      const walkDir = this.smoothWalkDirection(dirX, dirZ, delta);
      this.turnTowardYaw(this.walkFacingTargetForDirection(walkDir.x, walkDir.z), delta);
      const desiredSpeed = hasMoveIntent ? params.walkSpeed : 0;
      this.integrateWorldVelocity(dirX * desiredSpeed, dirZ * desiredSpeed, delta);
    } else if (state === 'walk') {
      this.clearWalkFacingLock();
      this.angularVelocity = 0;
      this.worldVelocity.set(0, 0);
      void this.fsm.trigger('moveStop');
    } else if (options.opponent && state === 'idle') {
      this.faceToward(options.opponent, delta, undefined, true);
    }

    this.refreshMovementDebug();
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
