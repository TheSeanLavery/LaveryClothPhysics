import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import GUI from 'lil-gui';
import { makeDraggableLilGui } from '../ui/draggableFloating.ts';
import type { WebGPURenderer } from 'three/webgpu';
import {
  createTShirtAssembly,
  type ClothAssembly,
} from '../cloth/patternAssembly';
import { BreastPhysicsSimulator } from './breastPhysics';
import {
  cloneAnimationTargetSkeleton,
  PhysicsPoseRig,
  type PhysicsPoseRigConfig,
  type PhysicsPoseRigStats,
} from './physicsPoseRig';
import {
  buildCharacterSdfBlueprints,
  compileCharacterSdfCapsulesFromBlueprints,
  compileFallbackCharacterSdfCapsules,
  createCharacterSdfFitQualityReport,
  createCharacterSdfPresetEnvelope,
  type CharacterSdfCapsule,
  type CharacterSdfCapsuleBlueprint,
  type CharacterSdfFitQualityReport,
  type CharacterSdfPresetEnvelope,
} from './sdf';
import { EyeBlinkSystem, type EyeBlinkConfig } from './eyeBlink';
import { measureRigForwardYaw } from './rigForwardMeasure.ts';
export const VISIBLE_CHARACTER_MODEL_URL = '/assets/characters/meshy/blue-haired-anime-girl.fbx';
/** Mixamo T-pose used for shirt dressing and the character preview toolbar. */
export const CHARACTER_SHIRT_TPOSE_FILE = 'mixamo/tpose.fbx';
export const MIXAMO_TPOSE_URL = `/assets/characters/${CHARACTER_SHIRT_TPOSE_FILE}`;
export const MIXAMO_IDLE_URL = '/assets/characters/mixamo/idle.fbx';
export const MIXAMO_DANCING_TWERK_URL = '/assets/characters/mixamo/dancing-twerk.fbx';

export type CharacterAnimationKind = 'tpose' | 'idle' | 'dance';

