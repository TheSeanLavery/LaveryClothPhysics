import * as THREE from 'three';
import type { ClothSimulation } from '../../cloth';
import { mergeClothAssemblies } from '../../cloth/mergeClothAssemblies.ts';
import {
  AnimatedCharacterSceneRig,
} from '../../character/AnimatedCharacter.ts';
import { CharacterController } from '../../character/CharacterController.ts';
import { resolveClipFadeDuration } from '../../animations/characterAnimationProfile.ts';
import type { FsmStateId } from '../../animations/characterAnimationProfile.ts';
import type { DuelControlMode } from './characterDuelConfig.ts';
import {
  dressTShirtOnRig,
  settleRigForShirtDressing,
  SHIRT_DRESS_POSE_SETTLE_SEC,
  waitForRigsAnimationSettle,
  warmupCharacterClothCollision,
} from '../../character/characterGarmentDress.ts';
import { mergeBoneSdfCapsules } from '../../character/mergeBoneSdfCapsules.ts';
import {
  auditShirtSdfClearance,
  SHIRT_SDF_CLEARANCE,
} from '../../character/shirtDressing.ts';
import { FacingDebugArrow } from '../../character/facingDebugArrow.ts';
import { forwardYawToXZDirection } from '../../character/rigForwardMeasure.ts';
import { CHARACTER_DUEL_CONFIG } from './characterDuelConfig.ts';

export interface CharacterDuelStats {
  readonly phase: 'loading' | 'dressing' | 'ready' | 'fighting';
  readonly controlMode: DuelControlMode;
  readonly fighterACount: number;
  readonly fighterBCount: number;
  readonly particleCount: number;
  readonly vertexCount: number;
  readonly activeClipA: string | null;
  readonly activeClipB: string | null;
  readonly positionA: [number, number, number];
  readonly positionB: [number, number, number];
}

export class CharacterDuelScene {
  readonly rigA: AnimatedCharacterSceneRig;
  readonly rigB: AnimatedCharacterSceneRig;
  controllerA!: CharacterController;
  controllerB!: CharacterController;

  private phase: CharacterDuelStats['phase'] = 'loading';
  private controlMode: DuelControlMode = 'pvp';
  private mergedVertexCount = 0;
  private readonly keysDown = new Set<string>();
  private readonly moveA = new THREE.Vector2();
  private readonly moveB = new THREE.Vector2();
  private readonly tmpOpponentA = new THREE.Vector3();
  private readonly tmpOpponentB = new THREE.Vector3();
  private shirtRedressQueue: Promise<void> = Promise.resolve();
  private allowTposeRedress = false;
  private isRedressingShirts = false;
  private readonly facingArrowA: FacingDebugArrow;
  private readonly facingArrowB: FacingDebugArrow;
  private readonly facingArrowActualA: FacingDebugArrow;
  private readonly facingArrowActualB: FacingDebugArrow;
  facingDebugVisible = true;

  constructor(
    private readonly cloth: ClothSimulation,
    private readonly tearRestoreThreshold: number,
  ) {
    const half = CHARACTER_DUEL_CONFIG.spawnSeparation * 0.5;
    this.rigA = new AnimatedCharacterSceneRig(
      cloth.scene,
      CHARACTER_DUEL_CONFIG.assetUrl,
      CHARACTER_DUEL_CONFIG.tposeAnimationUrl,
      CHARACTER_DUEL_CONFIG.idleAnimationUrl,
      CHARACTER_DUEL_CONFIG.danceAnimationUrl,
    );
    this.rigB = new AnimatedCharacterSceneRig(
      cloth.scene,
      CHARACTER_DUEL_CONFIG.assetUrl,
      CHARACTER_DUEL_CONFIG.tposeAnimationUrl,
      CHARACTER_DUEL_CONFIG.idleAnimationUrl,
      CHARACTER_DUEL_CONFIG.danceAnimationUrl,
    );
    this.rigA.root.position.set(-half, 0, 0);
    this.rigB.root.position.set(half, 0, 0);
    this.facingArrowA = new FacingDebugArrow(cloth.scene, 0x7ee787, 'duel-facing-desired-a');
    this.facingArrowB = new FacingDebugArrow(cloth.scene, 0x6eb5ff, 'duel-facing-desired-b');
    this.facingArrowActualA = new FacingDebugArrow(cloth.scene, 0xffb347, 'duel-facing-actual-a', 0.75);
    this.facingArrowActualB = new FacingDebugArrow(cloth.scene, 0xff7b9a, 'duel-facing-actual-b', 0.75);
    for (const arrow of [
      this.facingArrowA,
      this.facingArrowB,
      this.facingArrowActualA,
      this.facingArrowActualB,
    ]) {
      arrow.setVisible(this.facingDebugVisible);
    }
  }

