import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import {
  Fn,
  If,
  Loop,
  float,
  instanceIndex,
  instancedArray,
  normalFlat,
  select,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { StorageInstancedBufferAttribute, WebGPURenderer } from 'three/webgpu';
import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from '../sim/InextensibleFlagSettings';
import {
  configureMatteCottonFlagMaterial,
  updateMatteCottonFlagMaterial,
} from '../shaders/FlagClothMaterial';
import { createEdgeAwareSimSurfaceSampler } from '../shaders/clothEdgeAwareSurface';
import {
  loadDenim512ClothTextures,
  type BakedClothTextureSet,
} from '../textures/loadBakedClothTextures';

interface TubeParticle {
  readonly initial: THREE.Vector3;
  readonly gridX: number;
  readonly gridY: number;
  readonly section: 'torso' | 'leftSleeve' | 'rightSleeve';
  position: THREE.Vector3;
  previous: THREE.Vector3;
}

interface TubeConstraint {
  readonly a: number;
  readonly b: number;
  readonly restLength: number;
  readonly stiffness: number;
}

interface TubeProjectile {
  readonly mesh: THREE.Mesh;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  alive: boolean;
}

interface GrabState {
  readonly particleIds: number[];
  readonly offsets: THREE.Vector3[];
  readonly plane: THREE.Plane;
}

export interface ZeroGravityTubeStats {
  particleCount: number;
  triangleCount: number;
  projectileCount: number;
  grabMode: boolean;
  shootMode: boolean;
  centerY: number;
  minY: number;
  maxY: number;
  maxParticleSpeed: number;
  hasNaN: boolean;
  gravity: number;
  pressure: number;
}

declare global {
  interface Window {
    __zeroGravityTubeStats?: () => ZeroGravityTubeStats;
    __zeroGravityTubeReset?: () => void;
    __zeroGravityTubeSetGrab?: (enabled: boolean) => void;
    __zeroGravityTubeSetShoot?: (enabled: boolean) => void;
    __zeroGravityTubeSetGravity?: (gravity: number) => void;
    __zeroGravityTubeFire?: (ndcX: number, ndcY: number) => boolean;
  }
}

interface TubeSettings {
  radius: number;
  height: number;
  segmentsAround: number;
  segmentsHeight: number;
  solverIterations: number;
  damping: number;
  pressure: number;
  gravity: number;
  simulationSubsteps: number;
  grabRadius: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileImpulse: number;
  fabricColor: string;
  wireframe: boolean;
}

const MAX_PROJECTILES = 8;
const MAX_GRAB_PARTICLES = 64;

export class ZeroGravityTubeScene {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly settings: TubeSettings = {
    radius: 0.42,
    height: 1.28,
    segmentsAround: 36,
    segmentsHeight: 28,
    solverIterations: 4,
    damping: 0.992,
    pressure: 0,
    gravity: 0,
    simulationSubsteps: 2,
    grabRadius: 0.18,
    projectileSpeed: 5.5,
    projectileRadius: 0.045,
    projectileImpulse: 0.22,
    fabricColor: '#f4f6ff',
    wireframe: false,
  };

  private readonly statusEl: HTMLElement;
  private readonly backendEl: HTMLElement;
  private readonly particlesEl: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly particles: TubeParticle[] = [];
  private readonly renderParticleIds: number[] = [];
  private readonly constraints: TubeConstraint[] = [];
  private readonly constrainedPairs = new Set<string>();
  private readonly projectiles: TubeProjectile[] = [];
  private readonly materialSettings: InextensibleFlagSettings;
  private readonly flatShadingUniform = uniform(1);
  private readonly normalSampleStepUniform = uniform(1);
  private readonly gridStrideYUniform = uniform(1);
  private readonly gridMaxXUniform = uniform(1);
  private readonly gridMaxYUniform = uniform(1);
  private readonly gpuGravityUniform = uniform(0);
  private readonly gpuDampingUniform = uniform(0.992);
  private readonly gpuPressureUniform = uniform(0);
  private readonly gpuSubstepDtUniform = uniform(1 / 60);
  private readonly gpuGrabCountUniform = uniform(0);
  private readonly gpuGrabTargetUniform = uniform(new THREE.Vector3());
  private mesh!: THREE.Mesh;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.MeshPhysicalNodeMaterial;
  private tubePositionBuffer!: ReturnType<typeof instancedArray>;
  private tubePreviousBuffer!: ReturnType<typeof instancedArray>;
  private initialPositionBuffer!: ReturnType<typeof instancedArray>;
  private vertexParamsBuffer!: ReturnType<typeof instancedArray>;
  private springVertexIdBuffer!: ReturnType<typeof instancedArray>;
  private springRestLengthBuffer!: ReturnType<typeof instancedArray>;
  private springStiffnessBuffer!: ReturnType<typeof instancedArray>;
  private springCorrectionBuffer!: ReturnType<typeof instancedArray>;
  private springListBuffer!: ReturnType<typeof instancedArray>;
  private projectileStateBuffer!: ReturnType<typeof instancedArray>;
  private projectileVelocityBuffer!: ReturnType<typeof instancedArray>;
  private grabParticleIdBuffer!: ReturnType<typeof instancedArray>;
  private grabOffsetBuffer!: ReturnType<typeof instancedArray>;
  private predictGarmentMotion!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeGarmentCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyGarmentCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveGarmentProjectileImpulses!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyGarmentGrabTarget!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resetGarmentPositions!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private bakedClothTextures: BakedClothTextureSet | null = null;
  private grabState: GrabState | null = null;
  private grabMode = true;
  private shootMode = false;
  private lastFrameMs = performance.now();
  private frameCount = 0;
  private statsReadbackPending = false;
  private lastStats: ZeroGravityTubeStats | null = null;
  private lastStatsPositions: Float32Array | null = null;

  constructor(
    container: HTMLElement,
    statusEl: HTMLElement,
    backendEl: HTMLElement,
    particlesEl: HTMLElement,
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.materialSettings = {
      ...defaultInextensibleFlagSettings(),
      flagColor: this.settings.fabricColor,
      fabricNormalStrength: 0.62,
      fabricNormalScale: 0.5,
      fabricTiling: 8,
      tearFringeWidth: 0,
      showBridgeSplinters: false,
    };

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08111f);
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 80);
    this.camera.position.set(0, 0.65, 3.3);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 8;

    this.setupLights();
    this.setupProjectiles();
    this.updateStats();
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.bakedClothTextures = await loadDenim512ClothTextures();
    this.rebuildTube();
    this.bindPointerEvents();
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name} (isolated cloth)`;
    this.statusEl.dataset.state = 'running';
    this.statusEl.textContent = 'running (isolated cloth)';
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setGrabMode(enabled: boolean): void {
    this.grabMode = enabled;
    if (enabled) {
      this.shootMode = false;
    } else {
      this.clearGpuGrabTarget();
    }
    this.updateStats();
  }

  setShootMode(enabled: boolean): void {
    this.shootMode = enabled;
    if (enabled) {
      this.grabMode = false;
    }
    this.updateStats();
  }

  setGravity(gravity: number): void {
    this.settings.gravity = gravity;
  }

  isGrabModeOn(): boolean {
    return this.grabMode;
  }

  isShootModeOn(): boolean {
    return this.shootMode;
  }

  resetTube(): void {
    this.resetGpuGarmentBuffers();
    for (const projectile of this.projectiles) {
      projectile.alive = false;
      projectile.mesh.visible = false;
    }
    if (this.resetGarmentPositions) {
      this.renderer.compute(this.resetGarmentPositions);
    }
    this.updateStats();
  }

  getStats(): ZeroGravityTubeStats {
    if (this.lastStats) {
      return {
        ...this.lastStats,
        projectileCount: this.projectiles.filter((projectile) => projectile.alive).length,
        grabMode: this.grabMode,
        shootMode: this.shootMode,
        gravity: this.settings.gravity,
        pressure: this.settings.pressure,
      };
    }

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let centerY = 0;
    let maxParticleSpeed = 0;
    let hasNaN = false;

    for (const particle of this.particles) {
      minY = Math.min(minY, particle.position.y);
      maxY = Math.max(maxY, particle.position.y);
      centerY += particle.position.y;
      maxParticleSpeed = Math.max(maxParticleSpeed, particle.position.distanceTo(particle.previous));
      hasNaN =
        hasNaN ||
        !Number.isFinite(particle.position.x) ||
        !Number.isFinite(particle.position.y) ||
        !Number.isFinite(particle.position.z);
    }

    return {
      particleCount: this.particles.length,
      triangleCount: this.geometry?.index ? this.geometry.index.count / 3 : 0,
      projectileCount: this.projectiles.filter((projectile) => projectile.alive).length,
      grabMode: this.grabMode,
      shootMode: this.shootMode,
      centerY: this.particles.length > 0 ? centerY / this.particles.length : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 0,
      maxParticleSpeed,
      hasNaN,
      gravity: this.settings.gravity,
      pressure: this.settings.pressure,
    };
  }

  fireProjectileFromNdc(ndcX: number, ndcY: number): boolean {
    const projectile = this.projectiles.find((entry) => !entry.alive);
    if (!projectile) {
      return false;
    }

    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(this.camera);
    const direction = target.sub(origin).normalize();
    projectile.position.copy(origin).addScaledVector(direction, 0.25);
    projectile.velocity.copy(direction).multiplyScalar(this.settings.projectileSpeed);
    projectile.alive = true;
    projectile.mesh.visible = true;
    projectile.mesh.position.copy(projectile.position);
    this.updateStats();
    return true;
  }

  update(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameMs) / 1000, 0.033);
    this.lastFrameMs = now;
    this.controls.update();
    this.stepProjectiles(dt);
    this.updateProjectileBuffers();
    this.stepGpuSimulation(dt);
    this.frameCount++;
    if (this.frameCount % 12 === 0) {
      void this.refreshGpuStats();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  createControls(): GUI {
    const gui = new GUI({ title: 'GPU Cloth Isolation', width: 320 });
    gui.domElement.setAttribute('data-testid', 'tube-controls');
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '12px';
    gui.domElement.style.right = '12px';
    gui.domElement.style.zIndex = '20';
    gui.domElement.style.maxHeight = 'calc(100vh - 24px)';
    gui.domElement.style.overflow = 'auto';

    const simFolder = gui.addFolder('GPU cloth simulation');
    simFolder.add(this.settings, 'solverIterations', 1, 24, 1).name('Solver iterations');
    simFolder.add(this.settings, 'damping', 0.95, 0.9995, 0.0005).name('Damping');
    simFolder.add(this.settings, 'pressure', -0.04, 0.06, 0.001).name('Shape pressure');
    simFolder.add(this.settings, 'gravity', 0, 20, 0.1).name('Gravity');
    simFolder.add(this.settings, 'simulationSubsteps', 1, 16, 1).name('Simulation substeps');
    simFolder.add(this.settings, 'grabRadius', 0.04, 0.4, 0.01).name('Grab radius');
    simFolder.open();

    const projectileFolder = gui.addFolder('Projectiles');
    projectileFolder.add(this.settings, 'projectileSpeed', 1, 16, 0.1).name('Speed');
    projectileFolder.add(this.settings, 'projectileRadius', 0.01, 0.14, 0.005).name('Radius');
    projectileFolder.add(this.settings, 'projectileImpulse', 0.02, 0.7, 0.01).name('Impulse');

    const appearanceFolder = gui.addFolder('Appearance');
    appearanceFolder
      .addColor(this.settings, 'fabricColor')
      .name('Fabric color')
      .onChange(() => {
        this.materialSettings.flagColor = this.settings.fabricColor;
        updateMatteCottonFlagMaterial(this.material, this.materialSettings);
      });
    appearanceFolder
      .add(this.materialSettings, 'fabricNormalStrength', 0, 1, 0.01)
      .name('Weave strength')
      .onChange(() => updateMatteCottonFlagMaterial(this.material, this.materialSettings));
    appearanceFolder
      .add(this.materialSettings, 'fabricTiling', 1, 24, 0.25)
      .name('Fabric tiling')
      .onChange(() => updateMatteCottonFlagMaterial(this.material, this.materialSettings));
    appearanceFolder.add(this.settings, 'wireframe').name('Wireframe').onChange(() => {
      this.material.wireframe = this.settings.wireframe;
    });

    const actions = {
      reset: () => this.resetTube(),
      grab: () => this.setGrabMode(true),
      shoot: () => this.setShootMode(true),
    };
    const actionsFolder = gui.addFolder('Actions');
    actionsFolder.add(actions, 'reset').name('Reset cloth');
    actionsFolder.add(actions, 'grab').name('Grab mode');
    actionsFolder.add(actions, 'shoot').name('Shoot mode');
    return gui;
  }

  private setupLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3));
    const hemi = new THREE.HemisphereLight(0xc7dcff, 0x20283a, 1.8);
    const key = new THREE.DirectionalLight(0xfff1df, 4.4);
    key.position.set(3, 4, 4);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 2.2);
    rim.position.set(-3, 2, -4);
    this.scene.add(hemi, key, rim, this.createReferenceGrid());
  }

  private createReferenceGrid(): THREE.GridHelper {
    const grid = new THREE.GridHelper(3.5, 14, 0x446688, 0x223344);
    grid.position.y = -0.85;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.22;
    return grid;
  }

  private setupProjectiles(): void {
    const geometry = new THREE.SphereGeometry(1, 16, 12);
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0xd8e6ff,
      emissive: 0x5a7dff,
      emissiveIntensity: 0.3,
      roughness: 0.32,
    });
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.scale.setScalar(this.settings.projectileRadius);
      this.scene.add(mesh);
      this.projectiles.push({
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        alive: false,
      });
    }
  }

  private rebuildTube(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.geometry.dispose();
      this.material.dispose();
    }

    this.particles.length = 0;
    this.renderParticleIds.length = 0;
    this.constraints.length = 0;
    this.constrainedPairs.clear();
    const torsoAround = Math.max(24, Math.round(this.settings.segmentsAround));
    const torsoHeightSegments = Math.max(12, Math.round(this.settings.segmentsHeight));
    const positions: number[] = [];
    const uvs: number[] = [];
    const simGridCoords: number[] = [];
    const indices: number[] = [];

    const addParticle = (
      point: THREE.Vector3,
      gridX: number,
      gridY: number,
      section: TubeParticle['section'],
    ): number => {
      const position = point.clone();
      const particleId = this.particles.length;
      this.particles.push({
        initial: point,
        gridX,
        gridY,
        section,
        position,
        previous: position.clone(),
      });
      return particleId;
    };

    const addRenderVertex = (particleId: number, u: number, v: number): number => {
      const particle = this.particles[particleId]!;
      const renderId = this.renderParticleIds.length;
      this.renderParticleIds.push(particleId);
      positions.push(particle.position.x, particle.position.y, particle.position.z);
      uvs.push(u, v);
      simGridCoords.push(particleId, 0);
      return renderId;
    };

    const torsoParticleIds: number[][] = Array.from({ length: torsoAround }, () => []);
    const torsoRenderIds: number[][] = Array.from({ length: torsoAround + 1 }, () => []);
    const torsoRx = 0.64;
    const torsoRz = 0.46;
    const vestHeight = 1.5;
    const vestCenterY = -0.04;

    for (let y = 0; y <= torsoHeightSegments; y++) {
      const v = y / torsoHeightSegments;
      const py = vestCenterY + (v - 0.5) * vestHeight;
      const waistEase = 1 - Math.abs(v - 0.44) * 0.18;
      const shoulderEase = v > 0.72 ? 1.08 : 1;
      for (let x = 0; x < torsoAround; x++) {
        const u = x / torsoAround;
        const angle = u * Math.PI * 2;
        const point = new THREE.Vector3(
          Math.cos(angle) * torsoRx * waistEase * shoulderEase,
          py,
          Math.sin(angle) * torsoRz * waistEase,
        );
        torsoParticleIds[x]![y] = addParticle(point, x, y, 'torso');
      }
    }

    for (let x = 0; x <= torsoAround; x++) {
      for (let y = 0; y <= torsoHeightSegments; y++) {
        torsoRenderIds[x]![y] = addRenderVertex(
          torsoParticleIds[x % torsoAround]![y]!,
          x / torsoAround,
          y / torsoHeightSegments,
        );
      }
    }

    const rightArmholeColumn = 0;
    const leftArmholeColumn = Math.round(torsoAround * 0.5);
    const shoulderRow = Math.round(torsoHeightSegments * 0.76);
    const circularDistance = (a: number, b: number) => {
      const raw = Math.abs(a - b);
      return Math.min(raw, torsoAround - raw);
    };
    const isArmholeCell = (x: number, y: number) =>
      Math.abs(y - shoulderRow) <= 4 &&
      (circularDistance(x, rightArmholeColumn) <= 2 || circularDistance(x, leftArmholeColumn) <= 2);

    for (let y = 0; y < torsoHeightSegments; y++) {
      for (let x = 0; x < torsoAround; x++) {
        if (isArmholeCell(x, y)) {
          continue;
        }
        const i00 = torsoRenderIds[x]![y]!;
        const i10 = torsoRenderIds[x + 1]![y]!;
        const i01 = torsoRenderIds[x]![y + 1]!;
        const i11 = torsoRenderIds[x + 1]![y + 1]!;
        indices.push(i00, i10, i01, i10, i11, i01);
      }
    }

    for (let y = 0; y <= torsoHeightSegments; y++) {
      for (let x = 0; x < torsoAround; x++) {
        const id00 = torsoParticleIds[x]![y]!;
        this.addConstraint(id00, torsoParticleIds[(x + 1) % torsoAround]![y]!, 0.95);
        if (y < torsoHeightSegments) {
          this.addConstraint(id00, torsoParticleIds[x]![y + 1]!, 0.95);
          this.addConstraint(id00, torsoParticleIds[(x + 1) % torsoAround]![y + 1]!, 0.68);
          this.addConstraint(torsoParticleIds[(x + 1) % torsoAround]![y]!, torsoParticleIds[x]![y + 1]!, 0.68);
        }
        this.addConstraint(id00, torsoParticleIds[(x + 2) % torsoAround]![y]!, 0.22);
        if (y + 2 <= torsoHeightSegments) {
          this.addConstraint(id00, torsoParticleIds[x]![y + 2]!, 0.22);
        }
      }
    }

    const shaderPositions = new Float32Array(this.particles.length * 3);
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i]!;
      shaderPositions[i * 3] = particle.position.x;
      shaderPositions[i * 3 + 1] = particle.position.y;
      shaderPositions[i * 3 + 2] = particle.position.z;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.geometry.setAttribute('simGridCoord', new THREE.Float32BufferAttribute(simGridCoords, 2));
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();
    this.setupGpuGarmentBuffers(shaderPositions);
    this.gridStrideYUniform.value = 1;
    this.gridMaxXUniform.value = Math.max(1, this.particles.length - 1);
    this.gridMaxYUniform.value = 0;
    this.normalSampleStepUniform.value = 0.5;
    this.material = this.createClothShaderMaterial();
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'procedural-vest-cloth';
    this.scene.add(this.mesh);
    this.applyStatsFromCpuParticles();
  }

  private addConstraint(a: number, b: number, stiffness: number): void {
    const restLength = this.particles[a]!.position.distanceTo(this.particles[b]!.position);
    this.addConstraintWithRestLength(a, b, restLength, stiffness);
  }

  private addConstraintWithRestLength(a: number, b: number, restLength: number, stiffness: number): void {
    this.constraints.push({ a, b, restLength, stiffness });
    this.constrainedPairs.add(this.constraintPairKey(a, b));
  }

  private constraintPairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  private setupGpuGarmentBuffers(initialPositions: Float32Array): void {
    const vertexCount = this.particles.length;
    const constraintCount = this.constraints.length;
    const incidentEdges: number[][] = Array.from({ length: vertexCount }, () => []);
    const springVertexIds = new Uint32Array(constraintCount * 2);
    const springRestLengths = new Float32Array(constraintCount);
    const springStiffness = new Float32Array(constraintCount);

    for (let i = 0; i < this.constraints.length; i++) {
      const constraint = this.constraints[i]!;
      springVertexIds[i * 2] = constraint.a;
      springVertexIds[i * 2 + 1] = constraint.b;
      springRestLengths[i] = constraint.restLength;
      springStiffness[i] = constraint.stiffness;
      incidentEdges[constraint.a]!.push(i);
      incidentEdges[constraint.b]!.push(i);
    }

    const vertexParams = new Uint32Array(vertexCount * 4);
    const springList: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
      vertexParams[i * 4] = 0;
      vertexParams[i * 4 + 1] = incidentEdges[i]!.length;
      vertexParams[i * 4 + 2] = springList.length;
      vertexParams[i * 4 + 3] = 0;
      springList.push(...incidentEdges[i]!);
    }

    const paddedInitialPositions = this.toPaddedVec4Array(initialPositions);
    this.tubePositionBuffer = instancedArray(paddedInitialPositions.slice(), 'vec4').setPBO(true);
    this.tubePreviousBuffer = instancedArray(paddedInitialPositions.slice(), 'vec4').setPBO(true);
    this.initialPositionBuffer = instancedArray(paddedInitialPositions.slice(), 'vec4').setPBO(true);
    this.vertexParamsBuffer = instancedArray(vertexParams, 'uvec4');
    this.springVertexIdBuffer = instancedArray(springVertexIds, 'uvec2').setPBO(true);
    this.springRestLengthBuffer = instancedArray(springRestLengths, 'float');
    this.springStiffnessBuffer = instancedArray(springStiffness, 'float');
    this.springCorrectionBuffer = instancedArray(constraintCount, 'vec4');
    this.springListBuffer = instancedArray(new Uint32Array(springList), 'uint').setPBO(true);
    this.projectileStateBuffer = instancedArray(MAX_PROJECTILES, 'vec4').setPBO(true);
    this.projectileVelocityBuffer = instancedArray(MAX_PROJECTILES, 'vec4').setPBO(true);
    this.grabParticleIdBuffer = instancedArray(new Uint32Array(MAX_GRAB_PARTICLES), 'uint').setPBO(true);
    this.grabOffsetBuffer = instancedArray(MAX_GRAB_PARTICLES, 'vec4').setPBO(true);
    this.createGpuComputePipelines(vertexCount, constraintCount);
  }

  private toPaddedVec4Array(positions: Float32Array): Float32Array {
    const padded = new Float32Array((positions.length / 3) * 4);
    for (let i = 0; i < positions.length / 3; i++) {
      padded[i * 4] = positions[i * 3]!;
      padded[i * 4 + 1] = positions[i * 3 + 1]!;
      padded[i * 4 + 2] = positions[i * 3 + 2]!;
      padded[i * 4 + 3] = 0;
    }
    return padded;
  }

  private resetGpuGarmentBuffers(): void {
    const positions = (this.tubePositionBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    const previous = (this.tubePreviousBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    const initial = (this.initialPositionBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    positions.set(initial);
    previous.set(initial);
    (this.tubePositionBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
    (this.tubePreviousBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
    this.updateProjectileBuffers();
    this.applyStatsFromPositionArray(positions);
  }

  private createGpuComputePipelines(vertexCount: number, constraintCount: number): void {
    const positionBuffer = this.tubePositionBuffer;
    const previousBuffer = this.tubePreviousBuffer;
    const initialPositionBuffer = this.initialPositionBuffer;
    const vertexParamsBuffer = this.vertexParamsBuffer;
    const springVertexIdBuffer = this.springVertexIdBuffer;
    const springRestLengthBuffer = this.springRestLengthBuffer;
    const springStiffnessBuffer = this.springStiffnessBuffer;
    const springCorrectionBuffer = this.springCorrectionBuffer;
    const springListBuffer = this.springListBuffer;
    const projectileStateBuffer = this.projectileStateBuffer;
    const projectileVelocityBuffer = this.projectileVelocityBuffer;
    const grabParticleIdBuffer = this.grabParticleIdBuffer;
    const grabOffsetBuffer = this.grabOffsetBuffer;
    const gravity = this.gpuGravityUniform;
    const damping = this.gpuDampingUniform;
    const pressure = this.gpuPressureUniform;
    const substepDt = this.gpuSubstepDtUniform;
    const grabCount = this.gpuGrabCountUniform;
    const grabTarget = this.gpuGrabTargetUniform;

    this.predictGarmentMotion = Fn(() => {
      const current = positionBuffer.element(instanceIndex).xyz.toVar('vestCurrent');
      const previous = previousBuffer.element(instanceIndex).xyz.toVar('vestPrevious');
      const velocity = current.sub(previous).mul(damping).toVar('vestVelocity');
      previousBuffer.element(instanceIndex).assign(vec4(current, float(0)));

      const radial = vec3(current.x, float(0), current.z).toVar('vestRadial');
      const radialLength = radial.length().toVar('vestRadialLength');
      If(radialLength.greaterThan(float(1e-6)), () => {
        velocity.addAssign(radial.div(radialLength).mul(pressure));
      });
      velocity.y.subAssign(gravity.mul(substepDt).mul(substepDt));
      positionBuffer.element(instanceIndex).assign(vec4(current.add(velocity), float(0)));
    })()
      .compute(vertexCount)
      .setName('GPU Garment Predict');

    this.computeGarmentCorrections = Fn(() => {
      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const restLength = springRestLengthBuffer.element(instanceIndex);
      const stiffness = springStiffnessBuffer.element(instanceIndex);
      const p0 = positionBuffer.element(vertexIds.x).xyz;
      const p1 = positionBuffer.element(vertexIds.y).xyz;
      const delta = p1.sub(p0).toVar('garmentConstraintDelta');
      const dist = delta.length().max(float(0.000001)).toVar('garmentConstraintDist');
      const correction = delta.mul(dist.sub(restLength).div(dist)).mul(stiffness);
      springCorrectionBuffer.element(instanceIndex).assign(vec4(correction, float(0)));
    })()
      .compute(constraintCount)
      .setName('GPU Garment Constraint Corrections');

    this.applyGarmentCorrections = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex);
      const edgeCount = params.y;
      const edgePointer = params.z;
      const positionDelta = vec3(float(0), float(0), float(0)).toVar('garmentPositionDelta');

      Loop({ start: edgePointer, end: edgePointer.add(edgeCount), type: 'uint', condition: '<' }, ({ i }) => {
        const edgeId = springListBuffer.element(i).toVar('garmentEdgeId');
        const vertexIds = springVertexIdBuffer.element(edgeId);
        const correction = springCorrectionBuffer.element(edgeId).xyz;
        const isVertex0 = vertexIds.x.equal(instanceIndex);
        const delta = select(isVertex0, correction.mul(float(0.5)), correction.mul(float(-0.5)));
        positionDelta.addAssign(delta);
      });

      const deltaLength = positionDelta.length().toVar('garmentDeltaLength');
      If(deltaLength.greaterThan(float(0.05)), () => {
        positionDelta.assign(positionDelta.mul(float(0.05).div(deltaLength)));
      });
      positionBuffer.element(instanceIndex).addAssign(vec4(positionDelta, float(0)));
    })()
      .compute(vertexCount)
      .setName('GPU Garment Apply Corrections');

    this.resolveGarmentProjectileImpulses = Fn(() => {
      const p = positionBuffer.element(instanceIndex).xyz.toVar('projectileClothPosition');
      const previous = previousBuffer.element(instanceIndex).xyz.toVar('projectileClothPrevious');

      Loop({ start: uint(0), end: uint(MAX_PROJECTILES), type: 'uint', condition: '<' }, ({ i }) => {
        const projectile = projectileStateBuffer.element(i);
        const radius = projectile.w;
        If(radius.greaterThan(float(0)), () => {
          const projectileVelocity = projectileVelocityBuffer.element(i).xyz;
          const delta = p.sub(projectile.xyz).toVar('projectileClothDelta');
          const distance = delta.length().max(float(0.000001)).toVar('projectileClothDistance');
          const influenceRadius = radius.add(float(0.12)).toVar('projectileInfluenceRadius');
          If(distance.lessThan(influenceRadius), () => {
            const normal = delta.div(distance).toVar('projectileClothNormal');
            const push = influenceRadius.sub(distance).toVar('projectileClothPush');
            const impulseStrength = projectileVelocityBuffer.element(i).w;
            const impulse = normal.mul(push.mul(impulseStrength)).add(projectileVelocity.mul(float(0.002)));
            p.addAssign(impulse);
            previous.addAssign(impulse.mul(float(0.35)));
          });
        });
      });

      positionBuffer.element(instanceIndex).assign(vec4(p, float(0)));
      previousBuffer.element(instanceIndex).assign(vec4(previous, float(0)));
    })()
      .compute(vertexCount)
      .setName('GPU Garment Projectile Impulses');

    this.applyGarmentGrabTarget = Fn(() => {
      If(float(instanceIndex).lessThan(grabCount), () => {
        const particleId = grabParticleIdBuffer.element(instanceIndex);
        const target = grabTarget.add(grabOffsetBuffer.element(instanceIndex).xyz);
        positionBuffer.element(particleId).assign(vec4(target, float(0)));
        previousBuffer.element(particleId).assign(vec4(target, float(0)));
      });
    })()
      .compute(MAX_GRAB_PARTICLES)
      .setName('GPU Garment Grab Target');

    this.resetGarmentPositions = Fn(() => {
      const rest = initialPositionBuffer.element(instanceIndex);
      positionBuffer.element(instanceIndex).assign(rest);
      previousBuffer.element(instanceIndex).assign(rest);
    })()
      .compute(vertexCount)
      .setName('GPU Garment Reset');
  }

  private createClothShaderMaterial(): THREE.MeshPhysicalNodeMaterial {
    const gridIndex = Fn(([gridX, gridY]) => gridX.mul(this.gridStrideYUniform).add(gridY));
    const neverBroken = Fn(() => uint(0).equal(uint(1)));
    const inactiveEdgeIds = instancedArray(
      new Uint32Array(Math.max(2, this.renderParticleIds.length + 1)).fill(0xffffffff),
      'uint',
    );
    const sampleSimPosition = createEdgeAwareSimSurfaceSampler({
      vertexPositionBuffer: this.tubePositionBuffer,
      gridIndex,
      gridStrideY: this.gridStrideYUniform,
      gridMaxXUniform: this.gridMaxXUniform,
      gridMaxYUniform: this.gridMaxYUniform,
      gridMaxXUint: uint(this.gridMaxXUniform),
      gridMaxYUint: uint(this.gridMaxYUniform),
      isEdgeBroken: neverBroken,
      simHorizontalEdgeIdBuffer: inactiveEdgeIds,
      simVerticalEdgeIdBuffer: inactiveEdgeIds,
      simShearDownEdgeIdBuffer: inactiveEdgeIds,
      simShearUpEdgeIdBuffer: inactiveEdgeIds,
    });

    const material = new THREE.MeshPhysicalNodeMaterial({
      color: new THREE.Color(this.materialSettings.flagColor),
      side: THREE.DoubleSide,
      roughness: this.materialSettings.roughness,
      sheen: this.materialSettings.sheen,
      sheenRoughness: this.materialSettings.sheenRoughness,
      sheenColor: new THREE.Color(this.materialSettings.flagColor),
      emissive: new THREE.Color(this.materialSettings.flagColor),
      emissiveIntensity: this.materialSettings.emissiveIntensity,
      envMapIntensity: 1.2,
    });

    configureMatteCottonFlagMaterial(material, {
      settings: this.materialSettings,
      bakedTextures: this.bakedClothTextures,
      flatShadingUniform: this.flatShadingUniform,
      normalFlat,
      sampleSimPosition,
      normalSampleStep: this.normalSampleStepUniform,
      gridMaxXUniform: this.gridMaxXUniform,
      gridMaxYUniform: this.gridMaxYUniform,
    });
    material.wireframe = this.settings.wireframe;
    return material;
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

    canvas.addEventListener('pointermove', (event) => {
      updatePointer(event);
      this.updateGrabTarget();
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      updatePointer(event);
      if (this.shootMode) {
        this.fireProjectileFromNdc(this.pointerNdc.x, this.pointerNdc.y);
        return;
      }
      if (this.grabMode && this.beginGrab()) {
        this.controls.enabled = false;
        canvas.setPointerCapture(event.pointerId);
      }
    });

    const release = (event: PointerEvent) => {
      this.grabState = null;
      this.clearGpuGrabTarget();
      this.controls.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private beginGrab(): boolean {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit) {
      return false;
    }

    const particleIds = this.nearestParticleIds(hit.point, this.settings.grabRadius).slice(0, MAX_GRAB_PARTICLES);
    if (particleIds.length === 0) {
      return false;
    }

    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point);
    this.grabState = {
      particleIds,
      plane,
      offsets: particleIds.map((id) => this.particles[id]!.position.clone().sub(hit.point)),
    };
    this.writeGpuGrabTarget(hit.point);
    return true;
  }

  private updateGrabTarget(): void {
    if (!this.grabState) {
      return;
    }

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.grabState.plane, target)) {
      return;
    }

    this.writeGpuGrabTarget(target);
  }

  private nearestParticleIds(point: THREE.Vector3, radius: number): number[] {
    const ids: number[] = [];
    let nearest = -1;
    let nearestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.particles.length; i++) {
      const dist = this.particles[i]!.position.distanceTo(point);
      if (dist < radius) {
        ids.push(i);
      }
      if (dist < nearestDist) {
        nearest = i;
        nearestDist = dist;
      }
    }
    return ids.length > 0 ? ids : nearest >= 0 ? [nearest] : [];
  }

  private writeGpuGrabTarget(target: THREE.Vector3): void {
    if (!this.grabState || !this.grabParticleIdBuffer || !this.grabOffsetBuffer) {
      return;
    }

    const particleIds = (this.grabParticleIdBuffer.value as StorageInstancedBufferAttribute).array as Uint32Array;
    const offsets = (this.grabOffsetBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    particleIds.fill(0);
    offsets.fill(0);

    const count = Math.min(this.grabState.particleIds.length, MAX_GRAB_PARTICLES);
    const offsetStride = offsets.length >= MAX_GRAB_PARTICLES * 4 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const offset = this.grabState.offsets[i]!;
      particleIds[i] = this.grabState.particleIds[i]!;
      offsets[i * offsetStride] = offset.x;
      offsets[i * offsetStride + 1] = offset.y;
      offsets[i * offsetStride + 2] = offset.z;
    }

    this.gpuGrabTargetUniform.value.copy(target);
    this.gpuGrabCountUniform.value = count;
    (this.grabParticleIdBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
    (this.grabOffsetBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
  }

  private clearGpuGrabTarget(): void {
    this.gpuGrabCountUniform.value = 0;
  }

  private stepGpuSimulation(dt: number): void {
    if (!this.predictGarmentMotion) {
      return;
    }

    const substeps = Math.max(
      1,
      Math.min(16, Math.max(Math.round(this.settings.simulationSubsteps), Math.ceil(dt / (1 / 120)))),
    );
    const substepDt = dt / substeps;
    this.gpuGravityUniform.value = this.settings.gravity;
    this.gpuDampingUniform.value = this.settings.damping;
    this.gpuPressureUniform.value = this.settings.pressure;

    for (let substep = 0; substep < substeps; substep++) {
      this.gpuSubstepDtUniform.value = substepDt;
      this.renderer.compute(this.predictGarmentMotion);
      this.renderer.compute(this.resolveGarmentProjectileImpulses);
      this.renderer.compute(this.applyGarmentGrabTarget);

      const iterations = THREE.MathUtils.clamp(Math.round(this.settings.solverIterations), 1, 12);
      for (let i = 0; i < iterations; i++) {
        this.renderer.compute(this.computeGarmentCorrections);
        this.renderer.compute(this.applyGarmentCorrections);
        this.renderer.compute(this.resolveGarmentProjectileImpulses);
        this.renderer.compute(this.applyGarmentGrabTarget);
      }
    }
  }

  private async refreshGpuStats(): Promise<void> {
    if (this.statsReadbackPending || !this.tubePositionBuffer) {
      return;
    }
    this.statsReadbackPending = true;
    try {
      const attr = this.tubePositionBuffer.value as StorageInstancedBufferAttribute;
      const buffer = await this.renderer.getArrayBufferAsync(attr);
      this.applyStatsFromPositionArray(new Float32Array(buffer), this.particles.length);
    } finally {
      this.statsReadbackPending = false;
    }
  }

  private applyStatsFromCpuParticles(): void {
    const positions = new Float32Array(this.particles.length * 3);
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i]!;
      positions[i * 3] = particle.position.x;
      positions[i * 3 + 1] = particle.position.y;
      positions[i * 3 + 2] = particle.position.z;
    }
    this.applyStatsFromPositionArray(positions);
  }

  private applyStatsFromPositionArray(positions: Float32Array, particleCount = positions.length / 3): void {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let centerY = 0;
    let hasNaN = false;
    let maxParticleSpeed = 0;

    const stride = positions.length >= particleCount * 4 ? 4 : 3;
    const compactPositions = new Float32Array(particleCount * 3);
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex++) {
      const i = particleIndex * stride;
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      const compactOffset = particleIndex * 3;
      compactPositions[compactOffset] = x;
      compactPositions[compactOffset + 1] = y;
      compactPositions[compactOffset + 2] = z;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      centerY += y;
      hasNaN = hasNaN || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z);
      if (this.lastStatsPositions && this.lastStatsPositions.length === compactPositions.length) {
        const dx = x - this.lastStatsPositions[compactOffset]!;
        const dy = y - this.lastStatsPositions[compactOffset + 1]!;
        const dz = z - this.lastStatsPositions[compactOffset + 2]!;
        maxParticleSpeed = Math.max(maxParticleSpeed, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      const particle = this.particles[particleIndex];
      if (particle) {
        particle.previous.copy(particle.position);
        particle.position.set(x, y, z);
      }
    }
    this.lastStatsPositions = compactPositions;

    this.lastStats = {
      particleCount,
      triangleCount: this.geometry?.index ? this.geometry.index.count / 3 : 0,
      projectileCount: this.projectiles.filter((projectile) => projectile.alive).length,
      grabMode: this.grabMode,
      shootMode: this.shootMode,
      centerY: particleCount > 0 ? centerY / particleCount : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      maxY: Number.isFinite(maxY) ? maxY : 0,
      maxParticleSpeed,
      hasNaN,
      gravity: this.settings.gravity,
      pressure: this.settings.pressure,
    };
  }

  private stepProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      if (!projectile.alive) {
        continue;
      }
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.mesh.position.copy(projectile.position);
      projectile.mesh.scale.setScalar(this.settings.projectileRadius);

      if (projectile.position.length() > 12) {
        projectile.alive = false;
        projectile.mesh.visible = false;
        continue;
      }

      // Cloth/projectile contact belongs in GPU compute; keep CPU work visual-only here.
    }
    this.updateStats();
  }

  private updateProjectileBuffers(): void {
    if (!this.projectileStateBuffer || !this.projectileVelocityBuffer) {
      return;
    }

    const states = (this.projectileStateBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    const velocities = (this.projectileVelocityBuffer.value as StorageInstancedBufferAttribute).array as Float32Array;
    states.fill(0);
    velocities.fill(0);

    for (let i = 0; i < this.projectiles.length; i++) {
      const projectile = this.projectiles[i]!;
      const offset = i * 4;
      if (!projectile.alive) {
        continue;
      }
      states[offset] = projectile.position.x;
      states[offset + 1] = projectile.position.y;
      states[offset + 2] = projectile.position.z;
      states[offset + 3] = this.settings.projectileRadius;
      velocities[offset] = projectile.velocity.x;
      velocities[offset + 1] = projectile.velocity.y;
      velocities[offset + 2] = projectile.velocity.z;
      velocities[offset + 3] = this.settings.projectileImpulse;
    }

    (this.projectileStateBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
    (this.projectileVelocityBuffer.value as StorageInstancedBufferAttribute).needsUpdate = true;
  }

  private updateStats(): void {
    const stats = this.getStats();
    this.particlesEl.textContent = `cloth particles: ${stats.particleCount} · projectiles: ${stats.projectileCount}`;
  }
}