const UP = new THREE.Vector3(0, 1, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();
const BONE_SDF_CLOTH_SKIN = 0.012;

export type BoneSdfCapsule = CharacterSdfCapsule;

export interface CharacterAnchors {
  readonly hips: THREE.Vector3 | null;
  readonly chest: THREE.Vector3 | null;
  readonly neck: THREE.Vector3 | null;
  readonly leftShoulder: THREE.Vector3 | null;
  readonly rightShoulder: THREE.Vector3 | null;
  readonly leftArm: THREE.Vector3 | null;
  readonly rightArm: THREE.Vector3 | null;
}

export interface CharacterStats {
  readonly loaded: boolean;
  readonly assetUrl: string;
  readonly tposeAnimationUrl?: string;
  readonly idleAnimationUrl?: string;
  readonly animationUrl: string;
  readonly meshCount: number;
  readonly skinnedMeshCount: number;
  readonly boneCount: number;
  readonly animationClipCount: number;
  readonly retargetedTrackCount: number;
  readonly activeClipName: string | null;
  readonly mixerTime: number;
  readonly frameCount: number;
  readonly sdfCapsuleCount: number;
  readonly renderProxyCount: number;
  readonly xrayVisible: boolean;
  readonly boundsHeight: number;
  readonly boundsWidth: number;
  readonly boneNames: string[];
}

export interface BoneSdfCollisionProbe {
  readonly sampleCount: number;
  readonly sdfCount: number;
  readonly penetrationsBefore: number;
  readonly penetrationsAfter: number;
  readonly maxPushDistance: number;
  readonly averagePushDistance: number;
  readonly hitBoneNames: string[];
}

type BoneSdfCapsuleBlueprint = CharacterSdfCapsuleBlueprint;

interface MutableRegionCoverage {
  sampledVertexCount: number;
  nearSurfaceCount: number;
  outsideHoleCount: number;
  insideBlobCount: number;
  signedDistanceSum: number;
  absDistanceSum: number;
  outsideMeshDepthSum: number;
}

interface CoverageRegionAxes {
  readonly chest: THREE.Vector3;
  readonly hips: THREE.Vector3;
  readonly leftHip: THREE.Vector3 | null;
  readonly rightHip: THREE.Vector3 | null;
  readonly leftElbow: THREE.Vector3 | null;
  readonly rightElbow: THREE.Vector3 | null;
  readonly leftKnee: THREE.Vector3 | null;
  readonly rightKnee: THREE.Vector3 | null;
  readonly leftFoot: THREE.Vector3 | null;
  readonly rightFoot: THREE.Vector3 | null;
  readonly leftHand: THREE.Vector3 | null;
  readonly rightHand: THREE.Vector3 | null;
  readonly xAxis: THREE.Vector3;
  readonly frontAxis: THREE.Vector3;
}

export interface BoneSdfFitReport {
  readonly fitted: boolean;
  readonly capsuleCount: number;
  readonly fittedCapsuleCount: number;
  readonly heuristicCapsuleCount: number;
  readonly fittedVertexCount: number;
  readonly maxCapsulesPerBone: number;
  readonly boneNames: string[];
}

export interface BoneSdfMeshCoverageReport {
  readonly surfaceVertexCount: number;
  readonly sampledVertexCount: number;
  readonly nearSurfaceRatio: number;
  readonly outsideHoleRatio: number;
  readonly insideBlobRatio: number;
  readonly meanSignedDistance: number;
  readonly meanAbsDistance: number;
  readonly meanHoleDistance: number;
  readonly meanOutsideMeshDepth: number;
  readonly balancedError: number;
  readonly p90AbsDistance: number;
  readonly maxOutsideDistance: number;
  readonly maxInsideDepth: number;
  readonly worstOutsideCapsuleName: string | null;
  readonly worstInsideCapsuleName: string | null;
  readonly regions: Record<string, BoneSdfRegionCoverageReport>;
}

export interface BoneSdfRegionCoverageReport {
  readonly sampledVertexCount: number;
  readonly nearSurfaceRatio: number;
  readonly outsideHoleRatio: number;
  readonly insideBlobRatio: number;
  readonly meanSignedDistance: number;
  readonly meanAbsDistance: number;
  readonly meanOutsideMeshDepth: number;
  readonly balancedError: number;
}

type BreastSideName = 'left' | 'right';

interface BreastCollisionPrimitive {
  readonly name: string;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly radius: number;
}

interface BreastCollisionSideModel {
  readonly sideName: BreastSideName;
  readonly center: THREE.Vector3;
  readonly restCenter: THREE.Vector3;
  readonly offset: THREE.Vector3;
  readonly capsules: readonly BreastCollisionPrimitive[];
}

interface BreastCollisionModel {
  readonly shoulderWidth: number;
  readonly xAxis: THREE.Vector3;
  readonly frontAxis: THREE.Vector3;
  readonly sides: readonly BreastCollisionSideModel[];
  readonly capsules: readonly BreastCollisionPrimitive[];
}

interface ButtCollisionSideModel {
  readonly sideName: BreastSideName;
  readonly center: THREE.Vector3;
  readonly restCenter: THREE.Vector3;
  readonly offset: THREE.Vector3;
  readonly capsules: readonly BreastCollisionPrimitive[];
}

interface ButtCollisionModel {
  readonly shoulderWidth: number;
  readonly xAxis: THREE.Vector3;
  readonly frontAxis: THREE.Vector3;
  readonly sides: readonly ButtCollisionSideModel[];
  readonly capsules: readonly BreastCollisionPrimitive[];
}

export interface BreastVisualAlignmentSideReport {
  readonly center: [number, number, number];
  readonly sdfCenter: [number, number, number] | null;
  readonly offset: [number, number, number];
  readonly offsetLength: number;
  readonly sdfCenterError: number;
}

export interface BreastVisualAlignmentReport {
  readonly modelAvailable: boolean;
  readonly sdfCapsuleCount: number;
  readonly morphTargetsBuilt: boolean;
  readonly morphMeshCount: number;
  readonly morphInfluenceError: number;
  readonly maxSdfCenterError: number;
  readonly left: BreastVisualAlignmentSideReport | null;
  readonly right: BreastVisualAlignmentSideReport | null;
}

export interface ShirtAnchorReport {
  readonly hasRequiredAnchors: boolean;
  readonly visible: boolean;
  readonly bodyWidth: number;
  readonly torsoHeight: number;
  readonly sleeveLength: number;
  readonly sleeveOpening: number;
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly stitchEdgeCount: number;
  readonly center: [number, number, number];
  readonly neckGap: number;
  readonly anchorNames: string[];
}

export class AnimatedCharacterSceneRig {
  readonly root = new THREE.Group();
  readonly sdfDebugGroup = new THREE.Group();

  private readonly assetUrl: string;
  private readonly tposeAnimationUrl: string;
  private readonly idleAnimationUrl: string;
  private readonly animationUrl: string;
  private readonly bones: THREE.Bone[] = [];
  private readonly boneCapsules: BoneSdfCapsule[] = [];
  private readonly boneSdfBlueprints: BoneSdfCapsuleBlueprint[] = [];
  private readonly boneSdfMeshes = new Map<number, THREE.Object3D>();
  private mixer: THREE.AnimationMixer | null = null;
  private tposeAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private danceAction: THREE.AnimationAction | null = null;
  private activeAction: THREE.AnimationAction | null = null;
  private loadedRoot: THREE.Object3D | null = null;
  private targetRig: THREE.Group | null = null;
  private targetBones: THREE.Bone[] = [];
  private readonly physicsPoseRig = new PhysicsPoseRig();
  private animationClipCount = 0;
  private retargetedTrackCount = 0;
  private activeClipName: string | null = null;
  private meshCount = 0;
  private skinnedMeshCount = 0;
  private frameCount = 0;
  private boundsHeight = 0;
  private boundsWidth = 0;
  private animationSpeed = 1;
  private readonly breastSim = new BreastPhysicsSimulator();
  private readonly buttSim = new BreastPhysicsSimulator({
    stiffnessY: 55,
    stiffnessX: 50,
    stiffnessZ: 45,
    dampingY: 5.0,
    dampingX: 4.5,
    dampingZ: 4.5,
    responseY: 0.07,
    responseX: 0.06,
    responseZ: 0.06,
    maxOffsetY: 0.06,
    maxOffsetX: 0.06,
    maxOffsetZ: 0.05,
  });
  readonly buttPlacement = { dropY: 0.1, backZ: 0.12, sideX: 0.11, radius: 0.085 };
  readonly buttShape = { volume: 0, lift: 0, projection: 0, width: 0 };
  readonly eyeBlink = new EyeBlinkSystem();
  private breastBoneLeft: THREE.Bone | null = null;
  private breastBoneRight: THREE.Bone | null = null;
  private breastBonesSearched = false;
  private breastMorphTargetsBuilt = false;
  private buttMorphTargetsBuilt = false;
  private buttShapeMorphTargetsBuilt = false;
  private readonly breastMorphMeshes: THREE.SkinnedMesh[] = [];
  private readonly buttMorphMeshes: THREE.SkinnedMesh[] = [];
  private readonly buttShapeMorphMeshes: THREE.SkinnedMesh[] = [];
  private readonly buttJiggleMorphOffsets = new WeakMap<THREE.SkinnedMesh, number>();
  private readonly buttShapeMorphOffsets = new WeakMap<THREE.SkinnedMesh, number>();
  private readonly breastBaseQuaternions = new WeakMap<THREE.Bone, THREE.Quaternion>();
  private lastBreastCollisionModel: BreastCollisionModel | null = null;
  private lastButtCollisionModel: ButtCollisionModel | null = null;
  private boneSdfRadiusScale = 1;
  private characterSdfPreset: CharacterSdfPresetEnvelope | null = null;
  private includeSoftCollisionExtras = true;

  constructor(
    private readonly scene: THREE.Scene,
    assetUrl = VISIBLE_CHARACTER_MODEL_URL,
    tposeAnimationUrl = MIXAMO_TPOSE_URL,
    idleAnimationUrl = MIXAMO_IDLE_URL,
    animationUrl = MIXAMO_DANCING_TWERK_URL,
  ) {
    this.assetUrl = assetUrl;
    this.tposeAnimationUrl = tposeAnimationUrl;
    this.idleAnimationUrl = idleAnimationUrl;
    this.animationUrl = animationUrl;
    this.root.name = 'animated-character-in-cloth-scene';
    this.sdfDebugGroup.name = 'animated-character-bone-sdf-xray';
    this.sdfDebugGroup.visible = false;
    this.scene.add(this.root, this.sdfDebugGroup);
  }

  async load(): Promise<void> {
    const loader = new FBXLoader();
    const root = await loadFbxQuietly(loader, this.assetUrl);
    root.name = 'meshy-visible-character';
    this.loadedRoot = root;
    this.collectCharacterObjects(root);
    this.normalizeCharacter(root);
    this.root.add(root);

    this.setupAnimationTargetRig();

    const animationRoot = this.targetRig ?? root;
    this.mixer = new THREE.AnimationMixer(animationRoot);

    const tposeRoot = await loadFbxQuietly(loader, this.tposeAnimationUrl);
    const idleRoot = await loadFbxQuietly(loader, this.idleAnimationUrl);
    const danceRoot = await loadFbxQuietly(loader, this.animationUrl);
    this.animationClipCount =
      tposeRoot.animations.length + idleRoot.animations.length + danceRoot.animations.length;

    if (tposeRoot.animations.length > 0) {
      const clip = this.retargetClipTracks(tposeRoot.animations[0]!, tposeRoot, 'T-Pose retargeted');
      this.tposeAction = this.mixer.clipAction(clip, animationRoot);
      this.tposeAction.reset().play();
      this.activeAction = this.tposeAction;
      this.activeClipName = 'T-Pose';
      this.mixer.update(0.001);
    }

    if (idleRoot.animations.length > 0) {
      const clip = this.retargetClipTracks(idleRoot.animations[0]!, idleRoot, 'Idle retargeted');
      this.idleAction = this.mixer.clipAction(clip, animationRoot);
      this.idleAction.enabled = true;
      this.idleAction.setEffectiveWeight(0);
      if (!this.tposeAction) {
        this.activeAction = this.idleAction;
        this.activeClipName = 'Idle';
        this.idleAction.reset().setEffectiveWeight(1).play();
      }
    }

    if (danceRoot.animations.length > 0) {
      const clip = this.retargetClipTracks(danceRoot.animations[0]!, danceRoot, 'Dancing Twerk retargeted');
      this.danceAction = this.mixer.clipAction(clip, animationRoot);
      this.danceAction.enabled = true;
      this.danceAction.setEffectiveWeight(0);
      if (!this.tposeAction && !this.idleAction) {
        this.activeAction = this.danceAction;
        this.activeClipName = 'Dancing Twerk';
        this.danceAction.reset().setEffectiveWeight(1).play();
      }
    }

    if (!this.tposeAction && !this.idleAction && !this.danceAction) {
      this.mixer = null;
    } else if (this.mixer) {
      this.mixer.update(0.001);
    }

    root.updateMatrixWorld(true);
    this.characterSdfPreset = createCharacterSdfPresetEnvelope(
      'Character cloth SDF',
      'meshy-visible-character',
      this.assetUrl,
    );
    this.buildBoneSdfBlueprints();
    this.updateBoneSdfs();
    this.buildBoneSdfDebugVisuals();
    // Build morph targets now that bones are positioned.
    this.buildBreastMorphTargetsIfNeeded();
    this.buildButtMorphTargetsIfNeeded();
    this.buildButtShapeMorphTargetsIfNeeded();
    this.initEyeBlink();
  }

  update(delta: number): void {
    const step = delta * this.animationSpeed;
    this.mixer?.update(step);
    this.targetRig?.updateMatrixWorld(true);
    this.physicsPoseRig.step(step);
    this.loadedRoot?.updateMatrixWorld(true);
    this.updateBoneSdfs(step);
    this.syncBoneSdfDebugVisuals();
    this.eyeBlink.update(step);
    this.frameCount += 1;
  }

  setAnimationSpeed(speed: number): void {
    this.animationSpeed = THREE.MathUtils.clamp(speed, 0, 2);
  }

  transitionToIdle(fadeDuration = 0.75): void {
    this.blendToAnimation('idle', fadeDuration);
  }

  transitionToDance(fadeDuration = 0.75): void {
    this.blendToAnimation('dance', fadeDuration);
  }

  transitionToTpose(fadeDuration = 0.75): void {
    this.blendToAnimation('tpose', fadeDuration);
  }

  /** Fade out rig-embedded clips so FSM/player clips own the mixer. */
  muteEmbeddedAnimations(): void {
    for (const action of [this.tposeAction, this.idleAction, this.danceAction]) {
      if (!action) {
        continue;
      }
      action.setEffectiveWeight(0);
      action.stop();
    }
  }

  /** Same pose path as character preview — use before placing a T-shirt assembly. */
  settleShirtTpose(): void {
    this.blendToAnimation('tpose', 0.05);
    for (let frame = 0; frame < 4; frame += 1) {
      this.update(1 / 30);
    }
  }

  blendToAnimation(kind: CharacterAnimationKind, fadeDuration = 0.75): void {
    if (!this.mixer) {
      return;
    }

    const nextAction = kind === 'tpose'
      ? this.tposeAction
      : kind === 'idle'
        ? this.idleAction
        : this.danceAction;
    if (!nextAction || nextAction === this.activeAction) {
      return;
    }

    const clipNames: Record<CharacterAnimationKind, string> = {
      tpose: 'T-Pose',
      idle: 'Idle',
      dance: 'Dancing Twerk',
    };

    nextAction.reset().setEffectiveWeight(1).play();
    if (this.activeAction) {
      this.activeAction.crossFadeTo(nextAction, Math.max(0.01, fadeDuration), false);
    }
    this.activeAction = nextAction;
    this.activeClipName = clipNames[kind];
  }

  /**
   * Load an arbitrary FBX animation by URL and play it on the character.
   * Retargets the animation tracks to the character skeleton automatically.
   */
  async loadAndPlayAnimation(url: string, fadeDuration = 0.6, loop = true): Promise<string> {
    if (!this.mixer || !this.targetRig) {
      throw new Error('Character not loaded');
    }

    const loader = new FBXLoader();
    const animRoot = await loadFbxQuietly(loader, url);
    if (!animRoot.animations || animRoot.animations.length === 0) {
      throw new Error('No animation clips in FBX');
    }

    const sourceClip = animRoot.animations[0]!;
    const clipName = sourceClip.name || url.split('/').pop()?.replace('.fbx', '') || 'Custom';
    const retargeted = this.retargetClipTracks(sourceClip, animRoot, clipName);

    if (retargeted.tracks.length === 0) {
      throw new Error('No compatible tracks after retargeting');
    }

    const action = this.mixer.clipAction(retargeted, this.targetRig);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    if (!loop) {
      action.clampWhenFinished = true;
    }
    action.reset().setEffectiveWeight(1).play();

    if (this.activeAction) {
      this.activeAction.crossFadeTo(action, Math.max(0.01, fadeDuration), false);
    }
    this.activeAction = action;
    this.activeClipName = clipName;

    return clipName;
  }

  setXrayVisible(visible: boolean): void {
    this.sdfDebugGroup.visible = visible;
  }

  getStats(): CharacterStats {
    const box = this.loadedRoot ? this.measureCharacterBounds(this.loadedRoot) : new THREE.Box3();
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    return {
      loaded: this.loadedRoot !== null,
      assetUrl: this.assetUrl,
      tposeAnimationUrl: this.tposeAnimationUrl,
      idleAnimationUrl: this.idleAnimationUrl,
      animationUrl: this.animationUrl,
      meshCount: this.meshCount,
      skinnedMeshCount: this.skinnedMeshCount,
      boneCount: this.bones.length,
      animationClipCount: this.animationClipCount,
      retargetedTrackCount: this.retargetedTrackCount,
      activeClipName: this.activeClipName,
      mixerTime: this.mixer?.time ?? 0,
      frameCount: this.frameCount,
      sdfCapsuleCount: this.boneCapsules.length,
      renderProxyCount: this.meshCount + this.boneCapsules.length,
      xrayVisible: this.sdfDebugGroup.visible,
      boundsHeight: size.y || this.boundsHeight,
      boundsWidth: Math.max(size.x, size.z) || this.boundsWidth,
      boneNames: this.bones.slice(0, 48).map((bone) => bone.name),
    };
  }

  setBoneSdfRadiusScale(scale: number): void {
    this.boneSdfRadiusScale = Math.max(0.5, Math.min(1.5, scale));
  }

  getBoneSdfRuntimeScale(): number {
    return this.boneSdfRadiusScale;
  }

  getCharacterSdfPreset(): CharacterSdfPresetEnvelope | null {
    return this.characterSdfPreset;
  }

  setCharacterSdfPreset(preset: CharacterSdfPresetEnvelope): void {
    this.characterSdfPreset = createCharacterSdfPresetEnvelope(
      preset.name,
      preset.characterId,
      this.assetUrl,
      { ...preset, assetUrl: this.assetUrl },
    );
    this.rebuildCharacterSdfsFromPreset();
  }

  patchCharacterSdfPreset(
    patch: Partial<
      Pick<
        CharacterSdfPresetEnvelope,
        'globalRadiusScale' | 'globalRadiusBias' | 'surfaceBand' | 'boneOverrides' | 'manualCapsules' | 'vertexRules'
      >
    >,
  ): void {
    if (!this.characterSdfPreset) {
      return;
    }
    this.characterSdfPreset = createCharacterSdfPresetEnvelope(
      this.characterSdfPreset.name,
      this.characterSdfPreset.characterId,
      this.assetUrl,
      { ...this.characterSdfPreset, ...patch },
    );
    this.rebuildCharacterSdfsFromPreset();
  }

  setIncludeSoftCollisionExtras(enabled: boolean): void {
    if (this.includeSoftCollisionExtras === enabled) {
      return;
    }
    this.includeSoftCollisionExtras = enabled;
    this.updateBoneSdfs(0);
    this.syncBoneSdfDebugVisuals();
  }

  getIncludeSoftCollisionExtras(): boolean {
    return this.includeSoftCollisionExtras;
  }

  rebuildCharacterSdfsFromPreset(): void {
    this.buildBoneSdfBlueprints();
    this.updateBoneSdfs(0);
    this.syncBoneSdfDebugVisuals();
  }

  getCharacterSdfFitReport(): CharacterSdfFitQualityReport | null {
    if (!this.loadedRoot || this.boneCapsules.length === 0 || !this.characterSdfPreset) {
      return null;
    }
    return createCharacterSdfFitQualityReport(
      this.loadedRoot,
      this.boneCapsules,
      this.characterSdfPreset.surfaceBand,
    );
  }

  getBoneSdfSummary(): Array<{
    id: number;
    name: string;
    parentName: string;
    radius: number;
    length: number;
    start: [number, number, number];
    end: [number, number, number];
  }> {
    const radiusScale = this.boneSdfRadiusScale;
    return this.boneCapsules.map((capsule) => ({
      id: capsule.id,
      name: capsule.name,
      parentName: capsule.parentName,
      radius: capsule.radius * radiusScale,
      length: capsule.length,
      start: vectorTuple(capsule.start),
      end: vectorTuple(capsule.end),
    }));
  }

  getBoneSdfFitReport(): BoneSdfFitReport {
    return {
      fitted: this.boneSdfBlueprints.length > 0,
      capsuleCount: this.boneCapsules.length,
      fittedCapsuleCount: this.boneCapsules.filter((capsule) => capsule.fitted).length,
      heuristicCapsuleCount: this.boneCapsules.filter((capsule) => !capsule.fitted).length,
      fittedVertexCount: this.boneCapsules.reduce((sum, capsule) => sum + (capsule.fitVertexCount ?? 0), 0),
      maxCapsulesPerBone: maxCapsulesPerBone(this.boneCapsules),
      boneNames: this.boneCapsules.slice(0, 48).map((capsule) => capsule.name),
    };
  }

  getBoneSdfMeshCoverageReport(surfaceBand = 0.035): BoneSdfMeshCoverageReport {
    if (!this.loadedRoot || this.boneCapsules.length === 0) {
      return emptyBoneSdfMeshCoverageReport();
    }

    this.loadedRoot.updateMatrixWorld(true);
    const distances: number[] = [];
    let outsideHoleCount = 0;
    let insideBlobCount = 0;
    let nearSurfaceCount = 0;
    let signedDistanceSum = 0;
    let holeDistanceSum = 0;
    let outsideMeshDepthSum = 0;
    let maxOutsideDistance = 0;
    let maxInsideDepth = 0;
    let worstOutsideCapsuleName: string | null = null;
    let worstInsideCapsuleName: string | null = null;
    let surfaceVertexCount = 0;
    const regions = new Map<string, MutableRegionCoverage>();
    const regionAxes = this.buildCoverageRegionAxes();

    this.loadedRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) {
        return;
      }
      const positionAttr = object.geometry.getAttribute('position');
      const skinIndexAttr = object.geometry.getAttribute('skinIndex');
      const skinWeightAttr = object.geometry.getAttribute('skinWeight');
      if (!positionAttr) {
        return;
      }
      surfaceVertexCount += positionAttr.count;
      const sampleStride = Math.max(1, Math.floor(positionAttr.count / 2500));
      const point = new THREE.Vector3();
      for (let vertexIndex = 0; vertexIndex < positionAttr.count; vertexIndex += sampleStride) {
        let regionName = collisionCoverageRegionForVertex(object, vertexIndex, skinIndexAttr, skinWeightAttr);
        if (!regionName) {
          continue;
        }
        getSkinnedVertexWorldPosition(object, vertexIndex, point);
        regionName = refineCoverageRegion(regionName, point, regionAxes);
        const sample = closestCapsuleSignedDistance(point, this.boneCapsules);
        accumulateRegionCoverage(regions, regionName, sample.distance, surfaceBand);
        distances.push(sample.distance);
        signedDistanceSum += sample.distance;
        const absDistance = Math.abs(sample.distance);
        if (absDistance <= surfaceBand) {
          nearSurfaceCount += 1;
        } else if (sample.distance > surfaceBand) {
          outsideHoleCount += 1;
          holeDistanceSum += sample.distance;
          if (sample.distance > maxOutsideDistance) {
            maxOutsideDistance = sample.distance;
            worstOutsideCapsuleName = sample.name;
          }
        } else {
          const depth = -sample.distance;
          insideBlobCount += 1;
          outsideMeshDepthSum += depth;
          if (depth > maxInsideDepth) {
            maxInsideDepth = depth;
            worstInsideCapsuleName = sample.name;
          }
        }
      }
    });

    const absDistances = distances.map((distance) => Math.abs(distance)).sort((a, b) => a - b);
    const sampledVertexCount = distances.length;
    const meanAbsDistance = sampledVertexCount > 0
      ? absDistances.reduce((sum, value) => sum + value, 0) / sampledVertexCount
      : 0;

    return {
      surfaceVertexCount,
      sampledVertexCount,
      nearSurfaceRatio: sampledVertexCount > 0 ? nearSurfaceCount / sampledVertexCount : 0,
      outsideHoleRatio: sampledVertexCount > 0 ? outsideHoleCount / sampledVertexCount : 0,
      insideBlobRatio: sampledVertexCount > 0 ? insideBlobCount / sampledVertexCount : 0,
      meanSignedDistance: sampledVertexCount > 0 ? signedDistanceSum / sampledVertexCount : 0,
      meanAbsDistance,
      meanHoleDistance: sampledVertexCount > 0 ? holeDistanceSum / sampledVertexCount : 0,
      meanOutsideMeshDepth: sampledVertexCount > 0 ? outsideMeshDepthSum / sampledVertexCount : 0,
      balancedError: meanAbsDistance + Math.abs(sampledVertexCount > 0 ? signedDistanceSum / sampledVertexCount : 0),
      p90AbsDistance: percentile(absDistances, 0.9),
      maxOutsideDistance,
      maxInsideDepth,
      worstOutsideCapsuleName,
      worstInsideCapsuleName,
      regions: finalizeRegionCoverage(regions),
    };
  }

  getCharacterAnchors(): CharacterAnchors {
    return {
      hips: this.findBoneWorldPosition(['hips']),
      chest: this.findBoneWorldPosition(['spine2', 'spine1', 'spine']),
      neck: this.findBoneWorldPosition(['neck']),
      leftShoulder: this.findBoneWorldPosition(['leftshoulder', 'leftarm']),
      rightShoulder: this.findBoneWorldPosition(['rightshoulder', 'rightarm']),
      leftArm: this.findBoneWorldPosition(['leftforearm', 'leftarm']),
      rightArm: this.findBoneWorldPosition(['rightforearm', 'rightarm']),
    };
  }

  getMixer(): THREE.AnimationMixer | null {
    return this.mixer;
  }

  getLoadedRoot(): THREE.Object3D | null {
    return this.loadedRoot;
  }

  /** Invisible rig driven by AnimationMixer (animation intent). */
  getAnimationRoot(): THREE.Object3D | null {
    return this.targetRig;
  }

  getAnimationBones(): readonly THREE.Bone[] {
    return this.targetBones;
  }

  /** Visible rig + skinned mesh; also used for cloth bone SDFs. */
  getBones(): readonly THREE.Bone[] {
    return this.bones;
  }

  getPhysicsPoseRig(): PhysicsPoseRig {
    return this.physicsPoseRig;
  }

  getPhysicsPoseConfig(): PhysicsPoseRigConfig {
    return this.physicsPoseRig.config;
  }

  getPhysicsPoseStats(): PhysicsPoseRigStats {
    return this.physicsPoseRig.getStats();
  }

  setPhysicsPoseTargetRigVisible(visible: boolean): void {
    if (this.targetRig) {
      this.targetRig.visible = visible;
    }
  }

  /** Visual forward yaw (radians) from current bone pose — used by mesh-bind audit. */
  measureForwardYaw(): number | null {
    return measureRigForwardYaw(this);
  }

  getBreastPhysics(): BreastPhysicsSimulator {
    return this.breastSim;
  }

  getButtPhysics(): BreastPhysicsSimulator {
    return this.buttSim;
  }

  getBreastMorphInfo(): { meshCount: number; morphTargetsBuilt: boolean; morphCount: number; influences: number[][] } {
    return {
      meshCount: this.breastMorphMeshes.length,
      morphTargetsBuilt: this.breastMorphTargetsBuilt,
      morphCount: 12,
      influences: this.breastMorphMeshes.map((mesh) => [...(mesh.morphTargetInfluences ?? [])]),
    };
  }

  getButtMorphInfo(): { meshCount: number; morphTargetsBuilt: boolean; shapeTargetsBuilt: boolean; morphCount: number; influences: number[][] } {
    return {
      meshCount: this.buttMorphMeshes.length,
      morphTargetsBuilt: this.buttMorphTargetsBuilt,
      shapeTargetsBuilt: this.buttShapeMorphTargetsBuilt,
      morphCount: 16,
      influences: this.buttMorphMeshes.map((mesh) => [...(mesh.morphTargetInfluences ?? [])]),
    };
  }

  getBreastVisualAlignmentReport(): BreastVisualAlignmentReport {
    const model = this.lastBreastCollisionModel ?? this.buildBreastCollisionModel(0, false);
    if (!model) {
      return {
        modelAvailable: false,
        sdfCapsuleCount: 0,
        morphTargetsBuilt: this.breastMorphTargetsBuilt,
        morphMeshCount: this.breastMorphMeshes.length,
        morphInfluenceError: Number.POSITIVE_INFINITY,
        maxSdfCenterError: Number.POSITIVE_INFINITY,
        left: null,
        right: null,
      };
    }

    const expectedInfluences = breastMorphInfluencesForModel(model);
    const actualInfluences = this.breastMorphMeshes[0]?.morphTargetInfluences ?? [];
    const morphInfluenceError = expectedInfluences.reduce((maxError, expected, index) => {
      const actual = actualInfluences[index] ?? 0;
      return Math.max(maxError, Math.abs(actual - expected));
    }, 0);

    const left = this.breastAlignmentSideReport(model, 'left');
    const right = this.breastAlignmentSideReport(model, 'right');
    return {
      modelAvailable: true,
      sdfCapsuleCount: this.boneCapsules.filter((capsule) => capsule.name.startsWith('soft-chest-')).length,
      morphTargetsBuilt: this.breastMorphTargetsBuilt,
      morphMeshCount: this.breastMorphMeshes.length,
      morphInfluenceError,
      maxSdfCenterError: Math.max(left?.sdfCenterError ?? 0, right?.sdfCenterError ?? 0),
      left,
      right,
    };
  }

  /**
   * Returns the current world-space center of each breast capsule cluster.
   * Useful for hit-testing pointer interaction against the chest area.
   */
  getBreastWorldCenters(): { left: THREE.Vector3; right: THREE.Vector3 } | null {
    const model = this.lastBreastCollisionModel ?? this.buildBreastCollisionModel(0, false);
    if (!model) {
      return null;
    }
    const left = model.sides.find((side) => side.sideName === 'left');
    const right = model.sides.find((side) => side.sideName === 'right');
    if (!left || !right) {
      return null;
    }
    return {
      left: left.center.clone(),
      right: right.center.clone(),
    };
  }

  getButtWorldCenters(): { left: THREE.Vector3; right: THREE.Vector3 } | null {
    const model = this.lastButtCollisionModel ?? this.buildButtCollisionModel(0, false);
    if (!model) {
      return null;
    }
    const left = model.sides.find((side) => side.sideName === 'left');
    const right = model.sides.find((side) => side.sideName === 'right');
    if (!left || !right) {
      return null;
    }
    return {
      left: left.center.clone(),
      right: right.center.clone(),
    };
  }

  getBlinkInfo(): { amount: number; initialized: boolean; config: EyeBlinkConfig } {
    return {
      amount: this.eyeBlink.getBlinkAmount(),
      initialized: this.eyeBlink.isInitialized(),
      config: { ...this.eyeBlink.config },
    };
  }

  private breastAlignmentSideReport(
    model: BreastCollisionModel,
    sideName: BreastSideName,
  ): BreastVisualAlignmentSideReport | null {
    const side = model.sides.find((candidate) => candidate.sideName === sideName);
    if (!side) {
      return null;
    }
    const jiggleCapsule = this.boneCapsules.find((capsule) => capsule.name === `soft-chest-${sideName}-jiggle`);
    const sdfCenter = jiggleCapsule
      ? jiggleCapsule.start.clone().add(jiggleCapsule.end).multiplyScalar(0.5)
      : null;
    const sdfCenterError = sdfCenter ? sdfCenter.distanceTo(side.center) : Number.POSITIVE_INFINITY;
    return {
      center: vectorTuple(side.center),
      sdfCenter: sdfCenter ? vectorTuple(sdfCenter) : null,
      offset: vectorTuple(side.offset),
      offsetLength: side.offset.length(),
      sdfCenterError,
    };
  }

  private initEyeBlink(): void {
    if (!this.loadedRoot) return;
    const headBone = this.findBone(['head']);
    if (!headBone) return;
    this.eyeBlink.init(this.loadedRoot, headBone, getSkinnedVertexWorldPosition);
  }

  private collectCharacterObjects(root: THREE.Object3D): void {
    this.meshCount = 0;
    this.skinnedMeshCount = 0;
    this.bones.length = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.meshCount += 1;
        object.castShadow = true;
        object.receiveShadow = true;
      }
      if (object instanceof THREE.SkinnedMesh) {
        this.skinnedMeshCount += 1;
      }
      if (object instanceof THREE.Bone) {
        this.bones.push(object);
      }
    });
  }

  private normalizeCharacter(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = this.measureCharacterBounds(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? 1.75 / size.y : 0.01;
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);

    const scaledBox = this.measureCharacterBounds(root);
    const center = scaledBox.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(center.x, scaledBox.min.y, center.z));
    root.updateMatrixWorld(true);

    const finalSize = this.measureCharacterBounds(root).getSize(new THREE.Vector3());
    this.boundsHeight = finalSize.y;
    this.boundsWidth = Math.max(finalSize.x, finalSize.z);
  }

  private measureCharacterBounds(root: THREE.Object3D): THREE.Box3 {
    const meshBounds = new THREE.Box3().setFromObject(root);
    if (!meshBounds.isEmpty()) {
      return meshBounds;
    }

    const boneBounds = new THREE.Box3();
    for (const bone of this.bones) {
      boneBounds.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
    }
    return boneBounds;
  }

  private setupAnimationTargetRig(): void {
    if (this.bones.length === 0) {
      return;
    }
    const { targetRoot, targetBones, pairs } = cloneAnimationTargetSkeleton(this.bones);
    this.targetRig = targetRoot;
    this.targetBones = targetBones;
    this.root.add(targetRoot);
    targetRoot.updateMatrixWorld(true);
    this.physicsPoseRig.bind(pairs);
    this.physicsPoseRig.snapDisplayToTarget();
    this.loadedRoot?.updateMatrixWorld(true);
  }

  private retargetClipTracks(
    sourceClip: THREE.AnimationClip,
    animationRoot: THREE.Object3D,
    fallbackName = 'Dancing Twerk retargeted',
  ): THREE.AnimationClip {
    const targetBoneNamesByKey = new Map<string, string>();
    const bonesForRetarget = this.targetBones.length > 0 ? this.targetBones : this.bones;
    for (const bone of bonesForRetarget) {
      targetBoneNamesByKey.set(normalizeBoneName(bone.name), bone.name);
    }

    const tracks = sourceClip.tracks.flatMap((track) => {
      const split = splitTrackName(track.name);
      if (!split) {
        return [];
      }
      if (split.propertyPath !== 'quaternion') {
        return [];
      }
      const targetName = targetBoneNamesByKey.get(normalizeBoneName(split.targetName));
      if (!targetName) {
        return [];
      }
      const cloned = track.clone();
      cloned.name = `${targetName}.${split.propertyPath}`;
      return [cloned];
    });

    this.retargetedTrackCount = Math.max(this.retargetedTrackCount, tracks.length);
    if (tracks.length === 0) {
      console.warn('No direct animation tracks matched target rig');
    }

    return new THREE.AnimationClip(sourceClip.name || fallbackName, sourceClip.duration, tracks);
  }

  private buildBoneSdfBlueprints(): void {
    if (!this.loadedRoot) {
      return;
    }
    this.loadedRoot.updateMatrixWorld(true);
    this.boneSdfBlueprints.length = 0;
    this.boneSdfBlueprints.push(...buildCharacterSdfBlueprints(this.loadedRoot, this.bones, {
      preset: this.characterSdfPreset,
    }));
  }

  private updateBoneSdfs(delta = 0): void {
    if (!this.loadedRoot) {
      return;
    }
    this.loadedRoot.updateMatrixWorld(true);
    this.boneCapsules.length = 0;
    const preset = this.characterSdfPreset ?? undefined;
    if (this.boneSdfBlueprints.length > 0) {
      this.boneCapsules.push(...compileCharacterSdfCapsulesFromBlueprints(this.boneSdfBlueprints, { preset }));
      if (this.includeSoftCollisionExtras) {
        this.addSoftChestJiggleSdfs(delta);
      }
      return;
    }
    this.boneCapsules.push(...compileFallbackCharacterSdfCapsules(this.bones, { preset }));
    if (this.includeSoftCollisionExtras) {
      this.addSoftChestJiggleSdfs(delta);
    }
  }

  private buildBreastCollisionModel(delta: number, stepPhysics: boolean): BreastCollisionModel | null {
    const chest = this.findBoneWorldPosition(['spine2', 'spine1', 'spine']);
    const neck = this.findBoneWorldPosition(['neck']);
    const leftShoulder = this.findBoneWorldPosition(['leftshoulder', 'leftarm']);
    const rightShoulder = this.findBoneWorldPosition(['rightshoulder', 'rightarm']);
    if (!chest || !neck || !leftShoulder || !rightShoulder) {
      return null;
    }

    const xAxis = rightShoulder.clone().sub(leftShoulder);
    xAxis.y = 0;
    if (xAxis.lengthSq() < 0.0001) {
      xAxis.set(1, 0, 0);
    }
    xAxis.normalize();
    const frontAxis = UP.clone().cross(xAxis);
    if (frontAxis.lengthSq() < 0.0001) {
      frontAxis.set(0, 0, 1);
    }
    frontAxis.normalize();

    if (stepPhysics) {
      this.breastSim.step(chest.dot(xAxis), chest.y, chest.dot(frontAxis), delta);
    }

    const shoulderWidth = leftShoulder.distanceTo(rightShoulder);
    const sideOffset = THREE.MathUtils.clamp(shoulderWidth * 0.15, 0.052, 0.105);
    const frontOffset = THREE.MathUtils.clamp(shoulderWidth * 0.2, 0.085, 0.14);
    const verticalDrop = THREE.MathUtils.clamp(shoulderWidth * 0.055, 0.022, 0.038);
    const base = chest
      .clone()
      .lerp(neck, 0.08)
      .addScaledVector(UP, -verticalDrop)
      .addScaledVector(frontAxis, frontOffset);
    const sides = ([['left', -1], ['right', 1]] as const).map(([sideName, sign]) => {
      const spring = sideName === 'left' ? this.breastSim.left : this.breastSim.right;
      const restCenter = base.clone().addScaledVector(xAxis, sign * sideOffset);
      const offset = new THREE.Vector3()
        .addScaledVector(UP, spring.offsetY)
        .addScaledVector(xAxis, spring.offsetX)
        .addScaledVector(frontAxis, spring.offsetZ);
      const center = restCenter.clone().add(offset);
      return {
        sideName,
        center,
        restCenter,
        offset,
        capsules: buildBreastCapsulesForSide(sideName, sign, center, xAxis, frontAxis, shoulderWidth),
      };
    });

    return {
      shoulderWidth,
      xAxis,
      frontAxis,
      sides,
      capsules: sides.flatMap((side) => side.capsules),
    };
  }

  private buildButtCollisionModel(
    delta: number,
    stepPhysics: boolean,
    xAxisOverride?: THREE.Vector3,
    frontAxisOverride?: THREE.Vector3,
    shoulderWidthOverride?: number,
  ): ButtCollisionModel | null {
    const hips = this.findBoneWorldPosition(['hips']);
    const leftShoulder = this.findBoneWorldPosition(['leftshoulder', 'leftarm']);
    const rightShoulder = this.findBoneWorldPosition(['rightshoulder', 'rightarm']);
    if (!hips || !leftShoulder || !rightShoulder) {
      return null;
    }

    const xAxis = xAxisOverride?.clone() ?? rightShoulder.clone().sub(leftShoulder);
    xAxis.y = 0;
    if (xAxis.lengthSq() < 0.0001) {
      xAxis.set(1, 0, 0);
    }
    xAxis.normalize();

    const frontAxis = frontAxisOverride?.clone() ?? UP.clone().cross(xAxis);
    if (frontAxis.lengthSq() < 0.0001) {
      frontAxis.set(0, 0, 1);
    }
    frontAxis.normalize();

    const shoulderWidth = shoulderWidthOverride ?? leftShoulder.distanceTo(rightShoulder);
    if (stepPhysics) {
      this.buttSim.step(hips.dot(xAxis), hips.y, hips.dot(frontAxis), delta);
    }

    const sideOffset = THREE.MathUtils.clamp(shoulderWidth * this.buttPlacement.sideX, 0.045, 0.08);
    const base = hips
      .clone()
      .addScaledVector(frontAxis, -this.buttPlacement.backZ)
      .addScaledVector(UP, -this.buttPlacement.dropY);

    const sides = ([['left', -1], ['right', 1]] as const).map(([sideName, sign]) => {
      const spring = sideName === 'left' ? this.buttSim.left : this.buttSim.right;
      const restCenter = base.clone().addScaledVector(xAxis, sign * sideOffset);
      const offset = new THREE.Vector3()
        .addScaledVector(UP, spring.offsetY)
        .addScaledVector(xAxis, spring.offsetX)
        .addScaledVector(frontAxis, spring.offsetZ);
      const center = restCenter.clone().add(offset);
      return {
        sideName,
        center,
        restCenter,
        offset,
        capsules: buildButtCapsulesForSide(sideName, restCenter, frontAxis, shoulderWidth, this.buttPlacement.radius),
      };
    });

    return {
      shoulderWidth,
      xAxis,
      frontAxis,
      sides,
      capsules: sides.flatMap((side) => side.capsules),
    };
  }

  private addSoftChestJiggleSdfs(delta: number): void {
    const model = this.buildBreastCollisionModel(delta, true);
    if (!model) {
      return;
    }

    this.lastBreastCollisionModel = model;
    this.applyBreastDeformation(model);
    for (const capsule of model.capsules) {
      this.pushBoneCapsule(capsule.name, 'chest', capsule.start, capsule.end, capsule.radius);
    }

    const buttModel = this.buildButtCollisionModel(delta, true, model.xAxis, model.frontAxis, model.shoulderWidth);
    if (buttModel) {
      this.lastButtCollisionModel = buttModel;
      this.applyButtDeformation(buttModel);
    }
    this.addStaticButtSdfs(model.xAxis, model.frontAxis, model.shoulderWidth);

    this.addSoftLegRailSdfs(model.xAxis, model.frontAxis, model.shoulderWidth);
    this.addSoftHandSdfs(model.xAxis, model.frontAxis, model.shoulderWidth);
  }

  private addStaticButtSdfs(xAxis: THREE.Vector3, frontAxis: THREE.Vector3, shoulderWidth: number): void {
    const hips = this.findBoneWorldPosition(['hips']);
    if (!hips) {
      return;
    }

    const buttBase = hips.clone().addScaledVector(frontAxis, -THREE.MathUtils.clamp(shoulderWidth * 0.16, 0.07, 0.12));
    const buttRadius = THREE.MathUtils.clamp(shoulderWidth * 0.085, 0.045, 0.07);
    const buttSideOffset = THREE.MathUtils.clamp(shoulderWidth * 0.11, 0.045, 0.08);
    for (const [sideName, sign] of [['left', -1], ['right', 1]] as const) {
      const center = buttBase.clone().addScaledVector(xAxis, sign * buttSideOffset);
      const start = center.clone().addScaledVector(UP, -0.018);
      const end = center.clone().addScaledVector(UP, 0.018);
      this.boneCapsules.push({
        id: this.boneCapsules.length,
        name: `soft-butt-${sideName}`,
        parentName: 'hips',
        start,
        end,
        radius: buttRadius,
        length: start.distanceTo(end),
      });
      const thighCenter = center
        .clone()
        .addScaledVector(frontAxis, -THREE.MathUtils.clamp(shoulderWidth * 0.035, 0.015, 0.03))
        .addScaledVector(UP, -THREE.MathUtils.clamp(shoulderWidth * 0.18, 0.075, 0.13));
      const thighStart = thighCenter.clone().addScaledVector(UP, -0.055);
      const thighEnd = thighCenter.clone().addScaledVector(UP, 0.035);
      this.boneCapsules.push({
        id: this.boneCapsules.length,
        name: `soft-butt-leg-${sideName}`,
        parentName: 'hips',
        start: thighStart,
        end: thighEnd,
        radius: THREE.MathUtils.clamp(shoulderWidth * 0.08, 0.045, 0.068),
        length: thighStart.distanceTo(thighEnd),
      });
    }
  }

  private addSoftHandSdfs(xAxis: THREE.Vector3, frontAxis: THREE.Vector3, shoulderWidth: number): void {
    for (const [sideName, sign] of [['left', -1], ['right', 1]] as const) {
      const hand = this.findBoneWorldPosition([`${sideName}hand`]);
      const index = this.findBoneWorldPosition([
        `${sideName}handindex4`,
        `${sideName}handindex3`,
        `${sideName}handindex2`,
        `${sideName}handindex1`,
      ]);
      const thumb = this.findBoneWorldPosition([
        `${sideName}handthumb4`,
        `${sideName}handthumb3`,
        `${sideName}handthumb2`,
        `${sideName}handthumb1`,
      ]);
      if (!hand) {
        continue;
      }

      const fallbackFinger = hand
        .clone()
        .addScaledVector(xAxis, sign * THREE.MathUtils.clamp(shoulderWidth * 0.16, 0.075, 0.13));
      const fingerTip = index ?? fallbackFinger;
      const palmCenter = hand.clone().lerp(fingerTip, 0.36);
      const palmRadius = THREE.MathUtils.clamp(shoulderWidth * 0.046, 0.026, 0.04);
      this.pushBoneCapsule(
        `soft-hand-${sideName}-palm`,
        'hand-rail',
        hand.clone().lerp(fingerTip, 0.05),
        hand.clone().lerp(fingerTip, 0.72),
        palmRadius,
      );
      this.pushBoneCapsule(
        `soft-hand-${sideName}-width`,
        'hand-rail',
        palmCenter.clone().addScaledVector(frontAxis, -THREE.MathUtils.clamp(shoulderWidth * 0.055, 0.026, 0.045)),
        palmCenter.clone().addScaledVector(frontAxis, THREE.MathUtils.clamp(shoulderWidth * 0.055, 0.026, 0.045)),
        THREE.MathUtils.clamp(shoulderWidth * 0.034, 0.02, 0.032),
      );
      if (thumb) {
        this.pushBoneCapsule(
          `soft-hand-${sideName}-thumb`,
          'hand-rail',
          hand.clone().lerp(thumb, 0.12),
          hand.clone().lerp(thumb, 0.95),
          THREE.MathUtils.clamp(shoulderWidth * 0.03, 0.018, 0.028),
        );
      }
    }
  }

  private addSoftLegRailSdfs(xAxis: THREE.Vector3, frontAxis: THREE.Vector3, shoulderWidth: number): void {
    for (const [sideName, sign] of [['left', -1], ['right', 1]] as const) {
      const hip = this.findBoneWorldPosition([`${sideName}upleg`]);
      const knee = this.findBoneWorldPosition([`${sideName}leg`]);
      const foot = this.findBoneWorldPosition([`${sideName}foot`]);
      if (!hip || !knee) {
        continue;
      }

      const thighStartBase = hip.clone().lerp(knee, 0.08);
      const thighEndBase = hip.clone().lerp(knee, 0.86);
      const thighRadius = THREE.MathUtils.clamp(shoulderWidth * 0.052, 0.028, 0.044);
      const thighSideOffset = THREE.MathUtils.clamp(shoulderWidth * 0.075, 0.035, 0.06);
      const thighFrontOffset = THREE.MathUtils.clamp(shoulderWidth * 0.062, 0.028, 0.05);
      this.pushBoneCapsule(
        `soft-thigh-${sideName}-outer`,
        'thigh-rail',
        thighStartBase.clone().addScaledVector(xAxis, sign * thighSideOffset),
        thighEndBase.clone().addScaledVector(xAxis, sign * thighSideOffset),
        thighRadius,
      );
      this.pushBoneCapsule(
        `soft-thigh-${sideName}-back`,
        'thigh-rail',
        thighStartBase.clone().addScaledVector(frontAxis, -thighFrontOffset),
        thighEndBase.clone().addScaledVector(frontAxis, -thighFrontOffset),
        thighRadius,
      );
      this.pushBoneCapsule(
        `soft-thigh-${sideName}-front`,
        'thigh-rail',
        thighStartBase.clone().addScaledVector(frontAxis, thighFrontOffset * 0.75),
        thighEndBase.clone().addScaledVector(frontAxis, thighFrontOffset * 0.75),
        thighRadius * 0.82,
      );

      if (!foot) {
        continue;
      }
      const calfStartBase = knee.clone().lerp(foot, 0.1);
      const calfEndBase = knee.clone().lerp(foot, 0.82);
      const calfRadius = THREE.MathUtils.clamp(shoulderWidth * 0.056, 0.032, 0.048);
      const calfBackOffset = THREE.MathUtils.clamp(shoulderWidth * 0.06, 0.03, 0.052);
      const calfSideOffset = THREE.MathUtils.clamp(shoulderWidth * 0.06, 0.03, 0.05);
      this.pushBoneCapsule(
        `soft-calf-${sideName}-back`,
        'calf-rail',
        calfStartBase.clone().addScaledVector(frontAxis, -calfBackOffset),
        calfEndBase.clone().addScaledVector(frontAxis, -calfBackOffset),
        calfRadius,
      );
      this.pushBoneCapsule(
        `soft-calf-${sideName}-outer`,
        'calf-rail',
        calfStartBase.clone().addScaledVector(xAxis, sign * calfSideOffset),
        calfEndBase.clone().addScaledVector(xAxis, sign * calfSideOffset),
        calfRadius * 0.86,
      );
      this.pushBoneCapsule(
        `soft-calf-${sideName}-front`,
        'calf-rail',
        calfStartBase.clone().addScaledVector(frontAxis, calfBackOffset * 0.62),
        calfEndBase.clone().addScaledVector(frontAxis, calfBackOffset * 0.62),
        calfRadius * 0.78,
      );
      const footCenter = foot.clone().addScaledVector(frontAxis, THREE.MathUtils.clamp(shoulderWidth * 0.04, 0.02, 0.035));
      this.pushBoneCapsule(
        `soft-foot-${sideName}-length`,
        'foot-rail',
        footCenter.clone().addScaledVector(frontAxis, -THREE.MathUtils.clamp(shoulderWidth * 0.12, 0.06, 0.1)),
        footCenter.clone().addScaledVector(frontAxis, THREE.MathUtils.clamp(shoulderWidth * 0.18, 0.09, 0.15)),
        THREE.MathUtils.clamp(shoulderWidth * 0.06, 0.035, 0.052),
      );
      this.pushBoneCapsule(
        `soft-foot-${sideName}-width`,
        'foot-rail',
        footCenter.clone().addScaledVector(xAxis, sign * -THREE.MathUtils.clamp(shoulderWidth * 0.075, 0.038, 0.065)),
        footCenter.clone().addScaledVector(xAxis, sign * THREE.MathUtils.clamp(shoulderWidth * 0.075, 0.038, 0.065)),
        THREE.MathUtils.clamp(shoulderWidth * 0.052, 0.03, 0.046),
      );
    }
  }

  private applyBreastDeformation(model: BreastCollisionModel): void {
    this.applyBreastBoneRotations(model);
    this.buildBreastMorphTargetsIfNeeded(model);
    this.syncBreastMorphInfluences(model);
  }

  /**
   * Find breast bones on the skeleton and apply jiggle rotation from the
   * current breast model. The base quaternion prevents frame-to-frame drift.
   */
  private applyBreastBoneRotations(model: BreastCollisionModel): void {
    if (!this.breastBonesSearched) {
      this.breastBonesSearched = true;
      this.breastBoneLeft = this.findBone([
        'breastl', 'breast_l', 'leftbreast', 'bustl', 'bust_l', 'munel', 'mune_l',
      ]);
      this.breastBoneRight = this.findBone([
        'breastr', 'breast_r', 'rightbreast', 'bustr', 'bust_r', 'muner', 'mune_r',
      ]);
    }

    const ROTATION_SCALE = 6.0; // radians per unit offset — tuned for visual appeal

    for (const [sideName, bone] of [['left', this.breastBoneLeft], ['right', this.breastBoneRight]] as const) {
      if (!bone) {
        continue;
      }
      const side = model.sides.find((candidate) => candidate.sideName === sideName);
      if (!side) {
        continue;
      }
      let baseQuaternion = this.breastBaseQuaternions.get(bone);
      if (!baseQuaternion) {
        baseQuaternion = bone.quaternion.clone();
        this.breastBaseQuaternions.set(bone, baseQuaternion);
      }
      const rotation = new THREE.Euler(
        -side.offset.y * ROTATION_SCALE,
        side.offset.dot(model.frontAxis) * ROTATION_SCALE,
        side.offset.dot(model.xAxis) * ROTATION_SCALE,
        'XYZ',
      );
      bone.quaternion.copy(baseQuaternion).multiply(new THREE.Quaternion().setFromEuler(rotation));
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Build morph targets on each SkinnedMesh for breast vertex displacement.
   * Creates 12 targets: left/right × Y/X/Z × positive/negative.
   * Using separate +/- targets avoids negative morph influence clamping.
   * Vertices are weighted by a smooth falloff from breast center.
   *
   * Layout: [LY+, LY-, LX+, LX-, LZ+, LZ-, RY+, RY-, RX+, RX-, RZ+, RZ-]
   */
  private buildBreastMorphTargetsIfNeeded(model = this.lastBreastCollisionModel ?? this.buildBreastCollisionModel(0, false)): void {
    if (this.breastMorphTargetsBuilt || !this.loadedRoot) {
      return;
    }

    if (!model) return;
    this.breastMorphTargetsBuilt = true;

    // Displacement magnitude at the breast center (full strength).
    const MORPH_DISPLACEMENT = 0.055;
    // Radius of influence around each breast center.
    const INFLUENCE_RADIUS = 0.14;

    this.loadedRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;

      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      if (!positionAttr) return;

      const vertexCount = positionAttr.count;
      // 12 morph targets: per side (L/R) × per axis (Y/X/Z) × direction (+/-)
      const MORPH_COUNT = 12;
      const morphArrays = Array.from({ length: MORPH_COUNT }, () => new Float32Array(vertexCount * 3));
      let hasAnyWeight = false;

      // Precompute local-space axes from bind matrix (same for all vertices on this mesh).
      const normalMatrix = new THREE.Matrix3().setFromMatrix4(object.bindMatrixInverse);
      const localUp = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
      const localRight = new THREE.Vector3(1, 0, 0).applyMatrix3(normalMatrix).normalize();
      const localForward = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();

      const worldPos = new THREE.Vector3();
      for (let i = 0; i < vertexCount; i++) {
        getSkinnedVertexWorldPosition(object, i, worldPos);

        for (const [sideIndex, side] of model.sides.entries()) {
          const dist = worldPos.distanceTo(side.restCenter);
          if (dist >= INFLUENCE_RADIUS) continue;

          // Smooth falloff: 1 at center, 0 at edge.
          const t = dist / INFLUENCE_RADIUS;
          const weight = (1 - t * t) * (1 - t * t); // quartic falloff

          if (weight < 0.001) continue;
          hasAnyWeight = true;

          const disp = MORPH_DISPLACEMENT * weight;
          const baseOffset = sideIndex * 6; // 0..5 for left, 6..11 for right
          const idx = i * 3;

          // Y+ (up)
          morphArrays[baseOffset]![idx] += localUp.x * disp;
          morphArrays[baseOffset]![idx + 1] += localUp.y * disp;
          morphArrays[baseOffset]![idx + 2] += localUp.z * disp;
          // Y- (down)
          morphArrays[baseOffset + 1]![idx] -= localUp.x * disp;
          morphArrays[baseOffset + 1]![idx + 1] -= localUp.y * disp;
          morphArrays[baseOffset + 1]![idx + 2] -= localUp.z * disp;
          // X+ (right)
          morphArrays[baseOffset + 2]![idx] += localRight.x * disp;
          morphArrays[baseOffset + 2]![idx + 1] += localRight.y * disp;
          morphArrays[baseOffset + 2]![idx + 2] += localRight.z * disp;
          // X- (left)
          morphArrays[baseOffset + 3]![idx] -= localRight.x * disp;
          morphArrays[baseOffset + 3]![idx + 1] -= localRight.y * disp;
          morphArrays[baseOffset + 3]![idx + 2] -= localRight.z * disp;
          // Z+ (forward)
          morphArrays[baseOffset + 4]![idx] += localForward.x * disp;
          morphArrays[baseOffset + 4]![idx + 1] += localForward.y * disp;
          morphArrays[baseOffset + 4]![idx + 2] += localForward.z * disp;
          // Z- (back)
          morphArrays[baseOffset + 5]![idx] -= localForward.x * disp;
          morphArrays[baseOffset + 5]![idx + 1] -= localForward.y * disp;
          morphArrays[baseOffset + 5]![idx + 2] -= localForward.z * disp;
        }
      }

      if (!hasAnyWeight) return;

      // Attach morph targets to geometry.
      geometry.morphAttributes.position = morphArrays.map((array) => {
        const attr = new THREE.Float32BufferAttribute(array, 3);
        attr.name = 'breastMorph';
        return attr;
      });
      geometry.morphTargetsRelative = true;

      // Enable morph targets on the mesh.
      object.morphTargetInfluences = new Array(MORPH_COUNT).fill(0);
      object.updateMorphTargets();

      this.breastMorphMeshes.push(object);
    });
  }

  /**
   * Map breast physics offsets to morph target influences.
   * Positive offsets drive the + target, negative offsets drive the - target.
   * All influences stay >= 0 to avoid renderer clamping.
   */
  private syncBreastMorphInfluences(model = this.lastBreastCollisionModel ?? this.buildBreastCollisionModel(0, false)): void {
    if (this.breastMorphMeshes.length === 0) return;

    const influences = model ? breastMorphInfluencesForModel(model) : new Array(12).fill(0);

    for (const mesh of this.breastMorphMeshes) {
      const inf = mesh.morphTargetInfluences;
      if (!inf || inf.length < 12) continue;
      for (let index = 0; index < 12; index++) {
        inf[index] = influences[index] ?? 0;
      }
    }
  }

  private applyButtDeformation(model: ButtCollisionModel): void {
    this.buildButtMorphTargetsIfNeeded(model);
    this.syncButtMorphInfluences(model);
    this.buildButtShapeMorphTargetsIfNeeded(model);
    this.syncButtShapeMorphInfluences();
  }

  private buildButtMorphTargetsIfNeeded(model = this.lastButtCollisionModel ?? this.buildButtCollisionModel(0, false)): void {
    if (this.buttMorphTargetsBuilt || !this.loadedRoot || !model) {
      return;
    }
    this.buttMorphTargetsBuilt = true;

    const morphDisplacement = 0.045;
    const influenceRadius = 0.13;
    const morphCount = 12;

    this.loadedRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;

      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      if (!positionAttr) return;

      const vertexCount = positionAttr.count;
      const morphArrays = Array.from({ length: morphCount }, () => new Float32Array(vertexCount * 3));
      let hasAnyWeight = false;

      const normalMatrix = new THREE.Matrix3().setFromMatrix4(object.bindMatrixInverse);
      const localUp = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
      const localRight = new THREE.Vector3(1, 0, 0).applyMatrix3(normalMatrix).normalize();
      const localForward = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();

      const worldPos = new THREE.Vector3();
      for (let index = 0; index < vertexCount; index++) {
        getSkinnedVertexWorldPosition(object, index, worldPos);
        for (const [sideIndex, side] of model.sides.entries()) {
          const dist = worldPos.distanceTo(side.restCenter);
          if (dist >= influenceRadius) continue;
          const t = dist / influenceRadius;
          const weight = (1 - t * t) * (1 - t * t);
          if (weight < 0.001) continue;

          hasAnyWeight = true;
          const displacement = morphDisplacement * weight;
          const baseOffset = sideIndex * 6;
          const attrIndex = index * 3;

          morphArrays[baseOffset]![attrIndex] += localUp.x * displacement;
          morphArrays[baseOffset]![attrIndex + 1] += localUp.y * displacement;
          morphArrays[baseOffset]![attrIndex + 2] += localUp.z * displacement;
          morphArrays[baseOffset + 1]![attrIndex] -= localUp.x * displacement;
          morphArrays[baseOffset + 1]![attrIndex + 1] -= localUp.y * displacement;
          morphArrays[baseOffset + 1]![attrIndex + 2] -= localUp.z * displacement;
          morphArrays[baseOffset + 2]![attrIndex] += localRight.x * displacement;
          morphArrays[baseOffset + 2]![attrIndex + 1] += localRight.y * displacement;
          morphArrays[baseOffset + 2]![attrIndex + 2] += localRight.z * displacement;
          morphArrays[baseOffset + 3]![attrIndex] -= localRight.x * displacement;
          morphArrays[baseOffset + 3]![attrIndex + 1] -= localRight.y * displacement;
          morphArrays[baseOffset + 3]![attrIndex + 2] -= localRight.z * displacement;
          morphArrays[baseOffset + 4]![attrIndex] += localForward.x * displacement;
          morphArrays[baseOffset + 4]![attrIndex + 1] += localForward.y * displacement;
          morphArrays[baseOffset + 4]![attrIndex + 2] += localForward.z * displacement;
          morphArrays[baseOffset + 5]![attrIndex] -= localForward.x * displacement;
          morphArrays[baseOffset + 5]![attrIndex + 1] -= localForward.y * displacement;
          morphArrays[baseOffset + 5]![attrIndex + 2] -= localForward.z * displacement;
        }
      }

      if (!hasAnyWeight) return;

      const existing = geometry.morphAttributes.position ?? [];
      const offset = object.morphTargetInfluences?.length ?? existing.length;
      geometry.morphAttributes.position = [
        ...existing,
        ...morphArrays.map((array) => {
          const attr = new THREE.Float32BufferAttribute(array, 3);
          attr.name = 'buttJiggleMorph';
          return attr;
        }),
      ];
      geometry.morphTargetsRelative = true;

      const newInfluences = new Array(offset + morphCount).fill(0);
      if (object.morphTargetInfluences) {
        for (let index = 0; index < offset; index++) {
          newInfluences[index] = object.morphTargetInfluences[index] ?? 0;
        }
      }
      object.morphTargetInfluences = newInfluences;
      object.updateMorphTargets();

      this.buttJiggleMorphOffsets.set(object, offset);
      this.buttMorphMeshes.push(object);
    });
  }

  private syncButtMorphInfluences(model = this.lastButtCollisionModel ?? this.buildButtCollisionModel(0, false)): void {
    if (this.buttMorphMeshes.length === 0 || !model) return;

    const influences = buttMorphInfluencesForModel(model);
    for (const mesh of this.buttMorphMeshes) {
      const offset = this.buttJiggleMorphOffsets.get(mesh);
      const meshInfluences = mesh.morphTargetInfluences;
      if (offset === undefined || !meshInfluences || meshInfluences.length < offset + 12) continue;
      for (let index = 0; index < 12; index++) {
        meshInfluences[offset + index] = influences[index] ?? 0;
      }
    }
  }

  private buildButtShapeMorphTargetsIfNeeded(model = this.lastButtCollisionModel ?? this.buildButtCollisionModel(0, false)): void {
    if (this.buttShapeMorphTargetsBuilt || !this.loadedRoot || !model) {
      return;
    }
    this.buttShapeMorphTargetsBuilt = true;

    const hips = this.findBoneWorldPosition(['hips']);
    const spine = this.findBoneWorldPosition(['spine']);
    const leftUpLeg = this.findBoneWorldPosition(['leftupleg']);
    const rightUpLeg = this.findBoneWorldPosition(['rightupleg']);
    const zones: Array<{ center: THREE.Vector3; radius: number; strength: number; side: 'left' | 'right' | 'center' }> = [
      { center: model.sides[0]!.restCenter, radius: 0.16, strength: 1.0, side: 'left' },
      { center: model.sides[1]!.restCenter, radius: 0.16, strength: 1.0, side: 'right' },
    ];
    if (leftUpLeg) {
      zones.push({ center: leftUpLeg.clone().addScaledVector(model.frontAxis, -0.04), radius: 0.14, strength: 0.5, side: 'left' });
    }
    if (rightUpLeg) {
      zones.push({ center: rightUpLeg.clone().addScaledVector(model.frontAxis, -0.04), radius: 0.14, strength: 0.5, side: 'right' });
    }
    if (hips && spine) {
      zones.push({ center: hips.clone().lerp(spine, 0.3).addScaledVector(model.frontAxis, -0.06), radius: 0.14, strength: 0.35, side: 'center' });
    }

    const shapeDisplacement = 0.08;
    const morphCount = 4;

    this.loadedRoot.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;

      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      if (!positionAttr) return;

      const vertexCount = positionAttr.count;
      const morphArrays = Array.from({ length: morphCount }, () => new Float32Array(vertexCount * 3));
      let hasAnyWeight = false;

      const normalMatrix = new THREE.Matrix3().setFromMatrix4(object.bindMatrixInverse);
      const localUp = new THREE.Vector3(0, 1, 0).applyMatrix3(normalMatrix).normalize();
      const localRight = new THREE.Vector3(1, 0, 0).applyMatrix3(normalMatrix).normalize();
      const localForward = new THREE.Vector3(0, 0, 1).applyMatrix3(normalMatrix).normalize();

      const worldPos = new THREE.Vector3();
      for (let index = 0; index < vertexCount; index++) {
        getSkinnedVertexWorldPosition(object, index, worldPos);

        let bestWeight = 0;
        let bestSide: 'left' | 'right' | 'center' = 'center';
        let bestCenter: THREE.Vector3 | null = null;
        for (const zone of zones) {
          const dist = worldPos.distanceTo(zone.center);
          if (dist >= zone.radius) continue;
          const t = dist / zone.radius;
          const weight = (1 - t * t) * (1 - t * t) * zone.strength;
          if (weight > bestWeight) {
            bestWeight = weight;
            bestSide = zone.side;
            bestCenter = zone.center;
          }
        }
        if (bestWeight < 0.001 || !bestCenter) continue;

        hasAnyWeight = true;
        const displacement = shapeDisplacement * bestWeight;
        const attrIndex = index * 3;
        const radial = worldPos.clone().sub(bestCenter);
        if (radial.lengthSq() > 0.00001) radial.normalize();
        else radial.set(0, 0, -1);
        const localRadial = radial.applyMatrix3(normalMatrix).normalize();

        morphArrays[0]![attrIndex] += localRadial.x * displacement;
        morphArrays[0]![attrIndex + 1] += localRadial.y * displacement;
        morphArrays[0]![attrIndex + 2] += localRadial.z * displacement;
        morphArrays[1]![attrIndex] += localUp.x * displacement * 0.6;
        morphArrays[1]![attrIndex + 1] += localUp.y * displacement * 0.6;
        morphArrays[1]![attrIndex + 2] += localUp.z * displacement * 0.6;
        morphArrays[2]![attrIndex] -= localForward.x * displacement;
        morphArrays[2]![attrIndex + 1] -= localForward.y * displacement;
        morphArrays[2]![attrIndex + 2] -= localForward.z * displacement;
        const sideSign = bestSide === 'left' ? -1 : bestSide === 'right' ? 1 : 0;
        morphArrays[3]![attrIndex] += localRight.x * displacement * 0.5 * sideSign;
        morphArrays[3]![attrIndex + 1] += localRight.y * displacement * 0.5 * sideSign;
        morphArrays[3]![attrIndex + 2] += localRight.z * displacement * 0.5 * sideSign;
      }

      if (!hasAnyWeight) return;

      const existing = geometry.morphAttributes.position ?? [];
      const offset = object.morphTargetInfluences?.length ?? existing.length;
      geometry.morphAttributes.position = [
        ...existing,
        ...morphArrays.map((array) => {
          const attr = new THREE.Float32BufferAttribute(array, 3);
          attr.name = 'buttShapeMorph';
          return attr;
        }),
      ];
      geometry.morphTargetsRelative = true;

      const newInfluences = new Array(offset + morphCount).fill(0);
      if (object.morphTargetInfluences) {
        for (let index = 0; index < offset; index++) {
          newInfluences[index] = object.morphTargetInfluences[index] ?? 0;
        }
      }
      object.morphTargetInfluences = newInfluences;
      object.updateMorphTargets();

      this.buttShapeMorphOffsets.set(object, offset);
      this.buttShapeMorphMeshes.push(object);
    });
  }

  private syncButtShapeMorphInfluences(): void {
    for (const mesh of this.buttShapeMorphMeshes) {
      const offset = this.buttShapeMorphOffsets.get(mesh);
      const influences = mesh.morphTargetInfluences;
      if (offset === undefined || !influences || influences.length < offset + 4) continue;
      influences[offset] = this.buttShape.volume;
      influences[offset + 1] = this.buttShape.lift;
      influences[offset + 2] = this.buttShape.projection;
      influences[offset + 3] = this.buttShape.width;
    }
  }

  private pushBoneCapsule(
    name: string,
    parentName: string,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
  ): void {
    this.boneCapsules.push({
      id: this.boneCapsules.length,
      name,
      parentName,
      start,
      end,
      radius: withClothCollisionSkin(radius),
      length: start.distanceTo(end),
    });
  }

  private buildCoverageRegionAxes(): CoverageRegionAxes | null {
    const chest = this.findBoneWorldPosition(['spine2', 'spine1', 'spine']);
    const hips = this.findBoneWorldPosition(['hips']);
    const leftShoulder = this.findBoneWorldPosition(['leftshoulder', 'leftarm']);
    const rightShoulder = this.findBoneWorldPosition(['rightshoulder', 'rightarm']);
    if (!chest || !hips || !leftShoulder || !rightShoulder) {
      return null;
    }

    const xAxis = rightShoulder.clone().sub(leftShoulder);
    xAxis.y = 0;
    if (xAxis.lengthSq() < 0.0001) {
      xAxis.set(1, 0, 0);
    }
    xAxis.normalize();
    const frontAxis = UP.clone().cross(xAxis);
    if (frontAxis.lengthSq() < 0.0001) {
      frontAxis.set(0, 0, 1);
    }
    frontAxis.normalize();
    return {
      chest,
      hips,
      leftHip: this.findBoneWorldPosition(['leftupleg']),
      rightHip: this.findBoneWorldPosition(['rightupleg']),
      leftElbow: this.findBoneWorldPosition(['leftforearm']),
      rightElbow: this.findBoneWorldPosition(['rightforearm']),
      leftKnee: this.findBoneWorldPosition(['leftleg']),
      rightKnee: this.findBoneWorldPosition(['rightleg']),
      leftFoot: this.findBoneWorldPosition(['leftfoot']),
      rightFoot: this.findBoneWorldPosition(['rightfoot']),
      leftHand: this.findBoneWorldPosition(['lefthand']),
      rightHand: this.findBoneWorldPosition(['righthand']),
      xAxis,
      frontAxis,
    };
  }

  private buildBoneSdfDebugVisuals(): void {
    this.sdfDebugGroup.clear();
    this.boneSdfMeshes.clear();
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0x5cc8ff,
      emissive: new THREE.Color(0x1c86ff),
      emissiveIntensity: 0.25,
      roughness: 0.45,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
    });

    for (const capsule of this.boneCapsules) {
      const group = new THREE.Group();
      group.name = `xray-bone-sdf-${capsule.name}`;
      group.add(
        new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1), material),
        new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material),
        new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material),
      );
      this.sdfDebugGroup.add(group);
      this.boneSdfMeshes.set(capsule.id, group);
    }
    this.syncBoneSdfDebugVisuals();
  }

  private syncBoneSdfDebugVisuals(): void {
    for (const capsule of this.boneCapsules) {
      const group = this.boneSdfMeshes.get(capsule.id);
      if (group) {
        syncCapsuleGroup(group, capsule);
      }
    }
  }

  private findBoneWorldPosition(keys: readonly string[]): THREE.Vector3 | null {
    const bone = this.findBone(keys);
    if (!bone) {
      return null;
    }
    const position = bone.getWorldPosition(new THREE.Vector3());
    return isFiniteVector(position) ? position : null;
  }

  private findBone(keys: readonly string[]): THREE.Bone | null {
    for (const key of keys) {
      const normalizedKey = normalizeBoneName(key);
      const exact = this.bones.find((bone) => normalizeBoneName(bone.name).endsWith(normalizedKey));
      if (exact) {
        return exact;
      }
      const partial = this.bones.find((bone) => normalizeBoneName(bone.name).includes(normalizedKey));
      if (partial) {
        return partial;
      }
    }
    return null;
  }
}