  setFacingDebugVisible(visible: boolean): void {
    this.facingDebugVisible = visible;
    for (const arrow of [
      this.facingArrowA,
      this.facingArrowB,
      this.facingArrowActualA,
      this.facingArrowActualB,
    ]) {
      arrow.setVisible(visible);
    }
  }

  private syncFacingDebugArrows(): void {
    if (!this.controllerA || !this.controllerB) {
      return;
    }
    const debugA = this.controllerA.getFacingDebug();
    const debugB = this.controllerB.getFacingDebug();
    const posA = this.controllerA.getWorldPosition(this.tmpOpponentA);
    const posB = this.controllerB.getWorldPosition(this.tmpOpponentB);
    this.facingArrowA.updateDirection(posA, debugA.intentDirX, debugA.intentDirZ);
    this.facingArrowB.updateDirection(posB, debugB.intentDirX, debugB.intentDirZ);
    this.updateMeshForwardArrow(this.facingArrowActualA, this.rigA, posA, debugA.actualYaw);
    this.updateMeshForwardArrow(this.facingArrowActualB, this.rigB, posB, debugB.actualYaw);
  }

  private updateMeshForwardArrow(
    arrow: FacingDebugArrow,
    rig: AnimatedCharacterSceneRig,
    position: THREE.Vector3,
    fallbackRootYaw: number,
  ): void {
    const meshForwardYaw = rig.measureForwardYaw();
    if (meshForwardYaw !== null) {
      const dir = forwardYawToXZDirection(meshForwardYaw);
      arrow.updateDirection(position, dir.x, dir.z);
      return;
    }
    arrow.updateRootYaw(position, fallbackRootYaw);
  }

  /** Align both fighters toward each other (mesh-aligned root, not walk meshBindYaw). */
  syncFightersFacing(): void {
    if (!this.controllerA || !this.controllerB) {
      return;
    }
    const posA = this.controllerA.getWorldPosition();
    const posB = this.controllerB.getWorldPosition();
    this.controllerA.snapFaceToward(posB);
    this.controllerB.snapFaceToward(posA);
  }

  async load(): Promise<void> {
    this.phase = 'loading';
    await Promise.all([this.rigA.load(), this.rigB.load()]);
    this.rigA.root.name = 'duel-fighter-a';
    this.rigB.root.name = 'duel-fighter-b';
    settleRigForShirtDressing(this.rigA);
    settleRigForShirtDressing(this.rigB);
    this.rigA.root.updateMatrixWorld(true);
    this.rigB.root.updateMatrixWorld(true);

    this.phase = 'dressing';
    await this.redressMergedShirts();

    const onTposeEntered = (state: FsmStateId): void => {
      if (state === 'tpose' && this.allowTposeRedress && !this.isRedressingShirts) {
        void this.queueShirtRedressOnTpose();
      }
    };
    this.controllerA = new CharacterController(this.rigA, undefined, { onStateEntered: onTposeEntered });
    this.controllerB = new CharacterController(this.rigB, undefined, { onStateEntered: onTposeEntered });
    await Promise.all([this.controllerA.fsm.holdTpose(), this.controllerB.fsm.holdTpose()]);
    await Promise.all([this.controllerA.preloadLocomotion(), this.controllerB.preloadLocomotion()]);
    await Promise.all([this.controllerA.startIdle(), this.controllerB.startIdle()]);
    this.syncFightersFacing();
    this.phase = 'ready';
    this.allowTposeRedress = true;
  }

