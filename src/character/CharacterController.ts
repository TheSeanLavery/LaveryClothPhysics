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
import type { AnimatedCharacterSceneRig } from './AnimatedCharacter.ts';
import { wrapAngleRad } from './rigForwardMeasure.ts';

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
  private facingDebug: FacingDebugSnapshot = {
    desiredYaw: 0,
    actualYaw: 0,
    mode: 'hold',
    intentDirX: 0,
    intentDirZ: -1,
    meshForwardYaw: null,
    intentMeshYaw: 0,
    meshAlignErrorDeg: null,
  };

  constructor(
    readonly rig: AnimatedCharacterSceneRig,
    profile: CharacterAnimationProfile = getProfile(getDefaultProfileId()),
    options: CharacterControllerOptions = {},
  ) {
    this.root = rig.root;
    const mixer = rig.getMixer();
    const loadedRoot = rig.getLoadedRoot();
    if (!mixer || !loadedRoot) {
      throw new Error('CharacterController requires a loaded rig with mixer');
    }
    this.player = new CharacterAnimationPlayer(mixer, loadedRoot, rig.getBones(), { fadeDuration: 0.45 });
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
    this.facingYaw = this.root.rotation.y;
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

  /**
   * Walk only: root.y so velocity matches walk stride (meshBindYaw ≈ −90°).
   * Do not use for idle/attack/spawn look-at — clips need mesh-aligned root.
   */
  private walkRootYawFromVelocity(dx: number, dz: number): number {
    const { meshBindYaw } = this.facingParams();
    return Math.atan2(dx, dz) + (meshBindYaw ?? DEFAULT_MESH_BIND_YAW);
  }

  /** Steer root.y until bone forward matches mesh intent. */
  private rootYawToMatchMeshIntent(dx: number, dz: number): number {
    const intentMeshYaw = this.meshIntentYawFromDirection(dx, dz);
    const meshYaw = this.rig.measureForwardYaw();
    if (meshYaw === null) {
      return this.walkRootYawFromVelocity(dx, dz);
    }
    return this.facingYaw + wrapAngleRad(intentMeshYaw - meshYaw);
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
      desiredYaw = this.walkRootYawFromVelocity(normalized.x, normalized.y);
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
    };
  }

  async preloadLocomotion(): Promise<void> {
    await this.fsm.preload();
  }

  holdTpose(): void {
    void this.fsm.holdTpose();
  }

  async startIdle(): Promise<void> {
    await this.fsm.trigger('start');
  }

  setMoveInput(x: number, z: number): void {
    this.moveInput.set(x, z);
  }

  private turnTowardYaw(desiredYaw: number, delta: number): void {
    const turnSpeed = this.fsm.getProfile().parameters.turnSpeed;
    let deltaYaw = desiredYaw - this.facingYaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    this.facingYaw += THREE.MathUtils.clamp(deltaYaw, -turnSpeed * delta, turnSpeed * delta);
    this.root.rotation.y = this.facingYaw;
  }

  /** Instant mesh-aligned facing (attack start, spawn sync). */
  snapFaceToward(target: THREE.Vector3): void {
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    this.facingYaw = this.rootYawToMatchMeshIntent(dx, dz);
    this.root.rotation.y = this.facingYaw;
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

  async playAttackToward(target: THREE.Vector3): Promise<boolean> {
    const params = this.fsm.getProfile().parameters;
    if (!this.canAttackNow()) {
      return false;
    }
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
      if (options.opponent) {
        this.snapFaceToward(options.opponent);
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
        this.walkRootYawFromVelocity(normalized.x, normalized.y),
        delta,
      );
      this.root.position.x += normalized.x * params.walkSpeed * delta;
      this.root.position.z += normalized.y * params.walkSpeed * delta;
    } else if (state === 'walk') {
      void this.fsm.trigger('moveStop');
    } else if (options.opponent && state === 'idle') {
      this.faceToward(options.opponent, delta);
    }
  }

  private updateAiInput(delta: number, opponent: THREE.Vector3 | undefined, boundsRadius: number): void {
    const params = this.fsm.getProfile().parameters;
    this.aiWanderTimer -= delta;
    if (this.aiWanderTimer <= 0) {
      this.aiWanderTimer = 1.2 + Math.random() * 1.8;
      const angle = Math.random() * Math.PI * 2;
      this.aiMoveBias.set(Math.sin(angle), Math.cos(angle));
    }

    if (opponent && this.attackCooldown <= 0) {
      void this.playAttackToward(opponent);
    }

    const position = this.getWorldPosition(this.tmpTarget);
    let moveX = this.aiMoveBias.x;
    let moveZ = this.aiMoveBias.y;

    if (opponent) {
      const toOpponentX = opponent.x - position.x;
      const toOpponentZ = opponent.z - position.z;
      const dist = Math.hypot(toOpponentX, toOpponentZ);
      if (dist > params.attackRange * 0.85) {
        moveX = toOpponentX / Math.max(dist, 0.001);
        moveZ = toOpponentZ / Math.max(dist, 0.001);
      } else if (dist < 0.75) {
        moveX = -toOpponentX / Math.max(dist, 0.001);
        moveZ = -toOpponentZ / Math.max(dist, 0.001);
      }
    }

    const distFromCenter = Math.hypot(position.x, position.z);
    if (distFromCenter > boundsRadius * 0.9) {
      moveX += -position.x / Math.max(distFromCenter, 0.001);
      moveZ += -position.z / Math.max(distFromCenter, 0.001);
    }

    this.setMoveInput(moveX, moveZ);
  }
}
