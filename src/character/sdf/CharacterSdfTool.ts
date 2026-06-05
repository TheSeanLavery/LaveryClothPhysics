import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import GUI from 'lil-gui';
import { makeDraggableLilGui } from '../../ui/draggableFloating.ts';
import type { WebGPURenderer } from 'three/webgpu';
import {
  buildCharacterSdfBlueprints,
  compileCharacterSdfCapsulesFromBlueprints,
  createCharacterSdfFitQualityReport,
  createCharacterSdfPresetEnvelope,
  saveCharacterSdfPreset,
  type CharacterSdfCapsule,
  type CharacterSdfCapsuleBlueprint,
  type CharacterSdfFitQualityReport,
  type CharacterSdfPresetEnvelope,
} from './index';
import { VISIBLE_CHARACTER_MODEL_URL } from '../AnimatedCharacter';

const UP = new THREE.Vector3(0, 1, 0);

export interface CharacterSdfToolStats {
  readonly loaded: boolean;
  readonly assetUrl: string;
  readonly meshCount: number;
  readonly skinnedMeshCount: number;
  readonly boneCount: number;
  readonly capsuleCount: number;
  readonly selectedCapsuleName: string | null;
  readonly selectedVertex: { meshName: string; vertexIndex: number } | null;
}

export class CharacterSdfTool {
  readonly renderer: WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 30);
  readonly controls: OrbitControls;
  readonly root = new THREE.Group();
  readonly sdfDebugGroup = new THREE.Group();
  readonly errorPointGroup = new THREE.Group();

  private readonly assetUrl: string;
  private readonly statusEl: HTMLElement;
  private readonly backendEl: HTMLElement;
  private readonly particlesEl: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly bones: THREE.Bone[] = [];
  private readonly skinnedMeshes: THREE.SkinnedMesh[] = [];
  private readonly blueprints: CharacterSdfCapsuleBlueprint[] = [];
  private readonly capsules: CharacterSdfCapsule[] = [];
  private readonly capsuleMeshes = new Map<string, THREE.Object3D>();
  private readonly capsuleNameByObject = new Map<THREE.Object3D, string>();
  private loadedRoot: THREE.Object3D | null = null;
  private meshCount = 0;
  private selectedCapsuleName: string | null = null;
  private selectedVertex: { meshName: string; vertexIndex: number } | null = null;
  private report: CharacterSdfFitQualityReport = createCharacterSdfFitQualityReport(new THREE.Group(), []);
  private preset: CharacterSdfPresetEnvelope;

  constructor(
    container: HTMLElement,
    statusEl: HTMLElement,
    backendEl: HTMLElement,
    particlesEl: HTMLElement,
    assetUrl = VISIBLE_CHARACTER_MODEL_URL,
  ) {
    this.assetUrl = assetUrl;
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.preset = createCharacterSdfPresetEnvelope('Default character SDF', 'meshy-visible-character', assetUrl);

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x162030);
    this.camera.position.set(0, 0.95, 2.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.update();

    this.root.name = 'character-sdf-tool-root';
    this.sdfDebugGroup.name = 'character-sdf-tool-capsules';
    this.errorPointGroup.name = 'character-sdf-error-points';
    this.scene.add(this.root, this.sdfDebugGroup, this.errorPointGroup);
    this.bindPointerEvents();
  }

  async load(): Promise<void> {
    this.statusEl.dataset.state = 'loading';
    this.statusEl.textContent = 'loading character SDF tool';
    await this.renderer.init();
    this.addLights();
    const loader = new FBXLoader();
    const root = await loadFbxQuietly(loader, this.assetUrl);
    root.name = 'character-sdf-authoring-character';
    this.loadedRoot = root;
    this.collectObjects(root);
    this.normalizeCharacter(root);
    this.root.add(root);
    this.rebuildSdfs();
    this.statusEl.dataset.state = 'running';
    this.statusEl.textContent = 'running (character SDF tool)';
    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name} (character SDF tool)`;
    this.particlesEl.textContent = `sdf capsules: ${this.capsules.length}, samples: ${this.report.sampledVertexCount}`;
  }

  createControls(): GUI {
    const gui = new GUI({ title: 'Character SDF Tool', width: 360 });
    gui.domElement.setAttribute('data-testid', 'character-sdf-controls');
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '12px';
    gui.domElement.style.left = '12px';
    gui.domElement.style.zIndex = '30';
    gui.domElement.style.maxHeight = 'calc(100vh - 24px)';
    gui.domElement.style.overflow = 'auto';

    const state = {
      globalRadiusScale: this.preset.globalRadiusScale,
      globalRadiusBias: this.preset.globalRadiusBias,
      surfaceBand: this.preset.surfaceBand,
      selectedCapsule: '',
      selectedVertex: '',
      nearSurfaceRatio: 0,
      outsideHoleRatio: 0,
      insideBlobRatio: 0,
      meanAbsDistance: 0,
      rebuild: () => this.rebuildFromControlState(state),
      saveBrowserPreset: async () => {
        this.preset = await saveCharacterSdfPreset(this.preset);
        this.statusEl.textContent = `saved SDF preset "${this.preset.name}"`;
      },
      exportJson: () => {
        downloadJson('character-sdf-preset.json', this.preset);
      },
      excludeSelectedVertex: () => {
        if (!this.selectedVertex) {
          return;
        }
        this.preset = createCharacterSdfPresetEnvelope(this.preset.name, this.preset.characterId, this.assetUrl, {
          ...this.preset,
          vertexRules: [
            ...this.preset.vertexRules,
            { ...this.selectedVertex, action: 'exclude' },
          ],
        });
        this.rebuildSdfs();
        updateDisplays();
      },
      growSelectedCapsule: () => {
        this.adjustSelectedCapsuleRadius(0.004);
        updateDisplays();
      },
      shrinkSelectedCapsule: () => {
        this.adjustSelectedCapsuleRadius(-0.004);
        updateDisplays();
      },
    };

    const fitFolder = gui.addFolder('Fit');
    fitFolder.add(state, 'globalRadiusScale', 0.6, 1.5, 0.01).name('Global radius scale').onFinishChange(() => {
      this.rebuildFromControlState(state);
      updateDisplays();
    });
    fitFolder.add(state, 'globalRadiusBias', -0.04, 0.04, 0.001).name('Global radius bias').onFinishChange(() => {
      this.rebuildFromControlState(state);
      updateDisplays();
    });
    fitFolder.add(state, 'surfaceBand', 0.005, 0.08, 0.001).name('Target band').onFinishChange(() => {
      this.rebuildFromControlState(state);
      updateDisplays();
    });
    fitFolder.add(state, 'rebuild').name('Rebuild SDFs');
    fitFolder.open();

    const selectionFolder = gui.addFolder('Selection');
    selectionFolder.add(state, 'selectedCapsule').name('Capsule').disable();
    selectionFolder.add(state, 'selectedVertex').name('Vertex').disable();
    selectionFolder.add(state, 'growSelectedCapsule').name('Grow capsule');
    selectionFolder.add(state, 'shrinkSelectedCapsule').name('Shrink capsule');
    selectionFolder.add(state, 'excludeSelectedVertex').name('Exclude vertex');
    selectionFolder.open();

    const reportFolder = gui.addFolder('Error report');
    reportFolder.add(state, 'nearSurfaceRatio').name('Near surface').disable();
    reportFolder.add(state, 'outsideHoleRatio').name('Under / holes').disable();
    reportFolder.add(state, 'insideBlobRatio').name('Over / blobs').disable();
    reportFolder.add(state, 'meanAbsDistance').name('Mean abs error').disable();
    reportFolder.open();

    const presetFolder = gui.addFolder('Preset');
    presetFolder.add(state, 'saveBrowserPreset').name('Save browser preset');
    presetFolder.add(state, 'exportJson').name('Export JSON');

    const updateDisplays = (): void => {
      state.selectedCapsule = this.selectedCapsuleName ?? '';
      state.selectedVertex = this.selectedVertex
        ? `${this.selectedVertex.meshName}:${this.selectedVertex.vertexIndex}`
        : '';
      state.nearSurfaceRatio = this.report.nearSurfaceRatio;
      state.outsideHoleRatio = this.report.outsideHoleRatio;
      state.insideBlobRatio = this.report.insideBlobRatio;
      state.meanAbsDistance = this.report.meanAbsDistance;
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    };
    updateDisplays();
    makeDraggableLilGui(gui);
    return gui;
  }

  update(): void {
    this.controls.update();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  getStats(): CharacterSdfToolStats {
    return {
      loaded: this.loadedRoot !== null,
      assetUrl: this.assetUrl,
      meshCount: this.meshCount,
      skinnedMeshCount: this.skinnedMeshes.length,
      boneCount: this.bones.length,
      capsuleCount: this.capsules.length,
      selectedCapsuleName: this.selectedCapsuleName,
      selectedVertex: this.selectedVertex,
    };
  }

  getCapsules(): Array<{
    name: string;
    parentName: string;
    radius: number;
    length: number;
    start: [number, number, number];
    end: [number, number, number];
  }> {
    return this.capsules.map((capsule) => ({
      name: capsule.name,
      parentName: capsule.parentName,
      radius: capsule.radius,
      length: capsule.length,
      start: [capsule.start.x, capsule.start.y, capsule.start.z],
      end: [capsule.end.x, capsule.end.y, capsule.end.z],
    }));
  }

  getReport(): CharacterSdfFitQualityReport {
    return this.report;
  }

  getPreset(): CharacterSdfPresetEnvelope {
    return this.preset;
  }

  setGlobalRadiusScale(scale: number): CharacterSdfFitQualityReport {
    this.preset = createCharacterSdfPresetEnvelope(this.preset.name, this.preset.characterId, this.assetUrl, {
      ...this.preset,
      globalRadiusScale: scale,
    });
    this.rebuildSdfs();
    return this.report;
  }

  private rebuildFromControlState(state: {
    globalRadiusScale: number;
    globalRadiusBias: number;
    surfaceBand: number;
  }): void {
    this.preset = createCharacterSdfPresetEnvelope(this.preset.name, this.preset.characterId, this.assetUrl, {
      ...this.preset,
      globalRadiusScale: state.globalRadiusScale,
      globalRadiusBias: state.globalRadiusBias,
      surfaceBand: state.surfaceBand,
    });
    this.rebuildSdfs();
  }

  private rebuildSdfs(): void {
    if (!this.loadedRoot) {
      return;
    }
    this.blueprints.length = 0;
    this.blueprints.push(...buildCharacterSdfBlueprints(this.loadedRoot, this.bones, { preset: this.preset }));
    this.capsules.length = 0;
    this.capsules.push(...compileCharacterSdfCapsulesFromBlueprints(this.blueprints, { preset: this.preset }));
    this.buildCapsuleVisuals();
    this.report = createCharacterSdfFitQualityReport(this.loadedRoot, this.capsules, this.preset.surfaceBand);
    this.buildErrorPointVisuals();
    this.particlesEl.textContent = `sdf capsules: ${this.capsules.length}, samples: ${this.report.sampledVertexCount}`;
  }

  private adjustSelectedCapsuleRadius(delta: number): void {
    if (!this.selectedCapsuleName) {
      return;
    }
    const capsule = this.capsules.find((candidate) => candidate.name === this.selectedCapsuleName);
    if (!capsule) {
      return;
    }
    const existing = this.preset.boneOverrides.find((override) => override.boneName === capsule.parentName);
    const nextBias = (existing?.radiusBias ?? 0) + delta;
    const boneOverrides = [
      ...this.preset.boneOverrides.filter((override) => override.boneName !== capsule.parentName),
      { ...existing, boneName: capsule.parentName, radiusBias: nextBias },
    ];
    this.preset = createCharacterSdfPresetEnvelope(this.preset.name, this.preset.characterId, this.assetUrl, {
      ...this.preset,
      boneOverrides,
    });
    this.rebuildSdfs();
  }

  private collectObjects(root: THREE.Object3D): void {
    this.meshCount = 0;
    this.skinnedMeshes.length = 0;
    this.bones.length = 0;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        this.meshCount += 1;
        object.castShadow = true;
        object.receiveShadow = true;
      }
      if (object instanceof THREE.SkinnedMesh) {
        this.skinnedMeshes.push(object);
      }
      if (object instanceof THREE.Bone) {
        this.bones.push(object);
      }
    });
  }

  private normalizeCharacter(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? this.preset.targetHeight / size.y : 0.01;
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);
    const scaledBox = new THREE.Box3().setFromObject(root);
    const center = scaledBox.getCenter(new THREE.Vector3());
    root.position.sub(new THREE.Vector3(center.x, scaledBox.min.y, center.z));
    root.updateMatrixWorld(true);
  }

  private buildCapsuleVisuals(): void {
    this.sdfDebugGroup.clear();
    this.capsuleMeshes.clear();
    this.capsuleNameByObject.clear();
    const baseMaterial = new THREE.MeshStandardNodeMaterial({
      color: 0x5cc8ff,
      emissive: new THREE.Color(0x1c86ff),
      emissiveIntensity: 0.3,
      roughness: 0.45,
      transparent: true,
      opacity: 0.28,
      depthTest: false,
    });
    const selectedMaterial = new THREE.MeshStandardNodeMaterial({
      color: 0xffe66d,
      emissive: new THREE.Color(0xffaa00),
      emissiveIntensity: 0.45,
      roughness: 0.4,
      transparent: true,
      opacity: 0.42,
      depthTest: false,
    });

    for (const capsule of this.capsules) {
      const material = capsule.name === this.selectedCapsuleName ? selectedMaterial : baseMaterial;
      const group = new THREE.Group();
      group.name = `authoring-sdf-${capsule.name}`;
      group.add(
        new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1), material),
        new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material),
        new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material),
      );
      syncCapsuleGroup(group, capsule);
      this.sdfDebugGroup.add(group);
      this.capsuleMeshes.set(capsule.name, group);
      group.traverse((object) => this.capsuleNameByObject.set(object, capsule.name));
    }
  }

  private buildErrorPointVisuals(): void {
    this.errorPointGroup.clear();
    const positions = new Float32Array(this.report.samples.length * 3);
    const colors = new Float32Array(this.report.samples.length * 3);
    const color = new THREE.Color();
    for (let i = 0; i < this.report.samples.length; i++) {
      const sample = this.report.samples[i]!;
      positions[i * 3] = sample.position[0];
      positions[i * 3 + 1] = sample.position[1];
      positions[i * 3 + 2] = sample.position[2];
      const normalizedError = Math.min(1, Math.abs(sample.signedDistance) / Math.max(0.001, this.preset.surfaceBand * 2));
      if (sample.signedDistance > this.preset.surfaceBand) {
        color.setRGB(0.2, 0.65, 1.0).lerp(new THREE.Color(0.0, 0.12, 1.0), normalizedError);
      } else if (sample.signedDistance < -this.preset.surfaceBand) {
        color.setRGB(1.0, 0.7, 0.12).lerp(new THREE.Color(1.0, 0.0, 0.0), normalizedError);
      } else {
        color.setRGB(0.2, 1.0, 0.35);
      }
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 0.008, vertexColors: true, transparent: true, opacity: 0.9 }),
    );
    points.name = 'character-sdf-error-points';
    this.errorPointGroup.add(points);
  }

  private bindPointerEvents(): void {
    const canvas = this.renderer.domElement;
    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      updatePointer(event);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const capsuleHit = this.raycaster.intersectObjects([...this.capsuleNameByObject.keys()], false)[0];
      if (capsuleHit) {
        this.selectedCapsuleName = this.capsuleNameByObject.get(capsuleHit.object) ?? null;
        this.buildCapsuleVisuals();
        return;
      }
      const meshHit = this.raycaster.intersectObjects(this.skinnedMeshes, false)[0];
      if (meshHit?.object instanceof THREE.SkinnedMesh && meshHit.face) {
        const vertexIndex = nearestHitFaceVertex(meshHit);
        this.selectedVertex = { meshName: meshHit.object.name, vertexIndex };
      }
    });
  }

  private addLights(): void {
    this.scene.environment = new THREE.PMREMGenerator(this.renderer)
      .fromScene(new RoomEnvironment(), 0.04)
      .texture;
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x273245, 2.1));
    const key = new THREE.DirectionalLight(0xfff2df, 4.5);
    key.position.set(3.5, 5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 2);
    rim.position.set(-4, 3, -3);
    this.scene.add(rim);
  }
}

function syncCapsuleGroup(group: THREE.Object3D, capsule: CharacterSdfCapsule): void {
  const [cylinder, startSphere, endSphere] = group.children;
  const axis = capsule.end.clone().sub(capsule.start);
  const length = Math.max(axis.length(), 0.000001);
  const center = capsule.start.clone().add(capsule.end).multiplyScalar(0.5);
  group.position.copy(center);
  group.quaternion.setFromUnitVectors(UP, axis.clone().normalize());
  cylinder?.scale.set(capsule.radius, length, capsule.radius);
  startSphere?.position.set(0, -length * 0.5, 0);
  endSphere?.position.set(0, length * 0.5, 0);
  startSphere?.scale.setScalar(capsule.radius);
  endSphere?.scale.setScalar(capsule.radius);
}

function nearestHitFaceVertex(hit: THREE.Intersection): number {
  if (!hit.face) {
    return 0;
  }
  const geometry = (hit.object as THREE.Mesh).geometry;
  const position = geometry.getAttribute('position');
  const localHit = hit.object.worldToLocal(hit.point.clone());
  const candidates = [hit.face.a, hit.face.b, hit.face.c];
  let bestIndex = candidates[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  const point = new THREE.Vector3();
  for (const index of candidates) {
    point.fromBufferAttribute(position, index);
    const distance = point.distanceToSquared(localHit);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
