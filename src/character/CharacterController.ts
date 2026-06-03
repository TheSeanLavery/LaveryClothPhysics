import * as THREE from 'three';
import { CharacterAnimationStateMachine } from '../animations/CharacterAnimationStateMachine.ts';
import { CharacterAnimationPlayer } from '../animations/CharacterAnimationPlayer.ts';
import {
  getDefaultProfileId,
  getProfile,
  type CharacterAnimationProfile,
  type FsmStateId,
} from '../animations/characterAnimationProfile.ts';
import type { AnimatedCharacterSceneRig } from './AnimatedCharacter.ts';

export type CharacterControllerState = FsmStateId;

export type CharacterInputMode = 'human' | 'ai';

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

  constructor(
    readonly rig: AnimatedCharacterSceneRig,
    profile: CharacterAnimationProfile = getProfile(getDefaultProfileId()),
  ) {
    this.root = rig.root;
    const mixer = rig.getMixer();
    const loadedRoot = rig.getLoadedRoot();
    if (!mixer || !loadedRoot) {
      throw new Error('CharacterController requires a loaded rig with mixer');
    }
    this.player = new CharacterAnimationPlayer(mixer, loadedRoot, rig.getBones(), { fadeDuration: 0.3 });
    this.fsm = new CharacterAnimationStateMachine(profile, { rig, player: this.player });
    this.player.onFinished(() => {
      if (this.fsm.getState() === 'attack') {
        void this.fsm.trigger('attackDone');
      }
    });
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

  faceToward(target: THREE.Vector3, delta: number): void {
    const position = this.getWorldPosition(this.tmpTarget);
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    if (dx * dx + dz * dz < 1e-6) {
      return;
    }
    const desiredYaw = Math.atan2(dx, dz);
    const turnSpeed = this.fsm.getProfile().parameters.turnSpeed;
    let deltaYaw = desiredYaw - this.facingYaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    this.facingYaw += THREE.MathUtils.clamp(deltaYaw, -turnSpeed * delta, turnSpeed * delta);
    this.root.rotation.y = this.facingYaw;
  }

  async playAttackToward(target: THREE.Vector3): Promise<boolean> {
    const params = this.fsm.getProfile().parameters;
    if (this.attackCooldown > 0) {
      return false;
    }
    const position = this.getWorldPosition(this.tmpTarget);
    if (position.distanceTo(target) > params.attackRange) {
      return false;
    }
    this.faceToward(target, 1 / 60);
    this.moveInput.set(0, 0);
    const started = await this.fsm.trigger('attack');
    if (started) {
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
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.rig.update(delta);
    this.player.update(delta);
    this.fsm.tick(delta);

    if (this.fsm.getState() === 'attack') {
      return;
    }

    if (options.inputMode === 'ai') {
      this.updateAiInput(delta, options.opponent, options.boundsRadius ?? 4);
    }

    const moveLength = this.moveInput.length();
    if (moveLength > params.moveThreshold) {
      if (this.fsm.getState() !== 'walk') {
        void this.fsm.trigger('moveStart');
      }
      const normalized = this.moveInput.clone().divideScalar(moveLength);
      if (options.opponent) {
        this.faceToward(options.opponent, delta);
      } else {
        this.facingYaw = Math.atan2(normalized.x, normalized.y);
        this.root.rotation.y = this.facingYaw;
      }
      this.root.position.x += normalized.x * params.walkSpeed * delta;
      this.root.position.z += normalized.y * params.walkSpeed * delta;
    } else if (this.fsm.getState() === 'walk') {
      void this.fsm.trigger('moveStop');
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
