import * as THREE from 'three';
import type { ClothSimulation } from '../../cloth';
import type { ClothAssembly } from '../../cloth/patternAssembly.ts';
import { mergeClothAssemblies } from '../../cloth/mergeClothAssemblies.ts';
import {
  AnimatedCharacterSceneRig,
} from '../../character/AnimatedCharacter.ts';
import { CharacterController } from '../../character/CharacterController.ts';
import { resolveClipFadeDuration } from '../../animations/characterAnimationProfile.ts';
import type { FsmStateId } from '../../animations/characterAnimationProfile.ts';
import {
  dressTShirtOnRig,
  SHIRT_DRESS_POSE_SETTLE_SEC,
  waitForAnimationFrames,
  waitForRigsAnimationSettle,
  waitForShirtSimSettle,
  warmupCharacterClothCollision,
} from '../../character/characterGarmentDress.ts';
import { mergeBoneSdfCapsules } from '../../character/mergeBoneSdfCapsules.ts';
import { SdfSquashTracker, type SdfSquashReport } from '../../character/sdf';
import {
  getDefaultCharacterModelId,
  normalizeCharacterModelId,
  resolveCharacterModelUrl,
} from '../../animations/characterModelCatalog.ts';
import {
  auditShirtSdfClearance,
  SHIRT_SDF_CLEARANCE,
} from '../../character/shirtDressing.ts';
import { FacingDebugArrow } from '../../character/facingDebugArrow.ts';
import { forwardYawToXZDirection } from '../../character/rigForwardMeasure.ts';
import {
  getDefaultCharacterDuelAnimationSetup,
  type CharacterDuelAnimationSetup,
} from './characterDuelAnimation.ts';
import {
  applyDuelCombatProfile,
  CHARACTER_DUEL_CONFIG,
  duelShirtPresetState,
  type DuelControlMode,
} from './characterDuelConfig.ts';
import type { GarmentPresetEnvelope } from '../../garments/garmentSchema.ts';

export interface CharacterDuelLoadOptions {
  readonly setup?: CharacterDuelAnimationSetup;
  readonly fighterAModelId?: string;
  readonly fighterBModelId?: string;
}

export interface CharacterDuelRoundStats {
  readonly roundCount: number;
  readonly lastRoundWinner: 'A' | 'B' | null;
  readonly autoRematch: boolean;
  readonly roundResetInProgress: boolean;
}

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
  readonly fighterAModelId: string;
  readonly fighterBModelId: string;
  readonly fighterAAssetUrl: string;
  readonly fighterBAssetUrl: string;
  readonly roundCount: number;
  readonly lastRoundWinner: 'A' | 'B' | null;
  readonly autoRematch: boolean;
}

export class CharacterDuelScene {
  readonly rigA: AnimatedCharacterSceneRig;
  readonly rigB: AnimatedCharacterSceneRig;
  controllerA!: CharacterController;
  controllerB!: CharacterController;

  private phase: CharacterDuelStats['phase'] = 'loading';
  private controlMode: DuelControlMode = 'pvp';
  private mergedVertexCount = 0;
  private fighterAVertexCount = 0;
  private mergedShirtAssembly: ClothAssembly | null = null;
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
  private readonly mergedSquashTracker = new SdfSquashTracker();
  private lastMergedSquashReport: SdfSquashReport | null = null;
  private duelSetup: CharacterDuelAnimationSetup | null = null;
  private fighterAModelId = getDefaultCharacterModelId();
  private fighterBModelId = getDefaultCharacterModelId();
  private isSwappingModel = false;
  private autoRematchEnabled = CHARACTER_DUEL_CONFIG.healthDisplay.autoRematch;
  private roundEndHoldSec = CHARACTER_DUEL_CONFIG.healthDisplay.roundEndHoldSec;
  private roundCount = 1;
  private lastRoundWinner: 'A' | 'B' | null = null;
  private roundResetInProgress = false;
  private roundEndZeroFor: 'A' | 'B' | 'both' | null = null;
  private roundEndZeroElapsed = 0;

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

  /** Reset spawn positions and zero root yaw before facing + shirt dress. */
  private resetSpawnTransforms(): void {
    const half = CHARACTER_DUEL_CONFIG.spawnSeparation * 0.5;
    this.rigA.root.position.set(-half, 0, 0);
    this.rigB.root.position.set(half, 0, 0);
    this.rigA.root.rotation.set(0, 0, 0);
    this.rigB.root.rotation.set(0, 0, 0);
    this.rigA.root.updateMatrixWorld(true);
    this.rigB.root.updateMatrixWorld(true);
  }

