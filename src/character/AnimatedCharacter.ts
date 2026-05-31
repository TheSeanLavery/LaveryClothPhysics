import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import GUI from 'lil-gui';
import type { WebGPURenderer } from 'three/webgpu';
import {
  createTShirtAssembly,
  type ClothAssembly,
} from '../cloth/patternAssembly';
export const VISIBLE_CHARACTER_MODEL_URL = '/assets/characters/meshy/blue-haired-anime-girl.fbx';
export const MIXAMO_TPOSE_URL = '/assets/characters/mixamo/tpose.fbx';
export const MIXAMO_IDLE_URL = '/assets/characters/mixamo/idle.fbx';
export const MIXAMO_DANCING_TWERK_URL = '/assets/characters/mixamo/dancing-twerk.fbx';

export type CharacterAnimationKind = 'tpose' | 'idle' | 'dance';

const UP = new THREE.Vector3(0, 1, 0);
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();
const TMP_C = new THREE.Vector3();

export interface BoneSdfCapsule {
  readonly id: number;
  readonly name: string;
  readonly parentName: string;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly radius: number;
  readonly length: number;
}

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
  private readonly boneSdfMeshes = new Map<number, THREE.Object3D>();
  private mixer: THREE.AnimationMixer | null = null;
  private tposeAction: THREE.AnimationAction | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private danceAction: THREE.AnimationAction | null = null;
  private activeAction: THREE.AnimationAction | null = null;
  private loadedRoot: THREE.Object3D | null = null;
  private animationClipCount = 0;
  private retargetedTrackCount = 0;
  private activeClipName: string | null = null;
  private meshCount = 0;
  private skinnedMeshCount = 0;
  private frameCount = 0;
  private boundsHeight = 0;
  private boundsWidth = 0;
  private animationSpeed = 1;
  private chestJiggleOffset = 0;
  private chestJiggleVelocity = 0;
  private lastChestY: number | null = null;

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

    this.mixer = new THREE.AnimationMixer(root);

    const tposeRoot = await loadFbxQuietly(loader, this.tposeAnimationUrl);
    const idleRoot = await loadFbxQuietly(loader, this.idleAnimationUrl);
    const danceRoot = await loadFbxQuietly(loader, this.animationUrl);
    this.animationClipCount =
      tposeRoot.animations.length + idleRoot.animations.length + danceRoot.animations.length;

    if (tposeRoot.animations.length > 0) {
      const clip = this.retargetClipTracks(tposeRoot.animations[0]!, tposeRoot, 'T-Pose retargeted');
      this.tposeAction = this.mixer.clipAction(clip, root);
      this.tposeAction.reset().play();
      this.activeAction = this.tposeAction;
      this.activeClipName = 'T-Pose';
      this.mixer.update(0.001);
    }

    if (idleRoot.animations.length > 0) {
      const clip = this.retargetClipTracks(idleRoot.animations[0]!, idleRoot, 'Idle retargeted');
      this.idleAction = this.mixer.clipAction(clip, root);
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
      this.danceAction = this.mixer.clipAction(clip, root);
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
    this.updateBoneSdfs();
    this.buildBoneSdfDebugVisuals();
  }

  update(delta: number): void {
    this.mixer?.update(delta * this.animationSpeed);
    this.updateBoneSdfs(delta);
    this.syncBoneSdfDebugVisuals();
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

  private retargetClipTracks(
    sourceClip: THREE.AnimationClip,
    animationRoot: THREE.Object3D,
    fallbackName = 'Dancing Twerk retargeted',
  ): THREE.AnimationClip {
    const targetBoneNamesByKey = new Map<string, string>();
    for (const bone of this.bones) {
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

  private updateBoneSdfs(delta = 0): void {
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
    this.addSoftChestJiggleSdfs(delta);
  }

  private addSoftChestJiggleSdfs(delta: number): void {
    const chest = this.findBoneWorldPosition(['spine2', 'spine1', 'spine']);
    const neck = this.findBoneWorldPosition(['neck']);
    const leftShoulder = this.findBoneWorldPosition(['leftshoulder', 'leftarm']);
    const rightShoulder = this.findBoneWorldPosition(['rightshoulder', 'rightarm']);
    if (!chest || !neck || !leftShoulder || !rightShoulder) {
      return;
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

    if (delta > 0 && this.lastChestY !== null) {
      const chestStep = chest.y - this.lastChestY;
      const targetLag = THREE.MathUtils.clamp(-chestStep * 1.35, -0.04, 0.04);
      const stiffness = 55;
      const damping = 9;
      this.chestJiggleVelocity += (targetLag - this.chestJiggleOffset) * stiffness * delta;
      this.chestJiggleVelocity *= Math.exp(-damping * delta);
      this.chestJiggleOffset += this.chestJiggleVelocity * delta;
      this.chestJiggleOffset = THREE.MathUtils.clamp(this.chestJiggleOffset, -0.045, 0.045);
    }
    this.lastChestY = chest.y;

    const shoulderWidth = leftShoulder.distanceTo(rightShoulder);
    const sideOffset = THREE.MathUtils.clamp(shoulderWidth * 0.13, 0.045, 0.095);
    const frontOffset = THREE.MathUtils.clamp(shoulderWidth * 0.2, 0.085, 0.15);
    const base = chest.clone().lerp(neck, 0.12).addScaledVector(frontAxis, frontOffset);
    const radius = THREE.MathUtils.clamp(shoulderWidth * 0.1, 0.055, 0.082);

    for (const [sideName, sign] of [['left', -1], ['right', 1]] as const) {
      const center = base
        .clone()
        .addScaledVector(xAxis, sign * sideOffset)
        .addScaledVector(UP, this.chestJiggleOffset);
      const start = center.clone().addScaledVector(UP, -0.018);
      const end = center.clone().addScaledVector(UP, 0.018);
      this.boneCapsules.push({
        id: this.boneCapsules.length,
        name: `soft-chest-${sideName}-jiggle`,
        parentName: 'chest',
        start,
        end,
        radius,
        length: start.distanceTo(end),
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

  return gui;
}