  startFighting(): void {
    this.phase = 'fighting';
  }

  /** Re-place both duel shirts on the current body pose and reload the merged sim cloth. */
  async redressMergedShirts(): Promise<void> {
    if (this.isRedressingShirts) {
      return;
    }
    this.isRedressingShirts = true;
    try {
      const restoreA = this.controllerA?.fsm.getState();
      const restoreB = this.controllerB?.fsm.getState();

      if (this.controllerA && this.controllerB) {
        const profileA = this.controllerA.getProfile();
        const profileB = this.controllerB.getProfile();
        const tposeClipA = profileA.states.tpose.clips[0]!;
        const tposeClipB = profileB.states.tpose.clips[0]!;
        const fadeSec = Math.max(
          resolveClipFadeDuration(profileA, 'tpose', tposeClipA),
          resolveClipFadeDuration(profileB, 'tpose', tposeClipB),
        ) + SHIRT_DRESS_POSE_SETTLE_SEC;

        const enterTpose: Promise<void>[] = [];
        if (this.controllerA.fsm.getState() !== 'tpose') {
          enterTpose.push(this.controllerA.fsm.forceState('tpose'));
        }
        if (this.controllerB.fsm.getState() !== 'tpose') {
          enterTpose.push(this.controllerB.fsm.forceState('tpose'));
        }
        await Promise.all(enterTpose);
        await waitForRigsAnimationSettle(
          [
            { rig: this.rigA, player: this.controllerA.player },
            { rig: this.rigB, player: this.controllerB.player },
          ],
          fadeSec,
        );
      } else {
        settleRigForShirtDressing(this.rigA);
        settleRigForShirtDressing(this.rigB);
        this.rigA.root.updateMatrixWorld(true);
        this.rigB.root.updateMatrixWorld(true);
      }

      const assemblyA = dressTShirtOnRig(this.rigA, CHARACTER_DUEL_CONFIG.shirtOptions);
      const assemblyB = dressTShirtOnRig(this.rigB, CHARACTER_DUEL_CONFIG.shirtOptions);
      const merged = mergeClothAssemblies([assemblyA, assemblyB]);
      this.mergedVertexCount = merged.vertices.length;
      await this.cloth.loadClothAssembly(merged);
      await warmupCharacterClothCollision(this.cloth, [this.rigA, this.rigB], this.tearRestoreThreshold);

      // Do not forceState('tpose') — that re-fires onStateEntered and loops redress.
      if (this.controllerA && restoreA && restoreA !== 'tpose') {
        await this.controllerA.fsm.forceState(restoreA);
      }
      if (this.controllerB && restoreB && restoreB !== 'tpose') {
        await this.controllerB.fsm.forceState(restoreB);
      }
      this.syncFightersFacing();
    } finally {
      this.isRedressingShirts = false;
    }
  }

  private queueShirtRedressOnTpose(): Promise<void> {
    this.shirtRedressQueue = this.shirtRedressQueue
      .then(() => this.redressMergedShirts())
      .catch((error) => {
        console.error('Failed to redress duel shirts on T-pose:', error);
      });
    return this.shirtRedressQueue;
  }

  setControlMode(mode: DuelControlMode): void {
    this.controlMode = mode;
  }

  getControlMode(): DuelControlMode {
    return this.controlMode;
  }

  getStats(): CharacterDuelStats {
    return {
      phase: this.phase,
      controlMode: this.controlMode,
      fighterACount: this.rigA.getStats().frameCount,
      fighterBCount: this.rigB.getStats().frameCount,
      particleCount: this.cloth.getStats().particleCount,
      vertexCount: this.mergedVertexCount,
      activeClipA: this.controllerA.fsm.getSnapshot().activeClipName,
      activeClipB: this.controllerB.fsm.getSnapshot().activeClipName,
      positionA: this.controllerA.getWorldPosition().toArray() as [number, number, number],
      positionB: this.controllerB.getWorldPosition().toArray() as [number, number, number],
    };
  }

