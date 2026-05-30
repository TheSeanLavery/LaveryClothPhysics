import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import type { WebGPURenderer } from 'three/webgpu';
import {
  createKimonoPattern,
  createTShirtPattern,
  createTubePattern,
  validateGarmentPattern,
  withPleats,
  type CardinalEdge,
  type GarmentPanel,
  type GarmentPattern,
  type GarmentSeam,
  type Vec2,
} from '../sim/garmentPatternGeometry';

export type GarmentSpawnType = 'tube' | 'skirt' | 'dress' | 't-shirt' | 'kimono';

interface FloatingGarment {
  readonly group: THREE.Group;
  readonly pattern: GarmentPattern;
  readonly particles: ClothParticle[];
  readonly panels: SimulatedPanel[];
  readonly constraints: ClothConstraint[];
  readonly constraintLines: ConstraintLine[];
  readonly velocity: THREE.Vector3;
  readonly angularVelocity: THREE.Vector3;
}

interface ClothParticle {
  readonly position: THREE.Vector3;
  readonly previous: THREE.Vector3;
  readonly invMass: number;
}

interface ClothConstraint {
  readonly a: number;
  readonly b: number;
  readonly restLength: number;
  readonly stiffness: number;
}

interface SimulatedPanel {
  readonly panel: GarmentPanel;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly particleIds: readonly number[];
  readonly segmentsX: number;
  readonly segmentsY: number;
}

interface ConstraintLine {
  readonly line: THREE.LineSegments;
  readonly particlePairs: readonly (readonly [number, number])[];
}

interface GarmentBuild {
  readonly group: THREE.Group;
  readonly particles: ClothParticle[];
  readonly panels: SimulatedPanel[];
  readonly constraints: ClothConstraint[];
  readonly constraintLines: ConstraintLine[];
}

interface DragState {
  readonly garment: FloatingGarment;
  readonly plane: THREE.Plane;
  readonly offset: THREE.Vector3;
}

interface GarmentSandboxSettings {
  spawnType: GarmentSpawnType;
  clothColor: string;
  showSeams: boolean;
  driftSpeed: number;
  spinSpeed: number;
}

const GARMENT_TYPES: GarmentSpawnType[] = ['tube', 'skirt', 'dress', 't-shirt', 'kimono'];
const FLOAT_BOUNDS = 3.2;
const PANEL_DEPTH_OFFSET = 0.006;
const CLOTH_DAMPING = 0.992;
const SOLVER_ITERATIONS = 7;
const STRUCTURAL_STIFFNESS = 0.96;
const SHEAR_STIFFNESS = 0.72;
const BEND_STIFFNESS = 0.18;
const SEAM_STIFFNESS = 0.88;

declare global {
  interface Window {
    __garmentSandboxSpawn?: (type?: GarmentSpawnType) => FloatingGarment;
    __garmentSandboxClear?: () => void;
    __garmentSandboxReset?: () => void;
  }
}

export class ZeroGravityGarmentSandbox {
  readonly renderer: WebGPURenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly settings: GarmentSandboxSettings = {
    spawnType: 'tube',
    clothColor: '#f2f4ff',
    showSeams: true,
    driftSpeed: 0.18,
    spinSpeed: 0.18,
  };

  private readonly statusEl: HTMLElement;
  private readonly backendEl: HTMLElement;
  private readonly particlesEl: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly garments: FloatingGarment[] = [];
  private dragState: DragState | null = null;
  private lastFrameTimeMs = performance.now();
  private spawnIndex = 0;

  constructor(
    container: HTMLElement,
    statusEl: HTMLElement,
    backendEl: HTMLElement,
    particlesEl: HTMLElement,
  ) {
    this.statusEl = statusEl;
    this.backendEl = backendEl;
    this.particlesEl = particlesEl;

    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.domElement.setAttribute('data-testid', 'sim-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x08111f);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 60);
    this.camera.position.set(0, 1.1, 5.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.65, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 12;
    this.controls.update();

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.45));
    const hemi = new THREE.HemisphereLight(0xbad5ff, 0x263348, 1.8);
    const key = new THREE.DirectionalLight(0xfff2df, 4.8);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9ec5ff, 2.4);
    rim.position.set(-4, 3, -5);
    this.scene.add(hemi, key, rim, this.createZeroGrid());

