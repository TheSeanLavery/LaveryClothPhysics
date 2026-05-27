import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Fn,
  If,
  Return,
  instancedArray,
  instanceIndex,
  uniform,
  select,
  attribute,
  Loop,
  float,
  cross,
  mix,
  normalFlat,
  transformNormalToView,
  triNoise3D,
  time,
  vec3,
  sin,
  cos,
  uint,
  directionToFaceDirection,
} from 'three/tsl';
import type { StorageInstancedBufferAttribute, WebGPURenderer } from 'three/webgpu';
import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from './InextensibleFlagSettings';

export interface InextensibleFlagSimulationOptions {
  width?: number;
  height?: number;
  segmentsX?: number;
  segmentsY?: number;
}

export interface InextensibleFlagSimulationStats {
  status: 'initializing' | 'running' | 'error';
  backend: string;
  particleCount: number;
  frameCount: number;
  checksum: number;
  spanX: number;
  spanY: number;
  spanZ: number;
  maxStretch: number;
  hasNaN: boolean;
  isHealthy: boolean;
}

interface ClothVertex {
  id: number;
  position: THREE.Vector3;
  gridX: number;
  gridY: number;
  isFixed: boolean;
  springIds: number[]; // incident PBD edge constraint ids (not force springs)
}

interface ClothEdge {
  id: number;
  vertex0: ClothVertex;
  vertex1: ClothVertex;
  kind: 'structural' | 'shear' | 'bend';
}

type StatusElement = HTMLElement;
type BackendElement = HTMLElement;
type ParticlesElement = HTMLElement;

declare global {
  interface Window {
    __flagSim?: InextensibleFlagSimulationStats;
    __flagSimRefreshHealth?: () => Promise<InextensibleFlagSimulationStats>;
  }
}

/**
 * Inextensible flag: Verlet predict (wind only) + PBD distance constraints on mesh edges.
 * No force-based springs.
 */
export class InextensibleFlagSimulation {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  clothMesh!: THREE.Mesh;
  clothGeometry!: THREE.BufferGeometry;
  clothMaterial!: THREE.MeshPhysicalNodeMaterial;
  readonly settings: InextensibleFlagSettings;

  private readonly statusEl: StatusElement;
  private readonly backendEl: BackendElement;
  private readonly particlesEl: ParticlesElement;

  private readonly clothWidth: number;
  private readonly clothHeight: number;
  private clothNumSegmentsX: number;
  private clothNumSegmentsY: number;

  private readonly clothVertices: ClothVertex[] = [];
  private readonly clothEdges: ClothEdge[] = [];
  private readonly clothVertexColumns: ClothVertex[][] = [];

  private vertexPositionBuffer!: ReturnType<typeof instancedArray>;
  private vertexPreviousBuffer!: ReturnType<typeof instancedArray>;
  private initialPositionBuffer!: ReturnType<typeof instancedArray>;
  private substepStartBuffer!: ReturnType<typeof instancedArray>;
  private vertexParamsBuffer!: ReturnType<typeof instancedArray>;
  private vertexGridBuffer!: ReturnType<typeof instancedArray>;
  private springVertexIdBuffer!: ReturnType<typeof instancedArray>;
  private springRestLengthBuffer!: ReturnType<typeof instancedArray>;
  private edgeKindBuffer!: ReturnType<typeof instancedArray>;
  private springCorrectionBuffer!: ReturnType<typeof instancedArray>;
  private springListBuffer!: ReturnType<typeof instancedArray>;

  private predictMotion!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private beginSubstep!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeDistanceCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeHardStructuralCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyDistanceCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private clampSubstepTravel!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolvePoleCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveSelfCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private enforcePins!: ReturnType<ReturnType<typeof Fn>['compute']>;

  private dampeningUniform!: ReturnType<typeof uniform>;
  private constraintRelaxationUniform!: ReturnType<typeof uniform>;
  private maxVertexStepUniform!: ReturnType<typeof uniform>;
  private maxSubstepTravelUniform!: ReturnType<typeof uniform>;
  private bendStiffnessUniform!: ReturnType<typeof uniform>;
  private minCompressionUniform!: ReturnType<typeof uniform>;
  private clothThicknessUniform!: ReturnType<typeof uniform>;
  private flatShadingUniform!: ReturnType<typeof uniform>;
  private renderNormalStepUniform!: ReturnType<typeof uniform>;
  private renderGeometrySmoothingUniform!: ReturnType<typeof uniform>;
  private poleAxisXUniform!: ReturnType<typeof uniform>;
  private poleCenterYUniform!: ReturnType<typeof uniform>;
  private poleHalfHeightUniform!: ReturnType<typeof uniform>;
  private poleRadiusBottomUniform!: ReturnType<typeof uniform>;
  private poleRadiusTopUniform!: ReturnType<typeof uniform>;
  private windUniform!: ReturnType<typeof uniform>;
  private windTurbulenceUniform!: ReturnType<typeof uniform>;
  private windDirectionUniform!: ReturnType<typeof uniform>;
  private gravityUniform!: ReturnType<typeof uniform>;
  private zoneAStrengthUniform!: ReturnType<typeof uniform>;
  private zoneARadiusUniform!: ReturnType<typeof uniform>;
  private zoneASpeedUniform!: ReturnType<typeof uniform>;
  private zoneADirectionUniform!: ReturnType<typeof uniform>;
  private zoneBStrengthUniform!: ReturnType<typeof uniform>;
  private zoneBRadiusUniform!: ReturnType<typeof uniform>;
  private zoneBSpeedUniform!: ReturnType<typeof uniform>;
  private zoneBDirectionUniform!: ReturnType<typeof uniform>;

  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private backLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;

  private readonly defaultCameraPosition = new THREE.Vector3(-2.2, 1.6, 2.4);
  private readonly defaultCameraTarget = new THREE.Vector3(0, 0.95, 0);
  private readonly flagHoistTopY = 1.35;
  private readonly poleAxisX: number;
  private readonly poleCenterY: number;
  private readonly poleHalfHeight: number;
  private readonly poleRadiusBottom = 0.04;
  private readonly poleRadiusTop = 0.03;