  getFighterModelIds(): { readonly fighterA: string; readonly fighterB: string } {
    return {
      fighterA: this.fighterAModelId,
      fighterB: this.fighterBModelId,
    };
  }

  async swapFighterModel(fighter: 'A' | 'B', modelId: string): Promise<void> {
    if (this.isSwappingModel || this.isRedressingShirts) {
      return;
    }
    this.isSwappingModel = true;
    try {
      const resolvedModelId = normalizeCharacterModelId(modelId);
      const rig = fighter === 'A' ? this.rigA : this.rigB;
      const controller = fighter === 'A' ? this.controllerA : this.controllerB;
      const restoreState = controller?.fsm.getState() ?? 'idle';
      await rig.reloadCharacterModel(resolveCharacterModelUrl(resolvedModelId));
      if (fighter === 'A') {
        this.fighterAModelId = resolvedModelId;
      } else {
        this.fighterBModelId = resolvedModelId;
      }
      await this.rebuildController(fighter);
      const nextController = fighter === 'A' ? this.controllerA : this.controllerB;
      const dress = await nextController.prepareRigForGarmentDress({
        onFrame: () => this.stepBootFrame(1 / 60),
        poseSettleSec: 0.5,
      });
      if (!dress.passed) {
        throw new Error(`Fighter ${fighter} dress sequence failed after model swap`);
      }
      this.syncFightersFacing();
      await this.redressMergedShirts();
      if (restoreState !== 'tpose') {
        await nextController.fsm.forceState(restoreState);
      } else {
        await nextController.startIdle();
      }
      this.syncFightersFacing();
    } finally {
      this.isSwappingModel = false;
    }
  }

  private async ensureFighterModelLoaded(
    rig: AnimatedCharacterSceneRig,
    modelId: string,
  ): Promise<void> {
    const url = resolveCharacterModelUrl(normalizeCharacterModelId(modelId));
    if (rig.getLoadedRoot() && rig.getAssetUrl() === url) {
      return;
    }
    if (rig.getLoadedRoot()) {
      await rig.reloadCharacterModel(url);
      return;
    }
    if (rig.getAssetUrl() !== url) {
      await rig.reloadCharacterModel(url);
      return;
    }
    await rig.load();
  }

  private createTposeRedressCallback(): (state: FsmStateId) => void {
    return (state: FsmStateId): void => {
      if (state === 'tpose' && this.allowTposeRedress && !this.isRedressingShirts && !this.isSwappingModel) {
        void this.queueShirtRedressOnTpose();
      }
    };
  }

  private async rebuildController(fighter: 'A' | 'B'): Promise<void> {
    const setup = this.duelSetup ?? getDefaultCharacterDuelAnimationSetup();
    const rig = fighter === 'A' ? this.rigA : this.rigB;
    const profile = applyDuelCombatProfile(
      fighter === 'A' ? setup.fighterA.profile : setup.fighterB.profile,
    );
    const controller = new CharacterController(rig, profile, {
      onStateEntered: this.createTposeRedressCallback(),
    });
    if (fighter === 'A') {
      this.controllerA = controller;
    } else {
      this.controllerB = controller;
    }
    await controller.preloadLocomotion();
  }

  async load(options: CharacterDuelLoadOptions = {}): Promise<void> {
    const setup = options.setup ?? getDefaultCharacterDuelAnimationSetup();
    this.duelSetup = setup;
    if (options.fighterAModelId) {
      this.fighterAModelId = options.fighterAModelId;
    }
    if (options.fighterBModelId) {
      this.fighterBModelId = options.fighterBModelId;
    }
    this.phase = 'loading';
    await Promise.all([
      this.ensureFighterModelLoaded(this.rigA, this.fighterAModelId),
      this.ensureFighterModelLoaded(this.rigB, this.fighterBModelId),
    ]);
    this.rigA.root.name = 'duel-fighter-a';
    this.rigB.root.name = 'duel-fighter-b';
    this.resetSpawnTransforms();

    this.controllerA = new CharacterController(this.rigA, applyDuelCombatProfile(setup.fighterA.profile), {
      onStateEntered: this.createTposeRedressCallback(),
    });
    this.controllerB = new CharacterController(this.rigB, applyDuelCombatProfile(setup.fighterB.profile), {
      onStateEntered: this.createTposeRedressCallback(),
    });

    const bootFrame = () => this.stepBootFrame(1 / 60);
    await this.waitForBootRenderReady(16, bootFrame);

    this.phase = 'dressing';
    await this.dressMergedShirtsOnTpose();

    await Promise.all([this.controllerA.preloadLocomotion(), this.controllerB.preloadLocomotion()]);
    await this.controllerA.startIdle();
    await this.controllerB.startIdle();

    const idleFade = Math.max(
      setup.fighterA.profile.parameters.dressBlendToIdleSec
        ?? resolveClipFadeDuration(setup.fighterA.profile, 'idle', setup.fighterA.profile.states.idle.clips[0]!),
      setup.fighterB.profile.parameters.dressBlendToIdleSec
        ?? resolveClipFadeDuration(setup.fighterB.profile, 'idle', setup.fighterB.profile.states.idle.clips[0]!),
    ) + SHIRT_DRESS_POSE_SETTLE_SEC;
    await waitForRigsAnimationSettle(
      [
        { rig: this.rigA, player: this.controllerA.player },
        { rig: this.rigB, player: this.controllerB.player },
      ],
      idleFade,
      bootFrame,
    );
    this.syncFightersFacing();

    this.phase = 'ready';
    this.allowTposeRedress = true;
  }