export class AnimatedCharacterPreview {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly statusEl: HTMLElement;
  private readonly backendEl: HTMLElement;
  private readonly particlesEl: HTMLElement;
  private readonly timer = new THREE.Timer();
  private readonly assetUrl: string;
  private readonly animationUrl: string;
  private readonly characterRoot = new THREE.Group();
  private readonly sdfDebugGroup = new THREE.Group();
  private readonly shirtGroup = new THREE.Group();
  private readonly boneSdfMeshes = new Map<number, THREE.Object3D>();
  private readonly bones: THREE.Bone[] = [];
  private readonly boneCapsules: BoneSdfCapsule[] = [];
  private shirtAssembly: ClothAssembly | null = null;
  private shirtDimensions: {
    bodyWidth: number;
    torsoHeight: number;
    sleeveLength: number;
    sleeveOpening: number;
  } | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private activeClipName: string | null = null;
  private loadedRoot: THREE.Object3D | null = null;
  private animationRoot: THREE.Object3D | null = null;
  private animationClipCount = 0;
  private retargetedTrackCount = 0;
  private meshCount = 0;
  private skinnedMeshCount = 0;
  private frameCount = 0;
  private boundsHeight = 0;
  private boundsWidth = 0;
  private animationSpeed = 1;

  constructor(
    container: HTMLElement,
    statusEl: HTMLElement,
    backendEl: HTMLElement,
    particlesEl: HTMLElement,
    assetUrl = VISIBLE_CHARACTER_MODEL_URL,
    animationUrl = MIXAMO_DANCING_TWERK_URL,
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.assetUrl = assetUrl;
    this.animationUrl = animationUrl;

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b26);

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 60);
    this.camera.position.set(0, 1.05, 3.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 8;
    this.controls.update();

    this.scene.add(
      new THREE.AmbientLight(0xffffff, 0.45),
      new THREE.HemisphereLight(0xdde8ff, 0x263044, 1.8),
      directionalLight(0xfff0de, 3.4, 4, 6, 3),
      directionalLight(0xbfd5ff, 1.4, -4, 2, 4),
      directionalLight(0xffffff, 1.1, -3, 5, -3),
    );

    const grid = new THREE.GridHelper(2.5, 20, 0x52617a, 0x2a3448);
    grid.position.y = 0;
    this.scene.add(grid);

    this.characterRoot.name = 'animated-mixamo-character-root';
    this.scene.add(this.characterRoot);

    this.sdfDebugGroup.name = 'animated-bone-sdf-xray';
    this.sdfDebugGroup.visible = true;
    this.scene.add(this.sdfDebugGroup);

    this.shirtGroup.name = 'real-stitched-tshirt-on-character';
    this.shirtGroup.visible = true;
    this.scene.add(this.shirtGroup);
  }

  async init(): Promise<void> {
    await this.renderer.init();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    await this.loadCharacter();
    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name} (character preview)`;
    await this.renderer.compileAsync(this.scene, this.camera);

    this.statusEl.dataset.state = 'running';
    this.statusEl.textContent = 'running (animated character)';
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  update(): void {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 1 / 30);
    this.controls.update();
    this.mixer?.update(delta * this.animationSpeed);
    this.updateBoneSdfs();
    this.syncBoneSdfDebugVisuals();
    this.syncTShirtToCharacter();
    this.frameCount += 1;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  setAnimationSpeed(speed: number): void {
    this.animationSpeed = THREE.MathUtils.clamp(speed, 0, 2);
  }

  setXrayVisible(visible: boolean): void {
    this.sdfDebugGroup.visible = visible;
  }

  setShirtVisible(visible: boolean): void {
    this.shirtGroup.visible = visible;
  }

  getStats(): CharacterStats {
    const box = this.loadedRoot ? new THREE.Box3().setFromObject(this.loadedRoot) : new THREE.Box3();
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    return {
      loaded: this.loadedRoot !== null,
      assetUrl: this.assetUrl,
      animationUrl: this.animationUrl,
      meshCount: this.meshCount,
      skinnedMeshCount: this.skinnedMeshCount,
      boneCount: this.bones.length,
      animationClipCount: this.animationClipCount,
      retargetedTrackCount: this.retargetedTrackCount,
      activeClipName: this.activeClipName,
      mixerTime: this.mixer?.time ?? 0,
      frameCount: this.frameCount,
      sdfCapsuleCount: this.boneCapsules.length,
      renderProxyCount: this.meshCount + this.boneCapsules.length,
      xrayVisible: this.sdfDebugGroup.visible,
      boundsHeight: size.y || this.boundsHeight,
      boundsWidth: Math.max(size.x, size.z) || this.boundsWidth,
      boneNames: this.bones.slice(0, 48).map((bone) => bone.name),
    };
  }

  getBoneSdfSummary(): Array<{
    id: number;
    name: string;
    parentName: string;
    radius: number;
    length: number;
    start: [number, number, number];
    end: [number, number, number];
  }> {
    return this.boneCapsules.map((capsule) => ({
      id: capsule.id,
      name: capsule.name,
      parentName: capsule.parentName,
      radius: capsule.radius,
      length: capsule.length,
      start: vectorTuple(capsule.start),
      end: vectorTuple(capsule.end),
    }));
  }

  probeBoneSdfCollision(): BoneSdfCollisionProbe {
    this.updateBoneSdfs();
    const anchors = this.getCharacterAnchors();
    const center = anchors.chest ?? new THREE.Vector3(0, 0.9, 0);
    const clothSamples: THREE.Vector3[] = [];
    const width = Math.max(0.3, this.estimateShoulderWidth(anchors) * 0.9);
    const height = Math.max(0.35, this.estimateTorsoHeight(anchors) * 0.5);

    for (let x = 0; x < 9; x++) {
      for (let y = 0; y < 9; y++) {
        clothSamples.push(new THREE.Vector3(
          center.x + (x / 8 - 0.5) * width,
          center.y + (y / 8 - 0.5) * height,
          center.z,
        ));
      }
    }

    let penetrationsBefore = 0;
    let penetrationsAfter = 0;
    let totalPush = 0;
    let maxPushDistance = 0;
    const hitBoneNames = new Set<string>();

    for (const sample of clothSamples) {
      const before = closestCapsuleSignedDistance(sample, this.boneCapsules);
      if (before.distance < 0) {
        penetrationsBefore += 1;
        sample.addScaledVector(before.normal, -before.distance + 0.002);
        totalPush += -before.distance;
        maxPushDistance = Math.max(maxPushDistance, -before.distance);
        hitBoneNames.add(before.name);
      }
      const after = closestCapsuleSignedDistance(sample, this.boneCapsules);
      if (after.distance < -0.0005) {
        penetrationsAfter += 1;
      }
    }

    return {
      sampleCount: clothSamples.length,
      sdfCount: this.boneCapsules.length,
      penetrationsBefore,
      penetrationsAfter,
      maxPushDistance,
      averagePushDistance: totalPush / Math.max(1, penetrationsBefore),
      hitBoneNames: [...hitBoneNames],
    };
  }

  getCharacterAnchors(): CharacterAnchors {
    return {
      hips: this.findBoneWorldPosition(['hips']),
      chest: this.findBoneWorldPosition(['spine2', 'spine1', 'spine']),
      neck: this.findBoneWorldPosition(['neck']),
      leftShoulder: this.findBoneWorldPosition(['leftshoulder', 'leftarm']),
      rightShoulder: this.findBoneWorldPosition(['rightshoulder', 'rightarm']),
      leftArm: this.findBoneWorldPosition(['leftforearm', 'leftarm']),
      rightArm: this.findBoneWorldPosition(['rightforearm', 'rightarm']),
    };
  }

  getShirtAnchorReport(): ShirtAnchorReport {
    const anchors = this.getCharacterAnchors();
    const dimensions = this.shirtDimensions ?? this.estimateShirtDimensions(anchors);
    const namedAnchors = Object.entries(anchors).filter(([, value]) => value !== null).map(([name]) => name);
    const neckTarget = anchors.neck ?? anchors.chest ?? new THREE.Vector3();
    const shirtNeck = new THREE.Vector3(
      this.shirtGroup.position.x,
      this.shirtGroup.position.y + dimensions.torsoHeight * 0.9,
      this.shirtGroup.position.z,
    );
    return {
      hasRequiredAnchors: Boolean(anchors.hips && anchors.chest && anchors.neck && anchors.leftArm && anchors.rightArm),
      visible: this.shirtGroup.visible && this.shirtAssembly !== null,
      bodyWidth: dimensions.bodyWidth,
      torsoHeight: dimensions.torsoHeight,
      sleeveLength: dimensions.sleeveLength,
      sleeveOpening: dimensions.sleeveOpening,
      vertexCount: this.shirtAssembly?.vertices.length ?? 0,
      faceCount: this.shirtAssembly?.faces.length ?? 0,
      stitchEdgeCount: this.shirtAssembly?.stitchEdges.length ?? 0,
      center: vectorTuple(this.shirtGroup.position),
      neckGap: shirtNeck.distanceTo(neckTarget),
      anchorNames: namedAnchors,
    };
  }

  private async loadCharacter(): Promise<void> {
    this.statusEl.dataset.state = 'loading';
    this.statusEl.textContent = 'loading animated character';
    const loader = new FBXLoader();
    const root = await this.loadFbxQuietly(loader, this.assetUrl);
    root.name = 'meshy-visible-character';
    this.loadedRoot = root;
    this.collectCharacterObjects(root);
    this.normalizeCharacter(root);
    this.characterRoot.add(root);

    const animationRoot = await this.loadFbxQuietly(loader, this.animationUrl);
    animationRoot.name = 'mixamo-dancing-twerk-animation-source';
    this.animationRoot = animationRoot;
    this.animationClipCount = animationRoot.animations.length;

    if (animationRoot.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(root);
      const clip = this.retargetClipTracks(animationRoot.animations[0]!, animationRoot);
      this.activeClipName = clip.name || 'Dancing Twerk';
      this.mixer.clipAction(clip, root).reset().play();
      this.mixer.update(0.001);
    }

    root.updateMatrixWorld(true);
    this.updateBoneSdfs();
    this.buildBoneSdfDebugVisuals();
    this.buildCharacterTShirt();
    this.syncTShirtToCharacter();
    this.particlesEl.textContent =
      `character: ${this.meshCount} mesh(es), ${this.bones.length} bones, ${this.shirtAssembly?.vertices.length ?? 0} shirt verts`;
  }

  private async loadFbxQuietly(loader: FBXLoader, url: string): Promise<THREE.Group> {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const message = args.map(String).join(' ');
      if (message.includes('THREE.FBXLoader: Vertex has more than 4 skinning weights')) {
        return;
      }
      originalWarn(...args);
    };

    try {
      return await loader.loadAsync(url);
    } finally {
      console.warn = originalWarn;
    }
  }

  private retargetClipTracks(sourceClip: THREE.AnimationClip, animationRoot: THREE.Object3D): THREE.AnimationClip {
    const targetBoneNamesByKey = new Map<string, string>();
    for (const bone of this.bones) {
      targetBoneNamesByKey.set(normalizeBoneName(bone.name), bone.name);
    }

    const sourceBoneNamesByKey = new Map<string, string>();
    animationRoot.traverse((object) => {
      if (object instanceof THREE.Bone) {
        sourceBoneNamesByKey.set(normalizeBoneName(object.name), object.name);
      }
    });

    const tracks = sourceClip.tracks.flatMap((track) => {
      const split = splitTrackName(track.name);
      if (!split) {
        return [];
      }
      if (split.propertyPath !== 'quaternion') {
        return [];
      }
      const sourceKey = normalizeBoneName(split.targetName);
      const targetName = targetBoneNamesByKey.get(sourceKey);
      if (!targetName) {
        return [];
      }
      const cloned = track.clone();
      cloned.name = `${targetName}.${split.propertyPath}`;
      return [cloned];
    });

    this.retargetedTrackCount = tracks.length;
    if (tracks.length === 0) {
      const targetKeys = new Set(targetBoneNamesByKey.keys());
      const sourceKeys = new Set(sourceBoneNamesByKey.keys());
      const sharedKeys = [...targetKeys].filter((key) => sourceKeys.has(key));
      console.warn(`No direct animation tracks matched target rig; shared bones: ${sharedKeys.length}`);
    }

    return new THREE.AnimationClip(sourceClip.name || 'Dancing Twerk retargeted', sourceClip.duration, tracks);
  }

  private normalizeCharacter(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = this.measureCharacterBounds(root);
    const size = box.getSize(new THREE.Vector3());
    const targetHeight = 1.75;
    const scale = size.y > 0 ? targetHeight / size.y : 0.01;
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);

    const scaledBox = this.measureCharacterBounds(root);
    const center = scaledBox.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(center.x, scaledBox.min.y, center.z));
    root.updateMatrixWorld(true);

    const finalSize = this.measureCharacterBounds(root).getSize(new THREE.Vector3());
    this.boundsHeight = finalSize.y;
    this.boundsWidth = Math.max(finalSize.x, finalSize.z);
  }

  private measureCharacterBounds(root: THREE.Object3D): THREE.Box3 {
    const meshBounds = new THREE.Box3().setFromObject(root);
    if (!meshBounds.isEmpty()) {
      return meshBounds;
    }

    const boneBounds = new THREE.Box3();
    for (const bone of this.bones) {
      boneBounds.expandByPoint(bone.getWorldPosition(new THREE.Vector3()));
    }
    return boneBounds;
  }

  private collectCharacterObjects(root: THREE.Object3D): void {
    this.meshCount = 0;
    this.skinnedMeshCount = 0;
    this.bones.length = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.meshCount += 1;
        object.castShadow = true;
        object.receiveShadow = true;
      }
      if (object instanceof THREE.SkinnedMesh) {
        this.skinnedMeshCount += 1;
      }
      if (object instanceof THREE.Bone) {
        this.bones.push(object);
      }
    });
  }

  private updateBoneSdfs(): void {
    if (!this.loadedRoot) {
      return;
    }
    this.loadedRoot.updateMatrixWorld(true);
    this.boneCapsules.length = 0;
    for (const bone of this.bones) {
      const parent = bone.parent;
      if (!(parent instanceof THREE.Bone)) {
        continue;
      }
      const start = parent.getWorldPosition(new THREE.Vector3());
      const end = bone.getWorldPosition(new THREE.Vector3());
      const length = start.distanceTo(end);
      if (length < 0.01) {
        continue;
      }
      this.boneCapsules.push({
        id: this.boneCapsules.length,
        name: bone.name,
        parentName: parent.name,
        start,
        end,
        radius: radiusForBone(bone.name, length),
        length,
      });
    }
  }

  private buildBoneSdfDebugVisuals(): void {
    this.sdfDebugGroup.clear();
    this.boneSdfMeshes.clear();
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0x5cc8ff,
      emissive: new THREE.Color(0x1c86ff),
      emissiveIntensity: 0.25,
      roughness: 0.45,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
    });

    for (const capsule of this.boneCapsules) {
      const group = new THREE.Group();
      group.name = `xray-bone-sdf-${capsule.name}`;
      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1), material);
      cylinder.name = `${group.name}-capsule`;
      const startSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
      startSphere.name = `${group.name}-start`;
      const endSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
      endSphere.name = `${group.name}-end`;
      group.add(cylinder, startSphere, endSphere);
      this.sdfDebugGroup.add(group);
      this.boneSdfMeshes.set(capsule.id, group);
    }
    this.syncBoneSdfDebugVisuals();
  }

  private syncBoneSdfDebugVisuals(): void {
    for (const capsule of this.boneCapsules) {
      let group = this.boneSdfMeshes.get(capsule.id);
      if (!group) {
        this.buildBoneSdfDebugVisuals();
        group = this.boneSdfMeshes.get(capsule.id);
      }
      if (!group) {
        continue;
      }
      syncCapsuleGroup(group, capsule);
    }
  }

  private buildCharacterTShirt(): void {
    const anchors = this.getCharacterAnchors();
    const dimensions = this.estimateShirtDimensions(anchors);
    const assembly = createTShirtAssembly({
      bodyWidth: dimensions.bodyWidth,
      torsoHeight: dimensions.torsoHeight,
      sleeveLength: dimensions.sleeveLength,
      sleeveOpening: dimensions.sleeveOpening,
      sleeveTubeRadius: dimensions.sleeveOpening * 0.35,
      depth: Math.max(0.18, dimensions.bodyWidth * 0.36),
      bodySegmentsX: 24,
      bodySegmentsY: 28,
      sleeveSegmentsX: 16,
    });

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(assembly.vertices.length * 3);
    const uvs = new Float32Array(assembly.vertices.length * 2);
    for (let i = 0; i < assembly.vertices.length; i++) {
      const vertex = assembly.vertices[i]!;
      positions[i * 3] = vertex.position[0];
      positions[i * 3 + 1] = vertex.position[1];
      positions[i * 3 + 2] = vertex.position[2];
      uvs[i * 2] = vertex.uv[0];
      uvs[i * 2 + 1] = vertex.uv[1];
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(assembly.faces.flatMap((face) => [face.vertices[0], face.vertices[1], face.vertices[2]]));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardNodeMaterial({
      color: 0xf7f4ed,
      roughness: 0.86,
      metalness: 0.0,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'real-createTShirtAssembly-character-shirt';

    const edgeGeometry = new THREE.BufferGeometry();
    const edgePositions = new Float32Array(assembly.edges.length * 2 * 3);
    for (let i = 0; i < assembly.edges.length; i++) {
      const edge = assembly.edges[i]!;
      const a = assembly.vertices[edge.a]!.position;
      const b = assembly.vertices[edge.b]!.position;
      edgePositions[i * 6] = a[0];
      edgePositions[i * 6 + 1] = a[1];
      edgePositions[i * 6 + 2] = a[2];
      edgePositions[i * 6 + 3] = b[0];
      edgePositions[i * 6 + 4] = b[1];
      edgePositions[i * 6 + 5] = b[2];
    }
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicNodeMaterial({ color: 0x49617e, transparent: true, opacity: 0.25 }),
    );
    edgeLines.name = 'real-tshirt-stitch-and-panel-edges';

    this.shirtGroup.clear();
    this.shirtGroup.add(mesh, edgeLines);
    this.shirtAssembly = assembly;
    this.shirtDimensions = dimensions;
  }

  private syncTShirtToCharacter(): void {
    if (!this.shirtAssembly || !this.shirtDimensions) {
      return;
    }

    const anchors = this.getCharacterAnchors();
    const hips = anchors.hips ?? new THREE.Vector3(0, 0.8, 0);
    const chest = anchors.chest ?? new THREE.Vector3(0, 1.15, 0);
    const neck = anchors.neck ?? new THREE.Vector3(chest.x, chest.y + 0.25, chest.z);
    const leftShoulder = anchors.leftShoulder;
    const rightShoulder = anchors.rightShoulder;
    const torsoCenter = TMP_A.copy(hips).lerp(chest, 0.62);
    const shoulderCenter = leftShoulder && rightShoulder
      ? TMP_B.copy(leftShoulder).add(rightShoulder).multiplyScalar(0.5)
      : chest;
    const shirtCenter = TMP_C.copy(torsoCenter).lerp(shoulderCenter, 0.35);

    this.shirtGroup.position.set(
      shirtCenter.x,
      neck.y - this.shirtDimensions.torsoHeight * 0.88,
      shirtCenter.z,
    );

    if (leftShoulder && rightShoulder) {
      const xAxis = TMP_A.copy(rightShoulder).sub(leftShoulder);
      xAxis.y = 0;
      if (xAxis.lengthSq() > 0.0001) {
        xAxis.normalize();
        const zAxis = TMP_B.copy(xAxis).cross(UP).normalize();
        const matrix = new THREE.Matrix4().makeBasis(xAxis, UP, zAxis);
        this.shirtGroup.quaternion.setFromRotationMatrix(matrix);
      }
    }
  }

  private findBoneWorldPosition(keys: readonly string[]): THREE.Vector3 | null {
    const bone = this.findBone(keys);
    if (!bone) {
      return null;
    }
    const position = bone.getWorldPosition(new THREE.Vector3());
    return isFiniteVector(position) ? position : null;
  }

  private findBone(keys: readonly string[]): THREE.Bone | null {
    for (const key of keys) {
      const normalizedKey = normalizeBoneName(key);
      const exact = this.bones.find((bone) => normalizeBoneName(bone.name).endsWith(normalizedKey));
      if (exact) {
        return exact;
      }
      const partial = this.bones.find((bone) => normalizeBoneName(bone.name).includes(normalizedKey));
      if (partial) {
        return partial;
      }
    }
    return null;
  }

  private estimateShoulderWidth(anchors: CharacterAnchors): number {
    if (anchors.leftShoulder && anchors.rightShoulder) {
      return finiteNumber(anchors.leftShoulder.distanceTo(anchors.rightShoulder), Math.max(0.45, this.boundsWidth * 0.8));
    }
    return finiteNumber(Math.max(0.45, this.boundsWidth * 0.8), 0.5);
  }

  private estimateTorsoHeight(anchors: CharacterAnchors): number {
    if (anchors.neck && anchors.hips) {
      return finiteNumber(anchors.neck.distanceTo(anchors.hips), Math.max(0.65, this.boundsHeight * 0.48));
    }
    if (anchors.chest && anchors.hips) {
      return finiteNumber(anchors.chest.distanceTo(anchors.hips) * 1.5, Math.max(0.65, this.boundsHeight * 0.48));
    }
    return finiteNumber(Math.max(0.65, this.boundsHeight * 0.48), 0.86);
  }

  private estimateShirtDimensions(anchors: CharacterAnchors): {
    bodyWidth: number;
    torsoHeight: number;
    sleeveLength: number;
    sleeveOpening: number;
  } {
    const torsoHeight = finiteClamped(this.estimateTorsoHeight(anchors) * 1.12, 0.86, 0.72, 1.05);
    const shoulderWidth = finiteClamped(this.estimateShoulderWidth(anchors), 0.5, 0.34, 0.62);
    const bodyWidth = finiteClamped(Math.max(shoulderWidth * 1.55, torsoHeight * 0.82), 0.78, 0.62, 0.9);
    return {
      bodyWidth,
      torsoHeight,
      sleeveLength: finiteClamped(bodyWidth * 0.48, 0.38, 0.28, 0.44),
      sleeveOpening: finiteClamped(torsoHeight * 0.39, 0.34, 0.28, 0.36),
    };
  }
}

function directionalLight(color: THREE.ColorRepresentation, intensity: number, x: number, y: number, z: number): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(x, y, z);
  return light;
}

function buildBreastCapsulesForSide(
  sideName: BreastSideName,
  sign: -1 | 1,
  center: THREE.Vector3,
  xAxis: THREE.Vector3,
  frontAxis: THREE.Vector3,
  shoulderWidth: number,
): BreastCollisionPrimitive[] {
  const radius = THREE.MathUtils.clamp(shoulderWidth * 0.112, 0.06, 0.09);
  const lowerDrop = THREE.MathUtils.clamp(shoulderWidth * 0.085, 0.035, 0.06);
  const lowerForward = THREE.MathUtils.clamp(shoulderWidth * 0.04, 0.018, 0.035);
  const lowerHalfWidth = THREE.MathUtils.clamp(shoulderWidth * 0.025, 0.01, 0.02);
  const outerOffset = THREE.MathUtils.clamp(shoulderWidth * 0.055, 0.022, 0.045);
  const outerDrop = THREE.MathUtils.clamp(shoulderWidth * 0.025, 0.01, 0.02);
  const outerDown = THREE.MathUtils.clamp(shoulderWidth * 0.045, 0.018, 0.035);
  const outerUp = THREE.MathUtils.clamp(shoulderWidth * 0.035, 0.014, 0.03);
  const tipForward = THREE.MathUtils.clamp(shoulderWidth * 0.065, 0.03, 0.055);
  const tipDrop = THREE.MathUtils.clamp(shoulderWidth * 0.025, 0.01, 0.02);
  const tipHalfWidth = THREE.MathUtils.clamp(shoulderWidth * 0.018, 0.008, 0.015);

  const lowerCenter = center.clone()
    .addScaledVector(UP, -lowerDrop)
    .addScaledVector(frontAxis, lowerForward);
  const outerCenter = center.clone()
    .addScaledVector(xAxis, sign * outerOffset)
    .addScaledVector(UP, -outerDrop);
  const tipCenter = center.clone()
    .addScaledVector(frontAxis, tipForward)
    .addScaledVector(UP, -tipDrop);

  return [
    {
      name: `soft-chest-${sideName}-jiggle`,
      start: center.clone().addScaledVector(UP, -0.018),
      end: center.clone().addScaledVector(UP, 0.018),
      radius,
    },
    {
      name: `soft-chest-${sideName}-lower`,
      start: lowerCenter.clone().addScaledVector(xAxis, sign * -lowerHalfWidth),
      end: lowerCenter.clone().addScaledVector(xAxis, sign * lowerHalfWidth),
      radius: THREE.MathUtils.clamp(shoulderWidth * 0.078, 0.043, 0.065),
    },
    {
      name: `soft-chest-${sideName}-outer`,
      start: outerCenter.clone().addScaledVector(UP, -outerDown),
      end: outerCenter.clone().addScaledVector(UP, outerUp),
      radius: THREE.MathUtils.clamp(shoulderWidth * 0.055, 0.032, 0.05),
    },
    {
      name: `soft-chest-${sideName}-tip`,
      start: tipCenter.clone().addScaledVector(xAxis, sign * -tipHalfWidth),
      end: tipCenter.clone().addScaledVector(xAxis, sign * tipHalfWidth),
      radius: THREE.MathUtils.clamp(shoulderWidth * 0.04, 0.024, 0.038),
    },
  ];
}

function buildButtCapsulesForSide(
  sideName: BreastSideName,
  center: THREE.Vector3,
  frontAxis: THREE.Vector3,
  shoulderWidth: number,
  radiusScale: number,
): BreastCollisionPrimitive[] {
  const cheekRadius = THREE.MathUtils.clamp(shoulderWidth * radiusScale, 0.03, 0.14);
  const thighRadius = THREE.MathUtils.clamp(shoulderWidth * 0.08, 0.045, 0.068);
  const start = center.clone().addScaledVector(UP, -0.018);
  const end = center.clone().addScaledVector(UP, 0.018);
  const thighCenter = center
    .clone()
    .addScaledVector(frontAxis, -THREE.MathUtils.clamp(shoulderWidth * 0.035, 0.015, 0.03))
    .addScaledVector(UP, -THREE.MathUtils.clamp(shoulderWidth * 0.18, 0.075, 0.13));
  const thighStart = thighCenter.clone().addScaledVector(UP, -0.055);
  const thighEnd = thighCenter.clone().addScaledVector(UP, 0.035);

  return [
    {
      name: `soft-butt-${sideName}`,
      start,
      end,
      radius: Math.max(0.001, cheekRadius - BONE_SDF_CLOTH_SKIN),
    },
    {
      name: `soft-butt-leg-${sideName}`,
      start: thighStart,
      end: thighEnd,
      radius: Math.max(0.001, thighRadius - BONE_SDF_CLOTH_SKIN),
    },
  ];
}

function breastMorphInfluencesForModel(model: BreastCollisionModel): number[] {
  const influences = new Array(12).fill(0);
  const scale = 1.0 / 0.055;
  for (const [sideIndex, side] of model.sides.entries()) {
    const y = side.offset.y * scale;
    const x = side.offset.dot(model.xAxis) * scale;
    const z = side.offset.dot(model.frontAxis) * scale;
    const base = sideIndex * 6;
    influences[base] = y > 0 ? y : 0;
    influences[base + 1] = y < 0 ? -y : 0;
    influences[base + 2] = x > 0 ? x : 0;
    influences[base + 3] = x < 0 ? -x : 0;
    influences[base + 4] = z > 0 ? z : 0;
    influences[base + 5] = z < 0 ? -z : 0;
  }
  return influences;
}

function buttMorphInfluencesForModel(model: ButtCollisionModel): number[] {
  const influences = new Array(12).fill(0);
  const scale = 1.0 / 0.045;
  for (const [sideIndex, side] of model.sides.entries()) {
    const y = side.offset.y * scale;
    const x = side.offset.dot(model.xAxis) * scale;
    const z = side.offset.dot(model.frontAxis) * scale;
    const base = sideIndex * 6;
    influences[base] = y > 0 ? y : 0;
    influences[base + 1] = y < 0 ? -y : 0;
    influences[base + 2] = x > 0 ? x : 0;
    influences[base + 3] = x < 0 ? -x : 0;
    influences[base + 4] = z > 0 ? z : 0;
    influences[base + 5] = z < 0 ? -z : 0;
  }
  return influences;
}

function syncCapsuleGroup(group: THREE.Object3D, capsule: BoneSdfCapsule): void {
  const center = TMP_A.copy(capsule.start).add(capsule.end).multiplyScalar(0.5);
  const direction = TMP_B.copy(capsule.end).sub(capsule.start);
  const length = Math.max(direction.length(), 0.0001);
  direction.normalize();
  group.position.copy(center);
  group.quaternion.setFromUnitVectors(UP, direction);
  const cylinder = group.children[0];
  const startSphere = group.children[1];
  const endSphere = group.children[2];
  cylinder?.scale.set(capsule.radius, length, capsule.radius);
  startSphere?.position.set(0, -length * 0.5, 0);
  endSphere?.position.set(0, length * 0.5, 0);
  startSphere?.scale.setScalar(capsule.radius);
  endSphere?.scale.setScalar(capsule.radius);
}

function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function splitTrackName(trackName: string): { targetName: string; propertyPath: string } | null {
  const dot = trackName.indexOf('.');
  if (dot <= 0 || dot >= trackName.length - 1) {
    return null;
  }
  return {
    targetName: trackName.slice(0, dot),
    propertyPath: trackName.slice(dot + 1),
  };
}

function emptyBoneSdfMeshCoverageReport(): BoneSdfMeshCoverageReport {
  return {
    surfaceVertexCount: 0,
    sampledVertexCount: 0,
    nearSurfaceRatio: 0,
    outsideHoleRatio: 1,
    insideBlobRatio: 1,
    meanSignedDistance: Number.POSITIVE_INFINITY,
    meanAbsDistance: Number.POSITIVE_INFINITY,
    meanHoleDistance: Number.POSITIVE_INFINITY,
    meanOutsideMeshDepth: Number.POSITIVE_INFINITY,
    balancedError: Number.POSITIVE_INFINITY,
    p90AbsDistance: Number.POSITIVE_INFINITY,
    maxOutsideDistance: Number.POSITIVE_INFINITY,
    maxInsideDepth: Number.POSITIVE_INFINITY,
    worstOutsideCapsuleName: null,
    worstInsideCapsuleName: null,
    regions: {},
  };
}

function getSkinnedVertexWorldPosition(
  mesh: THREE.SkinnedMesh,
  vertexIndex: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const positionAttr = mesh.geometry.getAttribute('position');
  const skinIndexAttr = mesh.geometry.getAttribute('skinIndex');
  const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
  target.fromBufferAttribute(positionAttr, vertexIndex);
  if (!skinIndexAttr || !skinWeightAttr || !mesh.skeleton) {
    return mesh.localToWorld(target);
  }

  const bindPosition = target.clone().applyMatrix4(mesh.bindMatrix);
  const skinned = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();
  for (let influence = 0; influence < Math.min(4, skinWeightAttr.itemSize); influence++) {
    const weight = skinWeightAttr.getComponent(vertexIndex, influence);
    if (weight <= 0) {
      continue;
    }
    const boneIndex = Math.round(skinIndexAttr.getComponent(vertexIndex, influence));
    const bone = mesh.skeleton.bones[boneIndex];
    const inverse = mesh.skeleton.boneInverses[boneIndex];
    if (!bone || !inverse) {
      continue;
    }
    boneMatrix.multiplyMatrices(bone.matrixWorld, inverse);
    skinned.addScaledVector(bindPosition.clone().applyMatrix4(boneMatrix), weight);
  }

  target.copy(skinned.applyMatrix4(mesh.bindMatrixInverse));
  return mesh.localToWorld(target);
}

function collisionCoverageRegionForVertex(
  mesh: THREE.SkinnedMesh,
  vertexIndex: number,
  skinIndexAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  skinWeightAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
): string | null {
  if (!skinIndexAttr || !skinWeightAttr || !mesh.skeleton) {
    return 'body';
  }

  let bestRegion: string | null = null;
  let bestWeight = 0;
  for (let influence = 0; influence < Math.min(4, skinWeightAttr.itemSize); influence++) {
    const weight = skinWeightAttr.getComponent(vertexIndex, influence);
    if (weight < 0.18) {
      continue;
    }
    const boneIndex = Math.round(skinIndexAttr.getComponent(vertexIndex, influence));
    const bone = mesh.skeleton.bones[boneIndex];
    if (bone && isClothCollisionCoverageBone(bone.name) && weight > bestWeight) {
      bestWeight = weight;
      bestRegion = collisionRegionForBone(bone.name);
    }
  }
  return bestRegion;
}

function buildCapsuleBlueprintsForBone(
  bone: THREE.Bone,
  endBone: THREE.Bone,
  points: readonly THREE.Vector3[],
): BoneSdfCapsuleBlueprint[] {
  const startPosition = bone.getWorldPosition(new THREE.Vector3());
  const endPosition = endBone.getWorldPosition(new THREE.Vector3());
  const axis = endPosition.clone().sub(startPosition);
  const length = axis.length();
  if (length < 0.01) {
    return [];
  }
  axis.normalize();

  if (points.length < 6) {
    return [{
      name: bone.name,
      parentName: bone.name,
      startBone: bone,
      endBone,
      t0: 0,
      t1: 1,
      radius: radiusForBone(bone.name, length),
      fitVertexCount: points.length,
    }];
  }

  const samples = points.map((point) => {
    const offset = point.clone().sub(startPosition);
    const t = THREE.MathUtils.clamp(offset.dot(axis) / length, -0.1, 1.1);
    const axisPoint = startPosition.clone().addScaledVector(axis, t * length);
    return { t, radius: point.distanceTo(axisPoint) };
  });
  samples.sort((a, b) => a.t - b.t);

  const segmentCount = segmentCountForBone(bone.name);
  const blueprints: BoneSdfCapsuleBlueprint[] = [];
  const fallbackRadii = samples.map((sample) => sample.radius).sort((a, b) => a - b);
  const limbBone = isLimbBone(bone.name);
  const sampleOverlap = limbBone ? 0.055 : 0.12;
  const endpointPadding = limbBone ? 0.006 : 0.025;
  const radiusPercentile = limbBone ? 0.4 : 0.45;
  for (let segment = 0; segment < segmentCount; segment++) {
    const minT = segment / segmentCount;
    const maxT = (segment + 1) / segmentCount;
    const segmentSamples = samples.filter((sample) =>
      sample.t >= minT - sampleOverlap && sample.t <= maxT + sampleOverlap,
    );
    const radii = (segmentSamples.length >= 4 ? segmentSamples : samples)
      .map((sample) => sample.radius)
      .sort((a, b) => a - b);
    const t0 = THREE.MathUtils.clamp(minT - endpointPadding, 0, 1);
    const t1 = THREE.MathUtils.clamp(maxT + endpointPadding, 0, 1);
    const radius = clampFittedRadius(bone.name, percentile(radii.length > 0 ? radii : fallbackRadii, radiusPercentile));
    if (t1 - t0 < 0.035 || radius <= 0) {
      continue;
    }
    blueprints.push({
      name: segmentCount > 1 ? `${bone.name}-fit-${segment + 1}` : bone.name,
      parentName: bone.name,
      startBone: bone,
      endBone,
      t0,
      t1,
      radius,
      fitVertexCount: segmentSamples.length,
    });
  }

  if (blueprints.length > 0) {
    return blueprints;
  }

  const radii = samples.map((sample) => sample.radius).sort((a, b) => a - b);
  return [{
    name: bone.name,
    parentName: bone.name,
    startBone: bone,
    endBone,
    t0: 0,
    t1: 1,
    radius: clampFittedRadius(bone.name, percentile(radii, 0.88)),
    fitVertexCount: points.length,
  }];
}

function primaryCollisionChildBone(bone: THREE.Bone): THREE.Bone | null {
  let best: THREE.Bone | null = null;
  for (const child of bone.children) {
    if (!(child instanceof THREE.Bone)) {
      continue;
    }
    if (shouldSkipFittedBone(child.name) && !isUsefulTerminalEndpoint(bone.name, child.name)) {
      continue;
    }
    if (!best || collisionChildPriority(child.name) > collisionChildPriority(best.name)) {
      best = child;
    }
  }
  return best;
}

function isUsefulTerminalEndpoint(parentName: string, childName: string): boolean {
  const parent = normalizeBoneName(parentName);
  const child = normalizeBoneName(childName);
  if (parent.includes('hand')) {
    return (
      child.includes('thumb') ||
      child.includes('index') ||
      child.includes('middle') ||
      child.includes('ring') ||
      child.includes('pinky')
    );
  }
  if (parent.includes('foot')) {
    return child.includes('toe') || child.endsWith('end');
  }
  if (parent.includes('head')) {
    return child.includes('head') || child.endsWith('end');
  }
  return false;
}

function collisionChildPriority(name: string): number {
  const normalized = normalizeBoneName(name);
  if (
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('middle') ||
    normalized.includes('ring') ||
    normalized.includes('pinky')
  ) {
    return 3;
  }
  if (normalized.includes('toe') || normalized.endsWith('end')) {
    return 3;
  }
  if (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('hand') ||
    normalized.includes('upleg') ||
    normalized.includes('leg') ||
    normalized.includes('foot') ||
    normalized.includes('spine') ||
    normalized.includes('neck')
  ) {
    return 2;
  }
  return 1;
}

function segmentCountForBone(name: string): number {
  const normalized = normalizeBoneName(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return 3;
  }
  if (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('upperleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg'
  ) {
    return 2;
  }
  return 1;
}

function isLimbBone(name: string): boolean {
  const normalized = normalizeBoneName(name);
  return (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('upperleg') ||
    normalized.includes('upleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg'
  );
}

function clampFittedRadius(name: string, radius: number): number {
  const normalized = normalizeBoneName(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return THREE.MathUtils.clamp(radius * 0.82, 0.04, 0.12);
  }
  if (normalized.includes('upperleg') || normalized.includes('upleg')) {
    return THREE.MathUtils.clamp(radius * 0.92, 0.035, 0.095);
  }
  if (normalized === 'leftleg' || normalized === 'rightleg') {
    return THREE.MathUtils.clamp(radius * 0.92, 0.025, 0.075);
  }
  if (normalized.includes('arm') || normalized.includes('shoulder')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.022, 0.068);
  }
  if (normalized.includes('forearm') || normalized.includes('hand')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.018, 0.052);
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.035, 0.11);
  }
  return THREE.MathUtils.clamp(radius * 0.9, 0.01, 0.04);
}

function withClothCollisionSkin(radius: number): number {
  return radius + BONE_SDF_CLOTH_SKIN;
}

function shouldSkipFittedBone(name: string): boolean {
  const normalized = normalizeBoneName(name);
  return (
    normalized.endsWith('end') ||
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('toe')
  );
}

function isClothCollisionCoverageBone(name: string): boolean {
  const normalized = normalizeBoneName(name);
  if (normalized.includes('head') || normalized.endsWith('end') || normalized.includes('toe')) {
    return false;
  }
  return (
    normalized.includes('hips') ||
    normalized.includes('spine') ||
    normalized.includes('neck') ||
    normalized.includes('shoulder') ||
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('hand') ||
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('middle') ||
    normalized.includes('ring') ||
    normalized.includes('pinky') ||
    normalized.includes('upperleg') ||
    normalized.includes('upleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg' ||
    normalized.includes('foot')
  );
}

function collisionRegionForBone(name: string): string {
  const normalized = normalizeBoneName(name);
  if (
    normalized.includes('hand') ||
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('middle') ||
    normalized.includes('ring') ||
    normalized.includes('pinky')
  ) {
    return normalized.includes('left') ? 'leftHand' : normalized.includes('right') ? 'rightHand' : 'hands';
  }
  if (
    normalized.includes('shoulder') ||
    normalized.includes('arm') ||
    normalized.includes('forearm')
  ) {
    return normalized.includes('left') ? 'leftArm' : normalized.includes('right') ? 'rightArm' : 'arms';
  }
  if (
    normalized.includes('upperleg') ||
    normalized.includes('upleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg' ||
    normalized.includes('foot')
  ) {
    return normalized.includes('left') ? 'leftLeg' : normalized.includes('right') ? 'rightLeg' : 'legs';
  }
  if (normalized.includes('hips')) {
    return 'hips';
  }
  if (normalized.includes('spine') || normalized.includes('neck')) {
    return 'torso';
  }
  return 'body';
}

function refineCoverageRegion(
  coarseRegion: string,
  point: THREE.Vector3,
  axes: CoverageRegionAxes | null,
): string {
  if (!axes) {
    return coarseRegion;
  }
  if (coarseRegion === 'leftArm' && axes.leftElbow && point.distanceTo(axes.leftElbow) < 0.13) {
    return 'leftElbow';
  }
  if (coarseRegion === 'rightArm' && axes.rightElbow && point.distanceTo(axes.rightElbow) < 0.13) {
    return 'rightElbow';
  }
  if (coarseRegion === 'leftHand' && axes.leftHand && point.distanceTo(axes.leftHand) < 0.22) {
    return 'leftHand';
  }
  if (coarseRegion === 'rightHand' && axes.rightHand && point.distanceTo(axes.rightHand) < 0.22) {
    return 'rightHand';
  }
  if (coarseRegion === 'torso') {
    const fromChest = point.clone().sub(axes.chest);
    if (fromChest.dot(axes.frontAxis) > 0.035 && point.y > axes.chest.y - 0.16) {
      const sideDistance = fromChest.dot(axes.xAxis);
      if (Math.abs(sideDistance) > 0.022) {
        return sideDistance < 0 ? 'leftBreast' : 'rightBreast';
      }
      return 'chestCenterFront';
    }
  }
  if (coarseRegion === 'hips' || coarseRegion === 'leftLeg' || coarseRegion === 'rightLeg') {
    const fromHips = point.clone().sub(axes.hips);
    if (fromHips.dot(axes.frontAxis) < -0.035 && point.y > axes.hips.y - 0.2) {
      return coarseRegion === 'hips' ? 'buttBack' : 'buttLegBack';
    }
  }
  if (coarseRegion === 'leftLeg') {
    return refineLegCoverageRegion('left', point, axes.leftHip, axes.leftKnee, axes.leftFoot);
  }
  if (coarseRegion === 'rightLeg') {
    return refineLegCoverageRegion('right', point, axes.rightHip, axes.rightKnee, axes.rightFoot);
  }
  return coarseRegion;
}

function refineLegCoverageRegion(
  sideName: 'left' | 'right',
  point: THREE.Vector3,
  hip: THREE.Vector3 | null,
  knee: THREE.Vector3 | null,
  foot: THREE.Vector3 | null,
): string {
  if (knee && point.distanceTo(knee) < 0.16) {
    return `${sideName}Knee`;
  }
  if (foot && point.distanceTo(foot) < 0.18) {
    return `${sideName}Foot`;
  }
  if (hip && knee) {
    const hipToKnee = knee.clone().sub(hip);
    const lengthSq = hipToKnee.lengthSq();
    if (lengthSq > 0.000001) {
      const t = point.clone().sub(hip).dot(hipToKnee) / lengthSq;
      if (t >= -0.1 && t <= 1.12) {
        return `${sideName}Thigh`;
      }
    }
  }
  return `${sideName}Calf`;
}

function accumulateRegionCoverage(
  regions: Map<string, MutableRegionCoverage>,
  regionName: string,
  distance: number,
  surfaceBand: number,
): void {
  let region = regions.get(regionName);
  if (!region) {
    region = {
      sampledVertexCount: 0,
      nearSurfaceCount: 0,
      outsideHoleCount: 0,
      insideBlobCount: 0,
      signedDistanceSum: 0,
      absDistanceSum: 0,
      outsideMeshDepthSum: 0,
    };
    regions.set(regionName, region);
  }

  region.sampledVertexCount += 1;
  region.signedDistanceSum += distance;
  region.absDistanceSum += Math.abs(distance);
  if (Math.abs(distance) <= surfaceBand) {
    region.nearSurfaceCount += 1;
  } else if (distance > surfaceBand) {
    region.outsideHoleCount += 1;
  } else {
    region.insideBlobCount += 1;
    region.outsideMeshDepthSum += -distance;
  }
}

function finalizeRegionCoverage(
  regions: ReadonlyMap<string, MutableRegionCoverage>,
): Record<string, BoneSdfRegionCoverageReport> {
  const report: Record<string, BoneSdfRegionCoverageReport> = {};
  for (const [name, region] of regions) {
    const count = region.sampledVertexCount;
    const meanSignedDistance = count > 0 ? region.signedDistanceSum / count : 0;
    const meanAbsDistance = count > 0 ? region.absDistanceSum / count : 0;
    report[name] = {
      sampledVertexCount: count,
      nearSurfaceRatio: count > 0 ? region.nearSurfaceCount / count : 0,
      outsideHoleRatio: count > 0 ? region.outsideHoleCount / count : 0,
      insideBlobRatio: count > 0 ? region.insideBlobCount / count : 0,
      meanSignedDistance,
      meanAbsDistance,
      meanOutsideMeshDepth: count > 0 ? region.outsideMeshDepthSum / count : 0,
      balancedError: meanAbsDistance + Math.abs(meanSignedDistance),
    };
  }
  return report;
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = THREE.MathUtils.clamp((values.length - 1) * p, 0, values.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const t = index - low;
  return THREE.MathUtils.lerp(values[low]!, values[high]!, t);
}

function maxCapsulesPerBone(capsules: readonly BoneSdfCapsule[]): number {
  const counts = new Map<string, number>();
  for (const capsule of capsules) {
    const key = capsule.name.replace(/-fit-\d+$/, '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function radiusForBone(name: string, length: number): number {
  const normalized = normalizeBoneName(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return THREE.MathUtils.clamp(length * 0.42, 0.055, 0.14);
  }
  if (normalized.includes('upperleg')) {
    return THREE.MathUtils.clamp(length * 0.18, 0.045, 0.09);
  }
  if (normalized.includes('leg') || normalized.includes('foot')) {
    return THREE.MathUtils.clamp(length * 0.14, 0.035, 0.07);
  }
  if (normalized.includes('arm') || normalized.includes('shoulder')) {
    return THREE.MathUtils.clamp(length * 0.2, 0.035, 0.075);
  }
  if (normalized.includes('forearm') || normalized.includes('hand')) {
    return THREE.MathUtils.clamp(length * 0.16, 0.025, 0.055);
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return THREE.MathUtils.clamp(length * 0.35, 0.045, 0.11);
  }
  return THREE.MathUtils.clamp(length * 0.16, 0.012, 0.04);
}

function closestCapsuleSignedDistance(
  point: THREE.Vector3,
  capsules: readonly BoneSdfCapsule[],
): { distance: number; normal: THREE.Vector3; name: string } {
  let bestDistance = Infinity;
  let bestName = '';
  const bestNormal = new THREE.Vector3(0, 1, 0);

  for (const capsule of capsules) {
    const segment = TMP_A.copy(capsule.end).sub(capsule.start);
    const segmentLengthSq = Math.max(segment.lengthSq(), 0.000001);
    const t = THREE.MathUtils.clamp(TMP_B.copy(point).sub(capsule.start).dot(segment) / segmentLengthSq, 0, 1);
    const closest = TMP_C.copy(capsule.start).addScaledVector(segment, t);
    const normal = TMP_B.copy(point).sub(closest);
    const distanceToAxis = normal.length();
    const distance = distanceToAxis - capsule.radius;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = capsule.name;
      bestNormal.copy(distanceToAxis > 0.000001 ? normal.multiplyScalar(1 / distanceToAxis) : UP);
    }
  }

  return { distance: bestDistance, normal: bestNormal.clone(), name: bestName };
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteClamped(value: number, fallback: number, min: number, max: number): number {
  return THREE.MathUtils.clamp(finiteNumber(value, fallback), min, max);
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

async function loadFbxQuietly(loader: FBXLoader, url: string): Promise<THREE.Group> {
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (message.includes('THREE.FBXLoader: Vertex has more than 4 skinning weights')) {
      return;
    }
    originalWarn(...args);
  };

  try {
    return await loader.loadAsync(url);
  } finally {
    console.warn = originalWarn;
  }
}

export function createAnimatedCharacterControls(preview: AnimatedCharacterPreview): GUI {
  const gui = new GUI({ title: 'Animated Character', width: 320 });
  gui.domElement.setAttribute('data-testid', 'character-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  gui.domElement.style.right = '12px';

  const params = {
    animationSpeed: 1,
    showBoneSdfs: true,
    showTShirt: true,
  };

  gui.add(params, 'animationSpeed', 0, 2, 0.01).name('Animation speed').onChange((value: number) => {
    preview.setAnimationSpeed(value);
  });
  gui.add(params, 'showBoneSdfs').name('Show bone SDF x-ray').onChange((value: boolean) => {
    preview.setXrayVisible(value);
  });
  gui.add(params, 'showTShirt').name('Show real T-shirt').onChange((value: boolean) => {
    preview.setShirtVisible(value);
  });

  makeDraggableLilGui(gui);
  return gui;
}