  private readonly timer = new THREE.Timer();
  private timeSinceLastStep = 0;
  private frameCount = 0;
  private checksum = 0;
  private spanX = 0;
  private spanY = 0;
  private spanZ = 0;
  private maxStretch = 1;
  private hasNaN = false;
  private isHealthy = false;

  private readonly stepsPerSecond = 360;
  private isReady = false;

  constructor(
    container: HTMLElement,
    statusEl: StatusElement,
    backendEl: BackendElement,
    particlesEl: ParticlesElement,
    options: InextensibleFlagSimulationOptions = {},
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.settings = defaultInextensibleFlagSettings();

    this.clothWidth = options.width ?? 1.6;
    this.clothHeight = options.height ?? 0.9;
    this.clothNumSegmentsX = options.segmentsX ?? this.settings.segmentsX;
    this.clothNumSegmentsY = options.segmentsY ?? this.settings.segmentsY;
    this.settings.segmentsX = this.clothNumSegmentsX;
    this.settings.segmentsY = this.clothNumSegmentsY;

    const poleHeight = this.clothHeight + 0.35;
    this.poleAxisX = -this.clothWidth * 0.5 - 0.05;
    this.poleCenterY = this.flagHoistTopY - this.clothHeight * 0.5;
    this.poleHalfHeight = poleHeight * 0.5;

    this.renderer = new THREE.WebGPURenderer({
      antialias: true,
      requiredLimits: { maxStorageBuffersInVertexStage: 1 },
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2438);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.01,
      30,
    );
    this.camera.position.copy(this.defaultCameraPosition);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.defaultCameraTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.update();

    this.setupLighting();
    this.addPole();
    this.setupClothGeometry();
    this.setupVertexBuffers();
    this.setupEdgeBuffers();
    this.setupUniforms();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);