  startFighting(): void {
    this.phase = 'fighting';
    this.cloth.setDuelShirtHealthDisplayConfig(CHARACTER_DUEL_CONFIG.healthDisplay);
  }

  getRoundStats(): CharacterDuelRoundStats {
    return {
      roundCount: this.roundCount,
      lastRoundWinner: this.lastRoundWinner,
      autoRematch: this.autoRematchEnabled,
      roundResetInProgress: this.roundResetInProgress,
    };
  }

  setAutoRematchEnabled(enabled: boolean): void {
    this.autoRematchEnabled = enabled;
    if (!enabled) {
      this.roundEndZeroFor = null;
      this.roundEndZeroElapsed = 0;
    }
  }

  getAutoRematchEnabled(): boolean {
    return this.autoRematchEnabled;
  }

  setRoundEndHoldSec(seconds: number): void {
    this.roundEndHoldSec = Math.max(0.1, Math.min(5, seconds));
  }

  getRoundEndHoldSec(): number {
    return this.roundEndHoldSec;
  }

  private async beginRoundReset(winner: 'A' | 'B'): Promise<void> {
    if (this.roundResetInProgress || this.isRedressingShirts) {
      return;
    }
    this.roundResetInProgress = true;
    this.lastRoundWinner = winner;
    this.roundEndZeroFor = null;
    this.roundEndZeroElapsed = 0;
    const priorPhase = this.phase;
    this.phase = 'dressing';
    try {
      this.resetSpawnTransforms();
      await this.dressMergedShirtsOnTpose();
      await Promise.all([
        this.controllerA.startIdle(),
        this.controllerB.startIdle(),
      ]);
      this.syncFightersFacing();
      this.roundCount += 1;
    } catch (error: unknown) {
      console.error('Duel round reset failed', error);
    } finally {
      this.roundResetInProgress = false;
      this.phase = priorPhase === 'loading' ? 'fighting' : 'fighting';
    }
  }

  private maybeStartRoundReset(delta: number): void {
    if (
      !this.autoRematchEnabled
      || this.roundResetInProgress
      || this.isRedressingShirts
      || this.isSwappingModel
      || this.phase !== 'fighting'
    ) {
      return;
    }

    const health = this.cloth.getDuelShirtHealth();
    const aDead = health.fighterA <= 0;
    const bDead = health.fighterB <= 0;
    if (!aDead && !bDead) {
      this.roundEndZeroFor = null;
      this.roundEndZeroElapsed = 0;
      return;
    }

    const zeroFor: 'A' | 'B' | 'both' = aDead && bDead ? 'both' : aDead ? 'A' : 'B';
    if (this.roundEndZeroFor !== zeroFor) {
      this.roundEndZeroFor = zeroFor;
      this.roundEndZeroElapsed = 0;
    }
    this.roundEndZeroElapsed += delta;
    if (this.roundEndZeroElapsed < this.roundEndHoldSec) {
      return;
    }

    const winner: 'A' | 'B' = aDead && !bDead ? 'B' : bDead && !aDead ? 'A' : 'A';
    void this.beginRoundReset(winner);
  }

