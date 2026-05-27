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
  transformNormalToView,
  cross,
  triNoise3D,
  time,
  vec3,
  sin,
  cos,
  directionToFaceDirection,
  uint,
} from 'three/tsl';
import type { StorageInstancedBufferAttribute, WebGPURenderer } from 'three/webgpu';
import { defaultFlagSettings, type FlagSettings } from './FlagSettings';

export interface FlagSimulationOptions {
  width?: number;
  height?: number;
  segmentsX?: number;
  segmentsY?: number;
}

export interface FlagSimulationStats {
  status: 'initializing' | 'running' | 'error';
  backend: string;
  particleCount: number;
  frameCount: number;
  checksum: number;
}

interface VerletVertex {
  id: number;
  position: THREE.Vector3;
  isFixed: boolean;
  springIds: number[];
}

interface VerletSpring {
  id: number;
  vertex0: VerletVertex;
  vertex1: VerletVertex;
}

type StatusElement = HTMLElement;
type BackendElement = HTMLElement;
type ParticlesElement = HTMLElement;

declare global {
  interface Window {
    __flagSim?: FlagSimulationStats;
  }
}

export class FlagSimulation {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  clothMesh!: THREE.Mesh;
  clothMaterial!: THREE.MeshPhysicalNodeMaterial;
  readonly settings: FlagSettings;

  private readonly statusEl: StatusElement;
  private readonly backendEl: BackendElement;
  private readonly particlesEl: ParticlesElement;

  private readonly clothWidth: number;
  private readonly clothHeight: number;
  private clothNumSegmentsX: number;
  private clothNumSegmentsY: number;

  private readonly verletVertices: VerletVertex[] = [];
  private readonly verletSprings: VerletSpring[] = [];
  private readonly verletVertexColumns: VerletVertex[][] = [];

  private vertexPositionBuffer!: ReturnType<typeof instancedArray>;
  private initialPositionBuffer!: ReturnType<typeof instancedArray>;
  private vertexForceBuffer!: ReturnType<typeof instancedArray>;
  private vertexParamsBuffer!: ReturnType<typeof instancedArray>;
  private springVertexIdBuffer!: ReturnType<typeof instancedArray>;
  private springRestLengthBuffer!: ReturnType<typeof instancedArray>;
  private springForceBuffer!: ReturnType<typeof instancedArray>;
  private springCorrectionBuffer!: ReturnType<typeof instancedArray>;
  private springListBuffer!: ReturnType<typeof instancedArray>;

  private computeSpringForces!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeVertexForces!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeSpringCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyVertexCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;

  private dampeningUniform!: ReturnType<typeof uniform>;
  private stiffnessUniform!: ReturnType<typeof uniform>;
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

  private readonly timer = new THREE.Timer();
  private timeSinceLastStep = 0;
  private frameCount = 0;
  private checksum = 0;

  private readonly stepsPerSecond = 360;
  private isReady = false;

  constructor(
    container: HTMLElement,
    statusEl: StatusElement,
    backendEl: BackendElement,
    particlesEl: ParticlesElement,
    options: FlagSimulationOptions = {},
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;
    this.settings = defaultFlagSettings();

    this.clothWidth = options.width ?? 1.6;
    this.clothHeight = options.height ?? 0.9;
    this.clothNumSegmentsX = options.segmentsX ?? this.settings.segmentsX;
    this.clothNumSegmentsY = options.segmentsY ?? this.settings.segmentsY;
    this.settings.segmentsX = this.clothNumSegmentsX;
    this.settings.segmentsY = this.clothNumSegmentsY;

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
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.update();

    this.setupLighting();
    this.addPole();
    this.setupVerletGeometry();
    this.setupVerletVertexBuffers();
    this.setupVerletSpringBuffers();
    this.setupUniforms();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);

    this.particlesEl.textContent = `particles: ${this.verletVertices.length}`;
    this.timer.connect(document);
    this.applySettings();
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

  async rebuildFlag(): Promise<void> {
    this.isReady = false;
    this.clothNumSegmentsX = THREE.MathUtils.clamp(Math.round(this.settings.segmentsX), 4, 128);
    this.clothNumSegmentsY = THREE.MathUtils.clamp(Math.round(this.settings.segmentsY), 4, 96);
    this.settings.segmentsX = this.clothNumSegmentsX;
    this.settings.segmentsY = this.clothNumSegmentsY;

    this.scene.remove(this.clothMesh);
    this.clothMesh.geometry.dispose();
    this.clothMaterial.dispose();

    this.verletVertices.length = 0;
    this.verletSprings.length = 0;
    this.verletVertexColumns.length = 0;

    this.setupVerletGeometry();
    this.setupVerletVertexBuffers();
    this.setupVerletSpringBuffers();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);