    this.particlesEl.textContent = `particles: ${this.clothVertices.length}`;
    this.timer.connect(document);
    this.applySettings();
    this.applyHealthFromArray(
      (this.vertexPositionBuffer.value as StorageInstancedBufferAttribute).array as Float32Array,
    );
  }

  async init(): Promise<void> {
    await this.renderer.init();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name}`;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.isReady = true;
    this.setStatus('running');
  }

  resetCamera(): void {
    this.camera.position.copy(this.defaultCameraPosition);
    this.controls.target.copy(this.defaultCameraTarget);
    this.controls.update();
  }

  async rebuildRenderMesh(): Promise<void> {
    if (!this.clothMesh || !this.isReady) {
      return;
    }

    this.isReady = false;
    this.scene.remove(this.clothMesh);
    this.clothGeometry.dispose();
    this.clothMaterial.dispose();

    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);
    this.applySettings();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.isReady = true;
  }

  async rebuildFlag(): Promise<void> {
    this.isReady = false;
    this.clothNumSegmentsX = THREE.MathUtils.clamp(Math.round(this.settings.segmentsX), 4, 128);
    this.clothNumSegmentsY = THREE.MathUtils.clamp(Math.round(this.settings.segmentsY), 4, 96);
    this.settings.segmentsX = this.clothNumSegmentsX;
    this.settings.segmentsY = this.clothNumSegmentsY;

    this.scene.remove(this.clothMesh);
    this.clothGeometry.dispose();
    this.clothMaterial.dispose();

    this.clothVertices.length = 0;
    this.clothEdges.length = 0;
    this.clothVertexColumns.length = 0;

    this.setupClothGeometry();
    this.setupVertexBuffers();
    this.setupEdgeBuffers();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);

    this.particlesEl.textContent = `particles: ${this.clothVertices.length}`;
    this.timeSinceLastStep = 0;
    this.applySettings();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.isReady = true;
  }

  applySettings(): void {
    const s = this.settings;

    this.dampeningUniform.value = s.dampening;
    this.bendStiffnessUniform.value = s.bendStiffness;
    this.minCompressionUniform.value = s.minCompression;
    this.clothThicknessUniform.value = s.clothThickness;
    this.flatShadingUniform.value = s.flatShading ? 1 : 0;
    this.renderGeometrySmoothingUniform.value = s.renderGeometrySmoothing;
    this.windUniform.value = s.windStrength;
    this.windTurbulenceUniform.value = s.windTurbulence;
    this.windDirectionUniform.value.set(s.windDirectionX, s.windDirectionY, s.windDirectionZ);
    this.gravityUniform.value = s.gravity;
    this.zoneAStrengthUniform.value = s.zoneAStrength;
    this.zoneARadiusUniform.value = s.zoneARadius;
    this.zoneASpeedUniform.value = s.zoneASpeed;
    this.zoneADirectionUniform.value.set(s.zoneADirX, s.zoneADirY, s.zoneADirZ);
    this.zoneBStrengthUniform.value = s.zoneBStrength;
    this.zoneBRadiusUniform.value = s.zoneBRadius;
    this.zoneBSpeedUniform.value = s.zoneBSpeed;
    this.zoneBDirectionUniform.value.set(s.zoneBDirX, s.zoneBDirY, s.zoneBDirZ);

    this.renderer.toneMappingExposure = s.exposure;
    this.ambientLight.intensity = s.ambientIntensity;
    this.hemiLight.intensity = s.hemiIntensity;
    this.keyLight.intensity = s.keyLightIntensity;
    this.fillLight.intensity = s.fillLightIntensity;
    this.backLight.intensity = s.backLightIntensity;
    this.rimLight.intensity = s.rimLightIntensity;

    this.syncClothMaterial(this.clothMaterial);
  }

  private syncClothMaterial(material: THREE.MeshPhysicalNodeMaterial): void {
    const s = this.settings;

    material.color.set(s.flagColor);
    material.roughness = s.roughness;
    material.sheen = s.sheen;
    material.sheenRoughness = s.sheenRoughness;
    material.emissive.set(s.flagColor);
    material.emissiveIntensity = s.emissiveIntensity;
    material.sheenColor.set(s.flagColor);
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  update(): void {
    if (!this.isReady) {
      return;
    }

    this.timer.update();
    this.controls.update();

    const deltaTime = Math.min(this.timer.getDelta(), 1 / 60);
    const timePerStep = 1 / this.stepsPerSecond;
    this.timeSinceLastStep += deltaTime;

    while (this.timeSinceLastStep >= timePerStep) {
      this.timeSinceLastStep -= timePerStep;

      this.renderer.compute(this.enforcePins);
      this.renderer.compute(this.beginSubstep);
      this.renderer.compute(this.predictMotion);

      const iterations = THREE.MathUtils.clamp(
        Math.round(this.settings.constraintIterations),
        1,
        48,
      );

      for (let i = 0; i < iterations; i++) {
        this.renderer.compute(this.computeDistanceCorrections);
        this.renderer.compute(this.applyDistanceCorrections);
      }

      for (let i = 0; i < 3; i++) {
        this.renderer.compute(this.computeHardStructuralCorrections);
        this.renderer.compute(this.applyDistanceCorrections);
      }

      for (let i = 0; i < 2; i++) {
        if (this.settings.poleCollision) {
          this.renderer.compute(this.resolvePoleCollision);
        }
        if (this.settings.selfCollision) {
          this.renderer.compute(this.resolveSelfCollision);
        }
      }

      this.renderer.compute(this.clampSubstepTravel);
      this.renderer.compute(this.enforcePins);
    }

    this.frameCount += 1;

    if (this.frameCount % 12 === 0) {
      void this.refreshHealthFromGpu();
    } else {
      this.publishStats();
    }
  }

  async refreshHealthFromGpu(): Promise<InextensibleFlagSimulationStats> {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const buffer = await this.renderer.getArrayBufferAsync(attr);
    this.applyHealthFromArray(new Float32Array(buffer), attr.itemSize);
    this.publishStats();
    return this.getStats();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  getStats(): InextensibleFlagSimulationStats {
    return {
      status: this.statusEl.dataset.state as InextensibleFlagSimulationStats['status'],
      backend: this.renderer.backend.constructor.name,
      particleCount: this.clothVertices.length,
      frameCount: this.frameCount,
      checksum: this.checksum,
      spanX: this.spanX,
      spanY: this.spanY,
      spanZ: this.spanZ,
      maxStretch: this.maxStretch,
      hasNaN: this.hasNaN,
      isHealthy: this.isHealthy,
    };
  }

  private setStatus(status: InextensibleFlagSimulationStats['status']): void {
    this.statusEl.dataset.state = status;
    this.statusEl.textContent = status;
  }

  private publishStats(): void {
    window.__flagSim = this.getStats();

    const healthEl = document.querySelector<HTMLElement>('[data-testid="sim-health"]');
    if (healthEl) {
      healthEl.dataset.state = this.isHealthy ? 'ok' : 'bad';
      healthEl.textContent = this.isHealthy
        ? `health: ok (${this.spanX.toFixed(2)}×${this.spanY.toFixed(2)}m, stretch ${this.maxStretch.toFixed(3)})`
        : `health: bad (span ${this.spanX.toFixed(2)}×${this.spanY.toFixed(2)}, stretch ${this.maxStretch.toFixed(3)}, nan ${this.hasNaN})`;
    }
  }

  private applyHealthFromArray(array: Float32Array, vertexStride = 3): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let sum = 0;
    let nan = false;
    let worstStretch = 1;

    const sampleStride = Math.max(1, Math.floor(array.length / 128));
    for (let i = 0; i < array.length; i += sampleStride) {
      sum += array[i]!;
    }

    for (let v = 0; v < this.clothVertices.length; v++) {
      const i = v * vertexStride;
      const x = array[i]!;
      const y = array[i + 1]!;
      const z = array[i + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        nan = true;
        continue;
      }
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    for (const edge of this.clothEdges) {
      const i0 = edge.vertex0.id * vertexStride;
      const i1 = edge.vertex1.id * vertexStride;
      const ax = array[i0]!;
      const ay = array[i0 + 1]!;
      const az = array[i0 + 2]!;
      const bx = array[i1]!;
      const by = array[i1 + 1]!;
      const bz = array[i1 + 2]!;
      if (!Number.isFinite(ax + ay + az + bx + by + bz)) {
        continue;
      }
      const dist = Math.hypot(bx - ax, by - ay, bz - az);
      const rest = edge.vertex0.position.distanceTo(edge.vertex1.position);
      if (rest > 1e-6) {
        worstStretch = Math.max(worstStretch, dist / rest);
      }
    }

    this.checksum = sum;
    this.spanX = Number.isFinite(minX) ? maxX - minX : 0;
    this.spanY = Number.isFinite(minY) ? maxY - minY : 0;
    this.spanZ = Number.isFinite(minZ) ? maxZ - minZ : 0;
    this.maxStretch = worstStretch;
    this.hasNaN = nan;

    this.isHealthy =
      !nan &&
      this.spanX > 0.5 &&
      this.spanX < 4 &&
      this.spanY > 0.25 &&
      this.spanY < 2.5 &&
      this.spanZ < 4 &&
      worstStretch < 1.35;
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, this.settings.ambientIntensity);
    this.hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x2a3348, this.settings.hemiIntensity);

    this.keyLight = new THREE.DirectionalLight(0xfff4e8, this.settings.keyLightIntensity);
    this.keyLight.position.set(4, 6, 3);

    this.fillLight = new THREE.DirectionalLight(0xc8d8ff, this.settings.fillLightIntensity);
    this.fillLight.position.set(-5, 2, 4);

    this.backLight = new THREE.DirectionalLight(0xffd4c8, this.settings.backLightIntensity);
    this.backLight.position.set(2, 3, -5);

    this.rimLight = new THREE.DirectionalLight(0xffffff, this.settings.rimLightIntensity);
    this.rimLight.position.set(-3, 5, -2);

    this.scene.add(
      this.ambientLight,
      this.hemiLight,
      this.keyLight,
      this.fillLight,
      this.backLight,
      this.rimLight,
    );
  }

  private addPole(): void {
    const poleHeight = this.clothHeight + 0.35;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(this.poleRadiusTop, this.poleRadiusBottom, poleHeight, 12),
      new THREE.MeshStandardNodeMaterial({ color: 0x888899, roughness: 0.45, metalness: 0.35 }),
    );
    pole.position.set(this.poleAxisX, this.poleCenterY, 0);
    this.scene.add(pole);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4, 48),
      new THREE.MeshStandardNodeMaterial({ color: 0x243047, roughness: 0.92, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI * 0.5;
    ground.position.y = -0.55;
    this.scene.add(ground);
  }

  private setupClothGeometry(): void {
    const addVertex = (
      x: number,
      y: number,
      z: number,
      gridX: number,
      gridY: number,
      isFixed: boolean,
    ): ClothVertex => {
      const id = this.clothVertices.length;
      const vertex: ClothVertex = {
        id,
        position: new THREE.Vector3(x, y, z),
        gridX,
        gridY,
        isFixed,
        springIds: [],
      };
      this.clothVertices.push(vertex);
      return vertex;
    };

    const addEdge = (
      vertex0: ClothVertex,
      vertex1: ClothVertex,
      kind: ClothEdge['kind'] = 'structural',
    ): ClothEdge => {
      const id = this.clothEdges.length;
      const edge: ClothEdge = { id, vertex0, vertex1, kind };
      vertex0.springIds.push(id);
      vertex1.springIds.push(id);
      this.clothEdges.push(edge);
      return edge;
    };

    for (let x = 0; x <= this.clothNumSegmentsX; x++) {
      const column: ClothVertex[] = [];
      for (let y = 0; y <= this.clothNumSegmentsY; y++) {
        const posX = x * (this.clothWidth / this.clothNumSegmentsX) - this.clothWidth * 0.5;
        const posY = this.flagHoistTopY - y * (this.clothHeight / this.clothNumSegmentsY);
        const isHoistCorner = x === 0 && (y === 0 || y === this.clothNumSegmentsY);
        column.push(addVertex(posX, posY, 0, x, y, isHoistCorner));
      }
      this.clothVertexColumns.push(column);
    }

    for (let x = 0; x <= this.clothNumSegmentsX; x++) {
      for (let y = 0; y <= this.clothNumSegmentsY; y++) {
        const vertex0 = this.clothVertexColumns[x]![y]!;
        if (x > 0) addEdge(vertex0, this.clothVertexColumns[x - 1]![y]!, 'structural');
        if (y > 0) addEdge(vertex0, this.clothVertexColumns[x]![y - 1]!, 'structural');
        if (x > 0 && y > 0) {
          addEdge(vertex0, this.clothVertexColumns[x - 1]![y - 1]!, 'shear');
        }
        if (x > 0 && y < this.clothNumSegmentsY) {
          addEdge(vertex0, this.clothVertexColumns[x - 1]![y + 1]!, 'shear');
        }
        if (x > 1) {
          addEdge(vertex0, this.clothVertexColumns[x - 2]![y]!, 'bend');
        }
        if (y > 1) {
          addEdge(vertex0, this.clothVertexColumns[x]![y - 2]!, 'bend');
        }
      }
    }
  }

  private setupVertexBuffers(): void {
    const vertexCount = this.clothVertices.length;
    const springListArray: number[] = [];
    const vertexPositionArray = new Float32Array(vertexCount * 3);
    const vertexParamsArray = new Uint32Array(vertexCount * 3);
    const vertexGridArray = new Uint32Array(vertexCount * 2);

    for (let i = 0; i < vertexCount; i++) {
      const vertex = this.clothVertices[i]!;
      vertexPositionArray[i * 3] = vertex.position.x;
      vertexPositionArray[i * 3 + 1] = vertex.position.y;
      vertexPositionArray[i * 3 + 2] = vertex.position.z;
      vertexGridArray[i * 2] = vertex.gridX;
      vertexGridArray[i * 2 + 1] = vertex.gridY;
      vertexParamsArray[i * 3] = vertex.isFixed ? 1 : 0;

      if (!vertex.isFixed) {
        vertexParamsArray[i * 3 + 1] = vertex.springIds.length;
        vertexParamsArray[i * 3 + 2] = springListArray.length;
        springListArray.push(...vertex.springIds);
      }
    }

    this.vertexPositionBuffer = instancedArray(vertexPositionArray, 'vec3').setPBO(true);
    this.vertexPreviousBuffer = instancedArray(vertexPositionArray.slice(), 'vec3');
    this.initialPositionBuffer = instancedArray(vertexPositionArray.slice(), 'vec3');
    this.substepStartBuffer = instancedArray(vertexPositionArray.slice(), 'vec3');
    this.vertexParamsBuffer = instancedArray(vertexParamsArray, 'uvec3');
    this.vertexGridBuffer = instancedArray(new Uint32Array(vertexGridArray), 'uvec2');
    this.springListBuffer = instancedArray(new Uint32Array(springListArray), 'uint').setPBO(true);
  }

  private setupEdgeBuffers(): void {
    const edgeCount = this.clothEdges.length;
    const springVertexIdArray = new Uint32Array(edgeCount * 2);
    const springRestLengthArray = new Float32Array(edgeCount);
    const edgeKindArray = new Uint32Array(edgeCount);

    for (let i = 0; i < edgeCount; i++) {
      const edge = this.clothEdges[i]!;
      springVertexIdArray[i * 2] = edge.vertex0.id;
      springVertexIdArray[i * 2 + 1] = edge.vertex1.id;
      springRestLengthArray[i] = edge.vertex0.position.distanceTo(edge.vertex1.position);
      edgeKindArray[i] = edge.kind === 'bend' ? 1 : 0;
    }

    this.springVertexIdBuffer = instancedArray(springVertexIdArray, 'uvec2').setPBO(true);
    this.springRestLengthBuffer = instancedArray(springRestLengthArray, 'float');
    this.edgeKindBuffer = instancedArray(edgeKindArray, 'uint');
    this.springCorrectionBuffer = instancedArray(edgeCount, 'vec3');
  }

  private setupUniforms(): void {
    const s = this.settings;

    this.dampeningUniform = uniform(s.dampening);
    this.constraintRelaxationUniform = uniform(0.48);
    this.maxVertexStepUniform = uniform(0.012);
    this.maxSubstepTravelUniform = uniform(0.022);
    this.bendStiffnessUniform = uniform(s.bendStiffness);
    this.minCompressionUniform = uniform(s.minCompression);
    this.clothThicknessUniform = uniform(s.clothThickness);
    this.flatShadingUniform = uniform(s.flatShading ? 1 : 0);
    this.renderNormalStepUniform = uniform(0.5 / Math.max(1, s.renderSubdivisions));
    this.renderGeometrySmoothingUniform = uniform(s.renderGeometrySmoothing);
    this.poleAxisXUniform = uniform(this.poleAxisX);
    this.poleCenterYUniform = uniform(this.poleCenterY);
    this.poleHalfHeightUniform = uniform(this.poleHalfHeight);
    this.poleRadiusBottomUniform = uniform(this.poleRadiusBottom);
    this.poleRadiusTopUniform = uniform(this.poleRadiusTop);
    this.windUniform = uniform(s.windStrength);
    this.windTurbulenceUniform = uniform(s.windTurbulence);
    this.windDirectionUniform = uniform(new THREE.Vector3(s.windDirectionX, s.windDirectionY, s.windDirectionZ));
    this.gravityUniform = uniform(s.gravity);
    this.zoneAStrengthUniform = uniform(s.zoneAStrength);
    this.zoneARadiusUniform = uniform(s.zoneARadius);
    this.zoneASpeedUniform = uniform(s.zoneASpeed);
    this.zoneADirectionUniform = uniform(new THREE.Vector3(s.zoneADirX, s.zoneADirY, s.zoneADirZ));
    this.zoneBStrengthUniform = uniform(s.zoneBStrength);
    this.zoneBRadiusUniform = uniform(s.zoneBRadius);
    this.zoneBSpeedUniform = uniform(s.zoneBSpeed);
    this.zoneBDirectionUniform = uniform(new THREE.Vector3(s.zoneBDirX, s.zoneBDirY, s.zoneBDirZ));
  }

  private setupComputeShaders(): void {
    const vertexCount = this.clothVertices.length;
    const edgeCount = this.clothEdges.length;

    const vertexPositionBuffer = this.vertexPositionBuffer;
    const vertexPreviousBuffer = this.vertexPreviousBuffer;
    const substepStartBuffer = this.substepStartBuffer;
    const initialPositionBuffer = this.initialPositionBuffer;
    const vertexParamsBuffer = this.vertexParamsBuffer;
    const vertexGridBuffer = this.vertexGridBuffer;
    const springVertexIdBuffer = this.springVertexIdBuffer;
    const springRestLengthBuffer = this.springRestLengthBuffer;
    const edgeKindBuffer = this.edgeKindBuffer;
    const springCorrectionBuffer = this.springCorrectionBuffer;
    const springListBuffer = this.springListBuffer;
    const dampeningUniform = this.dampeningUniform;
    const constraintRelaxationUniform = this.constraintRelaxationUniform;
    const maxVertexStepUniform = this.maxVertexStepUniform;
    const maxSubstepTravelUniform = this.maxSubstepTravelUniform;
    const bendStiffnessUniform = this.bendStiffnessUniform;
    const minCompressionUniform = this.minCompressionUniform;
    const clothThicknessUniform = this.clothThicknessUniform;
    const poleAxisXUniform = this.poleAxisXUniform;
    const poleCenterYUniform = this.poleCenterYUniform;
    const poleHalfHeightUniform = this.poleHalfHeightUniform;
    const poleRadiusBottomUniform = this.poleRadiusBottomUniform;
    const poleRadiusTopUniform = this.poleRadiusTopUniform;
    const windUniform = this.windUniform;
    const windTurbulenceUniform = this.windTurbulenceUniform;
    const windDirectionUniform = this.windDirectionUniform;
    const gravityUniform = this.gravityUniform;
    const zoneAStrengthUniform = this.zoneAStrengthUniform;
    const zoneARadiusUniform = this.zoneARadiusUniform;
    const zoneASpeedUniform = this.zoneASpeedUniform;
    const zoneADirectionUniform = this.zoneADirectionUniform;
    const zoneBStrengthUniform = this.zoneBStrengthUniform;
    const zoneBRadiusUniform = this.zoneBRadiusUniform;
    const zoneBSpeedUniform = this.zoneBSpeedUniform;
    const zoneBDirectionUniform = this.zoneBDirectionUniform;

    this.predictMotion = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        const pinned = initialPositionBuffer.element(instanceIndex);
        vertexPositionBuffer.element(instanceIndex).assign(pinned);
        vertexPreviousBuffer.element(instanceIndex).assign(pinned);
        Return();
      });

      const current = vertexPositionBuffer.element(instanceIndex).toVar('current');
      const previous = vertexPreviousBuffer.element(instanceIndex);
      const velocity = current.sub(previous).mul(dampeningUniform).toVar('velocity');

      velocity.y.subAssign(gravityUniform);

      const zoneCenterA = vec3(
        sin(time.mul(zoneASpeedUniform)).mul(1.2),
        float(0.35),
        cos(time.mul(zoneASpeedUniform.mul(0.7))).mul(0.8),
      );
      const zoneCenterB = vec3(
        sin(time.mul(zoneBSpeedUniform).add(2.1)).mul(-1.0),
        float(0.15),
        cos(time.mul(zoneBSpeedUniform.mul(1.2).add(1.4))).mul(1.4),
      );

      const zoneDirA = vec3(
        zoneADirectionUniform.x,
        zoneADirectionUniform.y,
        zoneADirectionUniform.z,
      ).normalize();
      const zoneDirB = vec3(
        zoneBDirectionUniform.x,
        zoneBDirectionUniform.y,
        zoneBDirectionUniform.z,
      ).normalize();

      const distA = current.sub(zoneCenterA).length();
      const distB = current.sub(zoneCenterB).length();
      const weightA = float(1.0)
        .sub(distA.div(zoneARadiusUniform))
        .max(0.0)
        .mul(0.00012)
        .mul(zoneAStrengthUniform.mul(3.5).div(zoneAStrengthUniform.add(3.5)));
      const weightB = float(1.0)
        .sub(distB.div(zoneBRadiusUniform))
        .max(0.0)
        .mul(0.0001)
        .mul(zoneBStrengthUniform.mul(3.5).div(zoneBStrengthUniform.add(3.5)));

      const saturatedWind = windUniform.mul(3.5).div(windUniform.add(3.5));
      const globalWindDir = vec3(
        windDirectionUniform.x,
        windDirectionUniform.y,
        windDirectionUniform.z,
      ).normalize();
      const noise = triNoise3D(current, 1, time).sub(0.2).mul(0.0001).mul(windTurbulenceUniform);
      const globalWind = globalWindDir.dot(vec3(1, 0, 0)).mul(0.00006);
      const windForce = noise
        .add(weightA.mul(zoneDirA.dot(vec3(1, 0, 0))))
        .add(weightB.mul(zoneDirB.dot(vec3(-1, 0, 0))))
        .add(globalWind)
        .mul(saturatedWind);

      velocity.z.addAssign(windForce);
      velocity.x.addAssign(weightA.mul(zoneDirA.x).mul(0.00008));
      velocity.x.addAssign(weightB.mul(zoneDirB.x).mul(0.00006));
      velocity.y.addAssign(globalWindDir.y.mul(0.00004).mul(saturatedWind));

      const maxVelocity = float(0.018);
      const velocityLength = velocity.length().toVar('velocityLength');
      If(velocityLength.greaterThan(maxVelocity), () => {
        velocity.assign(velocity.mul(maxVelocity.div(velocityLength)));
      });

      vertexPreviousBuffer.element(instanceIndex).assign(current);
      vertexPositionBuffer.element(instanceIndex).assign(current.add(velocity));
    })()
      .compute(vertexCount)
      .setName('Predict Motion');

    this.beginSubstep = Fn(() => {
      const current = vertexPositionBuffer.element(instanceIndex);
      substepStartBuffer.element(instanceIndex).assign(current);
    })()
      .compute(vertexCount)
      .setName('Begin Substep');

    this.computeDistanceCorrections = Fn(() => {
      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const restLength = springRestLengthBuffer.element(instanceIndex);
      const edgeKind = edgeKindBuffer.element(instanceIndex);

      const vertex0Position = vertexPositionBuffer.element(vertexIds.x);
      const vertex1Position = vertexPositionBuffer.element(vertexIds.y);

      const delta = vertex1Position.sub(vertex0Position).toVar();
      const dist = delta.length().max(0.000001).toVar();

      const isBend = edgeKind.equal(uint(1));
      const stretch = dist.sub(restLength).max(float(0));
      const squeeze = restLength.mul(minCompressionUniform).sub(dist).max(float(0)).mul(float(0.55));
      const structuralViolation = stretch.sub(squeeze);
      const bendViolation = dist.sub(restLength).mul(bendStiffnessUniform);
      const violation = select(isBend, bendViolation, structuralViolation);
      const correction = delta.mul(violation.div(dist)).mul(constraintRelaxationUniform);
      springCorrectionBuffer.element(instanceIndex).assign(correction);
    })()
      .compute(edgeCount)
      .setName('Distance Corrections');

    this.computeHardStructuralCorrections = Fn(() => {
      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const restLength = springRestLengthBuffer.element(instanceIndex);
      const edgeKind = edgeKindBuffer.element(instanceIndex);

      If(edgeKind.equal(uint(1)), () => {
        springCorrectionBuffer.element(instanceIndex).assign(vec3(0, 0, 0));
        Return();
      });

      const vertex0Position = vertexPositionBuffer.element(vertexIds.x);
      const vertex1Position = vertexPositionBuffer.element(vertexIds.y);

      const delta = vertex1Position.sub(vertex0Position).toVar();
      const dist = delta.length().max(0.000001).toVar();
      const stretch = dist.sub(restLength).max(float(0));
      const squeeze = restLength.mul(minCompressionUniform).sub(dist).max(float(0));
      const violation = stretch.sub(squeeze);
      const correction = delta.mul(violation.div(dist));
      springCorrectionBuffer.element(instanceIndex).assign(correction);
    })()
      .compute(edgeCount)
      .setName('Hard Structural Corrections');

    this.applyDistanceCorrections = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;
      const edgeCountVar = params.y;
      const edgePointer = params.z;

      If(isFixed, () => {
        Return();
      });

      const positionDelta = vec3(float(0), float(0), float(0)).toVar('positionDelta');
      const ptrStart = edgePointer.toVar('ptrStart');
      const ptrEnd = ptrStart.add(edgeCountVar).toVar('ptrEnd');

      Loop({ start: ptrStart, end: ptrEnd, type: 'uint', condition: '<' }, ({ i }) => {
        const edgeId = springListBuffer.element(i).toVar('edgeId');
        const correction = springCorrectionBuffer.element(edgeId);
        const edgeVertexIds = springVertexIdBuffer.element(edgeId);
        const isVertex0 = edgeVertexIds.x.equal(instanceIndex);
        const otherId = select(isVertex0, edgeVertexIds.y, edgeVertexIds.x);
        const otherIsFixed = vertexParamsBuffer.element(otherId).x.equal(uint(1));
        const split = select(otherIsFixed, float(1.0), float(0.5));
        const delta = select(isVertex0, correction.mul(split), correction.mul(split).negate());
        positionDelta.addAssign(delta);
      });

      const deltaLength = positionDelta.length().toVar('deltaLength');
      If(deltaLength.greaterThan(maxVertexStepUniform), () => {
        positionDelta.assign(positionDelta.mul(maxVertexStepUniform.div(deltaLength)));
      });

      vertexPositionBuffer.element(instanceIndex).addAssign(positionDelta);
    })()
      .compute(vertexCount)
      .setName('Apply Distance Corrections');

    this.clampSubstepTravel = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        Return();
      });

      const start = substepStartBuffer.element(instanceIndex).toVar('substepStart');
      const current = vertexPositionBuffer.element(instanceIndex).toVar('current');
      const offset = current.sub(start).toVar('offset');
      const travel = offset.length().toVar('travel');

      If(travel.greaterThan(maxSubstepTravelUniform), () => {
        const clamped = start.add(offset.mul(maxSubstepTravelUniform.div(travel)));
        vertexPositionBuffer.element(instanceIndex).assign(clamped);
        vertexPreviousBuffer.element(instanceIndex).assign(clamped);
      });
    })()
      .compute(vertexCount)
      .setName('Clamp Substep Travel');

    this.resolvePoleCollision = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex).toVar('position');
      const poleYMin = poleCenterYUniform.sub(poleHalfHeightUniform);
      const poleYMax = poleCenterYUniform.add(poleHalfHeightUniform);

      If(position.y.lessThan(poleYMin).or(position.y.greaterThan(poleYMax)), () => {
        Return();
      });

      const poleSpan = poleHalfHeightUniform.mul(2.0).max(0.0001);
      const heightT = position.y.sub(poleYMin).div(poleSpan);
      const poleRadius = poleRadiusBottomUniform
        .mul(float(1.0).sub(heightT))
        .add(poleRadiusTopUniform.mul(heightT))
        .add(clothThicknessUniform);

      const offsetX = position.x.sub(poleAxisXUniform);
      const offsetZ = position.z;
      const radialDist = offsetX.mul(offsetX).add(offsetZ.mul(offsetZ)).sqrt().toVar('radialDist');

      If(radialDist.lessThan(poleRadius), () => {
        const penetration = poleRadius.sub(radialDist);
        const pushX = select(
          radialDist.greaterThan(0.00001),
          offsetX.div(radialDist),
          float(1.0),
        );
        const pushZ = select(
          radialDist.greaterThan(0.00001),
          offsetZ.div(radialDist),
          float(0.0),
        );

        position.x.addAssign(pushX.mul(penetration));
        position.z.addAssign(pushZ.mul(penetration));
        vertexPositionBuffer.element(instanceIndex).assign(position);
      });
    })()
      .compute(vertexCount)
      .setName('Pole Collision');

    this.resolveSelfCollision = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex).toVar('position');
      const gridSelf = vertexGridBuffer.element(instanceIndex);
      const repulsion = vec3(float(0), float(0), float(0)).toVar('repulsion');
      const minSeparation = clothThicknessUniform.mul(2.0);
      const vertexCountVar = uint(vertexCount);

      Loop({ start: uint(0), end: vertexCountVar, type: 'uint', condition: '<' }, ({ i: otherIndex }) => {
        If(otherIndex.notEqual(instanceIndex), () => {
          const gridOther = vertexGridBuffer.element(otherIndex);
          const gridDeltaX = gridSelf.x.sub(gridOther.x).abs();
          const gridDeltaY = gridSelf.y.sub(gridOther.y).abs();
          const gridDistance = gridDeltaX.add(gridDeltaY);

          If(gridDistance.greaterThan(uint(2)), () => {
            const otherPosition = vertexPositionBuffer.element(otherIndex);
            const offset = position.sub(otherPosition).toVar('offset');
            const dist = offset.length().max(0.000001).toVar('dist');

            If(dist.lessThan(minSeparation), () => {
              const penetration = minSeparation.sub(dist).mul(float(0.5));
              repulsion.addAssign(offset.mul(penetration.div(dist)));
            });
          });
        });
      });

      const repulsionLength = repulsion.length().toVar('repulsionLength');
      If(repulsionLength.greaterThan(maxVertexStepUniform), () => {
        repulsion.assign(repulsion.mul(maxVertexStepUniform.div(repulsionLength)));
      });

      If(repulsionLength.greaterThan(0.0), () => {
        vertexPositionBuffer.element(instanceIndex).addAssign(repulsion);
      });
    })()
      .compute(vertexCount)
      .setName('Self Collision');

    this.enforcePins = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        const pinned = initialPositionBuffer.element(instanceIndex);
        vertexPositionBuffer.element(instanceIndex).assign(pinned);
        vertexPreviousBuffer.element(instanceIndex).assign(pinned);
      });
    })()
      .compute(vertexCount)
      .setName('Enforce Pins');
  }

  private createClothMaterial(): THREE.MeshPhysicalNodeMaterial {
    const vertexPositionBuffer = this.vertexPositionBuffer;
    const gridSizeY = this.clothNumSegmentsY + 1;
    const gridStrideY = uniform(gridSizeY);
    const gridMaxXUniform = uniform(this.clothNumSegmentsX);
    const gridMaxYUniform = uniform(this.clothNumSegmentsY);
    const normalSampleStep = this.renderNormalStepUniform;
    const geometrySmoothing = this.renderGeometrySmoothingUniform;

    const gridIndex = Fn(([gridX, gridY]) => gridX.mul(gridStrideY).add(gridY));

    const sampleGridPoint = Fn(([gridX, gridY]) => {
      const ix = uint(gridX.clamp(0, float(gridMaxXUniform)));
      const iy = uint(gridY.clamp(0, float(gridMaxYUniform)));
      return vertexPositionBuffer.element(gridIndex(ix, iy));
    });

    const catmullRom1D = Fn(([p0, p1, p2, p3, t]) => {
      const t2 = t.mul(t);
      const t3 = t2.mul(t);

      return p1
        .mul(2)
        .add(p2.sub(p0).mul(t))
        .add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t2))
        .add(p3.sub(p0).add(p1.mul(3)).sub(p2.mul(3)).mul(t3))
        .mul(0.5);
    });

    const sampleSimPositionLinear = Fn(([simGridX, simGridY]) => {
      const cx = simGridX.clamp(0, float(gridMaxXUniform));
      const cy = simGridY.clamp(0, float(gridMaxYUniform));
      const gridX0 = cx.floor();
      const gridY0 = cy.floor();
      const fx = cx.sub(gridX0);
      const fy = cy.sub(gridY0);
      const gx0 = uint(gridX0);
      const gy0 = uint(gridY0);
      const gx1 = select(gx0.lessThan(gridMaxXUniform), gx0.add(uint(1)), gx0);
      const gy1 = select(gy0.lessThan(gridMaxYUniform), gy0.add(uint(1)), gy0);

      const p00 = vertexPositionBuffer.element(gridIndex(gx0, gy0));
      const p10 = vertexPositionBuffer.element(gridIndex(gx1, gy0));
      const p01 = vertexPositionBuffer.element(gridIndex(gx0, gy1));
      const p11 = vertexPositionBuffer.element(gridIndex(gx1, gy1));

      const alongX0 = mix(p00, p10, fx);
      const alongX1 = mix(p01, p11, fx);

      return mix(alongX0, alongX1, fy);
    });

    const sampleSimPositionCatmull = Fn(([simGridX, simGridY]) => {
      const cx = simGridX.clamp(0, float(gridMaxXUniform));
      const cy = simGridY.clamp(0, float(gridMaxYUniform));
      const cellX = cx.floor();
      const cellY = cy.floor();
      const fx = cx.sub(cellX);
      const fy = cy.sub(cellY);

      const rowAt = Fn(([rowY, t]) =>
        catmullRom1D(
          sampleGridPoint(cellX.sub(1), rowY),
          sampleGridPoint(cellX, rowY),
          sampleGridPoint(cellX.add(1), rowY),
          sampleGridPoint(cellX.add(2), rowY),
          t,
        ),
      );

      const r0 = rowAt(cellY.sub(1), fx);
      const r1 = rowAt(cellY, fx);
      const r2 = rowAt(cellY.add(1), fx);
      const r3 = rowAt(cellY.add(2), fx);

      return catmullRom1D(r0, r1, r2, r3, fy);
    });

    const sampleSimPositionAvgCatmull = Fn(([simGridX, simGridY, stepScale]) => {
      const maxX = float(gridMaxXUniform);
      const maxY = float(gridMaxYUniform);
      const step = normalSampleStep.mul(stepScale);
      const center = sampleSimPositionCatmull(simGridX, simGridY);
      const left = sampleSimPositionCatmull(simGridX.sub(step).clamp(0, maxX), simGridY);
      const right = sampleSimPositionCatmull(simGridX.add(step).clamp(0, maxX), simGridY);
      const up = sampleSimPositionCatmull(simGridX, simGridY.sub(step).clamp(0, maxY));
      const down = sampleSimPositionCatmull(simGridX, simGridY.add(step).clamp(0, maxY));

      return center.add(left).add(right).add(up).add(down).mul(0.2);
    });

    const sampleSimPosition = Fn(([simGridX, simGridY]) => {
      const catmullBlend = geometrySmoothing.clamp(0, 1);
      const base = mix(
        sampleSimPositionLinear(simGridX, simGridY),
        sampleSimPositionCatmull(simGridX, simGridY),
        catmullBlend,
      );
      const relax1 = geometrySmoothing.sub(1).clamp(0, 1);
      const relaxed = sampleSimPositionAvgCatmull(simGridX, simGridY, float(2));
      const mid = mix(base, relaxed, relax1);
      const relax2 = geometrySmoothing.sub(2).clamp(0, 1);
      const extraRelaxed = sampleSimPositionAvgCatmull(simGridX, simGridY, float(4));

      return mix(mid, extraRelaxed, relax2);
    });

    const computeRenderWorldNormal = Fn(() => {
      const simCoord = attribute('simGridCoord');
      const simGridX = simCoord.x;
      const simGridY = simCoord.y;
      const step = normalSampleStep;
      const maxX = float(gridMaxXUniform);
      const maxY = float(gridMaxYUniform);

      const posL = sampleSimPosition(simGridX.sub(step).clamp(0, maxX), simGridY);
      const posR = sampleSimPosition(simGridX.add(step).clamp(0, maxX), simGridY);
      const posU = sampleSimPosition(simGridX, simGridY.sub(step).clamp(0, maxY));
      const posD = sampleSimPosition(simGridX, simGridY.add(step).clamp(0, maxY));
      const tangent = posR.sub(posL);
      const bitangent = posD.sub(posU);
      const normal = cross(tangent, bitangent);

      return normal.div(normal.length().max(1e-4)).normalize();
    });

    const smoothNormal = directionToFaceDirection(
      transformNormalToView(
        computeRenderWorldNormal().toVarying('vFlagNormal').normalize(),
      ),
    );

    const clothMaterial = new THREE.MeshPhysicalNodeMaterial({
      color: new THREE.Color(this.settings.flagColor),
      side: THREE.DoubleSide,
      roughness: this.settings.roughness,
      sheen: this.settings.sheen,
      sheenRoughness: this.settings.sheenRoughness,
      sheenColor: new THREE.Color(this.settings.flagColor),
      emissive: new THREE.Color(this.settings.flagColor),
      emissiveIntensity: this.settings.emissiveIntensity,
      envMapIntensity: 1.2,
    });

    clothMaterial.positionNode = Fn(() => {
      const simCoord = attribute('simGridCoord');
      return sampleSimPosition(simCoord.x, simCoord.y);
    })();

    clothMaterial.normalNode = select(
      this.flatShadingUniform.equal(uint(1)),
      normalFlat,
      smoothNormal,
    );

    return clothMaterial;
  }

  private setupClothMesh(clothMaterial: THREE.MeshPhysicalNodeMaterial): THREE.Mesh {
    const renderSubdiv = THREE.MathUtils.clamp(Math.round(this.settings.renderSubdivisions), 1, 10);
    this.settings.renderSubdivisions = renderSubdiv;
    this.renderNormalStepUniform.value = 0.5 / renderSubdiv;

    const renderCellsX = this.clothNumSegmentsX * renderSubdiv;
    const renderCellsY = this.clothNumSegmentsY * renderSubdiv;
    const renderGridSizeX = renderCellsX + 1;
    const renderGridSizeY = renderCellsY + 1;
    const vertexCount = renderGridSizeX * renderGridSizeY;
    const geometry = new THREE.BufferGeometry();
    const simGridCoordArray = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    const getRenderIndex = (gridX: number, gridY: number) => gridX * renderGridSizeY + gridY;

    for (let gridX = 0; gridX < renderGridSizeX; gridX++) {
      for (let gridY = 0; gridY < renderGridSizeY; gridY++) {
        const index = getRenderIndex(gridX, gridY);
        simGridCoordArray[index * 2] = gridX / renderSubdiv;
        simGridCoordArray[index * 2 + 1] = gridY / renderSubdiv;
      }
    }

    for (let gridX = 0; gridX < renderCellsX; gridX++) {
      for (let gridY = 0; gridY < renderCellsY; gridY++) {
        const i00 = getRenderIndex(gridX, gridY);
        const i10 = getRenderIndex(gridX + 1, gridY);
        const i01 = getRenderIndex(gridX, gridY + 1);
        const i11 = getRenderIndex(gridX + 1, gridY + 1);
        indices.push(i00, i10, i01);
        indices.push(i10, i11, i01);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geometry.setAttribute('simGridCoord', new THREE.BufferAttribute(simGridCoordArray, 2));
    geometry.setIndex(indices);
    this.clothGeometry = geometry;

    const mesh = new THREE.Mesh(geometry, clothMaterial);
    mesh.frustumCulled = false;
    mesh.name = 'inextensible-flag-mesh';
    this.scene.add(mesh);
    return mesh;
  }
}