  /**
   * T-pose → place shirts → load sim → let cloth settle (stay in T-pose throughout).
   * Used at duel boot; does not restore animation state afterward.
   */
  async dressMergedShirtsOnTpose(): Promise<void> {
    if (this.isRedressingShirts) {
      return;
    }
    this.isRedressingShirts = true;
    try {
      const bootFrame = () => this.stepBootFrame(1 / 60);
      this.controllerA.fsm.clearRigDressReady();
      this.controllerB.fsm.clearRigDressReady();
      const [dressA, dressB] = await Promise.all([
        this.controllerA.prepareRigForGarmentDress({
          onFrame: bootFrame,
          poseSettleSec: 0.5,
        }),
        this.controllerB.prepareRigForGarmentDress({
          onFrame: bootFrame,
          poseSettleSec: 0.5,
        }),
      ]);
      if (!dressA.passed || !dressB.passed) {
        const msg = [
          ...dressA.failures.map((f) => `fighter A: ${f}`),
          ...dressB.failures.map((f) => `fighter B: ${f}`),
        ].join('; ');
        throw new Error(`Rig dress sequence failed before shirt placement: ${msg}`);
      }
      if (this.controllerA.getState() !== 'tpose' || this.controllerB.getState() !== 'tpose') {
        throw new Error('fighters must be held in T-pose before shirt placement');
      }

      this.syncFightersFacing();
      await this.settleRigsAfterFacingSync(bootFrame);
      this.rigA.root.updateMatrixWorld(true);
      this.rigB.root.updateMatrixWorld(true);

      const shirtParams = duelShirtPresetState.preset.params;
      const assemblyA = dressTShirtOnRig(this.rigA, shirtParams);
      const assemblyB = dressTShirtOnRig(this.rigB, shirtParams);
      this.fighterAVertexCount = assemblyA.vertices.length;
      const merged = mergeClothAssemblies([assemblyA, assemblyB]);
      this.mergedShirtAssembly = merged;
      this.mergedVertexCount = merged.vertices.length;
      await this.cloth.loadClothAssembly(merged);
      this.cloth.setDuelShirtHealthPartition(this.fighterAVertexCount);
      this.cloth.clothMesh.visible = true;
      await warmupCharacterClothCollision(
        this.cloth,
        [this.rigA, this.rigB],
        this.tearRestoreThreshold,
        () => this.stepBootFrame(1 / 60),
      );
      await this.waitForMergedShirtSimSettle();
      this.syncDuelClothCollisionAndHealth();
      await this.cloth.calibrateDuelShirtHealthFromDress(
        merged,
        this.rigA.getBoneSdfSummary(),
        this.rigB.getBoneSdfSummary(),
      );
    } finally {
      this.isRedressingShirts = false;
    }
  }

  /** Re-dress from T-pose and restore prior FSM state (e.g. after clip-editor T-pose preview). */
  async redressMergedShirts(): Promise<void> {
    if (this.isRedressingShirts) {
      return;
    }
    const restoreA = this.controllerA?.fsm.getState();
    const restoreB = this.controllerB?.fsm.getState();
    await this.dressMergedShirtsOnTpose();
    if (this.controllerA && restoreA && restoreA !== 'tpose') {
      await this.controllerA.fsm.forceState(restoreA);
    }
    if (this.controllerB && restoreB && restoreB !== 'tpose') {
      await this.controllerB.fsm.forceState(restoreB);
    }
    this.syncFightersFacing();
  }

  /** Advance held T-pose bone matrices after root yaw snaps (duel facing). */
  private async settleRigsAfterFacingSync(onFrame?: () => void): Promise<void> {
    const stepSec = 1 / 60;
    const steps = Math.max(1, Math.ceil(SHIRT_DRESS_POSE_SETTLE_SEC / stepSec));
    for (let i = 0; i < steps; i += 1) {
      this.rigA.root.updateMatrixWorld(true);
      this.rigB.root.updateMatrixWorld(true);
      onFrame?.();
      await waitForAnimationFrames(1);
    }
  }

  /** One boot/dress frame: animation + bone SDFs + cloth sim (matches live play loop). */
  stepBootFrame(delta: number): void {
    if (this.controllerA && this.controllerB) {
      for (const controller of [this.controllerA, this.controllerB]) {
        controller.player.update(delta);
        controller.fsm.tick(delta);
        controller.rig.update(delta);
      }
      this.rigA.root.updateMatrixWorld(true);
      this.rigB.root.updateMatrixWorld(true);
    } else {
      this.rigA.update(delta);
      this.rigB.update(delta);
    }
    this.syncFacingDebugArrows();
    this.syncDuelClothCollisionAndHealth();
    if (this.mergedVertexCount > 0) {
      this.cloth.update(delta);
    }
  }