    this.particlesEl.textContent = `particles: ${this.verletVertices.length}`;
    this.timeSinceLastStep = 0;
    this.applySettings();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.isReady = true;
  }

  applySettings(): void {
    const s = this.settings;

    this.dampeningUniform.value = s.dampening;
    this.stiffnessUniform.value = s.stiffness;
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

    this.clothMaterial.color.set(s.flagColor);
    this.clothMaterial.roughness = s.roughness;
    this.clothMaterial.sheen = s.sheen;
    this.clothMaterial.sheenRoughness = s.sheenRoughness;
    this.clothMaterial.emissive.set(s.flagColor);
    this.clothMaterial.emissiveIntensity = s.emissiveIntensity;
    this.clothMaterial.sheenColor.set(s.flagColor);
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

      const iterations = THREE.MathUtils.clamp(Math.round(this.settings.solverIterations), 1, 32);

      // Pass 0: Verlet dynamics (wind, momentum). Passes 1+: PBD projection (stiffness).
      this.renderer.compute(this.computeSpringForces);
      this.renderer.compute(this.computeVertexForces);

      for (let i = 1; i < iterations; i++) {
        this.renderer.compute(this.computeSpringCorrections);
        this.renderer.compute(this.applyVertexCorrections);
      }
    }

    this.frameCount += 1;
    this.updateChecksum();
    this.publishStats();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  getStats(): FlagSimulationStats {
    return {
      status: this.statusEl.dataset.state as FlagSimulationStats['status'],
      backend: this.renderer.backend.constructor.name,
      particleCount: this.verletVertices.length,
      frameCount: this.frameCount,
      checksum: this.checksum,
    };
  }

  private setStatus(status: FlagSimulationStats['status']): void {
    this.statusEl.dataset.state = status;
    this.statusEl.textContent = status;
  }

  private publishStats(): void {
    window.__flagSim = this.getStats();
  }

  private updateChecksum(): void {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const array = attr.array as Float32Array;
    let sum = 0;
    const stride = Math.max(1, Math.floor(array.length / 128));
    for (let i = 0; i < array.length; i += stride) {
      sum += array[i]!;
    }
    this.checksum = sum;
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
    const poleCenterY = this.flagHoistTopY - this.clothHeight * 0.5;

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.04, poleHeight, 12),
      new THREE.MeshStandardNodeMaterial({ color: 0x888899, roughness: 0.45, metalness: 0.35 }),
    );
    pole.position.set(-this.clothWidth * 0.5 - 0.05, poleCenterY, 0);
    this.scene.add(pole);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4, 48),
      new THREE.MeshStandardNodeMaterial({ color: 0x243047, roughness: 0.92, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI * 0.5;
    ground.position.y = -0.55;
    this.scene.add(ground);
  }

  private setupVerletGeometry(): void {
    const addVerletVertex = (x: number, y: number, z: number, isFixed: boolean): VerletVertex => {
      const id = this.verletVertices.length;
      const vertex: VerletVertex = {
        id,
        position: new THREE.Vector3(x, y, z),
        isFixed,
        springIds: [],
      };
      this.verletVertices.push(vertex);
      return vertex;
    };

    const addVerletSpring = (vertex0: VerletVertex, vertex1: VerletVertex): VerletSpring => {
      const id = this.verletSprings.length;
      const spring: VerletSpring = { id, vertex0, vertex1 };
      vertex0.springIds.push(id);
      vertex1.springIds.push(id);
      this.verletSprings.push(spring);
      return spring;
    };

    for (let x = 0; x <= this.clothNumSegmentsX; x++) {
      const column: VerletVertex[] = [];
      for (let y = 0; y <= this.clothNumSegmentsY; y++) {
        const posX = x * (this.clothWidth / this.clothNumSegmentsX) - this.clothWidth * 0.5;
        const posY = this.flagHoistTopY - y * (this.clothHeight / this.clothNumSegmentsY);
        // Traditional vertical flag: hoist edge on the left, pinned at two corners only.
        const isHoistCorner = x === 0 && (y === 0 || y === this.clothNumSegmentsY);
        column.push(addVerletVertex(posX, posY, 0, isHoistCorner));
      }
      this.verletVertexColumns.push(column);
    }

    for (let x = 0; x <= this.clothNumSegmentsX; x++) {
      for (let y = 0; y <= this.clothNumSegmentsY; y++) {
        const vertex0 = this.verletVertexColumns[x]![y]!;
        if (x > 0) addVerletSpring(vertex0, this.verletVertexColumns[x - 1]![y]!);
        if (y > 0) addVerletSpring(vertex0, this.verletVertexColumns[x]![y - 1]!);
        if (x > 0 && y > 0) addVerletSpring(vertex0, this.verletVertexColumns[x - 1]![y - 1]!);
        if (x > 0 && y < this.clothNumSegmentsY) {
          addVerletSpring(vertex0, this.verletVertexColumns[x - 1]![y + 1]!);
        }
      }
    }
  }

  private setupVerletVertexBuffers(): void {
    const vertexCount = this.verletVertices.length;
    const springListArray: number[] = [];
    const vertexPositionArray = new Float32Array(vertexCount * 3);
    const vertexParamsArray = new Uint32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      const vertex = this.verletVertices[i]!;
      vertexPositionArray[i * 3] = vertex.position.x;
      vertexPositionArray[i * 3 + 1] = vertex.position.y;
      vertexPositionArray[i * 3 + 2] = vertex.position.z;
      vertexParamsArray[i * 3] = vertex.isFixed ? 1 : 0;

      if (!vertex.isFixed) {
        vertexParamsArray[i * 3 + 1] = vertex.springIds.length;
        vertexParamsArray[i * 3 + 2] = springListArray.length;
        springListArray.push(...vertex.springIds);
      }
    }

    this.vertexPositionBuffer = instancedArray(vertexPositionArray, 'vec3');
    this.initialPositionBuffer = instancedArray(vertexPositionArray.slice(), 'vec3');
    this.vertexForceBuffer = instancedArray(vertexCount, 'vec3');
    this.vertexParamsBuffer = instancedArray(vertexParamsArray, 'uvec3');
    this.springListBuffer = instancedArray(new Uint32Array(springListArray), 'uint').setPBO(true);
  }

  private setupVerletSpringBuffers(): void {
    const springCount = this.verletSprings.length;
    const springVertexIdArray = new Uint32Array(springCount * 2);
    const springRestLengthArray = new Float32Array(springCount);

    for (let i = 0; i < springCount; i++) {
      const spring = this.verletSprings[i]!;
      springVertexIdArray[i * 2] = spring.vertex0.id;
      springVertexIdArray[i * 2 + 1] = spring.vertex1.id;
      springRestLengthArray[i] = spring.vertex0.position.distanceTo(spring.vertex1.position);
    }

    this.springVertexIdBuffer = instancedArray(springVertexIdArray, 'uvec2').setPBO(true);
    this.springRestLengthBuffer = instancedArray(springRestLengthArray, 'float');
    this.springForceBuffer = instancedArray(springCount, 'vec3');
    this.springCorrectionBuffer = instancedArray(springCount, 'vec3');
  }

  private setupUniforms(): void {
    const s = this.settings;

    this.dampeningUniform = uniform(s.dampening);
    this.stiffnessUniform = uniform(s.stiffness);
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
    const vertexCount = this.verletVertices.length;
    const springCount = this.verletSprings.length;

    const springVertexIdBuffer = this.springVertexIdBuffer;
    const springRestLengthBuffer = this.springRestLengthBuffer;
    const springForceBuffer = this.springForceBuffer;
    const springCorrectionBuffer = this.springCorrectionBuffer;
    const vertexPositionBuffer = this.vertexPositionBuffer;
    const initialPositionBuffer = this.initialPositionBuffer;
    const vertexForceBuffer = this.vertexForceBuffer;
    const vertexParamsBuffer = this.vertexParamsBuffer;
    const springListBuffer = this.springListBuffer;
    const stiffnessUniform = this.stiffnessUniform;
    const dampeningUniform = this.dampeningUniform;
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

    this.computeSpringForces = Fn(() => {
      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const restLength = springRestLengthBuffer.element(instanceIndex);

      const vertex0Position = vertexPositionBuffer.element(vertexIds.x);
      const vertex1Position = vertexPositionBuffer.element(vertexIds.y);

      const delta = vertex1Position.sub(vertex0Position).toVar();
      const dist = delta.length().max(0.000001).toVar();
      const verletStiffness = stiffnessUniform.min(float(0.5));
      const force = dist.sub(restLength).mul(verletStiffness).mul(delta).mul(0.5).div(dist);
      springForceBuffer.element(instanceIndex).assign(force);
    })()
      .compute(springCount)
      .setName('Spring Forces');

    this.computeSpringCorrections = Fn(() => {
      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const restLength = springRestLengthBuffer.element(instanceIndex);

      const vertex0Position = vertexPositionBuffer.element(vertexIds.x);
      const vertex1Position = vertexPositionBuffer.element(vertexIds.y);

      const delta = vertex1Position.sub(vertex0Position).toVar();
      const dist = delta.length().max(0.000001).toVar();
      const constraintStiffness = stiffnessUniform.mul(0.5).min(float(1.0));
      const correction = delta.mul(dist.sub(restLength).div(dist)).mul(constraintStiffness);
      springCorrectionBuffer.element(instanceIndex).assign(correction);
    })()
      .compute(springCount)
      .setName('Spring Corrections');

    this.applyVertexCorrections = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;
      const springCountVar = params.y;
      const springPointer = params.z;

      If(isFixed, () => {
        vertexPositionBuffer.element(instanceIndex).assign(initialPositionBuffer.element(instanceIndex));
        Return();
      });

      const positionDelta = vec3(float(0), float(0), float(0)).toVar('positionDelta');
      const ptrStart = springPointer.toVar('ptrStart');
      const ptrEnd = ptrStart.add(springCountVar).toVar('ptrEnd');

      Loop({ start: ptrStart, end: ptrEnd, type: 'uint', condition: '<' }, ({ i }) => {
        const springId = springListBuffer.element(i).toVar('springId');
        const correction = springCorrectionBuffer.element(springId);
        const springVertexIds = springVertexIdBuffer.element(springId);
        const isVertex0 = springVertexIds.x.equal(instanceIndex);
        const otherId = select(isVertex0, springVertexIds.y, springVertexIds.x);
        const otherIsFixed = vertexParamsBuffer.element(otherId).x.equal(uint(1));
        const split = select(otherIsFixed, float(1.0), float(0.5));
        const delta = select(isVertex0, correction.mul(split), correction.mul(split).negate());
        positionDelta.addAssign(delta);
      });

      vertexPositionBuffer.element(instanceIndex).addAssign(positionDelta);
    })()
      .compute(vertexCount)
      .setName('Apply Corrections');

    this.computeVertexForces = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;
      const springCountVar = params.y;
      const springPointer = params.z;

      If(isFixed, () => {
        vertexPositionBuffer.element(instanceIndex).assign(initialPositionBuffer.element(instanceIndex));
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex).toVar('vertexPosition');
      const force = vertexForceBuffer.element(instanceIndex).toVar('vertexForce');

      force.mulAssign(dampeningUniform);

      const ptrStart = springPointer.toVar('ptrStart');
      const ptrEnd = ptrStart.add(springCountVar).toVar('ptrEnd');

      Loop({ start: ptrStart, end: ptrEnd, type: 'uint', condition: '<' }, ({ i }) => {
        const springId = springListBuffer.element(i).toVar('springId');
        const springForce = springForceBuffer.element(springId);
        const springVertexIds = springVertexIdBuffer.element(springId);
        const factor = select(springVertexIds.x.equal(instanceIndex), float(1.0), float(-1.0));
        force.addAssign(springForce.mul(factor));
      });

      force.y.subAssign(gravityUniform);

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

      const distA = position.sub(zoneCenterA).length();
      const distB = position.sub(zoneCenterB).length();
      const weightA = float(1.0)
        .sub(distA.div(zoneARadiusUniform))
        .max(0.0)
        .mul(0.00012)
        .mul(zoneAStrengthUniform);
      const weightB = float(1.0)
        .sub(distB.div(zoneBRadiusUniform))
        .max(0.0)
        .mul(0.0001)
        .mul(zoneBStrengthUniform);

      const globalWindDir = vec3(
        windDirectionUniform.x,
        windDirectionUniform.y,
        windDirectionUniform.z,
      ).normalize();
      const noise = triNoise3D(position, 1, time).sub(0.2).mul(0.0001).mul(windTurbulenceUniform);
      const globalWind = globalWindDir.dot(vec3(1, 0, 0)).mul(0.00006);
      const windForce = noise
        .add(weightA.mul(zoneDirA.dot(vec3(1, 0, 0))))
        .add(weightB.mul(zoneDirB.dot(vec3(-1, 0, 0))))
        .add(globalWind)
        .mul(windUniform);

      force.z.addAssign(windForce);
      force.x.addAssign(weightA.mul(zoneDirA.x).mul(0.00008));
      force.x.addAssign(weightB.mul(zoneDirB.x).mul(0.00006));
      force.y.addAssign(globalWindDir.y.mul(0.00004).mul(windUniform));

      vertexForceBuffer.element(instanceIndex).assign(force);
      vertexPositionBuffer.element(instanceIndex).addAssign(force);
    })()
      .compute(vertexCount)
      .setName('Vertex Forces');
  }

  private createClothMaterial(): THREE.MeshPhysicalNodeMaterial {
    const vertexPositionBuffer = this.vertexPositionBuffer;

    const computeFlagNormal = Fn(() => {
      const vertexIds = attribute('vertexIds');
      const v0 = vertexPositionBuffer.element(vertexIds.x).toVar();
      const v1 = vertexPositionBuffer.element(vertexIds.y).toVar();
      const v2 = vertexPositionBuffer.element(vertexIds.z).toVar();
      const v3 = vertexPositionBuffer.element(vertexIds.w).toVar();

      const top = v0.add(v1);
      const right = v1.add(v3);
      const bottom = v2.add(v3);
      const left = v0.add(v2);

      const tangent = right.sub(left).normalize();
      const bitangent = bottom.sub(top).normalize();
      const normal = cross(tangent, bitangent).normalize();

      return transformNormalToView(normal);
    });

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
      const vertexIds = attribute('vertexIds');
      const v0 = vertexPositionBuffer.element(vertexIds.x);
      const v1 = vertexPositionBuffer.element(vertexIds.y);
      const v2 = vertexPositionBuffer.element(vertexIds.z);
      const v3 = vertexPositionBuffer.element(vertexIds.w);

      return v0.add(v1).add(v2).add(v3).mul(0.25);
    })();

    // directionToFaceDirection runs in fragment stage and flips normals on back faces.
    // frontFacing always returns true in vertex shaders, so never flip there.
    clothMaterial.normalNode = directionToFaceDirection(computeFlagNormal().toVarying('vFlagNormal'));

    return clothMaterial;
  }

  private setupClothMesh(clothMaterial: THREE.MeshPhysicalNodeMaterial): THREE.Mesh {
    const vertexCount = this.clothNumSegmentsX * this.clothNumSegmentsY;
    const geometry = new THREE.BufferGeometry();
    const verletVertexIdArray = new Uint32Array(vertexCount * 4);
    const indices: number[] = [];

    const getIndex = (x: number, y: number) => y * this.clothNumSegmentsX + x;

    for (let x = 0; x < this.clothNumSegmentsX; x++) {
      for (let y = 0; y < this.clothNumSegmentsY; y++) {
        const index = getIndex(x, y);
        verletVertexIdArray[index * 4] = this.verletVertexColumns[x]![y]!.id;
        verletVertexIdArray[index * 4 + 1] = this.verletVertexColumns[x + 1]![y]!.id;
        verletVertexIdArray[index * 4 + 2] = this.verletVertexColumns[x]![y + 1]!.id;
        verletVertexIdArray[index * 4 + 3] = this.verletVertexColumns[x + 1]![y + 1]!.id;

        if (x > 0 && y > 0) {
          indices.push(getIndex(x, y), getIndex(x - 1, y), getIndex(x - 1, y - 1));
          indices.push(getIndex(x, y), getIndex(x - 1, y - 1), getIndex(x, y - 1));
        }
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geometry.setAttribute('vertexIds', new THREE.BufferAttribute(verletVertexIdArray, 4, false));
    geometry.setIndex(indices);

    const mesh = new THREE.Mesh(geometry, clothMaterial);
    mesh.frustumCulled = false;
    mesh.name = 'flag-mesh';
    this.scene.add(mesh);
    return mesh;
  }
}