    this.bindPointerEvents();
    this.spawnStarterSet();
    this.updateStats();
  }

  async init(): Promise<void> {
    await this.renderer.init();

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name} (zero-g garments)`;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.statusEl.dataset.state = 'running';
    this.statusEl.textContent = 'running (zero gravity garments)';
  }

  spawnGarment(type: GarmentSpawnType = this.settings.spawnType): FloatingGarment {
    const pattern = this.createPattern(type);
    const build = this.createGarmentBuild(pattern, type);
    const group = build.group;
    const lane = (this.spawnIndex % 5) - 2;
    const row = Math.floor(this.spawnIndex / 5) % 2;
    group.position.set(lane * 1.05, 0.45 + row * 0.85, -0.35 + row * 0.35);
    group.rotation.y = (lane * Math.PI) / 14;
    this.scene.add(group);

    const garment: FloatingGarment = {
      group,
      pattern,
      particles: build.particles,
      panels: build.panels,
      constraints: build.constraints,
      constraintLines: build.constraintLines,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * this.settings.driftSpeed,
        (Math.random() - 0.5) * this.settings.driftSpeed * 0.45,
        (Math.random() - 0.5) * this.settings.driftSpeed,
      ),
      angularVelocity: new THREE.Vector3(
        (Math.random() - 0.5) * this.settings.spinSpeed,
        (Math.random() - 0.5) * this.settings.spinSpeed,
        (Math.random() - 0.5) * this.settings.spinSpeed,
      ),
    };

    this.garments.push(garment);
    this.spawnIndex += 1;
    this.updateStats();
    return garment;
  }

  spawnStarterSet(): void {
    for (const type of GARMENT_TYPES) {
      this.spawnGarment(type);
    }
  }

  clearGarments(): void {
    for (const garment of this.garments) {
      this.scene.remove(garment.group);
      garment.group.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
        }
      });
    }
    this.garments.length = 0;
    this.dragState = null;
    this.spawnIndex = 0;
    this.updateStats();
  }

  resetStarterSet(): void {
    this.clearGarments();
    this.spawnStarterSet();
  }

  setSpawnType(type: GarmentSpawnType): void {
    this.settings.spawnType = type;
  }

  resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrameTimeMs) / 1000, 0.05);
    this.lastFrameTimeMs = now;
    this.controls.update();
    this.stepClothSimulation(dt);
    this.stepFloatingGarments(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private createPattern(type: GarmentSpawnType): GarmentPattern {
    if (type === 'tube') {
      return createTubePattern({
        id: `tube-${this.spawnIndex}`,
        label: 'Tube',
        circumference: 1.65,
        height: 1.05,
        panelCount: 6,
      });
    }

    if (type === 'skirt') {
      return withPleats(
        createTubePattern({
          id: `skirt-${this.spawnIndex}`,
          label: 'Pleated skirt',
          circumference: 1.5,
          height: 0.95,
          panelCount: 8,
          flareRatio: 1.75,
        }),
        {
          panelId: 'tube-panel-0',
          count: 10,
          depth: 0.035,
          from: [0, 0.86],
          to: [0.35, 0.86],
        },
      );
    }

    if (type === 'dress') {
      return createTubePattern({
        id: `dress-${this.spawnIndex}`,
        label: 'Dress shell',
        circumference: 1.85,
        height: 1.65,
        panelCount: 8,
        flareRatio: 1.45,
      });
    }

    if (type === 't-shirt') {
      return createTShirtPattern({
        id: `shirt-${this.spawnIndex}`,
        chestWidth: 1.0,
        torsoHeight: 1.0,
        sleeveLength: 0.48,
        sleeveOpening: 0.32,
      });
    }

    return createKimonoPattern({
      id: `kimono-${this.spawnIndex}`,
      bodyWidth: 1.25,
      bodyHeight: 1.2,
      sleeveLength: 0.65,
      sleeveWidth: 0.42,
    });
  }

  private createGarmentBuild(pattern: GarmentPattern, type: GarmentSpawnType): GarmentBuild {
    const group = new THREE.Group();
    group.name = `zero-g-${pattern.id}`;
    group.userData.patternId = pattern.id;
    group.userData.garmentType = type;
    group.userData.simulatedCloth = true;

    const issues = validateGarmentPattern(pattern);
    const color = issues.length === 0 ? this.settings.clothColor : '#ffb86c';
    const material = new THREE.MeshPhysicalNodeMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0,
      sheen: 0.65,
      sheenRoughness: 0.68,
      envMapIntensity: 0.9,
    });

    const seamMaterial = new THREE.LineBasicNodeMaterial({
      color: issues.length === 0 ? 0x75c7ff : 0xffb86c,
      transparent: true,
      opacity: this.settings.showSeams ? 0.85 : 0,
    });
    const foldMaterial = new THREE.LineBasicNodeMaterial({
      color: 0xffe38a,
      transparent: true,
      opacity: this.settings.showSeams ? 0.7 : 0,
    });

    const particles: ClothParticle[] = [];
    const constraints: ClothConstraint[] = [];
    const panels: SimulatedPanel[] = [];
    const panelById = new Map<string, SimulatedPanel>();
    const constraintLines: ConstraintLine[] = [];

    for (const panel of pattern.panels) {
      const simPanel = this.createSimulatedPanel(panel, material, particles, constraints);
      panels.push(simPanel);
      panelById.set(panel.id, simPanel);
      group.add(simPanel.mesh);
    }

    for (const seam of pattern.seams) {
      const panelA = panelById.get(seam.a.panelId);
      const panelB = panelById.get(seam.b.panelId);
      if (!panelA || !panelB) {
        continue;
      }

      const pairs = this.addSeamConstraints(seam, panelA, panelB, constraints);
      if (pairs.length > 0) {
        const line = this.createConstraintLine(particles, pairs, seamMaterial, `seam-${seam.id}`);
        constraintLines.push(line);
        group.add(line.line);
      }
    }

    for (const modifier of pattern.modifiers) {
      if (modifier.type !== 'pleat') {
        continue;
      }
      const panel = panelById.get(modifier.panelId);
      if (!panel) {
        continue;
      }
      const foldLines = this.applyPleatModifier(panel, particles, modifier.count, modifier.depth);
      if (foldLines.length > 0) {
        const line = this.createConstraintLine(
          particles,
          foldLines,
          foldMaterial,
          `pleat-${modifier.id}`,
        );
        constraintLines.push(line);
        group.add(line.line);
      }
    }

    const scale = type === 'dress' ? 0.9 : 1;
    group.scale.setScalar(scale);
    return { group, particles, panels, constraints, constraintLines };
  }

  private createSimulatedPanel(
    panel: GarmentPanel,
    material: THREE.Material,
    particles: ClothParticle[],
    constraints: ClothConstraint[],
  ): SimulatedPanel {
    const segmentsX = Math.max(2, Math.min(panel.segmentsX, 28));
    const segmentsY = Math.max(2, Math.min(panel.segmentsY, 34));
    const geometry = new THREE.BufferGeometry();
    const particleIds: number[] = [];
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y <= segmentsY; y++) {
      for (let x = 0; x <= segmentsX; x++) {
        const u = x / segmentsX;
        const v = y / segmentsY;
        const position = this.panelUvToPlacedPoint(panel, u, v);
        const flutter = new THREE.Vector3(
          (Math.random() - 0.5) * 0.008,
          (Math.random() - 0.5) * 0.008,
          (Math.random() - 0.5) * 0.035,
        );
        const particle: ClothParticle = {
          position: position.clone().add(flutter),
          previous: position.clone().addScaledVector(flutter, 0.35),
          invMass: 1,
        };
        const particleId = particles.length;
        particles.push(particle);
        particleIds.push(particleId);
        positions.push(particle.position.x, particle.position.y, particle.position.z);
        uvs.push(u, v);
      }
    }

    const getLocalId = (x: number, y: number): number => y * (segmentsX + 1) + x;
    const getParticleId = (x: number, y: number): number => particleIds[getLocalId(x, y)]!;

    for (let y = 0; y < segmentsY; y++) {
      for (let x = 0; x < segmentsX; x++) {
        const i00 = getLocalId(x, y);
        const i10 = getLocalId(x + 1, y);
        const i01 = getLocalId(x, y + 1);
        const i11 = getLocalId(x + 1, y + 1);
        indices.push(i00, i10, i01, i10, i11, i01);
      }
    }

    for (let y = 0; y <= segmentsY; y++) {
      for (let x = 0; x <= segmentsX; x++) {
        if (x < segmentsX) {
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x, y),
            getParticleId(x + 1, y),
            STRUCTURAL_STIFFNESS,
          );
        }
        if (y < segmentsY) {
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x, y),
            getParticleId(x, y + 1),
            STRUCTURAL_STIFFNESS,
          );
        }
        if (x < segmentsX && y < segmentsY) {
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x, y),
            getParticleId(x + 1, y + 1),
            SHEAR_STIFFNESS,
          );
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x + 1, y),
            getParticleId(x, y + 1),
            SHEAR_STIFFNESS,
          );
        }
        if (x + 2 <= segmentsX) {
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x, y),
            getParticleId(x + 2, y),
            BEND_STIFFNESS,
          );
        }
        if (y + 2 <= segmentsY) {
          this.addConstraintBetweenParticles(
            constraints,
            particles,
            getParticleId(x, y),
            getParticleId(x, y + 2),
            BEND_STIFFNESS,
          );
        }
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = panel.id;
    mesh.userData.draggableGarment = true;
    return { panel, mesh, geometry, particleIds, segmentsX, segmentsY };
  }

  private panelUvToPlacedPoint(panel: GarmentPanel, u: number, v: number): THREE.Vector3 {
    const bottom = lerpVec2(panel.outline[0]!, panel.outline[1]!, u);
    const top = lerpVec2(panel.outline[3]!, panel.outline[2]!, u);
    const point = lerpVec2(bottom, top, v);
    const bounds = panelBounds(panel);
    const local = new THREE.Vector3(
      point[0] - bounds.center[0],
      point[1] - bounds.center[1],
      PANEL_DEPTH_OFFSET,
    );
    local.applyEuler(
      new THREE.Euler(
        panel.placement.rotation[0],
        panel.placement.rotation[1],
        panel.placement.rotation[2],
      ),
    );
    local.add(
      new THREE.Vector3(
        panel.placement.origin[0],
        panel.placement.origin[1],
        panel.placement.origin[2],
      ),
    );
    return local;
  }

  private addConstraintBetweenParticles(
    constraints: ClothConstraint[],
    particles: readonly ClothParticle[],
    a: number,
    b: number,
    stiffness: number,
    restLength = particles[a]!.position.distanceTo(particles[b]!.position),
  ): void {
    constraints.push({ a, b, restLength, stiffness });
  }

  private addSeamConstraints(
    seam: GarmentSeam,
    panelA: SimulatedPanel,
    panelB: SimulatedPanel,
    constraints: ClothConstraint[],
  ): (readonly [number, number])[] {
    const edgeA = this.edgeParticleIds(panelA, seam.a.edgeId, seam.a.reversed);
    const edgeB = this.edgeParticleIds(panelB, seam.b.edgeId, seam.b.reversed);
    const pairCount = Math.min(edgeA.length, edgeB.length);
    const pairs: (readonly [number, number])[] = [];

    for (let i = 0; i < pairCount; i++) {
      const aIndex = resampleIndex(i, pairCount, edgeA.length);
      const bIndex = resampleIndex(i, pairCount, edgeB.length);
      const a = edgeA[aIndex]!;
      const b = edgeB[bIndex]!;
      constraints.push({ a, b, restLength: 0, stiffness: SEAM_STIFFNESS });
      if (i % Math.max(1, Math.floor(pairCount / 10)) === 0) {
        pairs.push([a, b]);
      }
    }

    return pairs;
  }

  private edgeParticleIds(
    panel: SimulatedPanel,
    edge: CardinalEdge,
    reversed = false,
  ): number[] {
    const ids: number[] = [];
    const get = (x: number, y: number): number => panel.particleIds[y * (panel.segmentsX + 1) + x]!;

    if (edge === 'bottom') {
      for (let x = 0; x <= panel.segmentsX; x++) {
        ids.push(get(x, 0));
      }
    } else if (edge === 'top') {
      for (let x = 0; x <= panel.segmentsX; x++) {
        ids.push(get(x, panel.segmentsY));
      }
    } else if (edge === 'left') {
      for (let y = 0; y <= panel.segmentsY; y++) {
        ids.push(get(0, y));
      }
    } else {
      for (let y = 0; y <= panel.segmentsY; y++) {
        ids.push(get(panel.segmentsX, y));
      }
    }

    return reversed ? ids.reverse() : ids;
  }

  private applyPleatModifier(
    panel: SimulatedPanel,
    particles: readonly ClothParticle[],
    count: number,
    depth: number,
  ): (readonly [number, number])[] {
    const pairs: (readonly [number, number])[] = [];
    const steps = Math.max(1, count);
    const get = (x: number, y: number): number => panel.particleIds[y * (panel.segmentsX + 1) + x]!;

    for (let i = 0; i < steps; i++) {
      const column = Math.round(((i + 1) / (steps + 1)) * panel.segmentsX);
      const zOffset = (i % 2 === 0 ? 1 : -1) * depth;
      for (let y = 0; y <= panel.segmentsY; y++) {
        const particle = particles[get(column, y)]!;
        particle.position.z += zOffset;
        particle.previous.z += zOffset;
        if (y < panel.segmentsY) {
          pairs.push([get(column, y), get(column, y + 1)]);
        }
      }
    }

    return pairs;
  }

  private createConstraintLine(
    particles: readonly ClothParticle[],
    pairs: readonly (readonly [number, number])[],
    material: THREE.Material,
    name: string,
  ): ConstraintLine {
    const positions = new Float32Array(pairs.length * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line = new THREE.LineSegments(geometry, material);
    line.name = name;
    const constraintLine = { line, particlePairs: pairs };
    this.updateConstraintLine(constraintLine, particles);
    return constraintLine;
  }

  private stepClothSimulation(dt: number): void {
    const time = performance.now() * 0.001;
    for (const garment of this.garments) {
      for (let i = 0; i < garment.particles.length; i++) {
        const particle = garment.particles[i]!;
        const velocity = particle.position.clone().sub(particle.previous).multiplyScalar(CLOTH_DAMPING);
        particle.previous.copy(particle.position);
        const flutter = Math.sin(time * 1.7 + i * 0.37) * 0.006;
        particle.position.addScaledVector(velocity, Math.min(dt * 60, 1.4));
        particle.position.z += flutter * dt;
      }

      for (let i = 0; i < SOLVER_ITERATIONS; i++) {
        for (const constraint of garment.constraints) {
          this.satisfyConstraint(garment.particles, constraint);
        }
      }

      for (const panel of garment.panels) {
        this.updatePanelGeometry(panel, garment.particles);
      }
      for (const line of garment.constraintLines) {
        this.updateConstraintLine(line, garment.particles);
      }
    }
  }

  private satisfyConstraint(particles: readonly ClothParticle[], constraint: ClothConstraint): void {
    const a = particles[constraint.a]!;
    const b = particles[constraint.b]!;
    const delta = b.position.clone().sub(a.position);
    const distance = delta.length();
    if (distance < 1e-6) {
      return;
    }

    const invMassSum = a.invMass + b.invMass;
    if (invMassSum <= 0) {
      return;
    }

    const correction = delta.multiplyScalar(
      ((distance - constraint.restLength) / distance) * constraint.stiffness,
    );
    a.position.addScaledVector(correction, a.invMass / invMassSum);
    b.position.addScaledVector(correction, -b.invMass / invMassSum);
  }

  private updatePanelGeometry(panel: SimulatedPanel, particles: readonly ClothParticle[]): void {
    const positionAttr = panel.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < panel.particleIds.length; i++) {
      const particle = particles[panel.particleIds[i]!]!;
      positionAttr.setXYZ(i, particle.position.x, particle.position.y, particle.position.z);
    }
    positionAttr.needsUpdate = true;
    panel.geometry.computeVertexNormals();
  }

  private updateConstraintLine(line: ConstraintLine, particles: readonly ClothParticle[]): void {
    const positionAttr = line.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    let offset = 0;
    for (const [aId, bId] of line.particlePairs) {
      const a = particles[aId]!.position;
      const b = particles[bId]!.position;
      positionAttr.setXYZ(offset++, a.x, a.y, a.z);
      positionAttr.setXYZ(offset++, b.x, b.y, b.z);
    }
    positionAttr.needsUpdate = true;
  }

  private stepFloatingGarments(dt: number): void {
    for (const garment of this.garments) {
      if (this.dragState?.garment === garment) {
        continue;
      }

      garment.group.position.addScaledVector(garment.velocity, dt);
      garment.group.rotation.x += garment.angularVelocity.x * dt;
      garment.group.rotation.y += garment.angularVelocity.y * dt;
      garment.group.rotation.z += garment.angularVelocity.z * dt;
      this.bounceInsideBounds(garment);
    }
  }

  private bounceInsideBounds(garment: FloatingGarment): void {
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(garment.group.position[axis]) <= FLOAT_BOUNDS) {
        continue;
      }
      garment.group.position[axis] = Math.sign(garment.group.position[axis]) * FLOAT_BOUNDS;
      garment.velocity[axis] *= -0.85;
    }
  }

  private bindPointerEvents(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      this.updatePointer(event);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObjects(this.garments.map((garment) => garment.group), true);
      const hit = hits.find((candidate) => candidate.object.userData.draggableGarment);
      if (!hit) {
        return;
      }

      const garment = this.findGarmentForObject(hit.object);
      if (!garment) {
        return;
      }

      const planeNormal = new THREE.Vector3();
      this.camera.getWorldDirection(planeNormal);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        planeNormal,
        garment.group.position,
      );
      const intersection = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(plane, intersection);
      this.dragState = {
        garment,
        plane,
        offset: garment.group.position.clone().sub(intersection),
      };
      garment.velocity.set(0, 0, 0);
      this.controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      document.body.classList.add('grabbing');
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragState) {
        return;
      }

      this.updatePointer(event);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const intersection = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragState.plane, intersection)) {
        this.dragState.garment.group.position.copy(intersection.add(this.dragState.offset));
      }
    });

    const release = (event: PointerEvent): void => {
      if (!this.dragState) {
        return;
      }

      this.dragState.garment.velocity.set(
        (Math.random() - 0.5) * this.settings.driftSpeed * 0.45,
        (Math.random() - 0.5) * this.settings.driftSpeed * 0.25,
        (Math.random() - 0.5) * this.settings.driftSpeed * 0.45,
      );
      this.dragState = null;
      this.controls.enabled = true;
      document.body.classList.remove('grabbing');
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private findGarmentForObject(object: THREE.Object3D): FloatingGarment | undefined {
    return this.garments.find((garment) => {
      let current: THREE.Object3D | null = object;
      while (current) {
        if (current === garment.group) {
          return true;
        }
        current = current.parent;
      }
      return false;
    });
  }

  private createZeroGrid(): THREE.GridHelper {
    const grid = new THREE.GridHelper(7, 14, 0x284266, 0x17283e);
    grid.position.y = -1.25;
    grid.material.transparent = true;
    grid.material.opacity = 0.38;
    return grid;
  }

  private updateStats(): void {
    const panelCount = this.garments.reduce((sum, garment) => sum + garment.pattern.panels.length, 0);
    const seamCount = this.garments.reduce((sum, garment) => sum + garment.pattern.seams.length, 0);
    const particleCount = this.garments.reduce((sum, garment) => sum + garment.particles.length, 0);
    this.particlesEl.textContent = `garments: ${this.garments.length}, panels: ${panelCount}, seams: ${seamCount}, cloth particles: ${particleCount}`;
  }
}

export function createZeroGravityGarmentControls(sandbox: ZeroGravityGarmentSandbox): GUI {
  const gui = new GUI({ title: 'Zero-G Garments', width: 320 });
  gui.domElement.setAttribute('data-testid', 'garment-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  gui.domElement.style.right = '12px';
  gui.domElement.style.zIndex = '20';

  const actions = {
    spawn: () => sandbox.spawnGarment(),
    starterSet: () => sandbox.resetStarterSet(),
    clear: () => sandbox.clearGarments(),
  };

  const spawnFolder = gui.addFolder('Spawn');
  spawnFolder.add(sandbox.settings, 'spawnType', GARMENT_TYPES).name('Garment');
  spawnFolder.add(actions, 'spawn').name('Spawn selected');
  spawnFolder.add(actions, 'starterSet').name('Starter set');
  spawnFolder.add(actions, 'clear').name('Clear');
  spawnFolder.open();

  const motionFolder = gui.addFolder('Zero gravity motion');
  motionFolder.add(sandbox.settings, 'driftSpeed', 0, 0.8, 0.01).name('Drift');
  motionFolder.add(sandbox.settings, 'spinSpeed', 0, 1.2, 0.01).name('Spin');
  motionFolder.addColor(sandbox.settings, 'clothColor').name('New cloth color');
  motionFolder.add(sandbox.settings, 'showSeams').name('Show seams');

  return gui;
}

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function panelBounds(panel: GarmentPanel): { center: Vec2 } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of panel.outline) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5],
  };
}

function resampleIndex(index: number, outputCount: number, inputCount: number): number {
  if (outputCount <= 1 || inputCount <= 1) {
    return 0;
  }

  return Math.round((index / (outputCount - 1)) * (inputCount - 1));
}
