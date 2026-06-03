import * as THREE from 'three';
import type { ClothSimulation } from '../../cloth';
import { mergeClothAssemblies } from '../../cloth/mergeClothAssemblies.ts';
import {
  AnimatedCharacterSceneRig,
} from '../../character/AnimatedCharacter.ts';
import { CharacterController } from '../../character/CharacterController.ts';
import type { DuelControlMode } from './characterDuelConfig.ts';
import { dressTShirtOnRig, warmupCharacterClothCollision } from '../../character/characterGarmentDress.ts';
import { mergeBoneSdfCapsules } from '../../character/mergeBoneSdfCapsules.ts';
import {
  auditShirtSdfClearance,
  SHIRT_SDF_CLEARANCE,
} from '../../character/shirtDressing.ts';
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
    this.rigB.root.rotation.y = Math.PI;
  }

  async load(): Promise<void> {
    this.phase = 'loading';
    await Promise.all([this.rigA.load(), this.rigB.load()]);
    this.rigA.root.name = 'duel-fighter-a';
    this.rigB.root.name = 'duel-fighter-b';
    this.controllerA = new CharacterController(this.rigA);
    this.controllerB = new CharacterController(this.rigB);
    this.controllerA.holdTpose();
    this.controllerB.holdTpose();
    this.rigA.root.updateMatrixWorld(true);
    this.rigB.root.updateMatrixWorld(true);

    this.phase = 'dressing';
    const assemblyA = dressTShirtOnRig(this.rigA, CHARACTER_DUEL_CONFIG.shirtOptions);
    const assemblyB = dressTShirtOnRig(this.rigB, CHARACTER_DUEL_CONFIG.shirtOptions);
    const merged = mergeClothAssemblies([assemblyA, assemblyB]);
    this.mergedVertexCount = merged.vertices.length;
    await this.cloth.loadClothAssembly(merged);
    await warmupCharacterClothCollision(this.cloth, [this.rigA, this.rigB], this.tearRestoreThreshold);

    await Promise.all([this.controllerA.preloadLocomotion(), this.controllerB.preloadLocomotion()]);
    await Promise.all([this.controllerA.startIdle(), this.controllerB.startIdle()]);
    this.phase = 'ready';
  }

  startFighting(): void {
    this.phase = 'fighting';
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
    }
  }

  handleKeyUp(code: string): void {
    this.keysDown.delete(code);
  }

  update(delta: number): void {
    if (this.phase !== 'fighting' && this.phase !== 'ready') {
      this.rigA.update(delta);
      this.rigB.update(delta);
      this.cloth.setBoneSdfCapsules(mergeBoneSdfCapsules([
        this.rigA.getBoneSdfSummary(),
        this.rigB.getBoneSdfSummary(),
      ]));
      return;
    }

    const posA = this.controllerA.getWorldPosition();
    const posB = this.controllerB.getWorldPosition();

    if (this.controlMode === 'pvp') {
      this.readPvpInput();
      this.controllerA.setMoveInput(this.moveA.x, this.moveA.y);
      this.controllerB.setMoveInput(this.moveB.x, this.moveB.y);
      this.controllerA.update(delta, { inputMode: 'human', opponent: posB, boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius });
      this.controllerB.update(delta, { inputMode: 'human', opponent: posA, boundsRadius: CHARACTER_DUEL_CONFIG.arenaRadius });
      if (this.keysDown.has('Space')) {
        void this.controllerA.playAttackToward(posB);
      }
      if (this.keysDown.has('Enter')) {
        void this.controllerB.playAttackToward(posA);
      }
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

    this.cloth.setBoneSdfCapsules(mergeBoneSdfCapsules([
      this.rigA.getBoneSdfSummary(),
      this.rigB.getBoneSdfSummary(),
    ]));
  }

  private readPvpInput(): void {
    this.moveA.set(0, 0);
    this.moveB.set(0, 0);
    if (this.keysDown.has('KeyW')) this.moveA.y += 1;
    if (this.keysDown.has('KeyS')) this.moveA.y -= 1;
    if (this.keysDown.has('KeyA')) this.moveA.x -= 1;
    if (this.keysDown.has('KeyD')) this.moveA.x += 1;
    if (this.keysDown.has('ArrowUp')) this.moveB.y += 1;
    if (this.keysDown.has('ArrowDown')) this.moveB.y -= 1;
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