  private syncDuelClothCollisionAndHealth(): void {
    const capsulesA = this.rigA.getBoneSdfSummary();
    const capsulesB = this.rigB.getBoneSdfSummary();
    const merged = mergeBoneSdfCapsules([capsulesA, capsulesB]);
    const squashConfig = this.rigA.getSdfSquashConfig();
    const squashed = squashConfig.enabled
      ? this.mergedSquashTracker.apply(merged, squashConfig)
      : { capsules: merged, report: null };
    this.lastMergedSquashReport = squashed.report;
    this.cloth.setBoneSdfCapsules(squashed.capsules);
    this.cloth.updateDuelShirtHealthCapsuleSplit(capsulesA.length);
  }

  getMergedSquashReport(): SdfSquashReport | null {
    return this.lastMergedSquashReport;
  }

  resetMergedSquashState(): void {
    this.mergedSquashTracker.reset();
    this.lastMergedSquashReport = null;
  }

  private async waitForBootRenderReady(
    frameCount: number,
    onFrame: () => void,
  ): Promise<void> {
    for (let i = 0; i < frameCount; i += 1) {
      onFrame();
      await waitForAnimationFrames(1);
    }
    if (!this.rigA.getStats().loaded || !this.rigB.getStats().loaded) {
      throw new Error('Duel rig meshes not ready after boot warm-up');
    }
  }

  private async stepAnimationForClothSettle(): Promise<void> {
    this.stepBootFrame(1 / 60);
    await waitForAnimationFrames(1);
  }

  /** Keep T-pose (or current pose) stepping until merged shirt SDF readback passes. */
  async waitForMergedShirtSimSettle(): Promise<void> {
    await waitForShirtSimSettle(
      async () => {
        const report = await this.getSettledShirtSurfaceReport();
        return {
          vertexCount: report.vertex.vertexCount,
          penetrationCount: report.vertex.penetrationCount,
          minSignedDistance: report.vertex.minSignedDistance,
        };
      },
      () => this.stepAnimationForClothSettle(),
    );
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

  getShirtHealth(): { fighterA: number; fighterB: number } {
    return this.cloth.getDuelShirtHealth();
  }

  getShirtHealthDebug(): {
    health: { fighterA: number; fighterB: number };
    metrics: ReturnType<ClothSimulation['getDuelShirtHealthMetrics']>;
    displayConfig: ReturnType<ClothSimulation['getDuelShirtHealthDisplayConfig']>;
    fighterAVertexCount: number;
    round: CharacterDuelRoundStats;
    note: string;
  } {
    return {
      health: this.getShirtHealth(),
      metrics: this.cloth.getDuelShirtHealthMetrics(),
      displayConfig: this.cloth.getDuelShirtHealthDisplayConfig(),
      fighterAVertexCount: this.fighterAVertexCount,
      round: this.getRoundStats(),
      note: 'Display HP maps GPU remaining cloth/structure; 0 when below tunable broken %',
    };
  }

  getShirtPreset(): GarmentPresetEnvelope {
    return duelShirtPresetState.preset;
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
      fighterAModelId: this.fighterAModelId,
      fighterBModelId: this.fighterBModelId,
      fighterAAssetUrl: this.rigA.getAssetUrl(),
      fighterBAssetUrl: this.rigB.getAssetUrl(),
      roundCount: this.roundCount,
      lastRoundWinner: this.lastRoundWinner,
      autoRematch: this.autoRematchEnabled,
    };
  }

  async getSettledShirtSurfaceReport(): Promise<{
    vertex: ReturnType<typeof auditShirtSdfClearance>;
  }> {
    const base = this.mergedShirtAssembly;
    if (!base || base.vertices.length === 0) {
      return {
        vertex: auditShirtSdfClearance([], mergeBoneSdfCapsules([
          this.rigA.getBoneSdfSummary(),
          this.rigB.getBoneSdfSummary(),
        ]), SHIRT_SDF_CLEARANCE),
      };
    }
    const settledAssembly = await this.cloth.readCurrentClothAssembly(base);
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
    if (this.phase === 'loading' || this.phase === 'dressing') {
      this.stepBootFrame(delta);
      return;
    }
    if (this.phase !== 'fighting' && this.phase !== 'ready') {
      this.rigA.update(delta);
      this.rigB.update(delta);
      this.syncFacingDebugArrows();
      this.syncDuelClothCollisionAndHealth();
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
    this.syncDuelClothCollisionAndHealth();
    this.maybeStartRoundReset(delta);
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