  async getSettledShirtSurfaceReport(): Promise<{
    vertex: ReturnType<typeof auditShirtSdfClearance>;
  }> {
    const settledAssembly = await this.cloth.readCurrentClothAssembly({
      vertices: [],
      faces: [],
      edges: [],
      stitchEdges: [],
    });
    const sdfs = mergeBoneSdfCapsules([this.rigA.getBoneSdfSummary(), this.rigB.getBoneSdfSummary()]);
    return {
      vertex: auditShirtSdfClearance(settledAssembly.vertices, sdfs, SHIRT_SDF_CLEARANCE),
    };
  }

  handleKeyDown(code: string): void {
    this.keysDown.add(code);
    if (code === 'KeyM') {
      this.controlMode = this.controlMode === 'pvp' ? 'ai-ai' : 'pvp';
      return;
    }
    if (this.controlMode !== 'pvp' || (this.phase !== 'fighting' && this.phase !== 'ready')) {
      return;
    }
    const posA = this.controllerA.getWorldPosition();
    const posB = this.controllerB.getWorldPosition();
    if (code === 'Space') {
      void this.controllerA.playAttackToward(posB);
    } else if (code === 'Enter') {
      void this.controllerB.playAttackToward(posA);
    }
  }

  handleKeyUp(code: string): void {
    this.keysDown.delete(code);
  }

  update(delta: number): void {
    if (this.phase !== 'fighting' && this.phase !== 'ready') {
      this.rigA.update(delta);
      this.rigB.update(delta);
      this.syncFacingDebugArrows();
      this.cloth.setBoneSdfCapsules(mergeBoneSdfCapsules([
        this.rigA.getBoneSdfSummary(),
        this.rigB.getBoneSdfSummary(),
      ]));
      return;
    }

    const posA = this.tmpOpponentA.copy(this.controllerA.root.position);
    const posB = this.tmpOpponentB.copy(this.controllerB.root.position);

    if (this.controlMode === 'pvp') {
      this.readPvpInput();
      this.controllerA.setMoveInput(this.moveA.x, this.moveA.y);
      this.controllerB.setMoveInput(this.moveB.x, this.moveB.y);
      this.controllerA.update(delta, { inputMode: 'human', opponent: posB, boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius });
      this.controllerB.update(delta, { inputMode: 'human', opponent: posA, boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius });
    } else {
      this.controllerA.update(delta, {
        inputMode: 'ai',
        opponent: posB,
        boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius,
      });
      this.controllerB.update(delta, {
        inputMode: 'ai',
        opponent: posA,
        boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius,
      });
    }

    if (this.phase === 'ready') {
      this.phase = 'fighting';
    }

    this.syncFacingDebugArrows();

    this.cloth.setBoneSdfCapsules(mergeBoneSdfCapsules([
      this.rigA.getBoneSdfSummary(),
      this.rigB.getBoneSdfSummary(),
    ]));
  }

  private readPvpInput(): void {
    this.moveA.set(0, 0);
    this.moveB.set(0, 0);
    if (this.keysDown.has('KeyW')) this.moveA.y -= 1;
    if (this.keysDown.has('KeyS')) this.moveA.y += 1;
    if (this.keysDown.has('KeyA')) this.moveA.x -= 1;
    if (this.keysDown.has('KeyD')) this.moveA.x += 1;
    if (this.keysDown.has('ArrowUp')) this.moveB.y -= 1;
    if (this.keysDown.has('ArrowDown')) this.moveB.y += 1;
    if (this.keysDown.has('ArrowLeft')) this.moveB.x -= 1;
    if (this.keysDown.has('ArrowRight')) this.moveB.x += 1;
  }
}

export function addDuelArena(scene: THREE.Scene): void {
  const grid = new THREE.GridHelper(CHARACTER_DUEL_CONFIG.arenaRadius * 2, 24, 0x52617a, 0x2a3448);
  grid.position.y = 0;
  scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const hemi = new THREE.HemisphereLight(0xdde8ff, 0x263044, 1.6);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0de, 2.8);
  key.position.set(4, 6, 3);
  scene.add(key);
}
