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
  min,
  max,
  abs,
  floor,
  normalFlat,
  triNoise3D,
  time,
  vec3,
  vec4,
  vec2,
  sin,
  cos,
  uint,
} from 'three/tsl';
import type { StorageInstancedBufferAttribute, WebGPURenderer } from 'three/webgpu';
import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from './InextensibleFlagSettings';
import { normalizeFlagSettings } from './settingsPreset';
import {
  analyzeSelfCollisionViolations,
  type SelfCollisionCompareResult,
  type SelfCollisionReport,
} from '../testing/selfCollisionAnalysis';
import {
  captureFlagCanvasRaw,
  compareFlagCanvasCaptures,
  type FlagCanvasCapture,
  type FlagCanvasCompare,
} from '../testing/flagCanvasCapture';
import {
  analyzeFlagRenderDiagnostics,
  projectSimVerticesToScreenBounds,
  type FlagMeshRegionAnalysis,
  type FlagRenderDiagnostics,
} from '../testing/flagMeshSampling';
import {
  configureMatteCottonFlagMaterial,
  updateMatteCottonFlagMaterial,
} from '../shaders/FlagClothMaterial';
import { createEdgeAwareSimSurfaceSampler } from '../shaders/clothEdgeAwareSurface';
import {
  createSimGridDebugOverlay,
  type SimGridDebugOverlay,
} from '../shaders/SimGridDebugOverlay';
import { BbProjectilePool } from './BbProjectilePool';
import type {
  FlagSettingsPresetSummary,
  StoredFlagSettingsPreset,
} from '../storage/flagSettingsDb';
import {
  buildEdgeStructuralDependencies,
  createSimStructuralEdgeLookup,
} from './clothEdgeDependencies';
import {
  buildClothGraphEdges,
  syncClothConnectivity,
  type SyncClothConnectivityOptions,
  type ClothGraphEdge,
} from './clothComponents';
import type { StrandThreadAuditResult } from '../testing/strandThreadAudit';
import {
  buildClothRenderQuads,
  buildClothSdfRenderMesh,
  collectStrandThreadEdgeIds,
  auditStrandThreadCoverage,
  countBrokenEdges,
  createSimEdgeLookup,
  rebuildClothIndicesFromEdgeState,
  rebuildClothIndicesFromSdfEdgeState,
  triangleCrossesBrokenStructuralEdge,
  type ClothRenderQuad,
  type ClothRenderTriangle,
  type ClothSdfRenderMesh,
  type SimEdgeLookup,
  type StructuralGraphEdge,
  type StrandThreadCollectionOptions,
} from './clothMeshCuts';
import { createBbProjectileMesh, syncBbProjectileMesh } from '../shaders/BbProjectileVisual';
import {
  createStrandThreadInstancedMesh,
  syncStrandThreadInstancedMesh,
  updateStrandThreadMaterial,
  type StrandThreadEdge,
} from '../shaders/StrandThreadVisual';
import {
  loadDenim512ClothTextures,
  type BakedClothTextureSet,
} from '../textures/loadBakedClothTextures';
import type { ClothAssembly } from '../cloth/patternAssembly';
import {
  buildAssemblyClothTopology,
  buildGridClothTopology,
  type ClothTopology,
} from './clothTopology';

export interface InextensibleFlagSimulationOptions {
  width?: number;
  height?: number;
  segmentsX?: number;
  segmentsY?: number;
  isolated?: boolean;
  pinMode?: 'hoistCorners' | 'none';
  initialShape?: 'plane' | 'tube';
  tubeRadius?: number;
  assembly?: ClothAssembly;
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
  centerX: number;
  centerY: number;
  centerZ: number;
  minY: number;
  maxY: number;
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
  restLengthOverride?: number;
}

interface ComponentRenderStats {
  vertices: number;
  cells: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hasFixed: boolean;
}

type StatusElement = HTMLElement;
type BackendElement = HTMLElement;
type ParticlesElement = HTMLElement;

declare global {
  interface Window {
    __flagSim?: InextensibleFlagSimulationStats;
    __flagSimRefreshHealth?: () => Promise<InextensibleFlagSimulationStats>;
    __flagSimSetFabric?: (settings: Partial<FabricTestSettings>) => void;
    __flagSimSetFabricTextureSource?: (
      source: InextensibleFlagSettings['fabricTextureSource'],
    ) => Promise<void>;
    __flagSimSetWind?: (strength: number) => void;
    __flagSimCaptureFlagCanvas?: () => Promise<FlagCanvasCapture | null>;
    __flagSimCompareFabric?: () => Promise<FabricWeaveCompareResult | null>;
    __flagSimAnalyzeBlackSpots?: () => Promise<FlagMeshRegionAnalysis | null>;
    __flagSimRenderDiagnostics?: () => Promise<FlagRenderDiagnostics | null>;
    __flagSimFabricTextureStats?: () => FabricNormalMapStats;
    __flagSimSetSelfCollision?: (enabled: boolean) => void;
    __flagSimResetFlag?: () => void;
    __flagSimSelfCollisionReport?: () => Promise<SelfCollisionReport>;
    __flagSimProbeSelfCollision?: (passes?: number) => Promise<number>;
    __flagSimCompareSelfCollision?: () => Promise<SelfCollisionCompareResult | null>;
    __flagSimGetSettings?: () => InextensibleFlagSettings;
    __flagSimApplySettings?: (partial: Partial<InextensibleFlagSettings>) => Promise<void>;
    __flagSimListSettingsPresets?: () => Promise<FlagSettingsPresetSummary[]>;
    __flagSimSaveSettingsPreset?: (
      name: string,
      existingId?: string,
    ) => Promise<StoredFlagSettingsPreset>;
    __flagSimLoadSettingsPreset?: (id: string) => Promise<StoredFlagSettingsPreset>;
    __flagSimDeleteSettingsPreset?: (id: string) => Promise<void>;
    __flagSimFireBb?: (ndcX: number, ndcY: number) => number | null;
    __flagSimReadBbSamples?: () => Promise<BbProjectileSample[]>;
    __flagSimMeasureBbMotion?: (options?: {
      ndcX?: number;
      ndcY?: number;
      sampleCount?: number;
    }) => Promise<BbMotionSmoothnessReport>;
    __flagSimMeasureBbClothBlocking?: (options?: {
      ndcX?: number;
      ndcY?: number;
      sampleCount?: number;
    }) => Promise<BbClothBlockingReport>;
    __flagSimAuditStrandThreads?: () => Promise<StrandThreadAuditResult | null>;
    __flagSimAuditRandomTears?: (
      options?: RandomTearGeometryAuditOptions,
    ) => RandomTearGeometryAuditReport | null;
    __flagSimApplyCornerTear?: (options?: CornerTearTestOptions) => void;
    __flagSimAuditVisibleWorldGeometry?: (
      options?: VisibleWorldGeometryAuditOptions,
    ) => Promise<VisibleWorldGeometryAuditReport | null>;
    __fabricPlaneSetDebugView?: (mode: 'shaded' | 'uv' | 'normalMap' | 'albedo') => void;
  }
}

export interface FabricTestSettings {
  fabricNormalStrength: number;
  fabricNormalScale: number;
  fabricTiling: number;
}

export interface FabricWeaveCompareResult {
  off: FlagCanvasCapture;
  on: FlagCanvasCapture;
  compare: FlagCanvasCompare;
}

export type { SelfCollisionCompareResult, SelfCollisionReport };

export interface BbProjectileSample {
  slot: number;
  alive: boolean;
  position: { x: number; y: number; z: number };
  meshPosition: { x: number; y: number; z: number } | null;
  velocity: { x: number; y: number; z: number };
}

export interface BbMotionSmoothnessReport {
  slot: number;
  sampleCount: number;
  aliveSamples: number;
  stuckFrames: number;
  maxGpuMeshError: number;
  minStep: number;
  maxStep: number;
  medianStep: number;
  maxJumpRatio: number;
  averageSpeed: number;
  expectedSpeed: number;
  smooth: boolean;
  issues: string[];
}

export interface BbClothBlockingReport {
  slot: number;
  sampleCount: number;
  minDistanceToFlag: number;
  minSurfaceGap: number;
  closestSpeed: number;
  initialSpeed: number;
  velocityReversed: boolean;
  speedReduced: boolean;
  phasedThrough: boolean;
  blocked: boolean;
  issues: string[];
}

export interface RandomTearGeometryAuditOptions {
  seed?: number;
  samples?: number;
  tearsPerSample?: number;
  maxSimTriangleEdge?: number;
}

export interface RandomTearGeometryAuditReport {
  samples: number;
  trianglesChecked: number;
  brokenEdgeCount: number;
  maxSimTriangleEdge: number;
  crossComponentTriangles: number;
  brokenEdgeCrossingTriangles: number;
  overlongTriangles: number;
  issues: string[];
}

export interface CornerTearTestOptions {
  corner?: 'flyTop' | 'flyBottom' | 'hoistTop' | 'hoistBottom';
  radius?: number;
}

export interface VisibleWorldGeometryAuditOptions {
  maxWorldTriangleEdge?: number;
}

export interface VisibleWorldGeometryAuditReport {
  trianglesChecked: number;
  maxWorldTriangleEdge: number;
  overlongWorldTriangles: number;
  issues: string[];
}

export interface BoneSdfCapsuleSample {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly radius: number;
}

interface FabricNormalMapStats {
  size: number;
  varianceR: number;
  varianceG: number;
  varianceB: number;
  maxChannelRange: number;
}

const MAX_BONE_SDF_CAPSULES = 96;

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

  private simGridDebugOverlay: SimGridDebugOverlay | null = null;

  private readonly statusEl: StatusElement;
  private readonly backendEl: BackendElement;
  private readonly particlesEl: ParticlesElement;

  private readonly clothWidth: number;
  private readonly clothHeight: number;
  private readonly isolatedMode: boolean;
  private readonly pinMode: 'hoistCorners' | 'none';
  private readonly initialShape: 'plane' | 'tube';
  private readonly tubeRadius: number;
  private activeAssembly: ClothAssembly | null;
  private activeTopology: ClothTopology | null = null;
  private assemblyRenderVertexSimIds: number[] = [];
  private topologyMode: 'grid' | 'tube' | 'assembly';
  private clothNumSegmentsX: number;
  private clothNumSegmentsY: number;

  private readonly clothVertices: ClothVertex[] = [];
  private readonly clothEdges: ClothEdge[] = [];
  private clothGraphEdges: ClothGraphEdge[] = [];
  private structuralGraphEdges: StructuralGraphEdge[] = [];
  private readonly clothVertexColumns: ClothVertex[][] = [];
  private readonly simHorizontalEdgeIds: number[] = [];
  private readonly simVerticalEdgeIds: number[] = [];
  private readonly simShearDownEdgeIds: number[] = [];
  private readonly simShearUpEdgeIds: number[] = [];
  private simEdgeLookup: SimEdgeLookup | null = null;
  private clothRenderQuads: ClothRenderQuad[] = [];
  private clothSimGridCoords: Float32Array | null = null;
  private visibleClothSimGridCoords: Float32Array | null = null;
  private particleRenderBaseIndices: Uint32Array | null = null;
  private particleRenderTriangleEdgeIds: Int32Array | null = null;
  private clothTopologyReadbackPending = false;
  private lastBrokenEdgeCount = 0;
  private lastConnectivitySignature = '';
  private bbVisualRefreshPending = false;
  private strandThreadMesh: THREE.InstancedMesh | null = null;
  private strandThreadEdgeVertices: StrandThreadEdge[] = [];
  private strandThreadReadbackPending = false;
  private lastStrandThreadEdgeIds: number[] = [];
  private lastSyncedEdgeActive: Uint32Array | null = null;
  private readonly clothTopologyRefreshInterval = 3;
  private readonly strandPositionRefreshInterval = 4;

  private vertexPositionBuffer!: ReturnType<typeof instancedArray>;
  private vertexPreviousBuffer!: ReturnType<typeof instancedArray>;
  private initialPositionBuffer!: ReturnType<typeof instancedArray>;
  private substepStartBuffer!: ReturnType<typeof instancedArray>;
  private vertexParamsBuffer!: ReturnType<typeof instancedArray>;
  private vertexGridBuffer!: ReturnType<typeof instancedArray>;
  private vertexComponentBuffer!: ReturnType<typeof instancedArray>;
  private selfCollisionExclusionBuffer!: ReturnType<typeof instancedArray>;
  private springVertexIdBuffer!: ReturnType<typeof instancedArray>;
  private springRestLengthBuffer!: ReturnType<typeof instancedArray>;
  private edgeKindBuffer!: ReturnType<typeof instancedArray>;
  private springCorrectionBuffer!: ReturnType<typeof instancedArray>;
  private springListBuffer!: ReturnType<typeof instancedArray>;
  private edgeActiveBuffer!: ReturnType<typeof instancedArray>;
  private edgeVisualBuffer!: ReturnType<typeof instancedArray>;
  private edgeDependencyStartsBuffer!: ReturnType<typeof instancedArray>;
  private edgeDependencyIdsBuffer!: ReturnType<typeof instancedArray>;
  private simHorizontalEdgeIdBuffer!: ReturnType<typeof instancedArray>;
  private simVerticalEdgeIdBuffer!: ReturnType<typeof instancedArray>;
  private simShearDownEdgeIdBuffer!: ReturnType<typeof instancedArray>;
  private simShearUpEdgeIdBuffer!: ReturnType<typeof instancedArray>;
  private bbPositionBuffer!: ReturnType<typeof instancedArray>;
  private bbPreviousPositionBuffer!: ReturnType<typeof instancedArray>;
  private bbVelocityBuffer!: ReturnType<typeof instancedArray>;
  private bbAgeBuffer!: ReturnType<typeof instancedArray>;
  private bbActiveBuffer!: ReturnType<typeof instancedArray>;
  private boneSdfStartBuffer!: ReturnType<typeof instancedArray>;
  private boneSdfEndRadiusBuffer!: ReturnType<typeof instancedArray>;

  private predictMotion!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private beginSubstep!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeDistanceCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private computeHardStructuralCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyDistanceCorrections!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private clampSubstepTravel!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolvePoleCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveMannequinCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveBoneSdfCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveSelfCollision!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private enforcePins!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resetFlagPositions!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private measureGrabScreenDist!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private selectGrabTarget!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyGrabConstraint!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private breakEdgesByStrain!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private cascadeBrokenEdgeLinks!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private syncEdgeVisualForRender!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private integrateBbs!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveClothAgainstBbs!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private resolveBbClothContacts!: ReturnType<ReturnType<typeof Fn>['compute']>;
  private applyBbClothVertexImpulses!: ReturnType<ReturnType<typeof Fn>['compute']>;

  private grabScreenDistBuffer!: ReturnType<typeof instancedArray>;
  private grabTargetBuffer!: ReturnType<typeof instancedArray>;
  private grabOffsetNdcBuffer!: ReturnType<typeof instancedArray>;
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
  private shapePressureUniform!: ReturnType<typeof uniform>;
  private mannequinCollisionUniform!: ReturnType<typeof uniform>;
  private mannequinMarginUniform!: ReturnType<typeof uniform>;
  private mannequinFrictionUniform!: ReturnType<typeof uniform>;
  private mannequinTorsoRadiiUniform!: ReturnType<typeof uniform>;
  private mannequinTorsoCenterYUniform!: ReturnType<typeof uniform>;
  private mannequinArmRadiusUniform!: ReturnType<typeof uniform>;
  private mannequinArmHalfLengthUniform!: ReturnType<typeof uniform>;
  private mannequinArmCenterYUniform!: ReturnType<typeof uniform>;
  private mannequinNeckRadiusUniform!: ReturnType<typeof uniform>;
  private mannequinNeckCenterYUniform!: ReturnType<typeof uniform>;
  private mannequinNeckBaseRadiusUniform!: ReturnType<typeof uniform>;
  private mannequinNeckBaseCenterYUniform!: ReturnType<typeof uniform>;
  private zoneAStrengthUniform!: ReturnType<typeof uniform>;
  private zoneARadiusUniform!: ReturnType<typeof uniform>;
  private zoneASpeedUniform!: ReturnType<typeof uniform>;
  private zoneADirectionUniform!: ReturnType<typeof uniform>;
  private zoneBStrengthUniform!: ReturnType<typeof uniform>;
  private zoneBRadiusUniform!: ReturnType<typeof uniform>;
  private zoneBSpeedUniform!: ReturnType<typeof uniform>;
  private zoneBDirectionUniform!: ReturnType<typeof uniform>;
  private mouseNdcUniform!: ReturnType<typeof uniform>;
  private grabModeUniform!: ReturnType<typeof uniform>;
  private grabActiveUniform!: ReturnType<typeof uniform>;
  private grabTryLatchUniform!: ReturnType<typeof uniform>;
  private grabPickRadiusUniform!: ReturnType<typeof uniform>;
  private grabInfluenceRadiusUniform!: ReturnType<typeof uniform>;
  private grabCameraProjectionUniform!: ReturnType<typeof uniform>;
  private grabCameraViewUniform!: ReturnType<typeof uniform>;
  private grabCameraProjectionInverseUniform!: ReturnType<typeof uniform>;
  private grabCameraWorldUniform!: ReturnType<typeof uniform>;
  private bbHitRadiusUniform!: ReturnType<typeof uniform>;
  private bbVisualRadiusUniform!: ReturnType<typeof uniform>;
  private bbForceStrengthUniform!: ReturnType<typeof uniform>;
  private bbRestitutionUniform!: ReturnType<typeof uniform>;
  private bbFrictionUniform!: ReturnType<typeof uniform>;
  private bbFabricSoftnessUniform!: ReturnType<typeof uniform>;
  private bbGravityUniform!: ReturnType<typeof uniform>;
  private bbSubstepDtUniform!: ReturnType<typeof uniform>;
  private bbLifetimeUniform!: ReturnType<typeof uniform>;
  private bbBoundsMinUniform!: ReturnType<typeof uniform>;
  private bbBoundsMaxUniform!: ReturnType<typeof uniform>;
  private clothWidthUniform!: ReturnType<typeof uniform>;
  private clothHeightUniform!: ReturnType<typeof uniform>;
  private flagHoistTopYUniform!: ReturnType<typeof uniform>;
  private clothSegmentsXUniform!: ReturnType<typeof uniform>;
  private clothSegmentsYUniform!: ReturnType<typeof uniform>;
  private renderSubdivisionsUniform!: ReturnType<typeof uniform>;
  private tearStretchUniform!: ReturnType<typeof uniform>;
  private simGridSizeYUniform!: ReturnType<typeof uniform>;

  private isGrabModeEnabled = false;
  private isGrabActive = false;
  private grabTryLatch = false;
  private isShootModeEnabled = false;
  private readonly bbPool = new BbProjectilePool();
  private readonly bbMeshes: THREE.Mesh[] = [];
  private readonly grabHitTestPosition = new THREE.Vector3();
  private readonly bbBounds = new THREE.Box3(
    new THREE.Vector3(-4, -2, -4),
    new THREE.Vector3(4, 4, 4),
  );
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private keyLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private backLight!: THREE.DirectionalLight;
  private rimLight!: THREE.DirectionalLight;
  private mannequinVisual: THREE.Group | null = null;

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
  private centerX = 0;
  private centerY = 0;
  private centerZ = 0;
  private minY = 0;
  private maxY = 0;
  private maxStretch = 1;
  private hasNaN = false;
  private isHealthy = false;

  private readonly stepsPerSecond = 360;
  private isReady = false;
  private bakedClothTextures: BakedClothTextureSet | null = null;
  private renderValidated = false;

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
    this.isolatedMode = options.isolated ?? false;
    this.pinMode = options.pinMode ?? 'hoistCorners';
    this.initialShape = options.initialShape ?? 'plane';
    this.tubeRadius = options.tubeRadius ?? this.clothWidth / (Math.PI * 2);
    this.activeAssembly = options.assembly ?? null;
    this.topologyMode = this.activeAssembly ? 'assembly' : this.initialShape === 'tube' ? 'tube' : 'grid';
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
    this.camera.position.copy(this.isolatedMode ? new THREE.Vector3(0, 0, 2.4) : this.defaultCameraPosition);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.isolatedMode ? new THREE.Vector3(0, 0, 0) : this.defaultCameraTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 0.25;
    this.controls.maxDistance = 8;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.update();

    this.setupLighting();
    if (!this.isolatedMode) {
      this.addPole();
    }
    this.setupMannequinVisual();
    this.setupClothGeometry();
    this.setupVertexBuffers();
    this.setupEdgeBuffers();
    this.setupUniforms();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);
    this.setupStrandThreadVisual();
    this.setupSimGridDebugOverlay();
    this.setupBbVisuals();

    this.particlesEl.textContent = `particles: ${this.clothVertices.length}`;
    this.timer.connect(document);
    this.applySettings();
    this.applyHealthFromArray(
      (this.vertexPositionBuffer.value as StorageInstancedBufferAttribute).array as Float32Array,
    );
  }

  async init(): Promise<void> {
    await this.renderer.init();

    try {
      this.bakedClothTextures = await loadDenim512ClothTextures();
    } catch (error) {
      console.warn('Failed to load baked cloth textures; falling back to procedural weave.', error);
      this.bakedClothTextures = null;
      if (this.settings.fabricTextureSource === 'denim-512') {
        this.settings.fabricTextureSource = 'procedural';
      }
    }

    if (this.settings.fabricTextureSource === 'denim-512' && this.bakedClothTextures) {
      this.clothMaterial.dispose();
      this.clothMaterial = this.createClothMaterial();
      this.clothMesh.material = this.clothMaterial;
      this.applySettings();
    }

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    this.backendEl.textContent = `backend: ${this.renderer.backend.constructor.name}`;
    await this.renderer.compileAsync(this.scene, this.camera);
    this.restoreClothConnectivityCpu();
    this.isReady = true;
    this.setStatus('running');
  }

  /** Fail-fast once the sim has settled: flag pixels must be lit, not black. */
  private async validateFlagRender(): Promise<void> {
    const diagnostics = await this.getRenderDiagnostics();
    if (!diagnostics?.meshRegion) {
      this.setStatus('error');
      this.statusEl.textContent = 'error: flag mesh region unreadable';
      return;
    }

    const mesh = diagnostics.meshRegion;
    if (
      !mesh ||
      mesh.clothPixelCount < 200 ||
      mesh.clothMeanLuma < 40 ||
      mesh.clothBlackRatio > 0.35 ||
      mesh.clothPureBlackRatio > 0.08
    ) {
      this.setStatus('error');
      this.statusEl.textContent =
        `error: flag cloth black (luma=${mesh?.clothMeanLuma.toFixed(1) ?? '0'}, black=${((mesh?.clothBlackRatio ?? 1) * 100).toFixed(0)}%, pure=${((mesh?.clothPureBlackRatio ?? 1) * 100).toFixed(0)}%)`;
      console.error('Flag render validation failed', diagnostics);
    }
  }

  resetCamera(): void {
    this.camera.position.copy(this.defaultCameraPosition);
    this.controls.target.copy(this.defaultCameraTarget);
    this.controls.update();
  }

  setMousePointerNdc(x: number, y: number): void {
    this.mouseNdcUniform.value.set(x, y);
  }

  clearMousePointer(): void {
    this.mouseNdcUniform.value.set(-2, -2);
  }

  setGrabModeEnabled(enabled: boolean): void {
    this.isGrabModeEnabled = enabled;
    this.grabModeUniform.value = enabled ? 1 : 0;
    if (enabled) {
      this.isShootModeEnabled = false;
    }
    if (!enabled) {
      this.setGrabActive(false);
    }
  }

  setGrabActive(active: boolean): void {
    this.isGrabActive = active;
    this.grabActiveUniform.value = active ? 1 : 0;
    if (!active) {
      this.grabTryLatch = false;
    }
  }

  beginGrabAttempt(): void {
    this.resetGrabLatchState();
    this.isGrabActive = true;
    this.grabTryLatch = true;
    this.grabActiveUniform.value = 1;
  }

  canBeginGrabAttempt(): boolean {
    if (!this.isReady || !this.isGrabModeEnabled) {
      return false;
    }

    const mouse = this.mouseNdcUniform.value;
    if (mouse.x < -1.5) {
      return false;
    }

    const positionAttr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const positions = positionAttr.array as Float32Array;
    const itemSize = positionAttr.itemSize ?? 3;
    const pickRadius = this.grabPickRadiusUniform.value;

    this.camera.updateMatrixWorld();
    for (let i = 0; i < this.clothVertices.length; i++) {
      if (this.clothVertices[i]?.isFixed) {
        continue;
      }

      this.grabHitTestPosition
        .set(
          positions[i * itemSize] ?? 0,
          positions[i * itemSize + 1] ?? 0,
          positions[i * itemSize + 2] ?? 0,
        )
        .project(this.camera);

      if (this.grabHitTestPosition.z < -1 || this.grabHitTestPosition.z > 1) {
        continue;
      }

      const dist = Math.hypot(
        this.grabHitTestPosition.x - mouse.x,
        this.grabHitTestPosition.y - mouse.y,
      );
      if (dist < pickRadius) {
        return true;
      }
    }

    return false;
  }

  endGrabAttempt(): void {
    this.setGrabActive(false);
    this.resetGrabLatchState();
  }

  isGrabPointerDown(): boolean {
    return this.isGrabActive;
  }

  isGrabModeOn(): boolean {
    return this.isGrabModeEnabled;
  }

  setShootModeEnabled(enabled: boolean): void {
    this.isShootModeEnabled = enabled;
    if (enabled) {
      this.isGrabModeEnabled = false;
      this.grabModeUniform.value = 0;
      this.setGrabActive(false);
    }
  }

  isShootModeOn(): boolean {
    return this.isShootModeEnabled;
  }

  fireBb(mouseNdcX: number, mouseNdcY: number): boolean {
    if (!this.isShootModeEnabled || !this.isReady) {
      return false;
    }

    const mouseNdc = new THREE.Vector2(mouseNdcX, mouseNdcY);
    const fired = this.bbPool.fire(this.camera, mouseNdc);
    if (fired) {
      this.syncBbPoolToGpu();
      for (let i = 0; i < this.bbPool.maxCount; i++) {
        if (this.bbPool.getProjectile(i) === fired) {
          syncBbProjectileMesh(this.bbMeshes[i]!, fired.position, this.bbPool.visualRadius, true);
          break;
        }
      }
    }
    return fired !== null;
  }

  getBbPool(): BbProjectilePool {
    return this.bbPool;
  }

  fireBbForTest(ndcX: number, ndcY: number): number | null {
    if (!this.isReady) {
      return null;
    }

    const mouseNdc = new THREE.Vector2(ndcX, ndcY);
    const fired = this.bbPool.fire(this.camera, mouseNdc);
    if (!fired) {
      return null;
    }

    this.syncBbPoolToGpu();
    for (let i = 0; i < this.bbPool.maxCount; i++) {
      if (this.bbPool.getProjectile(i) === fired) {
        syncBbProjectileMesh(this.bbMeshes[i]!, fired.position, this.bbPool.visualRadius, true);
        return i;
      }
    }

    return null;
  }

  async readBbProjectileSamples(): Promise<BbProjectileSample[]> {
    if (!this.isReady) {
      return [];
    }

    const positionAttr = this.bbPositionBuffer.value as StorageInstancedBufferAttribute;
    const velocityAttr = this.bbVelocityBuffer.value as StorageInstancedBufferAttribute;
    const activeAttr = this.bbActiveBuffer.value as StorageInstancedBufferAttribute;
    const [positionBuffer, velocityBuffer, activeBuffer] = await Promise.all([
      this.renderer.getArrayBufferAsync(positionAttr),
      this.renderer.getArrayBufferAsync(velocityAttr),
      this.renderer.getArrayBufferAsync(activeAttr),
    ]);
    const positions = new Float32Array(positionBuffer);
    const velocities = new Float32Array(velocityBuffer);
    const active = new Uint32Array(activeBuffer);
    const samples: BbProjectileSample[] = [];

    for (let i = 0; i < this.bbPool.maxCount; i++) {
      const alive = active[i] === 1;
      const position = {
        x: positions[i * 3]!,
        y: positions[i * 3 + 1]!,
        z: positions[i * 3 + 2]!,
      };
      const velocity = {
        x: velocities[i * 3]!,
        y: velocities[i * 3 + 1]!,
        z: velocities[i * 3 + 2]!,
      };
      const bb = this.bbPool.getProjectile(i);
      bb.alive = alive;
      bb.position.set(position.x, position.y, position.z);
      bb.velocity.set(velocity.x, velocity.y, velocity.z);
      syncBbProjectileMesh(this.bbMeshes[i]!, bb.position, this.bbPool.visualRadius, alive);

      const mesh = this.bbMeshes[i]!;
      samples.push({
        slot: i,
        alive,
        position,
        meshPosition: alive
          ? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
          : null,
        velocity,
      });
    }

    return samples;
  }

  async measureBbMotionSmoothness(options: {
    ndcX?: number;
    ndcY?: number;
    sampleCount?: number;
  } = {}): Promise<BbMotionSmoothnessReport> {
    const ndcX = options.ndcX ?? 0;
    const ndcY = options.ndcY ?? 0;
    const sampleCount = Math.max(8, options.sampleCount ?? 28);
    const issues: string[] = [];
    const expectedSpeed = this.bbPool.projectileSpeed;

    this.bbPool.reset();
    this.syncBbPoolToGpu();
    for (let i = 0; i < this.bbPool.maxCount; i++) {
      syncBbProjectileMesh(this.bbMeshes[i]!, this.bbPool.getProjectile(i).position, this.bbPool.visualRadius, false);
    }

    const slot = this.fireBbForTest(ndcX, ndcY);
    if (slot === null) {
      return {
        slot: -1,
        sampleCount: 0,
        aliveSamples: 0,
        stuckFrames: sampleCount,
        maxGpuMeshError: Infinity,
        minStep: 0,
        maxStep: 0,
        medianStep: 0,
        maxJumpRatio: Infinity,
        averageSpeed: 0,
        expectedSpeed,
        smooth: false,
        issues: ['failed to fire BB'],
      };
    }

    const track: BbProjectileSample[] = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      await this.waitForFrame();
      const samples = await this.readBbProjectileSamples();
      const bb = samples.find((entry) => entry.slot === slot);
      if (!bb) {
        issues.push(`missing slot ${slot} at sample ${sampleIndex}`);
        break;
      }
      if (track.length > 0 && !bb.alive) {
        break;
      }
      track.push(bb);
    }

    let stuckFrames = 0;
    let maxGpuMeshError = 0;
    const steps: number[] = [];
    let aliveSamples = 0;

    for (let i = 0; i < track.length; i++) {
      const sample = track[i]!;
      if (!sample.alive) {
        continue;
      }

      aliveSamples += 1;

      if (sample.meshPosition) {
        maxGpuMeshError = Math.max(
          maxGpuMeshError,
          Math.hypot(
            sample.position.x - sample.meshPosition.x,
            sample.position.y - sample.meshPosition.y,
            sample.position.z - sample.meshPosition.z,
          ),
        );
      }

      if (i === 0) {
        continue;
      }

      const previous = track[i - 1]!;
      if (!previous.alive) {
        continue;
      }

      const step = Math.hypot(
        sample.position.x - previous.position.x,
        sample.position.y - previous.position.y,
        sample.position.z - previous.position.z,
      );

      if (step < 1e-6) {
        stuckFrames += 1;
      } else {
        steps.push(step);
      }
    }

    const sortedSteps = [...steps].sort((a, b) => a - b);
    const minStep = sortedSteps[0] ?? 0;
    const maxStep = sortedSteps[sortedSteps.length - 1] ?? 0;
    const medianStep =
      sortedSteps.length > 0 ? sortedSteps[Math.floor(sortedSteps.length / 2)]! : 0;
    const maxJumpRatio =
      medianStep > 1e-6 ? maxStep / medianStep : maxStep > 1e-6 ? Infinity : 1;
    const averageSpeed =
      steps.length > 0
        ? (steps.reduce((sum, step) => sum + step, 0) / steps.length) * 60
        : 0;

    if (aliveSamples < Math.min(8, sampleCount - 2)) {
      issues.push(`only ${aliveSamples} alive samples (expected at least ${Math.min(8, sampleCount - 2)})`);
    }
    if (stuckFrames > 0) {
      issues.push(`${stuckFrames} stuck frame(s) with zero motion`);
    }
    if (maxGpuMeshError > 1e-4) {
      issues.push(`gpu/mesh mismatch ${maxGpuMeshError.toExponential(2)}m`);
    }
    if (medianStep < 0.008) {
      issues.push(`median step ${medianStep.toFixed(4)}m is too small`);
    }
    if (maxJumpRatio > 4) {
      issues.push(`jump ratio ${maxJumpRatio.toFixed(2)} exceeds 4x median step`);
    }
    if (averageSpeed < expectedSpeed * 0.12) {
      issues.push(`average speed ${averageSpeed.toFixed(2)} << expected ${expectedSpeed.toFixed(2)}`);
    }

    return {
      slot,
      sampleCount: track.length,
      aliveSamples,
      stuckFrames,
      maxGpuMeshError,
      minStep,
      maxStep,
      medianStep,
      maxJumpRatio,
      averageSpeed,
      expectedSpeed,
      smooth: issues.length === 0,
      issues,
    };
  }

  async measureBbClothBlocking(
    options: {
      ndcX?: number;
      ndcY?: number;
      sampleCount?: number;
    } = {},
  ): Promise<BbClothBlockingReport> {
    const ndcX = options.ndcX ?? 0;
    const ndcY = options.ndcY ?? 0;
    const sampleCount = Math.max(16, options.sampleCount ?? 40);
    const issues: string[] = [];
    const flagCenter = { x: 0, y: 0.95, z: 0 };

    this.bbPool.reset();
    this.syncBbPoolToGpu();
    for (let i = 0; i < this.bbPool.maxCount; i++) {
      syncBbProjectileMesh(
        this.bbMeshes[i]!,
        this.bbPool.getProjectile(i).position,
        this.bbPool.visualRadius,
        false,
      );
    }

    for (let warmup = 0; warmup < 4; warmup++) {
      await this.waitForFrame();
    }

    const slot = this.fireBbForTest(ndcX, ndcY);
    if (slot === null) {
      return {
        slot: -1,
        sampleCount: 0,
        minDistanceToFlag: Infinity,
        minSurfaceGap: Infinity,
        closestSpeed: 0,
        initialSpeed: 0,
        velocityReversed: false,
        speedReduced: false,
        phasedThrough: false,
        blocked: false,
        issues: ['failed to fire BB'],
      };
    }

    let initialSpeed = 0;
    let minDistanceToFlag = Infinity;
    let minSurfaceGap = Infinity;
    let closestSpeed = Infinity;
    let velocityReversed = false;
    let speedReduced = false;
    let phasedThrough = false;
    let sampleTotal = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      await this.waitForFrame();
      const samples = await this.readBbProjectileSamples();
      const bb = samples.find((entry) => entry.slot === slot);
      if (!bb || !bb.alive) {
        break;
      }

      sampleTotal += 1;
      const speed = Math.hypot(bb.velocity.x, bb.velocity.y, bb.velocity.z);
      if (sampleIndex === 0) {
        initialSpeed = speed;
      }

      const distToFlag = Math.hypot(
        bb.position.x - flagCenter.x,
        bb.position.y - flagCenter.y,
        bb.position.z - flagCenter.z,
      );
      const inFlagSilhouette =
        Math.abs(bb.position.x) < 1.15 &&
        bb.position.y > 0.35 &&
        bb.position.y < 1.55;
      if (inFlagSilhouette) {
        const surfaceGap = Math.max(0, Math.abs(bb.position.z) - this.bbPool.visualRadius);
        minSurfaceGap = Math.min(minSurfaceGap, surfaceGap);
      }

      if (distToFlag < minDistanceToFlag) {
        minDistanceToFlag = distToFlag;
        closestSpeed = speed;
      }

      const reachedClothZone = distToFlag < 0.32 || minSurfaceGap < 0.12;

      if (reachedClothZone) {
        const toFlagX = flagCenter.x - bb.position.x;
        const toFlagY = flagCenter.y - bb.position.y;
        const toFlagZ = flagCenter.z - bb.position.z;
        const approach = bb.velocity.x * toFlagX + bb.velocity.y * toFlagY + bb.velocity.z * toFlagZ;
        if (approach < 0) {
          velocityReversed = true;
        }
        if (speed < initialSpeed * 0.45) {
          speedReduced = true;
        }
        if (
          bb.position.z < -0.15 &&
          bb.velocity.z < -12 &&
          Math.abs(bb.position.x) < 1.2 &&
          bb.position.y > 0.2 &&
          bb.position.y < 1.6
        ) {
          phasedThrough = true;
        }
      }
    }

    if (minDistanceToFlag > 0.35 && minSurfaceGap > 0.14) {
      issues.push(
        `BB never reached cloth (center ${minDistanceToFlag.toFixed(3)}m, surface gap ${Number.isFinite(minSurfaceGap) ? minSurfaceGap.toFixed(3) : 'inf'}m)`,
      );
    }
    if (phasedThrough) {
      issues.push('BB passed through flag volume at high speed');
    }
    if ((minDistanceToFlag < 0.32 || minSurfaceGap < 0.12) && !velocityReversed && !speedReduced) {
      issues.push('BB reached cloth zone without slowing or bouncing away');
    }

    const reachedCloth = minDistanceToFlag < 0.35 || minSurfaceGap < 0.14;
    const blocked =
      reachedCloth && !phasedThrough && (velocityReversed || speedReduced || minSurfaceGap < 0.1);

    return {
      slot,
      sampleCount: sampleTotal,
      minDistanceToFlag,
      minSurfaceGap: Number.isFinite(minSurfaceGap) ? minSurfaceGap : Infinity,
      closestSpeed: Number.isFinite(closestSpeed) ? closestSpeed : 0,
      initialSpeed,
      velocityReversed,
      speedReduced,
      phasedThrough,
      blocked,
      issues,
    };
  }

  setSimGridDebugVisible(visible: boolean): void {
    this.settings.showSimGridDebug = visible;
    this.syncSimGridDebugOverlay();
  }

  setBoneSdfCapsules(capsules: readonly BoneSdfCapsuleSample[]): void {
    if (!this.boneSdfStartBuffer || !this.boneSdfEndRadiusBuffer) {
      return;
    }

    const startAttr = this.boneSdfStartBuffer.value as StorageInstancedBufferAttribute;
    const endRadiusAttr = this.boneSdfEndRadiusBuffer.value as StorageInstancedBufferAttribute;
    const startArray = startAttr.array as Float32Array;
    const endRadiusArray = endRadiusAttr.array as Float32Array;
    startArray.fill(0);
    endRadiusArray.fill(0);

    const count = Math.min(capsules.length, MAX_BONE_SDF_CAPSULES);
    for (let i = 0; i < count; i++) {
      const capsule = capsules[i]!;
      startArray[i * 4] = capsule.start[0];
      startArray[i * 4 + 1] = capsule.start[1];
      startArray[i * 4 + 2] = capsule.start[2];
      startArray[i * 4 + 3] = 1;
      endRadiusArray[i * 4] = capsule.end[0];
      endRadiusArray[i * 4 + 1] = capsule.end[1];
      endRadiusArray[i * 4 + 2] = capsule.end[2];
      endRadiusArray[i * 4 + 3] = capsule.radius;
    }

    startAttr.needsUpdate = true;
    endRadiusAttr.needsUpdate = true;
  }

  resetFlag(): void {
    this.bbPool.reset();
    if (this.bbPositionBuffer) {
      this.syncBbPoolToGpu();
    }

    if (!this.isReady) {
      return;
    }

    this.setGrabActive(false);
    this.resetGrabLatchState();
    this.resetEdgeActiveStateCpu();
    this.renderer.compute(this.resetFlagPositions);
    this.renderer.compute(this.enforcePins);
    this.timeSinceLastStep = 0;
    this.frameCount = 0;
    this.renderValidated = false;
    void this.refreshHealthFromGpu();
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
    this.activeAssembly = null;
    this.activeTopology = null;
    this.topologyMode = this.initialShape === 'tube' ? 'tube' : 'grid';
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
    this.particleRenderBaseIndices = null;
    this.particleRenderTriangleEdgeIds = null;

    this.setupClothGeometry();
    this.setupVertexBuffers();
    this.setupEdgeBuffers();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);
    this.setupStrandThreadVisual();
    this.rebuildSimGridDebugOverlay();

    this.particlesEl.textContent = `particles: ${this.clothVertices.length}`;
    this.timeSinceLastStep = 0;
    this.simGridSizeYUniform.value = this.clothNumSegmentsY + 1;
    this.clothSegmentsXUniform.value = this.clothNumSegmentsX;
    this.clothSegmentsYUniform.value = this.clothNumSegmentsY;
    this.bbPool.reset();
    this.applySettings();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.isReady = true;
  }

  async loadClothAssembly(assembly: ClothAssembly): Promise<void> {
    this.isReady = false;
    this.activeAssembly = assembly;
    this.activeTopology = null;
    this.topologyMode = 'assembly';
    this.clothNumSegmentsX = Math.max(1, assembly.vertices.length - 1);
    this.clothNumSegmentsY = 0;
    this.settings.segmentsX = this.clothNumSegmentsX;
    this.settings.segmentsY = this.clothNumSegmentsY;

    this.scene.remove(this.clothMesh);
    this.clothGeometry.dispose();
    this.clothMaterial.dispose();

    this.clothVertices.length = 0;
    this.clothEdges.length = 0;
    this.clothVertexColumns.length = 0;
    this.assemblyRenderVertexSimIds = [];
    this.particleRenderBaseIndices = null;
    this.particleRenderTriangleEdgeIds = null;
    this.simHorizontalEdgeIds.length = 0;
    this.simVerticalEdgeIds.length = 0;
    this.simShearDownEdgeIds.length = 0;
    this.simShearUpEdgeIds.length = 0;

    this.setupClothGeometry();
    this.setupVertexBuffers();
    this.setupEdgeBuffers();
    this.setupComputeShaders();
    this.clothMaterial = this.createClothMaterial();
    this.clothMesh = this.setupClothMesh(this.clothMaterial);
    this.setupStrandThreadVisual();
    this.rebuildSimGridDebugOverlay();

    this.particlesEl.textContent = `particles: ${this.clothVertices.length}`;
    this.timeSinceLastStep = 0;
    this.simGridSizeYUniform.value = this.clothNumSegmentsY + 1;
    this.clothSegmentsXUniform.value = this.clothNumSegmentsX;
    this.clothSegmentsYUniform.value = this.clothNumSegmentsY;
    this.bbPool.reset();
    this.applySettings();
    this.applyHealthFromCpuVertices();
    await this.renderer.compileAsync(this.scene, this.camera);
    this.resetGrabLatchState();
    this.applyHealthFromCpuVertices();
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
    this.shapePressureUniform.value = s.shapePressure;
    this.mannequinCollisionUniform.value = s.mannequinCollision ? 1 : 0;
    this.mannequinMarginUniform.value = s.mannequinMargin;
    this.mannequinFrictionUniform.value = s.mannequinFriction;
    this.mannequinTorsoRadiiUniform.value.set(
      s.mannequinTorsoRadiusX,
      s.mannequinTorsoRadiusY,
      s.mannequinTorsoRadiusZ,
    );
    this.mannequinTorsoCenterYUniform.value = s.mannequinTorsoCenterY;
    this.mannequinArmRadiusUniform.value = s.mannequinArmRadius;
    this.mannequinArmHalfLengthUniform.value = s.mannequinArmHalfLength;
    this.mannequinArmCenterYUniform.value = s.mannequinArmCenterY;
    this.mannequinNeckRadiusUniform.value = s.mannequinNeckRadius;
    this.mannequinNeckCenterYUniform.value = s.mannequinNeckCenterY;
    this.mannequinNeckBaseRadiusUniform.value = s.mannequinNeckBaseRadius;
    this.mannequinNeckBaseCenterYUniform.value = s.mannequinNeckBaseCenterY;
    this.zoneAStrengthUniform.value = s.zoneAStrength;
    this.zoneARadiusUniform.value = s.zoneARadius;
    this.zoneASpeedUniform.value = s.zoneASpeed;
    this.zoneADirectionUniform.value.set(s.zoneADirX, s.zoneADirY, s.zoneADirZ);
    this.zoneBStrengthUniform.value = s.zoneBStrength;
    this.zoneBRadiusUniform.value = s.zoneBRadius;
    this.zoneBSpeedUniform.value = s.zoneBSpeed;
    this.zoneBDirectionUniform.value.set(s.zoneBDirX, s.zoneBDirY, s.zoneBDirZ);
    this.grabInfluenceRadiusUniform.value = s.grabRadius;
    this.tearStretchUniform.value = s.tearStretchThreshold;
    this.bbHitRadiusUniform.value = s.bbHitRadius;
    this.bbVisualRadiusUniform.value = s.bbVisualRadius;
    this.bbForceStrengthUniform.value = s.bbForceStrength;
    this.bbPool.setSpeed(s.bbSpeed);
    this.bbPool.setVisualRadius(s.bbVisualRadius);
    this.bbPool.setForceRadius(s.bbHitRadius);
    this.bbRestitutionUniform.value = s.bbRestitution;
    this.bbFrictionUniform.value = s.bbFriction;
    this.bbFabricSoftnessUniform.value = s.bbFabricSoftness;
    this.renderSubdivisionsUniform.value = s.renderSubdivisions;

    this.renderer.toneMappingExposure = s.exposure;
    this.ambientLight.intensity = s.ambientIntensity;
    this.hemiLight.intensity = s.hemiIntensity;
    this.keyLight.intensity = s.keyLightIntensity;
    this.fillLight.intensity = s.fillLightIntensity;
    this.backLight.intensity = s.backLightIntensity;
    this.rimLight.intensity = s.rimLightIntensity;

    this.syncClothMaterial(this.clothMaterial);
    this.syncSimGridDebugOverlay();
    this.syncStrandThreadVisual();
    this.syncMannequinVisual();
  }

  private syncSimGridDebugOverlay(): void {
    if (!this.simGridDebugOverlay) {
      return;
    }

    this.simGridDebugOverlay.uniforms.visible.value = this.settings.showSimGridDebug ? 1 : 0;
  }

  private setupSimGridDebugOverlay(): void {
    this.disposeSimGridDebugOverlay();
    this.simGridDebugOverlay = createSimGridDebugOverlay(
      this.vertexPositionBuffer,
      this.clothVertices.length,
      this.mouseNdcUniform,
    );
    this.scene.add(this.simGridDebugOverlay.sprite);
    this.syncSimGridDebugOverlay();
  }

  private rebuildSimGridDebugOverlay(): void {
    this.setupSimGridDebugOverlay();
  }

  private disposeSimGridDebugOverlay(): void {
    if (!this.simGridDebugOverlay) {
      return;
    }

    this.scene.remove(this.simGridDebugOverlay.sprite);
    this.simGridDebugOverlay.dispose();
    this.simGridDebugOverlay = null;
  }

  private syncClothMaterial(material: THREE.MeshPhysicalNodeMaterial): void {
    updateMatteCottonFlagMaterial(material, this.settings);
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
    this.syncGrabCameraUniforms();

    const deltaTime = Math.min(this.timer.getDelta(), 1 / 60);
    const timePerStep = 1 / this.stepsPerSecond;
    this.timeSinceLastStep += deltaTime;

    while (this.timeSinceLastStep >= timePerStep) {
      this.timeSinceLastStep -= timePerStep;
      this.bbSubstepDtUniform.value = timePerStep;

      this.renderer.compute(this.breakEdgesByStrain);
      for (let cascadePass = 0; cascadePass < 4; cascadePass++) {
        this.renderer.compute(this.cascadeBrokenEdgeLinks);
      }

      this.renderer.compute(this.enforcePins);
      this.renderer.compute(this.beginSubstep);
      this.renderer.compute(this.predictMotion);
      this.bbSubstepDtUniform.value = timePerStep * 0.5;
      this.renderer.compute(this.integrateBbs);
      this.renderer.compute(this.integrateBbs);

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

      for (let i = 0; i < 4; i++) {
        if (this.settings.poleCollision) {
          this.renderer.compute(this.resolvePoleCollision);
        }
        if (this.settings.mannequinCollision) {
          this.renderer.compute(this.resolveMannequinCollision);
        }
        for (let boneSdfPass = 0; boneSdfPass < 3; boneSdfPass++) {
          this.renderer.compute(this.resolveBoneSdfCollision);
        }
        if (this.settings.selfCollision) {
          this.renderer.compute(this.resolveSelfCollision);
        }
      }

      this.renderer.compute(this.clampSubstepTravel);
      this.renderer.compute(this.enforcePins);

      for (let contactPass = 0; contactPass < 3; contactPass++) {
        this.renderer.compute(this.resolveClothAgainstBbs);
        this.renderer.compute(this.resolveBbClothContacts);
        this.renderer.compute(this.applyBbClothVertexImpulses);
      }

      if (this.isGrabModeEnabled && this.isGrabActive) {
        this.renderer.compute(this.measureGrabScreenDist);
        this.renderer.compute(this.selectGrabTarget);
        this.renderer.compute(this.applyGrabConstraint);
      }
    }

    this.renderer.compute(this.syncEdgeVisualForRender);
    if (this.frameCount % this.clothTopologyRefreshInterval === 0) {
      void this.refreshClothTopologyFromGpu();
    }
    void this.refreshStrandThreadPositionsFromGpu();

    this.frameCount += 1;

    if (!this.renderValidated && this.frameCount === 180) {
      this.renderValidated = true;
      void this.validateFlagRender();
    }

    if (this.frameCount % 12 === 0) {
      void this.refreshHealthFromGpu();
    } else {
      this.publishStats();
    }

    if (this.grabTryLatch) {
      this.grabTryLatch = false;
    }
  }

  async refreshHealthFromGpu(): Promise<InextensibleFlagSimulationStats> {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const buffer = await this.renderer.getArrayBufferAsync(attr);
    this.applyHealthFromArray(new Float32Array(buffer), attr.itemSize ?? 3);
    this.publishStats();
    return this.getStats();
  }

  async readCurrentClothAssembly(baseAssembly: ClothAssembly): Promise<ClothAssembly> {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const buffer = await this.renderer.getArrayBufferAsync(attr);
    const positions = new Float32Array(buffer);
    const itemSize = attr.itemSize ?? 3;
    return {
      vertices: baseAssembly.vertices.map((vertex, index) => ({
        ...vertex,
        position: [
          positions[(this.assemblyRenderVertexSimIds[index] ?? index) * itemSize]!,
          positions[(this.assemblyRenderVertexSimIds[index] ?? index) * itemSize + 1]!,
          positions[(this.assemblyRenderVertexSimIds[index] ?? index) * itemSize + 2]!,
        ] as [number, number, number],
      })),
      faces: baseAssembly.faces,
      edges: baseAssembly.edges,
      stitchEdges: baseAssembly.stitchEdges,
    };
  }

  async refreshBbVisualsFromGpu(): Promise<void> {
    if (!this.isReady || this.bbVisualRefreshPending) {
      return;
    }

    this.bbVisualRefreshPending = true;
    try {
      const positionAttr = this.bbPositionBuffer.value as StorageInstancedBufferAttribute;
      const activeAttr = this.bbActiveBuffer.value as StorageInstancedBufferAttribute;
      const [positionBuffer, activeBuffer] = await Promise.all([
        this.renderer.getArrayBufferAsync(positionAttr),
        this.renderer.getArrayBufferAsync(activeAttr),
      ]);
      const positions = new Float32Array(positionBuffer);
      const active = new Uint32Array(activeBuffer);

      for (let i = 0; i < this.bbPool.maxCount; i++) {
        const bb = this.bbPool.getProjectile(i);
        bb.alive = active[i] === 1;
        bb.position.set(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
        syncBbProjectileMesh(this.bbMeshes[i]!, bb.position, this.bbPool.visualRadius, bb.alive);
      }
    } finally {
      this.bbVisualRefreshPending = false;
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private waitForFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
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
      centerX: this.centerX,
      centerY: this.centerY,
      centerZ: this.centerZ,
      minY: this.minY,
      maxY: this.maxY,
      maxStretch: this.maxStretch,
      hasNaN: this.hasNaN,
      isHealthy: this.isHealthy,
    };
  }

  setFabricSettings(partial: Partial<FabricTestSettings>): void {
    if (partial.fabricNormalStrength !== undefined) {
      this.settings.fabricNormalStrength = partial.fabricNormalStrength;
    }
    if (partial.fabricNormalScale !== undefined) {
      this.settings.fabricNormalScale = partial.fabricNormalScale;
    }
    if (partial.fabricTiling !== undefined) {
      this.settings.fabricTiling = partial.fabricTiling;
    }
    this.applySettings();
  }

  async setFabricTextureSource(source: InextensibleFlagSettings['fabricTextureSource']): Promise<void> {
    if (this.settings.fabricTextureSource === source) {
      return;
    }

    this.settings.fabricTextureSource = source;
    await this.rebuildRenderMesh();
  }

  setWindStrength(strength: number): void {
    this.settings.windStrength = strength;
    this.applySettings();
  }

  setSelfCollision(enabled: boolean): void {
    this.settings.selfCollision = enabled;
    this.applySettings();
  }

  async loadSettingsPreset(snapshot: InextensibleFlagSettings): Promise<void> {
    const next = normalizeFlagSettings(snapshot);
    const prevSegmentsX = this.clothNumSegmentsX;
    const prevSegmentsY = this.clothNumSegmentsY;
    const prevFabricSource = this.settings.fabricTextureSource;
    const prevRenderSubdiv = this.settings.renderSubdivisions;
    const preserveAssemblyTopology = this.topologyMode === 'assembly';

    Object.assign(this.settings, next);
    if (preserveAssemblyTopology) {
      this.settings.segmentsX = prevSegmentsX;
      this.settings.segmentsY = prevSegmentsY;
    }

    const segmentsChanged =
      !preserveAssemblyTopology &&
      (prevSegmentsX !== this.settings.segmentsX || prevSegmentsY !== this.settings.segmentsY);
    const fabricChanged = prevFabricSource !== this.settings.fabricTextureSource;
    const renderSubdivChanged = prevRenderSubdiv !== this.settings.renderSubdivisions;

    if (segmentsChanged) {
      await this.rebuildFlag();
      return;
    }

    if (fabricChanged || renderSubdivChanged) {
      await this.rebuildRenderMesh();
      return;
    }

    this.applySettings();
  }

  async getSelfCollisionReport(): Promise<SelfCollisionReport> {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const buffer = await this.renderer.getArrayBufferAsync(attr);
    return analyzeSelfCollisionViolations(new Float32Array(buffer), this.getSelfCollisionVertices(), {
      minSeparation: this.settings.clothThickness * 2,
      gridSkipRadius: 2,
    });
  }

  async probeSelfCollisionDispatch(passes = 8): Promise<number> {
    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const before = new Float32Array(await this.renderer.getArrayBufferAsync(attr));

    for (let i = 0; i < passes; i++) {
      this.renderer.compute(this.resolveSelfCollision);
    }

    const after = new Float32Array(await this.renderer.getArrayBufferAsync(attr));
    let maxDelta = 0;
    for (let i = 0; i < before.length; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(after[i]! - before[i]!));
    }
    return maxDelta;
  }

  async compareSelfCollisionEffect(options: {
    settleFrames?: number;
    windStrength?: number;
  } = {}): Promise<SelfCollisionCompareResult | null> {
    if (!this.isReady) {
      return null;
    }

    const settleFrames = options.settleFrames ?? 360;
    const windStrength = options.windStrength ?? 18;
    const savedWind = this.settings.windStrength;
    const savedSelfCollision = this.settings.selfCollision;

    const waitUntilFrame = async (targetFrame: number) => {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.frameCount >= targetFrame) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      });
    };

    this.setWindStrength(windStrength);
    this.setSelfCollision(true);
    this.resetFlag();
    const onStartFrame = this.frameCount;
    await waitUntilFrame(onStartFrame + settleFrames);
    const withSelfCollision = await this.getSelfCollisionReport();
    const probeMaxDeltaOn = await this.probeSelfCollisionDispatch(16);

    this.setSelfCollision(false);
    this.resetFlag();
    const offStartFrame = this.frameCount;
    await waitUntilFrame(offStartFrame + settleFrames);
    const withoutSelfCollision = await this.getSelfCollisionReport();

    this.setSelfCollision(savedSelfCollision);
    this.setWindStrength(savedWind);
    this.resetFlag();

    return { withSelfCollision, withoutSelfCollision, probeMaxDeltaOn };
  }

  async captureFlagCanvas(): Promise<FlagCanvasCapture | null> {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sim-canvas"]');
    if (!canvas) {
      return null;
    }

    this.render();
    return captureFlagCanvasRaw(canvas).then((result) => result.capture);
  }

  async analyzeBlackSpots(): Promise<FlagMeshRegionAnalysis | null> {
    const diagnostics = await this.getRenderDiagnostics();
    return diagnostics?.meshRegion ?? null;
  }

  async getRenderDiagnostics(): Promise<FlagRenderDiagnostics | null> {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sim-canvas"]');
    if (!canvas) {
      return null;
    }

    this.render();

    const attr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const buffer = await this.renderer.getArrayBufferAsync(attr);
    const positions = new Float32Array(buffer);

    const raw = await captureFlagCanvasRaw(canvas);
    if (raw.width === 0 || raw.height === 0) {
      return null;
    }

    const screenBounds = projectSimVerticesToScreenBounds(
      positions,
      this.camera,
      raw.width,
      raw.height,
    );

    return analyzeFlagRenderDiagnostics(
      raw.data,
      raw.width,
      raw.height,
      this.frameCount,
      this.settings.fabricTextureSource,
      screenBounds,
    );
  }

  async compareFabricWeaveOnOff(): Promise<FabricWeaveCompareResult | null> {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sim-canvas"]');
    if (!canvas) {
      return null;
    }

    const savedFabric: FabricTestSettings = {
      fabricNormalStrength: this.settings.fabricNormalStrength,
      fabricNormalScale: this.settings.fabricNormalScale,
      fabricTiling: this.settings.fabricTiling,
    };
    const savedWind = this.settings.windStrength;

    const waitForFrame = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      this.render();
    };

    this.setWindStrength(0);
    this.setFabricSettings({ fabricNormalStrength: 0, fabricNormalScale: 0, fabricTiling: 8 });
    await waitForFrame();
    const offRaw = await captureFlagCanvasRaw(canvas);
    if (!offRaw.capture) {
      this.setWindStrength(savedWind);
      this.setFabricSettings(savedFabric);
      return null;
    }

    this.setFabricSettings({ fabricNormalStrength: 1.5, fabricNormalScale: 1.2, fabricTiling: 12 });
    await waitForFrame();
    const onRaw = await captureFlagCanvasRaw(canvas);
    if (!onRaw.capture) {
      this.setWindStrength(savedWind);
      this.setFabricSettings(savedFabric);
      return null;
    }

    const compare = compareFlagCanvasCaptures(
      offRaw.capture,
      onRaw.capture,
      offRaw.data,
      onRaw.data,
      offRaw.width,
      offRaw.height,
    );

    this.setWindStrength(savedWind);
    this.setFabricSettings(savedFabric);
    await waitForFrame();

    return {
      off: offRaw.capture,
      on: onRaw.capture,
      compare,
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

  private getSelfCollisionVertices() {
    return this.clothVertices.map((vertex) => ({
      gridX: vertex.gridX,
      gridY: vertex.gridY,
      isFixed: vertex.isFixed,
    }));
  }

  private applyHealthFromArray(array: Float32Array, vertexStride = 3): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;
    let finiteVertices = 0;
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
      centerX += x;
      centerY += y;
      centerZ += z;
      finiteVertices += 1;
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
      const rest = edge.restLengthOverride ?? edge.vertex0.position.distanceTo(edge.vertex1.position);
      if (rest > 1e-6) {
        worstStretch = Math.max(worstStretch, dist / rest);
      }
    }

    this.checksum = sum;
    this.spanX = Number.isFinite(minX) ? maxX - minX : 0;
    this.spanY = Number.isFinite(minY) ? maxY - minY : 0;
    this.spanZ = Number.isFinite(minZ) ? maxZ - minZ : 0;
    this.centerX = finiteVertices > 0 ? centerX / finiteVertices : 0;
    this.centerY = finiteVertices > 0 ? centerY / finiteVertices : 0;
    this.centerZ = finiteVertices > 0 ? centerZ / finiteVertices : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;
    this.maxY = Number.isFinite(maxY) ? maxY : 0;
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

  private applyHealthFromCpuVertices(): void {
    const positions = new Float32Array(this.clothVertices.length * 3);
    for (const vertex of this.clothVertices) {
      positions[vertex.id * 3] = vertex.position.x;
      positions[vertex.id * 3 + 1] = vertex.position.y;
      positions[vertex.id * 3 + 2] = vertex.position.z;
    }
    this.applyHealthFromArray(positions);
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

  private setupMannequinVisual(): void {
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0x6f7f96,
      roughness: 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.38,
    });
    const group = new THREE.Group();
    group.name = 'sdf-mannequin-visual';

    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
    torso.name = 'sdf-mannequin-torso';
    group.add(torso);

    const arms = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 8), material);
    arms.name = 'sdf-mannequin-arms';
    arms.rotation.z = Math.PI * 0.5;
    group.add(arms);

    const neck = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
    neck.name = 'sdf-mannequin-neck';
    group.add(neck);

    const neckBase = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
    neckBase.name = 'sdf-mannequin-neck-base';
    group.add(neckBase);

    this.mannequinVisual = group;
    this.scene.add(group);
    this.syncMannequinVisual();
  }

  private syncMannequinVisual(): void {
    if (!this.mannequinVisual) {
      return;
    }
    const s = this.settings;
    this.mannequinVisual.visible = s.showMannequin;

    const torso = this.mannequinVisual.getObjectByName('sdf-mannequin-torso');
    if (torso) {
      torso.position.set(0, s.mannequinTorsoCenterY, 0);
      torso.scale.set(s.mannequinTorsoRadiusX, s.mannequinTorsoRadiusY, s.mannequinTorsoRadiusZ);
    }

    const arms = this.mannequinVisual.getObjectByName('sdf-mannequin-arms');
    if (arms) {
      arms.position.set(0, s.mannequinArmCenterY, 0);
      arms.scale.set(s.mannequinArmRadius, s.mannequinArmHalfLength * 2, s.mannequinArmRadius);
    }

    const neck = this.mannequinVisual.getObjectByName('sdf-mannequin-neck');
    if (neck) {
      neck.position.set(0, s.mannequinNeckCenterY, 0);
      neck.scale.setScalar(s.mannequinNeckRadius);
    }

    const neckBase = this.mannequinVisual.getObjectByName('sdf-mannequin-neck-base');
    if (neckBase) {
      neckBase.position.set(0, s.mannequinNeckBaseCenterY, 0);
      neckBase.scale.setScalar(s.mannequinNeckBaseRadius);
    }
  }

  private setupClothGeometry(): void {
    this.applyClothTopology(
      this.activeAssembly
        ? buildAssemblyClothTopology(this.activeAssembly)
        : buildGridClothTopology({
            width: this.clothWidth,
            height: this.clothHeight,
            segmentsX: this.clothNumSegmentsX,
            segmentsY: this.clothNumSegmentsY,
            isolated: this.isolatedMode,
            pinMode: this.pinMode,
            initialShape: this.initialShape,
            tubeRadius: this.tubeRadius,
            flagHoistTopY: this.flagHoistTopY,
          }),
    );
    return;
  }

  private applyClothTopology(topology: ClothTopology): void {
    this.activeTopology = topology;
    this.topologyMode = topology.kind;
    this.clothNumSegmentsX = topology.segmentsX;
    this.clothNumSegmentsY = topology.segmentsY;
    this.assemblyRenderVertexSimIds = [...(topology.renderSurface.renderVertexToParticle ?? [])];
    this.simHorizontalEdgeIds.length = 0;
    this.simVerticalEdgeIds.length = 0;
    this.simShearDownEdgeIds.length = 0;
    this.simShearUpEdgeIds.length = 0;
    this.simHorizontalEdgeIds.push(...topology.horizontalEdgeIds);
    this.simVerticalEdgeIds.push(...topology.verticalEdgeIds);
    this.simShearDownEdgeIds.push(...topology.shearDownEdgeIds);
    this.simShearUpEdgeIds.push(...topology.shearUpEdgeIds);

    for (const particle of topology.particles) {
      const vertex: ClothVertex = {
        id: particle.id,
        position: particle.position.clone(),
        gridX: particle.gridX,
        gridY: particle.gridY,
        isFixed: particle.isFixed,
        springIds: [],
      };
      this.clothVertices.push(vertex);
    }

    for (const column of topology.columns) {
      this.clothVertexColumns.push(column.map((vertexId) => this.clothVertices[vertexId]!));
    }

    for (const constraint of topology.constraints) {
      const id = this.clothEdges.length;
      const vertex0 = this.clothVertices[constraint.a]!;
      const vertex1 = this.clothVertices[constraint.b]!;
      const edge: ClothEdge = {
        id,
        vertex0,
        vertex1,
        kind: constraint.kind,
        restLengthOverride: constraint.restLength,
      };
      vertex0.springIds.push(id);
      vertex1.springIds.push(id);
      this.clothEdges.push(edge);
    }

    this.clothGraphEdges = buildClothGraphEdges(this.clothEdges);
    this.structuralGraphEdges = this.clothEdges
      .filter((edge) => edge.kind === 'structural')
      .map((edge) => ({
        id: edge.id,
        v0: edge.vertex0.id,
        v1: edge.vertex1.id,
      }));
  }

  private syncBbPoolToGpu(): void {
    const positionAttr = this.bbPositionBuffer.value as StorageInstancedBufferAttribute;
    const positionArray = positionAttr.array as Float32Array;
    const previousAttr = this.bbPreviousPositionBuffer.value as StorageInstancedBufferAttribute;
    const previousArray = previousAttr.array as Float32Array;
    const velocityAttr = this.bbVelocityBuffer.value as StorageInstancedBufferAttribute;
    const velocityArray = velocityAttr.array as Float32Array;
    const ageAttr = this.bbAgeBuffer.value as StorageInstancedBufferAttribute;
    const ageArray = ageAttr.array as Float32Array;
    const activeAttr = this.bbActiveBuffer.value as StorageInstancedBufferAttribute;
    const activeArray = activeAttr.array as Uint32Array;

    for (let i = 0; i < this.bbPool.maxCount; i++) {
      const bb = this.bbPool.getProjectile(i);
      positionArray[i * 3] = bb.position.x;
      positionArray[i * 3 + 1] = bb.position.y;
      positionArray[i * 3 + 2] = bb.position.z;
      previousArray[i * 3] = bb.position.x;
      previousArray[i * 3 + 1] = bb.position.y;
      previousArray[i * 3 + 2] = bb.position.z;
      velocityArray[i * 3] = bb.velocity.x;
      velocityArray[i * 3 + 1] = bb.velocity.y;
      velocityArray[i * 3 + 2] = bb.velocity.z;
      ageArray[i] = bb.age;
      activeArray[i] = bb.alive ? 1 : 0;
    }

    positionAttr.needsUpdate = true;
    previousAttr.needsUpdate = true;
    velocityAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
    activeAttr.needsUpdate = true;
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
    this.vertexComponentBuffer = instancedArray(new Uint32Array(vertexCount).fill(0), 'uint').setPBO(
      true,
    );
    this.selfCollisionExclusionBuffer = instancedArray(this.buildSelfCollisionExclusionArray(), 'uint');
    this.springListBuffer = instancedArray(new Uint32Array(springListArray), 'uint').setPBO(true);
    this.grabScreenDistBuffer = instancedArray(new Float32Array(vertexCount), 'float');
    this.grabTargetBuffer = instancedArray(new Uint32Array([0xffffffff, 0]), 'uint');
    this.grabOffsetNdcBuffer = instancedArray(new Float32Array(2), 'float');
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
      springRestLengthArray[i] =
        edge.restLengthOverride ?? edge.vertex0.position.distanceTo(edge.vertex1.position);
      edgeKindArray[i] =
        edge.kind === 'bend' ? 1 : edge.kind === 'shear' ? 2 : 0;
    }

    const structuralLookup = createSimStructuralEdgeLookup(
      this.clothNumSegmentsX,
      this.clothNumSegmentsY,
      this.simHorizontalEdgeIds,
      this.simVerticalEdgeIds,
    );
    const { edgeDependencyStarts, edgeDependencyIds } = buildEdgeStructuralDependencies(
      this.clothEdges,
      structuralLookup,
    );

    this.springVertexIdBuffer = instancedArray(springVertexIdArray, 'uvec2').setPBO(true);
    this.springRestLengthBuffer = instancedArray(springRestLengthArray, 'float');
    this.edgeKindBuffer = instancedArray(edgeKindArray, 'uint');
    this.springCorrectionBuffer = instancedArray(edgeCount, 'vec3');
    this.edgeActiveBuffer = instancedArray(new Uint32Array(edgeCount).fill(1), 'uint').setPBO(true);
    this.edgeVisualBuffer = instancedArray(new Uint32Array(edgeCount).fill(1), 'uint').setPBO(true);
    this.edgeDependencyStartsBuffer = instancedArray(edgeDependencyStarts, 'uint');
    this.edgeDependencyIdsBuffer = instancedArray(nonEmptyUint32Array(edgeDependencyIds), 'uint');
    this.simHorizontalEdgeIdBuffer = instancedArray(
      nonEmptyUint32Array(this.packSimEdgeIdLookup(this.simHorizontalEdgeIds)),
      'uint',
    ).setPBO(true);
    this.simVerticalEdgeIdBuffer = instancedArray(
      nonEmptyUint32Array(this.packSimEdgeIdLookup(this.simVerticalEdgeIds)),
      'uint',
    ).setPBO(true);
    this.simShearDownEdgeIdBuffer = instancedArray(
      nonEmptyUint32Array(this.packSimEdgeIdLookup(this.simShearDownEdgeIds)),
      'uint',
    ).setPBO(true);
    this.simShearUpEdgeIdBuffer = instancedArray(
      nonEmptyUint32Array(this.packSimEdgeIdLookup(this.simShearUpEdgeIds)),
      'uint',
    ).setPBO(true);
    this.bbPositionBuffer = instancedArray(new Float32Array(this.bbPool.maxCount * 3), 'vec3').setPBO(
      true,
    );
    this.bbPreviousPositionBuffer = instancedArray(
      new Float32Array(this.bbPool.maxCount * 3),
      'vec3',
    ).setPBO(true);
    this.bbVelocityBuffer = instancedArray(new Float32Array(this.bbPool.maxCount * 3), 'vec3').setPBO(
      true,
    );
    this.bbAgeBuffer = instancedArray(new Float32Array(this.bbPool.maxCount), 'float').setPBO(true);
    this.bbActiveBuffer = instancedArray(new Uint32Array(this.bbPool.maxCount), 'uint').setPBO(true);
    this.boneSdfStartBuffer = instancedArray(new Float32Array(MAX_BONE_SDF_CAPSULES * 4), 'vec4');
    this.boneSdfEndRadiusBuffer = instancedArray(new Float32Array(MAX_BONE_SDF_CAPSULES * 4), 'vec4');
  }

  private buildSelfCollisionExclusionArray(): Uint32Array {
    const vertexCount = this.clothVertices.length;
    if (this.activeTopology?.selfCollisionExclusions.length === vertexCount * vertexCount) {
      return this.activeTopology.selfCollisionExclusions;
    }

    if (this.topologyMode !== 'assembly') {
      return new Uint32Array(1);
    }

    const exclusions = new Uint32Array(vertexCount * vertexCount);

    const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);
    for (const edge of this.clothEdges) {
      adjacency[edge.vertex0.id]!.push(edge.vertex1.id);
      adjacency[edge.vertex1.id]!.push(edge.vertex0.id);
    }

    for (let source = 0; source < vertexCount; source++) {
      const queue: Array<{ id: number; depth: number }> = [{ id: source, depth: 0 }];
      const visited = new Set<number>([source]);
      exclusions[source * vertexCount + source] = 1;

      for (let cursor = 0; cursor < queue.length; cursor++) {
        const { id, depth } = queue[cursor]!;
        if (depth >= 2) {
          continue;
        }

        for (const next of adjacency[id]!) {
          if (visited.has(next)) {
            continue;
          }
          visited.add(next);
          exclusions[source * vertexCount + next] = 1;
          queue.push({ id: next, depth: depth + 1 });
        }
      }
    }

    return exclusions;
  }

  private packSimEdgeIdLookup(ids: number[]): Uint32Array {
    const packed = new Uint32Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      packed[i] = ids[i]! < 0 ? 0xffffffff : ids[i]!;
    }
    return packed;
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
    this.shapePressureUniform = uniform(s.shapePressure);
    this.mannequinCollisionUniform = uniform(s.mannequinCollision ? 1 : 0);
    this.mannequinMarginUniform = uniform(s.mannequinMargin);
    this.mannequinFrictionUniform = uniform(s.mannequinFriction);
    this.mannequinTorsoRadiiUniform = uniform(
      new THREE.Vector3(s.mannequinTorsoRadiusX, s.mannequinTorsoRadiusY, s.mannequinTorsoRadiusZ),
    );
    this.mannequinTorsoCenterYUniform = uniform(s.mannequinTorsoCenterY);
    this.mannequinArmRadiusUniform = uniform(s.mannequinArmRadius);
    this.mannequinArmHalfLengthUniform = uniform(s.mannequinArmHalfLength);
    this.mannequinArmCenterYUniform = uniform(s.mannequinArmCenterY);
    this.mannequinNeckRadiusUniform = uniform(s.mannequinNeckRadius);
    this.mannequinNeckCenterYUniform = uniform(s.mannequinNeckCenterY);
    this.mannequinNeckBaseRadiusUniform = uniform(s.mannequinNeckBaseRadius);
    this.mannequinNeckBaseCenterYUniform = uniform(s.mannequinNeckBaseCenterY);
    this.zoneAStrengthUniform = uniform(s.zoneAStrength);
    this.zoneARadiusUniform = uniform(s.zoneARadius);
    this.zoneASpeedUniform = uniform(s.zoneASpeed);
    this.zoneADirectionUniform = uniform(new THREE.Vector3(s.zoneADirX, s.zoneADirY, s.zoneADirZ));
    this.zoneBStrengthUniform = uniform(s.zoneBStrength);
    this.zoneBRadiusUniform = uniform(s.zoneBRadius);
    this.zoneBSpeedUniform = uniform(s.zoneBSpeed);
    this.zoneBDirectionUniform = uniform(new THREE.Vector3(s.zoneBDirX, s.zoneBDirY, s.zoneBDirZ));
    this.mouseNdcUniform = uniform(new THREE.Vector2(-2, -2));
    this.grabModeUniform = uniform(0);
    this.grabActiveUniform = uniform(0);
    this.grabTryLatchUniform = uniform(0);
    this.grabPickRadiusUniform = uniform(0.018);
    this.grabInfluenceRadiusUniform = uniform(this.settings.grabRadius);
    this.grabCameraProjectionUniform = uniform(new THREE.Matrix4());
    this.grabCameraViewUniform = uniform(new THREE.Matrix4());
    this.grabCameraProjectionInverseUniform = uniform(new THREE.Matrix4());
    this.grabCameraWorldUniform = uniform(new THREE.Matrix4());
    this.bbHitRadiusUniform = uniform(this.settings.bbHitRadius);
    this.bbVisualRadiusUniform = uniform(this.settings.bbVisualRadius);
    this.bbForceStrengthUniform = uniform(this.settings.bbForceStrength);
    this.bbRestitutionUniform = uniform(this.settings.bbRestitution);
    this.bbFrictionUniform = uniform(this.settings.bbFriction);
    this.bbFabricSoftnessUniform = uniform(this.settings.bbFabricSoftness);
    this.bbGravityUniform = uniform(4.5);
    this.bbSubstepDtUniform = uniform(1 / this.stepsPerSecond);
    this.bbLifetimeUniform = uniform(2.5);
    this.bbBoundsMinUniform = uniform(this.bbBounds.min.clone());
    this.bbBoundsMaxUniform = uniform(this.bbBounds.max.clone());
    this.clothWidthUniform = uniform(this.clothWidth);
    this.clothHeightUniform = uniform(this.clothHeight);
    this.flagHoistTopYUniform = uniform(this.flagHoistTopY);
    this.clothSegmentsXUniform = uniform(this.clothNumSegmentsX);
    this.clothSegmentsYUniform = uniform(this.clothNumSegmentsY);
    this.renderSubdivisionsUniform = uniform(this.settings.renderSubdivisions);
    this.tearStretchUniform = uniform(this.settings.tearStretchThreshold);
    this.bbPool.setSpeed(this.settings.bbSpeed);
    this.bbPool.setVisualRadius(this.settings.bbVisualRadius);
    this.bbPool.setForceRadius(this.settings.bbHitRadius);
    this.simGridSizeYUniform = uniform(this.clothNumSegmentsY + 1);
  }

  private syncGrabCameraUniforms(): void {
    this.camera.updateMatrixWorld();
    this.grabCameraProjectionUniform.value.copy(this.camera.projectionMatrix);
    this.grabCameraViewUniform.value.copy(this.camera.matrixWorldInverse);
    this.grabCameraProjectionInverseUniform.value.copy(this.camera.projectionMatrixInverse);
    this.grabCameraWorldUniform.value.copy(this.camera.matrixWorld);
    this.grabModeUniform.value = this.isGrabModeEnabled ? 1 : 0;
    this.grabActiveUniform.value = this.isGrabActive ? 1 : 0;
    this.grabTryLatchUniform.value = this.grabTryLatch ? 1 : 0;
  }

  private resetGrabLatchState(): void {
    const targetAttr = this.grabTargetBuffer.value as StorageInstancedBufferAttribute;
    const targetArray = targetAttr.array as Uint32Array;
    targetArray[0] = 0xffffffff;
    targetArray[1] = 0;
    targetAttr.needsUpdate = true;

    const offsetAttr = this.grabOffsetNdcBuffer.value as StorageInstancedBufferAttribute;
    const offsetArray = offsetAttr.array as Float32Array;
    offsetArray[0] = 0;
    offsetArray[1] = 0;
    offsetAttr.needsUpdate = true;
  }

  private resetEdgeActiveStateCpu(): void {
    this.applyEdgeActiveStateCpu(new Uint32Array(this.clothEdges.length).fill(1));
    this.restoreClothConnectivityCpu();
    this.restoreClothFullTopology();
  }

  private applyEdgeActiveStateCpu(edgeActive: Uint32Array): void {
    const activeAttr = this.edgeActiveBuffer.value as StorageInstancedBufferAttribute;
    (activeAttr.array as Uint32Array).set(edgeActive);
    activeAttr.needsUpdate = true;

    const visualAttr = this.edgeVisualBuffer.value as StorageInstancedBufferAttribute;
    (visualAttr.array as Uint32Array).set(edgeActive);
    visualAttr.needsUpdate = true;
  }

  private applyVertexComponentsCpu(components: Uint32Array): void {
    const componentAttr = this.vertexComponentBuffer.value as StorageInstancedBufferAttribute;
    (componentAttr.array as Uint32Array).set(components);
    componentAttr.needsUpdate = true;
  }

  private connectivitySignature(edgeActive: Uint32Array, components: Uint32Array): string {
    let broken = 0;
    for (let i = 0; i < edgeActive.length; i++) {
      if (edgeActive[i] === 0) {
        broken += 1;
      }
    }

    const roots = new Set<number>();
    for (let i = 0; i < components.length; i++) {
      roots.add(components[i]!);
    }

    return `${broken}:${roots.size}:${this.settings.tearMeshing}:${this.settings.tearSdfCornerRadius.toFixed(3)}`;
  }

  private isSimVertexFixed(gridX: number, gridY: number): boolean {
    return this.clothVertexColumns[gridX]?.[gridY]?.isFixed ?? true;
  }

  private clothConnectivitySyncOptions(): SyncClothConnectivityOptions | undefined {
    if (!this.simEdgeLookup) {
      return undefined;
    }

    return {
      lookup: this.simEdgeLookup,
      isVertexFixed: (gridX, gridY) => this.isSimVertexFixed(gridX, gridY),
    };
  }

  private restoreClothConnectivityCpu(): void {
    const edgeActive = new Uint32Array(this.clothEdges.length).fill(1);
    const { components } = syncClothConnectivity(
      this.clothVertices.length,
      this.clothGraphEdges,
      edgeActive,
      this.clothConnectivitySyncOptions(),
    );
    this.applyVertexComponentsCpu(components);
    this.lastBrokenEdgeCount = 0;
    this.lastConnectivitySignature = this.connectivitySignature(edgeActive, components);
  }

  private syncClothConnectivityFromEdgeState(edgeActive: Uint32Array): {
    edgeActive: Uint32Array;
    components: Uint32Array;
  } {
    const { edgeActive: syncedEdges, components } = syncClothConnectivity(
      this.clothVertices.length,
      this.clothGraphEdges,
      edgeActive,
      this.clothConnectivitySyncOptions(),
    );

    if (!this.edgeActiveArraysEqual(edgeActive, syncedEdges)) {
      edgeActive.set(syncedEdges);
      this.applyEdgeActiveStateCpu(syncedEdges);
    }

    this.applyVertexComponentsCpu(components);
    return { edgeActive: syncedEdges, components };
  }

  private edgeActiveArraysEqual(a: Uint32Array, b: Uint32Array): boolean {
    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }

    return true;
  }

  private buildClothRenderTopology(simGridCoordArray: Float32Array, indices: number[]): void {
    this.simEdgeLookup = createSimEdgeLookup(
      this.clothNumSegmentsX,
      this.clothNumSegmentsY,
      this.simHorizontalEdgeIds,
      this.simVerticalEdgeIds,
      this.simShearDownEdgeIds,
      this.simShearUpEdgeIds,
    );
    this.clothSimGridCoords = simGridCoordArray;
    this.visibleClothSimGridCoords = simGridCoordArray;
    this.clothRenderQuads = buildClothRenderQuads(indices);
    this.lastBrokenEdgeCount = 0;
  }

  private applyClothIndexBuffer(indices: Uint32Array): void {
    if (!this.clothGeometry) {
      return;
    }

    const currentIndex = this.clothGeometry.index;
    if (!currentIndex || currentIndex.array.length !== indices.length) {
      this.clothGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    } else {
      (currentIndex.array as Uint32Array).set(indices);
      currentIndex.needsUpdate = true;
    }

    this.clothGeometry.setDrawRange(0, indices.length);
  }

  private applyFloatAttribute(name: string, array: Float32Array, itemSize: number): void {
    const current = this.clothGeometry.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (current && current.array.length === array.length && current.itemSize === itemSize) {
      (current.array as Float32Array).set(array);
      current.needsUpdate = true;
      return;
    }

    this.clothGeometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  private applyClothRenderMesh(mesh: ClothSdfRenderMesh): void {
    if (!this.clothGeometry) {
      return;
    }

    const vertexCount = mesh.simGridCoords.length / 2;
    const fabricUvArray = new Float32Array(mesh.simGridCoords.length);
    for (let i = 0; i < vertexCount; i++) {
      const simX = mesh.simGridCoords[i * 2]!;
      const simY = mesh.simGridCoords[i * 2 + 1]!;
      fabricUvArray[i * 2] = (simX / this.clothNumSegmentsX) * this.clothWidth;
      fabricUvArray[i * 2 + 1] = (simY / this.clothNumSegmentsY) * this.clothHeight;
    }

    this.applyFloatAttribute('position', new Float32Array(vertexCount * 3), 3);
    this.applyFloatAttribute('simGridCoord', mesh.simGridCoords, 2);
    this.applyFloatAttribute('uv', fabricUvArray, 2);
    this.applyFloatAttribute('fabricUv', fabricUvArray, 2);
    this.applyClothIndexBuffer(mesh.indices);
    this.clothGeometry.setDrawRange(0, mesh.indices.length);
    this.visibleClothSimGridCoords = mesh.simGridCoords;
  }

  private buildRenderableComponentMask(components: Uint32Array): Uint8Array {
    const stats: ComponentRenderStats[] = Array.from({ length: components.length }, () => ({
      vertices: 0,
      cells: 0,
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      hasFixed: false,
    }));

    for (const vertex of this.clothVertices) {
      const component = components[vertex.id]!;
      const stat = stats[component]!;
      stat.vertices += 1;
      stat.minX = Math.min(stat.minX, vertex.gridX);
      stat.maxX = Math.max(stat.maxX, vertex.gridX);
      stat.minY = Math.min(stat.minY, vertex.gridY);
      stat.maxY = Math.max(stat.maxY, vertex.gridY);
      stat.hasFixed = stat.hasFixed || vertex.isFixed;
    }

    for (let cellX = 0; cellX < this.clothNumSegmentsX; cellX++) {
      for (let cellY = 0; cellY < this.clothNumSegmentsY; cellY++) {
        const c00 = components[this.clothVertexColumns[cellX]![cellY]!.id]!;
        const c10 = components[this.clothVertexColumns[cellX + 1]![cellY]!.id]!;
        const c01 = components[this.clothVertexColumns[cellX]![cellY + 1]!.id]!;
        const c11 = components[this.clothVertexColumns[cellX + 1]![cellY + 1]!.id]!;
        if (c00 === c10 && c00 === c01 && c00 === c11) {
          stats[c00]!.cells += 1;
        }
      }
    }

    const renderable = new Uint8Array(components.length);
    for (let component = 0; component < stats.length; component++) {
      const stat = stats[component]!;
      if (stat.vertices === 0) {
        continue;
      }

      const spanX = stat.maxX - stat.minX;
      const spanY = stat.maxY - stat.minY;
      const substantialDetachedPiece = stat.vertices >= 8 && stat.cells >= 3 && spanX >= 2 && spanY >= 2;
      if (stat.hasFixed || substantialDetachedPiece) {
        renderable[component] = 1;
      }
    }

    return renderable;
  }

  private seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  private createRandomTornEdgeState(seed: number, tearsPerSample: number): Uint32Array {
    const random = this.seededRandom(seed);
    const edgeActive = new Uint32Array(this.clothEdges.length).fill(1);

    for (let tear = 0; tear < tearsPerSample; tear++) {
      const centerX = 1 + random() * Math.max(1, this.clothNumSegmentsX - 2);
      const centerY = 1 + random() * Math.max(1, this.clothNumSegmentsY - 2);
      const radius = 0.85 + random() * 2.4;
      const radiusSq = radius * radius;

      for (const edge of this.clothEdges) {
        if (edge.kind === 'bend' || edge.vertex0.isFixed || edge.vertex1.isFixed) {
          continue;
        }

        const midX = (edge.vertex0.gridX + edge.vertex1.gridX) * 0.5;
        const midY = (edge.vertex0.gridY + edge.vertex1.gridY) * 0.5;
        const dx = midX - centerX;
        const dy = midY - centerY;
        const jitter = random() * 0.35;
        if (dx * dx + dy * dy <= radiusSq + jitter) {
          edgeActive[edge.id] = 0;
        }
      }
    }

    return edgeActive;
  }

  private componentForSimCoord(
    simGridCoords: Float32Array,
    vertexIndex: number,
    components: Uint32Array,
  ): number {
    const simX = simGridCoords[vertexIndex * 2]!;
    const simY = simGridCoords[vertexIndex * 2 + 1]!;
    const gridX = THREE.MathUtils.clamp(Math.round(simX), 0, this.clothNumSegmentsX);
    const gridY = THREE.MathUtils.clamp(Math.round(simY), 0, this.clothNumSegmentsY);
    const simVertex = this.clothVertexColumns[gridX]?.[gridY];
    return simVertex ? components[simVertex.id]! : 0xffffffff;
  }

  private auditVisibleMeshGeometry(
    simGridCoords: Float32Array,
    indices: Uint32Array,
    edgeActive: Uint32Array,
    components: Uint32Array,
    maxAllowedEdge: number,
  ): Omit<RandomTearGeometryAuditReport, 'samples' | 'brokenEdgeCount' | 'issues'> {
    let trianglesChecked = 0;
    let maxSimTriangleEdge = 0;
    let crossComponentTriangles = 0;
    let brokenEdgeCrossingTriangles = 0;
    let overlongTriangles = 0;

    const edgeLength = (a: number, b: number): number => {
      const ax = simGridCoords[a * 2]!;
      const ay = simGridCoords[a * 2 + 1]!;
      const bx = simGridCoords[b * 2]!;
      const by = simGridCoords[b * 2 + 1]!;
      return Math.hypot(ax - bx, ay - by);
    };

    for (let i = 0; i < indices.length; i += 3) {
      const triangle: ClothRenderTriangle = {
        i0: indices[i]!,
        i1: indices[i + 1]!,
        i2: indices[i + 2]!,
      };
      trianglesChecked += 1;

      const c0 = this.componentForSimCoord(simGridCoords, triangle.i0, components);
      const c1 = this.componentForSimCoord(simGridCoords, triangle.i1, components);
      const c2 = this.componentForSimCoord(simGridCoords, triangle.i2, components);
      if (c0 !== c1 || c0 !== c2) {
        crossComponentTriangles += 1;
      }

      if (this.simEdgeLookup && triangleCrossesBrokenStructuralEdge(triangle, simGridCoords, this.simEdgeLookup, edgeActive)) {
        brokenEdgeCrossingTriangles += 1;
      }

      const longestEdge = Math.max(
        edgeLength(triangle.i0, triangle.i1),
        edgeLength(triangle.i1, triangle.i2),
        edgeLength(triangle.i2, triangle.i0),
      );
      maxSimTriangleEdge = Math.max(maxSimTriangleEdge, longestEdge);
      if (longestEdge > maxAllowedEdge) {
        overlongTriangles += 1;
      }
    }

    return {
      trianglesChecked,
      maxSimTriangleEdge,
      crossComponentTriangles,
      brokenEdgeCrossingTriangles,
      overlongTriangles,
    };
  }

  private sampleVisibleVertexNearest(
    simGridCoords: Float32Array,
    vertexIndex: number,
    simPositions: Float32Array,
    positionStride: number,
  ): THREE.Vector3 {
    const simX = simGridCoords[vertexIndex * 2]!;
    const simY = simGridCoords[vertexIndex * 2 + 1]!;
    const gridX = THREE.MathUtils.clamp(Math.round(simX), 0, this.clothNumSegmentsX);
    const gridY = THREE.MathUtils.clamp(Math.round(simY), 0, this.clothNumSegmentsY);
    const simVertex = this.clothVertexColumns[gridX]?.[gridY];
    if (!simVertex) {
      return new THREE.Vector3();
    }

    const offset = simVertex.id * positionStride;
    return new THREE.Vector3(
      simPositions[offset] ?? 0,
      simPositions[offset + 1] ?? 0,
      simPositions[offset + 2] ?? 0,
    );
  }

  async auditVisibleWorldGeometryForTest(
    options: VisibleWorldGeometryAuditOptions = {},
  ): Promise<VisibleWorldGeometryAuditReport | null> {
    if (!this.clothGeometry.index) {
      return null;
    }

    const simGridAttr = this.clothGeometry.getAttribute('simGridCoord') as
      | THREE.BufferAttribute
      | undefined;
    if (!simGridAttr) {
      return null;
    }

    const maxAllowedEdge = options.maxWorldTriangleEdge ?? 0.75;
    const positionAttr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const positionBuffer = await this.renderer.getArrayBufferAsync(positionAttr);
    const simPositions = new Float32Array(positionBuffer);
    const simGridCoords = simGridAttr.array as Float32Array;
    const indices = this.clothGeometry.index.array as ArrayLike<number>;
    let trianglesChecked = 0;
    let maxWorldTriangleEdge = 0;
    let overlongWorldTriangles = 0;
    const p0 = new THREE.Vector3();
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();

    for (let i = 0; i < this.clothGeometry.drawRange.count; i += 3) {
      const i0 = indices[i]!;
      const i1 = indices[i + 1]!;
      const i2 = indices[i + 2]!;
      p0.copy(this.sampleVisibleVertexNearest(simGridCoords, i0, simPositions, positionAttr.itemSize));
      p1.copy(this.sampleVisibleVertexNearest(simGridCoords, i1, simPositions, positionAttr.itemSize));
      p2.copy(this.sampleVisibleVertexNearest(simGridCoords, i2, simPositions, positionAttr.itemSize));
      const longestEdge = Math.max(p0.distanceTo(p1), p1.distanceTo(p2), p2.distanceTo(p0));
      maxWorldTriangleEdge = Math.max(maxWorldTriangleEdge, longestEdge);
      if (longestEdge > maxAllowedEdge) {
        overlongWorldTriangles += 1;
      }
      trianglesChecked += 1;
    }

    const issues: string[] = [];
    if (trianglesChecked === 0) {
      issues.push('no visible triangles to audit');
    }
    if (overlongWorldTriangles > 0) {
      issues.push(`${overlongWorldTriangles} visible triangles exceed world edge ${maxAllowedEdge}`);
    }

    return { trianglesChecked, maxWorldTriangleEdge, overlongWorldTriangles, issues };
  }

  auditRandomTornGeometryForTest(
    options: RandomTearGeometryAuditOptions = {},
  ): RandomTearGeometryAuditReport | null {
    if (!this.simEdgeLookup || !this.clothSimGridCoords || this.clothRenderQuads.length === 0) {
      return null;
    }

    const samples = THREE.MathUtils.clamp(Math.round(options.samples ?? 8), 1, 32);
    const tearsPerSample = THREE.MathUtils.clamp(Math.round(options.tearsPerSample ?? 5), 1, 32);
    const maxAllowedEdge = options.maxSimTriangleEdge ?? 1.05;
    const seed = options.seed ?? 12345;
    const aggregate = {
      samples,
      trianglesChecked: 0,
      brokenEdgeCount: 0,
      maxSimTriangleEdge: 0,
      crossComponentTriangles: 0,
      brokenEdgeCrossingTriangles: 0,
      overlongTriangles: 0,
      issues: [] as string[],
    };

    for (let sample = 0; sample < samples; sample++) {
      const edgeState = this.createRandomTornEdgeState(seed + sample * 7919, tearsPerSample);
      this.applyEdgeActiveStateCpu(edgeState);
      const { edgeActive, components } = this.syncClothConnectivityFromEdgeState(edgeState);
      const brokenEdgeCount = countBrokenEdges(edgeActive);
      const visible = this.rebuildVisibleClothMesh(edgeActive, brokenEdgeCount, components);
      const simGridCoords = visible.sdfMesh?.simGridCoords ?? visible.simGridCoords;
      const indices = visible.indices;

      if (visible.sdfMesh) {
        this.applyClothRenderMesh(visible.sdfMesh);
      } else {
        this.visibleClothSimGridCoords = simGridCoords;
        this.applyClothIndexBuffer(indices);
      }

      const report = this.auditVisibleMeshGeometry(
        simGridCoords,
        indices,
        edgeActive,
        components,
        maxAllowedEdge,
      );
      aggregate.trianglesChecked += report.trianglesChecked;
      aggregate.brokenEdgeCount += brokenEdgeCount;
      aggregate.maxSimTriangleEdge = Math.max(aggregate.maxSimTriangleEdge, report.maxSimTriangleEdge);
      aggregate.crossComponentTriangles += report.crossComponentTriangles;
      aggregate.brokenEdgeCrossingTriangles += report.brokenEdgeCrossingTriangles;
      aggregate.overlongTriangles += report.overlongTriangles;
    }

    if (aggregate.trianglesChecked === 0) {
      aggregate.issues.push('no visible triangles after random tearing');
    }
    if (aggregate.crossComponentTriangles > 0) {
      aggregate.issues.push(`${aggregate.crossComponentTriangles} triangles span disconnected components`);
    }
    if (aggregate.brokenEdgeCrossingTriangles > 0) {
      aggregate.issues.push(`${aggregate.brokenEdgeCrossingTriangles} triangles cross broken structural edges`);
    }
    if (aggregate.overlongTriangles > 0) {
      aggregate.issues.push(`${aggregate.overlongTriangles} triangles exceed max sim edge ${maxAllowedEdge}`);
    }

    return aggregate;
  }

  private rebuildVisibleClothMesh(
    edgeActive: Uint32Array,
    brokenEdgeCount: number,
    components?: Uint32Array,
  ): {
    indices: Uint32Array;
    simGridCoords: Float32Array;
    sdfMesh?: ClothSdfRenderMesh;
  } {
    if (!this.simEdgeLookup || !this.clothSimGridCoords) {
      const empty = new Float32Array();
      return { indices: new Uint32Array(), simGridCoords: empty };
    }

    if (this.settings.tearMeshing === 'sdf' && brokenEdgeCount > 0) {
      const sdfMesh = buildClothSdfRenderMesh(
        this.clothRenderQuads,
        this.clothSimGridCoords,
        this.simEdgeLookup,
        edgeActive,
        {
          holeCornerRadius: this.settings.tearSdfCornerRadius,
          vertexComponents: components,
          renderableComponents: components ? this.buildRenderableComponentMask(components) : undefined,
        },
      );
      return { indices: sdfMesh.indices, simGridCoords: sdfMesh.simGridCoords, sdfMesh };
    }

    const indices = rebuildClothIndicesFromEdgeState(
      this.clothRenderQuads,
      this.clothSimGridCoords,
      this.simEdgeLookup,
      edgeActive,
    );
    return { indices, simGridCoords: this.clothSimGridCoords };
  }

  private rebuildParticleRenderIndices(edgeActive: Uint32Array, components: Uint32Array): Uint32Array {
    if (!this.particleRenderBaseIndices || !this.particleRenderTriangleEdgeIds || !this.clothSimGridCoords) {
      return new Uint32Array();
    }

    const nextIndices: number[] = [];
    const simVertexForRenderIndex = (index: number): number =>
      Math.round(this.clothSimGridCoords![index * 2] ?? 0);

    for (let i = 0; i < this.particleRenderBaseIndices.length; i += 3) {
      const i0 = this.particleRenderBaseIndices[i]!;
      const i1 = this.particleRenderBaseIndices[i + 1]!;
      const i2 = this.particleRenderBaseIndices[i + 2]!;
      const v0 = simVertexForRenderIndex(i0);
      const v1 = simVertexForRenderIndex(i1);
      const v2 = simVertexForRenderIndex(i2);
      const sameComponent = components[v0] === components[v1] && components[v0] === components[v2];
      if (!sameComponent) {
        continue;
      }

      let intact = true;
      for (let e = 0; e < 3; e++) {
        const edgeId = this.particleRenderTriangleEdgeIds[i + e]!;
        if (edgeId >= 0 && edgeActive[edgeId] === 0) {
          intact = false;
          break;
        }
      }
      if (intact) {
        nextIndices.push(i0, i1, i2);
      }
    }

    return new Uint32Array(nextIndices);
  }

  private restoreClothFullTopology(): void {
    if (this.particleRenderBaseIndices) {
      this.applyClothIndexBuffer(this.particleRenderBaseIndices);
      this.lastBrokenEdgeCount = 0;
      return;
    }

    if (
      !this.simEdgeLookup ||
      !this.clothSimGridCoords ||
      this.clothRenderQuads.length === 0
    ) {
      return;
    }

    const allActive = new Uint32Array(this.clothEdges.length).fill(1);
    const visible = this.rebuildVisibleClothMesh(allActive, 0);
    if (visible.sdfMesh) {
      this.applyClothRenderMesh(visible.sdfMesh);
    } else if (this.settings.tearMeshing === 'sdf') {
      this.applyClothRenderMesh({
        simGridCoords: this.clothSimGridCoords,
        indices: visible.indices,
      });
    } else {
      this.visibleClothSimGridCoords = this.clothSimGridCoords;
      this.applyClothIndexBuffer(visible.indices);
    }
    this.lastBrokenEdgeCount = 0;
  }

  private async refreshClothTopologyFromGpu(): Promise<void> {
    if (
      !this.isReady ||
      this.clothTopologyReadbackPending ||
      !this.clothSimGridCoords ||
      (!this.simEdgeLookup && !this.particleRenderBaseIndices) ||
      (this.simEdgeLookup && this.clothRenderQuads.length === 0)
    ) {
      return;
    }

    this.clothTopologyReadbackPending = true;

    try {
      const activeAttr = this.edgeActiveBuffer.value as StorageInstancedBufferAttribute;
      const buffer = await this.renderer.getArrayBufferAsync(activeAttr);
      const edgeActive = new Uint32Array(buffer);
      const { edgeActive: syncedEdgeActive, components } =
        this.syncClothConnectivityFromEdgeState(edgeActive);
      this.lastSyncedEdgeActive = syncedEdgeActive;
      const signature = this.connectivitySignature(syncedEdgeActive, components);
      if (signature === this.lastConnectivitySignature) {
        return;
      }

      const brokenEdgeCount = countBrokenEdges(syncedEdgeActive);
      const particleIndices = this.particleRenderBaseIndices
        ? this.rebuildParticleRenderIndices(syncedEdgeActive, components)
        : null;
      const visibleMesh = particleIndices
        ? { indices: particleIndices, simGridCoords: this.clothSimGridCoords }
        : this.rebuildVisibleClothMesh(syncedEdgeActive, brokenEdgeCount, components);
      this.lastConnectivitySignature = signature;
      this.lastBrokenEdgeCount = brokenEdgeCount;
      if (visibleMesh.sdfMesh) {
        this.applyClothRenderMesh(visibleMesh.sdfMesh);
      } else if (this.settings.tearMeshing === 'sdf') {
        this.applyClothRenderMesh({
          simGridCoords: this.clothSimGridCoords,
          indices: visibleMesh.indices,
        });
      } else {
        this.visibleClothSimGridCoords = this.clothSimGridCoords;
        this.applyClothIndexBuffer(visibleMesh.indices);
      }

      if (this.settings.renderStrandThreads && !this.strandThreadReadbackPending) {
        this.strandThreadReadbackPending = true;
        try {
          await this.syncStrandThreadsFromState(syncedEdgeActive, visibleMesh.indices, true);
        } finally {
          this.strandThreadReadbackPending = false;
        }
      }
    } finally {
      this.clothTopologyReadbackPending = false;
    }
  }


  private setupBbVisuals(): void {
    for (let i = 0; i < this.bbPool.maxCount; i++) {
      const mesh = createBbProjectileMesh();
      mesh.renderOrder = 12;
      this.bbMeshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  private getSyncedEdgeActiveForStrands(edgeActive: Uint32Array): Uint32Array {
    return syncClothConnectivity(
      this.clothVertices.length,
      this.clothGraphEdges,
      new Uint32Array(edgeActive),
      this.clothConnectivitySyncOptions(),
    ).edgeActive;
  }

  private strandThreadCollectionOptions(
    visibleIndices?: Uint32Array,
  ): StrandThreadCollectionOptions & {
    renderQuads: ClothRenderQuad[];
    simGridCoords: Float32Array;
    visibleIndices?: Uint32Array;
  } {
    return {
      segmentsX: this.clothNumSegmentsX,
      segmentsY: this.clothNumSegmentsY,
      vertexGrid: this.clothVertices,
      lookup: this.simEdgeLookup!,
      isVertexFixedGrid: (gridX, gridY) => this.isSimVertexFixed(gridX, gridY),
      renderQuads: this.clothRenderQuads,
      simGridCoords: this.visibleClothSimGridCoords ?? this.clothSimGridCoords!,
      visibleIndices,
    };
  }

  async auditStrandThreadCoverage(): Promise<StrandThreadAuditResult | null> {
    if (
      !this.isReady ||
      !this.simEdgeLookup ||
      !this.clothSimGridCoords ||
      this.clothRenderQuads.length === 0
    ) {
      return null;
    }

    let edgeActive = this.lastSyncedEdgeActive;
    if (!edgeActive) {
      const edgeAttr = this.edgeActiveBuffer.value as StorageInstancedBufferAttribute;
      const edgeBuffer = await this.renderer.getArrayBufferAsync(edgeAttr);
      edgeActive = this.getSyncedEdgeActiveForStrands(new Uint32Array(edgeBuffer));
    }

    const audit = auditStrandThreadCoverage(
      this.structuralGraphEdges,
      edgeActive,
      this.lastStrandThreadEdgeIds,
      this.clothVertices.length,
      (vertexId) => this.clothVertices[vertexId]?.isFixed ?? true,
      this.strandThreadCollectionOptions(),
    );

    return {
      frameCount: this.frameCount,
      brokenEdgeCount: countBrokenEdges(edgeActive),
      requiredCount: audit.required.length,
      renderedCount: audit.rendered.length,
      missingEdgeIds: audit.missing,
      extraEdgeIds: audit.extra,
    };
  }

  private async syncStrandThreadsFromState(
    syncedEdgeActive: Uint32Array,
    visibleIndices: Uint32Array,
    recomputeEdgeIds: boolean,
  ): Promise<void> {
    if (!this.settings.renderStrandThreads || !this.strandThreadMesh) {
      return;
    }

    let strandEdgeIds = this.lastStrandThreadEdgeIds;
    if (recomputeEdgeIds) {
      strandEdgeIds = collectStrandThreadEdgeIds(
        this.structuralGraphEdges,
        syncedEdgeActive,
        this.clothVertices.length,
        (vertexId) => this.clothVertices[vertexId]?.isFixed ?? true,
        this.strandThreadCollectionOptions(visibleIndices),
      );
      this.lastStrandThreadEdgeIds = strandEdgeIds;
    }

    if (strandEdgeIds.length === 0) {
      this.strandThreadMesh.count = 0;
      this.strandThreadMesh.visible = false;
      return;
    }

    const positionAttr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
    const positionBuffer = await this.renderer.getArrayBufferAsync(positionAttr);
    syncStrandThreadInstancedMesh(
      this.strandThreadMesh,
      strandEdgeIds,
      this.strandThreadEdgeVertices,
      new Float32Array(positionBuffer),
      positionAttr.itemSize,
      this.settings.strandThreadRadius,
    );
    this.strandThreadMesh.visible = true;
  }

  private disposeStrandThreadVisual(): void {
    if (!this.strandThreadMesh) {
      return;
    }

    this.scene.remove(this.strandThreadMesh);
    this.strandThreadMesh.geometry.dispose();
    (this.strandThreadMesh.material as THREE.Material).dispose();
    this.strandThreadMesh = null;
    this.strandThreadEdgeVertices = [];
  }

  private setupStrandThreadVisual(): void {
    this.disposeStrandThreadVisual();
    this.strandThreadEdgeVertices = this.clothEdges.map((edge) => ({
      v0: edge.vertex0.id,
      v1: edge.vertex1.id,
    }));
    this.strandThreadMesh = createStrandThreadInstancedMesh(
      this.clothEdges.length,
      new THREE.Color(this.settings.flagColor),
    );
    this.scene.add(this.strandThreadMesh);
    this.syncStrandThreadVisual();
  }

  private syncStrandThreadVisual(): void {
    if (!this.strandThreadMesh) {
      return;
    }

    const enabled = this.settings.renderStrandThreads;
    this.strandThreadMesh.visible = enabled && this.strandThreadMesh.count > 0;
    updateStrandThreadMaterial(
      this.strandThreadMesh,
      new THREE.Color(this.settings.flagColor),
      this.settings.strandThreadRadius,
    );

    if (!enabled) {
      this.strandThreadMesh.count = 0;
      this.lastStrandThreadEdgeIds = [];
    } else {
      this.lastConnectivitySignature = '';
    }
  }

  private async refreshStrandThreadPositionsFromGpu(): Promise<void> {
    if (
      !this.isReady ||
      !this.settings.renderStrandThreads ||
      !this.lastSyncedEdgeActive ||
      !this.strandThreadMesh ||
      this.strandThreadReadbackPending ||
      this.clothTopologyReadbackPending ||
      this.lastStrandThreadEdgeIds.length === 0 ||
      this.frameCount % this.strandPositionRefreshInterval !== 0
    ) {
      return;
    }

    this.strandThreadReadbackPending = true;

    try {
      const positionAttr = this.vertexPositionBuffer.value as StorageInstancedBufferAttribute;
      const positionBuffer = await this.renderer.getArrayBufferAsync(positionAttr);
      syncStrandThreadInstancedMesh(
        this.strandThreadMesh,
        this.lastStrandThreadEdgeIds,
        this.strandThreadEdgeVertices,
        new Float32Array(positionBuffer),
        positionAttr.itemSize,
        this.settings.strandThreadRadius,
      );
      this.strandThreadMesh.visible = true;
    } finally {
      this.strandThreadReadbackPending = false;
    }
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
    const vertexComponentBuffer = this.vertexComponentBuffer;
    const selfCollisionExclusionBuffer = this.selfCollisionExclusionBuffer;
    const springVertexIdBuffer = this.springVertexIdBuffer;
    const springRestLengthBuffer = this.springRestLengthBuffer;
    const edgeKindBuffer = this.edgeKindBuffer;
    const edgeActiveBuffer = this.edgeActiveBuffer;
    const springCorrectionBuffer = this.springCorrectionBuffer;
    const springListBuffer = this.springListBuffer;
    const edgeDependencyStartsBuffer = this.edgeDependencyStartsBuffer;
    const edgeDependencyIdsBuffer = this.edgeDependencyIdsBuffer;
    const tearStretchUniform = this.tearStretchUniform;
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
    const shapePressureUniform = this.shapePressureUniform;
    const mannequinCollisionUniform = this.mannequinCollisionUniform;
    const mannequinMarginUniform = this.mannequinMarginUniform;
    const mannequinFrictionUniform = this.mannequinFrictionUniform;
    const mannequinTorsoRadiiUniform = this.mannequinTorsoRadiiUniform;
    const mannequinTorsoCenterYUniform = this.mannequinTorsoCenterYUniform;
    const mannequinArmRadiusUniform = this.mannequinArmRadiusUniform;
    const mannequinArmHalfLengthUniform = this.mannequinArmHalfLengthUniform;
    const mannequinArmCenterYUniform = this.mannequinArmCenterYUniform;
    const mannequinNeckRadiusUniform = this.mannequinNeckRadiusUniform;
    const mannequinNeckCenterYUniform = this.mannequinNeckCenterYUniform;
    const mannequinNeckBaseRadiusUniform = this.mannequinNeckBaseRadiusUniform;
    const mannequinNeckBaseCenterYUniform = this.mannequinNeckBaseCenterYUniform;
    const zoneAStrengthUniform = this.zoneAStrengthUniform;
    const zoneARadiusUniform = this.zoneARadiusUniform;
    const zoneASpeedUniform = this.zoneASpeedUniform;
    const zoneADirectionUniform = this.zoneADirectionUniform;
    const zoneBStrengthUniform = this.zoneBStrengthUniform;
    const zoneBRadiusUniform = this.zoneBRadiusUniform;
    const zoneBSpeedUniform = this.zoneBSpeedUniform;
    const zoneBDirectionUniform = this.zoneBDirectionUniform;
    const bbPositionBuffer = this.bbPositionBuffer;
    const bbPreviousPositionBuffer = this.bbPreviousPositionBuffer;
    const bbVelocityBuffer = this.bbVelocityBuffer;
    const bbAgeBuffer = this.bbAgeBuffer;
    const bbActiveBuffer = this.bbActiveBuffer;
    const bbHitRadiusUniform = this.bbHitRadiusUniform;
    const bbVisualRadiusUniform = this.bbVisualRadiusUniform;
    const bbForceStrengthUniform = this.bbForceStrengthUniform;
    const bbRestitutionUniform = this.bbRestitutionUniform;
    const bbFrictionUniform = this.bbFrictionUniform;
    const bbFabricSoftnessUniform = this.bbFabricSoftnessUniform;
    const bbGravityUniform = this.bbGravityUniform;
    const bbSubstepDtUniform = this.bbSubstepDtUniform;
    const bbLifetimeUniform = this.bbLifetimeUniform;
    const bbBoundsMinUniform = this.bbBoundsMinUniform;
    const bbBoundsMaxUniform = this.bbBoundsMaxUniform;
    const bbSlotCount = this.bbPool.maxCount;
    const boneSdfStartBuffer = this.boneSdfStartBuffer;
    const boneSdfEndRadiusBuffer = this.boneSdfEndRadiusBuffer;

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

      const inflatedCenter = vec3(0, 0.38, 0);
      const pressureDir = current.sub(inflatedCenter).toVar('pressureDir');
      const pressureLen = pressureDir.length().toVar('pressureLen');
      If(pressureLen.greaterThan(0.001), () => {
        velocity.addAssign(pressureDir.div(pressureLen).mul(shapePressureUniform));
      });

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
      If(edgeActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        springCorrectionBuffer.element(instanceIndex).assign(vec3(0, 0, 0));
        Return();
      });

      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      If(
        vertexComponentBuffer
          .element(vertexIds.x)
          .notEqual(vertexComponentBuffer.element(vertexIds.y)),
        () => {
          springCorrectionBuffer.element(instanceIndex).assign(vec3(0, 0, 0));
          Return();
        },
      );

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
      If(edgeActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        springCorrectionBuffer.element(instanceIndex).assign(vec3(0, 0, 0));
        Return();
      });

      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      If(
        vertexComponentBuffer
          .element(vertexIds.x)
          .notEqual(vertexComponentBuffer.element(vertexIds.y)),
        () => {
          springCorrectionBuffer.element(instanceIndex).assign(vec3(0, 0, 0));
          Return();
        },
      );

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

        If(edgeActiveBuffer.element(edgeId).greaterThan(uint(0)), () => {
          const edgeVertexIds = springVertexIdBuffer.element(edgeId);
          If(
            vertexComponentBuffer
              .element(edgeVertexIds.x)
              .equal(vertexComponentBuffer.element(edgeVertexIds.y)),
            () => {
              const correction = springCorrectionBuffer.element(edgeId);
              const isVertex0 = edgeVertexIds.x.equal(instanceIndex);
              const otherId = select(isVertex0, edgeVertexIds.y, edgeVertexIds.x);
              const otherIsFixed = vertexParamsBuffer.element(otherId).x.equal(uint(1));
              const split = select(otherIsFixed, float(1.0), float(0.5));
              const delta = select(isVertex0, correction.mul(split), correction.mul(split).negate());
              positionDelta.addAssign(delta);
            },
          );
        });
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

    this.resolveMannequinCollision = Fn(() => {
      If(mannequinCollisionUniform.lessThan(1), () => {
        Return();
      });

      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex).toVar('mannequinPosition');
      const contactDistance = clothThicknessUniform.add(mannequinMarginUniform);

      const torsoCenter = vec3(0, mannequinTorsoCenterYUniform, 0);
      const torsoLocal = position.sub(torsoCenter).toVar('mannequinTorsoLocal');
      const torsoScaled = vec3(
        torsoLocal.x.div(mannequinTorsoRadiiUniform.x.max(0.001)),
        torsoLocal.y.div(mannequinTorsoRadiiUniform.y.max(0.001)),
        torsoLocal.z.div(mannequinTorsoRadiiUniform.z.max(0.001)),
      );
      const torsoLen = torsoScaled.length().max(0.000001).toVar('mannequinTorsoLen');
      const torsoMinRadius = min(
        min(mannequinTorsoRadiiUniform.x, mannequinTorsoRadiiUniform.y),
        mannequinTorsoRadiiUniform.z,
      );
      const torsoDistance = torsoLen.sub(1.0).mul(torsoMinRadius).toVar('mannequinTorsoDistance');
      const torsoNormal = vec3(
        torsoLocal.x.div(mannequinTorsoRadiiUniform.x.mul(mannequinTorsoRadiiUniform.x).max(0.000001)),
        torsoLocal.y.div(mannequinTorsoRadiiUniform.y.mul(mannequinTorsoRadiiUniform.y).max(0.000001)),
        torsoLocal.z.div(mannequinTorsoRadiiUniform.z.mul(mannequinTorsoRadiiUniform.z).max(0.000001)),
      ).normalize();

      const armClosestX = position.x.clamp(
        mannequinArmHalfLengthUniform.negate(),
        mannequinArmHalfLengthUniform,
      );
      const armClosest = vec3(armClosestX, mannequinArmCenterYUniform, 0);
      const armOffset = position.sub(armClosest).toVar('mannequinArmOffset');
      const armLen = armOffset.length().max(0.000001).toVar('mannequinArmLen');
      const armDistance = armLen.sub(mannequinArmRadiusUniform).toVar('mannequinArmDistance');
      const armNormal = armOffset.div(armLen);

      const neckCenter = vec3(0, mannequinNeckCenterYUniform, 0);
      const neckOffset = position.sub(neckCenter).toVar('mannequinNeckOffset');
      const neckLen = neckOffset.length().max(0.000001).toVar('mannequinNeckLen');
      const neckDistance = neckLen.sub(mannequinNeckRadiusUniform).toVar('mannequinNeckDistance');
      const neckNormal = neckOffset.div(neckLen);

      const neckBaseCenter = vec3(0, mannequinNeckBaseCenterYUniform, 0);
      const neckBaseOffset = position.sub(neckBaseCenter).toVar('mannequinNeckBaseOffset');
      const neckBaseLen = neckBaseOffset.length().max(0.000001).toVar('mannequinNeckBaseLen');
      const neckBaseDistance = neckBaseLen.sub(mannequinNeckBaseRadiusUniform).toVar('mannequinNeckBaseDistance');
      const neckBaseNormal = neckBaseOffset.div(neckBaseLen);

      const sdfDistance = torsoDistance.toVar('mannequinSdfDistance');
      const sdfNormal = torsoNormal.toVar('mannequinSdfNormal');
      If(armDistance.lessThan(sdfDistance), () => {
        sdfDistance.assign(armDistance);
        sdfNormal.assign(armNormal);
      });
      If(neckDistance.lessThan(sdfDistance), () => {
        sdfDistance.assign(neckDistance);
        sdfNormal.assign(neckNormal);
      });
      If(neckBaseDistance.lessThan(sdfDistance), () => {
        sdfDistance.assign(neckBaseDistance);
        sdfNormal.assign(neckBaseNormal);
      });

      If(sdfDistance.lessThan(contactDistance), () => {
        const penetration = contactDistance.sub(sdfDistance).clamp(0, 0.035);
        const projected = position.add(sdfNormal.mul(penetration)).toVar('mannequinProjected');
        const previous = vertexPreviousBuffer.element(instanceIndex).toVar('mannequinPrevious');
        const velocity = projected.sub(previous).toVar('mannequinVelocity');
        const normalVelocity = sdfNormal.mul(velocity.dot(sdfNormal));
        const tangentVelocity = velocity.sub(normalVelocity);
        const dampedVelocity = normalVelocity.add(
          tangentVelocity.mul(float(1.0).sub(mannequinFrictionUniform.clamp(0, 0.95))),
        );

        vertexPositionBuffer.element(instanceIndex).assign(projected);
        vertexPreviousBuffer.element(instanceIndex).assign(projected.sub(dampedVelocity));
      });
    })()
      .compute(vertexCount)
      .setName('Mannequin SDF Collision');

    this.resolveBoneSdfCollision = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex).toVar('boneSdfPosition');
      const sdfDistance = float(1e9).toVar('boneSdfDistance');
      const sdfNormal = vec3(float(0), float(1), float(0)).toVar('boneSdfNormal');

      Loop({ start: uint(0), end: uint(MAX_BONE_SDF_CAPSULES), type: 'uint', condition: '<' }, ({ i }) => {
        const start = boneSdfStartBuffer.element(i);
        const endRadius = boneSdfEndRadiusBuffer.element(i);
        const radius = endRadius.w;

        If(radius.greaterThan(float(0.0001)), () => {
          const a = start.xyz;
          const b = endRadius.xyz;
          const segment = b.sub(a).toVar('boneSdfSegment');
          const segmentLenSq = segment.dot(segment).max(float(0.000001));
          const t = position.sub(a).dot(segment).div(segmentLenSq).clamp(float(0), float(1));
          const closest = a.add(segment.mul(t));
          const offset = position.sub(closest).toVar('boneSdfOffset');
          const len = offset.length().max(float(0.000001));
          const distance = len.sub(radius);

          If(distance.lessThan(sdfDistance), () => {
            sdfDistance.assign(distance);
            sdfNormal.assign(offset.div(len));
          });
        });
      });

      const contactDistance = clothThicknessUniform.add(mannequinMarginUniform);
      If(sdfDistance.lessThan(contactDistance), () => {
        const penetration = contactDistance.sub(sdfDistance).clamp(0, 0.045);
        const projected = position.add(sdfNormal.mul(penetration)).toVar('boneSdfProjected');
        const previous = vertexPreviousBuffer.element(instanceIndex).toVar('boneSdfPrevious');
        const velocity = projected.sub(previous).toVar('boneSdfVelocity');
        const normalVelocity = sdfNormal.mul(velocity.dot(sdfNormal));
        const tangentVelocity = velocity.sub(normalVelocity);
        const dampedVelocity = normalVelocity.add(
          tangentVelocity.mul(float(1.0).sub(mannequinFrictionUniform.clamp(0, 0.95))),
        );

        vertexPositionBuffer.element(instanceIndex).assign(projected);
        vertexPreviousBuffer.element(instanceIndex).assign(projected.sub(dampedVelocity));
      });
    })()
      .compute(vertexCount)
      .setName('Bone SDF Collision');

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
        const gridOther = vertexGridBuffer.element(otherIndex);
        const gridDeltaXRaw = gridSelf.x.sub(gridOther.x).abs();
        const gridDeltaXWrapped = uint(this.clothNumSegmentsX + 1).sub(gridDeltaXRaw);
        const gridDeltaX = (
          this.topologyMode === 'tube'
            ? select(gridDeltaXRaw.lessThan(gridDeltaXWrapped), gridDeltaXRaw, gridDeltaXWrapped)
            : gridDeltaXRaw
        ).toVar('selfCollisionGridDeltaX');
        const gridDeltaY = gridSelf.y.sub(gridOther.y).abs();
        const gridDistance = gridDeltaX.add(gridDeltaY);
        const otherPosition = vertexPositionBuffer.element(otherIndex);
        const offset = position.sub(otherPosition).toVar('offset');
        const dist = offset.length().max(0.000001).toVar('dist');
        const isTopologicallyDistant = this.topologyMode === 'assembly'
          ? selfCollisionExclusionBuffer
              .element(instanceIndex.mul(vertexCountVar).add(otherIndex))
              .equal(uint(0))
          : gridDistance.greaterThan(uint(2));
        const active = otherIndex
          .notEqual(instanceIndex)
          .and(isTopologicallyDistant)
          .and(dist.lessThan(minSeparation));
        const penetration = select(active, minSeparation.sub(dist).mul(float(0.5)), float(0));

        repulsion.addAssign(offset.mul(penetration.div(dist)));
      });

      const repulsionLength = repulsion.length().toVar('repulsionLength');
      If(repulsionLength.greaterThan(minSeparation), () => {
        repulsion.assign(repulsion.mul(minSeparation.div(repulsionLength)));
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

    this.resetFlagPositions = Fn(() => {
      const rest = initialPositionBuffer.element(instanceIndex);
      vertexPositionBuffer.element(instanceIndex).assign(rest);
      vertexPreviousBuffer.element(instanceIndex).assign(rest);
      substepStartBuffer.element(instanceIndex).assign(rest);
    })()
      .compute(vertexCount)
      .setName('Reset Flag Positions');

    const mouseNdcUniform = this.mouseNdcUniform;
    const grabModeUniform = this.grabModeUniform;
    const grabActiveUniform = this.grabActiveUniform;
    const grabTryLatchUniform = this.grabTryLatchUniform;
    const grabPickRadiusUniform = this.grabPickRadiusUniform;
    const grabInfluenceRadiusUniform = this.grabInfluenceRadiusUniform;
    const grabCameraProjectionUniform = this.grabCameraProjectionUniform;
    const grabCameraViewUniform = this.grabCameraViewUniform;
    const grabCameraProjectionInverseUniform = this.grabCameraProjectionInverseUniform;
    const grabCameraWorldUniform = this.grabCameraWorldUniform;
    const grabScreenDistBuffer = this.grabScreenDistBuffer;
    const grabTargetBuffer = this.grabTargetBuffer;
    const grabOffsetNdcBuffer = this.grabOffsetNdcBuffer;
    const invalidGrabIndex = uint(0xffffffff);
    const vertexCountVar = uint(vertexCount);

    this.measureGrabScreenDist = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      const isFixed = params.x;

      If(isFixed, () => {
        grabScreenDistBuffer.element(instanceIndex).assign(float(1e9));
        Return();
      });

      const position = vertexPositionBuffer.element(instanceIndex);
      const viewPos = grabCameraViewUniform.mul(vec4(position, float(1)));
      const clip = grabCameraProjectionUniform.mul(viewPos);
      const ndc = clip.xy.div(clip.w);
      const dist = ndc.sub(mouseNdcUniform).length();

      grabScreenDistBuffer.element(instanceIndex).assign(dist);
    })()
      .compute(vertexCount)
      .setName('Measure Grab Screen Distance');

    this.selectGrabTarget = Fn(() => {
      If(instanceIndex.notEqual(uint(0)), () => {
        Return();
      });

      If(
        grabModeUniform.lessThan(0.5)
          .or(grabActiveUniform.lessThan(0.5))
          .or(mouseNdcUniform.x.lessThan(float(-1.5))),
        () => {
          grabTargetBuffer.element(uint(0)).assign(invalidGrabIndex);
          grabTargetBuffer.element(uint(1)).assign(uint(0));
          grabOffsetNdcBuffer.element(uint(0)).assign(float(0));
          grabOffsetNdcBuffer.element(uint(1)).assign(float(0));
          Return();
        },
      );

      If(grabTargetBuffer.element(uint(1)).equal(uint(1)), () => {
        Return();
      });

      If(grabTryLatchUniform.lessThan(0.5), () => {
        Return();
      });

      grabTargetBuffer.element(uint(0)).assign(invalidGrabIndex);
      grabTargetBuffer.element(uint(1)).assign(uint(0));
      grabOffsetNdcBuffer.element(uint(0)).assign(float(0));
      grabOffsetNdcBuffer.element(uint(1)).assign(float(0));

      const bestDist = float(1e9).toVar('grabBestDist');
      const bestIdx = invalidGrabIndex.toVar('grabBestIdx');

      Loop({ start: uint(0), end: vertexCountVar, type: 'uint', condition: '<' }, ({ i }) => {
        const idx = uint(i);
        const dist = grabScreenDistBuffer.element(idx);

        If(dist.lessThan(grabPickRadiusUniform).and(dist.lessThan(bestDist)), () => {
          bestDist.assign(dist);
          bestIdx.assign(idx);
        });
      });

      grabTargetBuffer.element(uint(0)).assign(bestIdx);

      If(bestIdx.notEqual(invalidGrabIndex), () => {
        const pickedPosition = vertexPositionBuffer.element(bestIdx);
        const pickedView = grabCameraViewUniform.mul(vec4(pickedPosition, float(1)));
        const pickedClip = grabCameraProjectionUniform.mul(pickedView);
        const pickedNdc = pickedClip.xy.div(pickedClip.w);
        const offsetNdc = pickedNdc.sub(mouseNdcUniform);

        grabOffsetNdcBuffer.element(uint(0)).assign(offsetNdc.x);
        grabOffsetNdcBuffer.element(uint(1)).assign(offsetNdc.y);
        grabTargetBuffer.element(uint(1)).assign(uint(1));
      });
    })()
      .compute(1)
      .setName('Select Grab Target');

    this.applyGrabConstraint = Fn(() => {
      If(grabModeUniform.lessThan(0.5).or(grabActiveUniform.lessThan(0.5)), () => {
        Return();
      });

      If(grabTargetBuffer.element(uint(1)).notEqual(uint(1)), () => {
        Return();
      });

      const targetIdx = grabTargetBuffer.element(uint(0));
      If(targetIdx.equal(invalidGrabIndex), () => {
        Return();
      });

      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      If(params.x, () => {
        Return();
      });

      const pickedPosition = vertexPositionBuffer.element(targetIdx);
      const pickedView = grabCameraViewUniform.mul(vec4(pickedPosition, float(1)));
      const pickedClip = grabCameraProjectionUniform.mul(pickedView);
      const pickedNdc = pickedClip.xy.div(pickedClip.w);
      const targetOffsetNdc = vec2(
        grabOffsetNdcBuffer.element(uint(0)),
        grabOffsetNdcBuffer.element(uint(1)),
      );
      const targetNdc = mouseNdcUniform.add(targetOffsetNdc);
      const dragDeltaNdc = targetNdc.sub(pickedNdc);

      const position = vertexPositionBuffer.element(instanceIndex).toVar('grabPosition');
      const viewPos = grabCameraViewUniform.mul(vec4(position, float(1)));
      const clip = grabCameraProjectionUniform.mul(viewPos);
      const ndc = clip.xy.div(clip.w);
      const influenceRadius = grabInfluenceRadiusUniform.max(float(0.001));
      const grabDistance = ndc.sub(pickedNdc).length();
      If(grabDistance.greaterThan(influenceRadius), () => {
        Return();
      });

      const grabWeight = float(1)
        .sub(grabDistance.div(influenceRadius).clamp(0, 1))
        .toVar('grabWeight');
      grabWeight.assign(grabWeight.mul(grabWeight));
      const movedNdc = ndc.add(dragDeltaNdc.mul(grabWeight));
      const newClip = vec4(
        movedNdc.x.mul(clip.w),
        movedNdc.y.mul(clip.w),
        clip.z,
        clip.w,
      );
      const newView = grabCameraProjectionInverseUniform.mul(newClip);
      const newWorld = grabCameraWorldUniform.mul(newView);
      const newPosition = newWorld.xyz.div(newWorld.w);

      vertexPositionBuffer.element(instanceIndex).assign(newPosition);
      vertexPreviousBuffer.element(instanceIndex).assign(newPosition);
    })()
      .compute(vertexCount)
      .setName('Apply Grab Constraint');

    this.breakEdgesByStrain = Fn(() => {
      If(edgeActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        Return();
      });

      If(edgeKindBuffer.element(instanceIndex).equal(uint(1)), () => {
        Return();
      });

      const vertexIds = springVertexIdBuffer.element(instanceIndex);
      const v0Fixed = vertexParamsBuffer.element(vertexIds.x).x;
      const v1Fixed = vertexParamsBuffer.element(vertexIds.y).x;

      If(v0Fixed.or(v1Fixed), () => {
        Return();
      });

      const p0 = vertexPositionBuffer.element(vertexIds.x);
      const p1 = vertexPositionBuffer.element(vertexIds.y);
      const dist = p1.sub(p0).length().max(0.000001);
      const restLength = springRestLengthBuffer.element(instanceIndex);
      const stretchRatio = dist.div(restLength);

      If(stretchRatio.greaterThan(tearStretchUniform), () => {
        edgeActiveBuffer.element(instanceIndex).assign(uint(0));
      });
    })()
      .compute(edgeCount)
      .setName('Break Edges By Strain');

    this.cascadeBrokenEdgeLinks = Fn(() => {
      If(edgeActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        Return();
      });

      const depStart = edgeDependencyStartsBuffer.element(instanceIndex);
      const depEnd = edgeDependencyStartsBuffer.element(instanceIndex.add(uint(1)));

      Loop({ start: depStart, end: depEnd, type: 'uint', condition: '<' }, ({ i }) => {
        const depId = edgeDependencyIdsBuffer.element(i);

        If(edgeActiveBuffer.element(depId).equal(uint(0)), () => {
          edgeActiveBuffer.element(instanceIndex).assign(uint(0));
        });
      });
    })()
      .compute(edgeCount)
      .setName('Cascade Broken Edge Links');

    this.integrateBbs = Fn(() => {
      If(bbActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        Return();
      });

      const age = bbAgeBuffer.element(instanceIndex).add(bbSubstepDtUniform).toVar('bbAge');
      bbAgeBuffer.element(instanceIndex).assign(age);

      If(age.greaterThan(bbLifetimeUniform), () => {
        bbActiveBuffer.element(instanceIndex).assign(uint(0));
        Return();
      });

      const bbPos = bbPositionBuffer.element(instanceIndex).toVar('bbIntegratePos');
      const bbVel = bbVelocityBuffer.element(instanceIndex).toVar('bbIntegrateVel');
      bbPreviousPositionBuffer.element(instanceIndex).assign(bbPos);

      bbVel.y.subAssign(bbGravityUniform.mul(bbSubstepDtUniform));
      bbPos.addAssign(bbVel.mul(bbSubstepDtUniform));

      const outOfBounds = bbPos.x
        .lessThan(bbBoundsMinUniform.x)
        .or(bbPos.x.greaterThan(bbBoundsMaxUniform.x))
        .or(bbPos.y.lessThan(bbBoundsMinUniform.y))
        .or(bbPos.y.greaterThan(bbBoundsMaxUniform.y))
        .or(bbPos.z.lessThan(bbBoundsMinUniform.z))
        .or(bbPos.z.greaterThan(bbBoundsMaxUniform.z));

      If(outOfBounds, () => {
        bbActiveBuffer.element(instanceIndex).assign(uint(0));
        Return();
      });

      bbPositionBuffer.element(instanceIndex).assign(bbPos);
      bbVelocityBuffer.element(instanceIndex).assign(bbVel);
    })()
      .compute(bbSlotCount)
      .setName('Integrate BBs');

    this.resolveClothAgainstBbs = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      If(params.x, () => {
        Return();
      });

      const current = vertexPositionBuffer.element(instanceIndex).toVar('bbClothPushCurrent');
      const previous = vertexPreviousBuffer.element(instanceIndex);
      const push = vec3(float(0), float(0), float(0)).toVar('bbClothPush');
      const contactRadius = bbVisualRadiusUniform
        .add(clothThicknessUniform)
        .add(bbHitRadiusUniform.mul(bbFabricSoftnessUniform).mul(float(0.35)));

      Loop({ start: uint(0), end: uint(bbSlotCount), type: 'uint', condition: '<' }, ({ i }) => {
        const slot = uint(i);

        If(bbActiveBuffer.element(slot).greaterThan(uint(0)), () => {
          const bbPos = bbPositionBuffer.element(slot);
          const bbVel = bbVelocityBuffer.element(slot);
          const offset = current.sub(bbPos);
          const dist = offset.length().max(float(0.000001));
          const penetration = contactRadius.sub(dist);

          If(penetration.greaterThan(float(0)), () => {
            const normal = offset.div(dist).toVar('bbClothPushNormal');
            const edgeDistance = dist.sub(bbVisualRadiusUniform).max(float(0));
            const edgeFalloff = float(1)
              .sub(edgeDistance.div(bbHitRadiusUniform))
              .clamp(float(0), float(1));
            const softness = bbFabricSoftnessUniform.mul(bbForceStrengthUniform).mul(float(0.68));
            const pushAmount = penetration.mul(softness).mul(edgeFalloff);
            push.addAssign(normal.mul(pushAmount));
            const carry = bbVel
              .mul(bbSubstepDtUniform)
              .mul(edgeFalloff)
              .mul(bbFabricSoftnessUniform)
              .mul(float(0.22));
            push.addAssign(carry);
          });
        });
      });

      current.addAssign(push);
      vertexPositionBuffer.element(instanceIndex).assign(current);
      vertexPreviousBuffer.element(instanceIndex).assign(previous.add(push.mul(float(0.42))));
    })()
      .compute(vertexCount)
      .setName('Resolve Cloth Against BBs');

    this.resolveBbClothContacts = Fn(() => {
      If(bbActiveBuffer.element(instanceIndex).equal(uint(0)), () => {
        Return();
      });

      const bbPos = bbPositionBuffer.element(instanceIndex).toVar('bbContactPos');
      const bbVel = bbVelocityBuffer.element(instanceIndex).toVar('bbContactVel');
      const hardRadius = bbVisualRadiusUniform;
      const softRadius = hardRadius.add(
        bbHitRadiusUniform.mul(bbFabricSoftnessUniform).mul(float(0.65)),
      );
      const bestPen = float(0).toVar('bbBestPen');
      const bestNormal = vec3(float(0), float(0), float(1)).toVar('bbBestNormal');

      Loop({ start: uint(0), end: uint(vertexCount), type: 'uint', condition: '<' }, ({ i: vertexId }) => {
        const surfPos = vertexPositionBuffer.element(vertexId).toVar('bbSoftSurfPos');
        const delta = bbPos.sub(surfPos);
        const dist = delta.length().max(float(0.000001));
        const pen = softRadius.sub(dist);

        If(pen.greaterThan(bestPen), () => {
          bestPen.assign(pen);
          bestNormal.assign(delta.div(dist));
        });
      });

      If(bestPen.greaterThan(float(0)), () => {
        const softZoneWidth = softRadius.sub(hardRadius).max(float(0.0001));
        const contactWeight = bestPen.div(softZoneWidth).clamp(float(0), float(1));
        const hardPen = bestPen.add(hardRadius.sub(softRadius)).max(float(0));
        const hardPush = hardPen.mul(float(0.35).add(bbFabricSoftnessUniform.mul(float(0.5))));
        const softPush = bestPen
          .mul(bbFabricSoftnessUniform)
          .mul(float(0.45).add(contactWeight.mul(float(0.2))));
        const pushOut = hardPush.add(softPush).add(float(0.00004));
        bbPos.addAssign(bestNormal.mul(pushOut));

        const normalSpeed = bbVel.dot(bestNormal);
        If(normalSpeed.lessThan(float(0)), () => {
          const softRestitution = bbRestitutionUniform.mul(bbFabricSoftnessUniform).mul(contactWeight);
          bbVel.addAssign(
            bestNormal.mul(
              normalSpeed
                .negate()
                .mul(float(1).add(softRestitution))
                .mul(bbFabricSoftnessUniform),
            ),
          );
          const tangent = bbVel.sub(bestNormal.mul(bbVel.dot(bestNormal)));
          bbVel.subAssign(
            tangent.mul(bbFrictionUniform).mul(bbFabricSoftnessUniform).mul(float(0.65)).mul(contactWeight),
          );
        });

        bbVel.mulAssign(float(1).sub(contactWeight.mul(bbFabricSoftnessUniform).mul(float(0.12))));
        bbPositionBuffer.element(instanceIndex).assign(bbPos);
        bbVelocityBuffer.element(instanceIndex).assign(bbVel);
      });
    })()
      .compute(bbSlotCount)
      .setName('Resolve BB Cloth Contacts');

    this.applyBbClothVertexImpulses = Fn(() => {
      const params = vertexParamsBuffer.element(instanceIndex).toVar();
      If(params.x, () => {
        Return();
      });

      const current = vertexPositionBuffer.element(instanceIndex).toVar('bbImpulseCurrent');
      const previous = vertexPreviousBuffer.element(instanceIndex);
      const impulse = vec3(float(0), float(0), float(0)).toVar('bbVertexImpulse');

      Loop({ start: uint(0), end: uint(bbSlotCount), type: 'uint', condition: '<' }, ({ i }) => {
        const slot = uint(i);

        If(bbActiveBuffer.element(slot).greaterThan(uint(0)), () => {
          const bbPos = bbPositionBuffer.element(slot);
          const bbVel = bbVelocityBuffer.element(slot);
          const offset = current.sub(bbPos);
          const dist = offset.length().max(float(0.000001));
          const surfaceDist = dist.sub(bbVisualRadiusUniform);
          If(surfaceDist.lessThan(bbHitRadiusUniform), () => {
            const influence = float(1).sub(surfaceDist.div(bbHitRadiusUniform)).max(float(0));
            const falloff = influence.mul(influence).mul(influence);
            const bbSpeed = bbVel.length().max(float(0.001));
            const spreadDir = offset.div(dist);
            const travelDir = bbVel.div(bbSpeed);
            const pushDir = travelDir.mul(float(0.55)).add(spreadDir.mul(float(0.45))).normalize();
            const impulseScale = float(0.00062)
              .mul(bbForceStrengthUniform)
              .mul(bbFabricSoftnessUniform)
              .mul(bbSpeed)
              .mul(falloff);
            impulse.addAssign(pushDir.mul(impulseScale));
          });
        });
      });

      vertexPositionBuffer.element(instanceIndex).assign(current.add(impulse));
      vertexPreviousBuffer.element(instanceIndex).assign(previous.add(impulse.mul(float(0.42))));
    })()
      .compute(vertexCount)
      .setName('Apply BB Cloth Vertex Impulses');

    const edgeVisualBuffer = this.edgeVisualBuffer;

    this.syncEdgeVisualForRender = Fn(() => {
      edgeVisualBuffer.element(instanceIndex).assign(edgeActiveBuffer.element(instanceIndex));
    })()
      .compute(edgeCount)
      .setName('Sync Edge Visual For Render');
  }

  private createClothMaterial(): THREE.MeshPhysicalNodeMaterial {
    const vertexPositionBuffer = this.vertexPositionBuffer;
    const gridSizeY = this.clothNumSegmentsY + 1;
    const gridStrideY = uniform(gridSizeY);
    const gridMaxXUniform = uniform(this.clothNumSegmentsX);
    const gridMaxYUniform = uniform(this.clothNumSegmentsY);
    const gridMaxXUint = uint(gridMaxXUniform);
    const gridMaxYUint = uint(gridMaxYUniform);
    const normalSampleStep = this.renderNormalStepUniform;
    const geometrySmoothing = this.renderGeometrySmoothingUniform;
    const edgeStateBuffer = this.edgeVisualBuffer;
    const simHorizontalEdgeIdBuffer = this.simHorizontalEdgeIdBuffer;
    const simVerticalEdgeIdBuffer = this.simVerticalEdgeIdBuffer;
    const invalidEdgeId = uint(0xffffffff);

    const isRenderEdgeBroken = Fn(([edgeId]) =>
      edgeId.notEqual(invalidEdgeId).and(edgeStateBuffer.element(edgeId).equal(uint(0))),
    );

    const gridIndex = Fn(([gridX, gridY]) => gridX.mul(gridStrideY).add(gridY));

    const sampleSimPositionLinear = this.topologyMode === 'assembly'
      ? Fn(([simVertexId]) =>
          vertexPositionBuffer
            .element(uint(simVertexId).clamp(uint(0), gridMaxXUint))
            .xyz,
        )
      : createEdgeAwareSimSurfaceSampler({
          vertexPositionBuffer,
          gridIndex,
          gridStrideY,
          gridMaxXUniform,
          gridMaxYUniform,
          gridMaxXUint,
          gridMaxYUint,
          isEdgeBroken: isRenderEdgeBroken,
          simHorizontalEdgeIdBuffer,
          simVerticalEdgeIdBuffer,
          simShearDownEdgeIdBuffer: this.simShearDownEdgeIdBuffer,
          simShearUpEdgeIdBuffer: this.simShearUpEdgeIdBuffer,
        });

    const sampleSimPositionAvgEdgeAware = Fn(([simGridX, simGridY, stepScale]) => {
      const maxX = float(gridMaxXUniform);
      const maxY = float(gridMaxYUniform);
      const step = normalSampleStep.mul(stepScale);
      const center = sampleSimPositionLinear(simGridX, simGridY);
      const left = sampleSimPositionLinear(simGridX.sub(step).clamp(0, maxX), simGridY);
      const right = sampleSimPositionLinear(simGridX.add(step).clamp(0, maxX), simGridY);
      const up = sampleSimPositionLinear(simGridX, simGridY.sub(step).clamp(0, maxY));
      const down = sampleSimPositionLinear(simGridX, simGridY.add(step).clamp(0, maxY));

      return center.add(left).add(right).add(up).add(down).mul(0.2);
    });

    const sampleSimPositionSmooth = Fn(([simGridX, simGridY]) => {
      const base = sampleSimPositionLinear(simGridX, simGridY);
      const relax1 = geometrySmoothing.sub(1).clamp(0, 1);
      const relaxed = sampleSimPositionAvgEdgeAware(simGridX, simGridY, float(2));
      const mid = mix(base, relaxed, relax1);
      const relax2 = geometrySmoothing.sub(2).clamp(0, 1);
      const extraRelaxed = sampleSimPositionAvgEdgeAware(simGridX, simGridY, float(4));

      return mix(mid, extraRelaxed, relax2);
    });

    const sampleSimPosition = this.topologyMode === 'assembly'
      ? Fn(([simGridX]) => sampleSimPositionLinear(simGridX))
      : Fn(([simGridX, simGridY]) => sampleSimPositionSmooth(simGridX, simGridY));

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

    configureMatteCottonFlagMaterial(clothMaterial, {
      settings: this.settings,
      bakedTextures: this.bakedClothTextures,
      flatShadingUniform: this.flatShadingUniform,
      normalFlat,
      sampleSimPosition,
      normalSampleStep,
      gridMaxXUniform,
      gridMaxYUniform,
      edgeActiveBuffer: this.edgeVisualBuffer,
      simHorizontalEdgeIdBuffer: this.simHorizontalEdgeIdBuffer,
      simVerticalEdgeIdBuffer: this.simVerticalEdgeIdBuffer,
      simShearDownEdgeIdBuffer: this.simShearDownEdgeIdBuffer,
      simShearUpEdgeIdBuffer: this.simShearUpEdgeIdBuffer,
      simGridSizeYUniform: this.simGridSizeYUniform,
    });

    return clothMaterial;
  }

  private setupClothMesh(clothMaterial: THREE.MeshPhysicalNodeMaterial): THREE.Mesh {
    const renderSurface = this.activeTopology?.renderSurface;
    if (renderSurface?.source === 'particles') {
      return this.setupParticleClothMesh(clothMaterial);
    }

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
    const fabricUvArray = new Float32Array(vertexCount * 2);
    const indices: number[] = [];

    const getRenderIndex = (gridX: number, gridY: number) => gridX * renderGridSizeY + gridY;

    for (let gridX = 0; gridX < renderGridSizeX; gridX++) {
      for (let gridY = 0; gridY < renderGridSizeY; gridY++) {
        const index = getRenderIndex(gridX, gridY);
        const simX = gridX / renderSubdiv;
        const simY = gridY / renderSubdiv;
        simGridCoordArray[index * 2] = simX;
        simGridCoordArray[index * 2 + 1] = simY;
        fabricUvArray[index * 2] = (simX / this.clothNumSegmentsX) * this.clothWidth;
        fabricUvArray[index * 2 + 1] = (simY / this.clothNumSegmentsY) * this.clothHeight;
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

    if (this.topologyMode === 'tube') {
      const seamColumn = renderCellsX;
      const firstColumn = 0;
      for (let gridY = 0; gridY < renderCellsY; gridY++) {
        const i00 = getRenderIndex(seamColumn, gridY);
        const i10 = getRenderIndex(firstColumn, gridY);
        const i01 = getRenderIndex(seamColumn, gridY + 1);
        const i11 = getRenderIndex(firstColumn, gridY + 1);
        indices.push(i00, i10, i01);
        indices.push(i10, i11, i01);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geometry.setAttribute('simGridCoord', new THREE.BufferAttribute(simGridCoordArray, 2));
    geometry.setAttribute('uv', new THREE.BufferAttribute(fabricUvArray, 2));
    geometry.setAttribute('fabricUv', new THREE.BufferAttribute(fabricUvArray, 2));
    geometry.setIndex(indices);
    this.clothGeometry = geometry;
    this.buildClothRenderTopology(simGridCoordArray, indices);

    const mesh = new THREE.Mesh(geometry, clothMaterial);
    const boundsCenter = new THREE.Vector3(0, this.flagHoistTopY - this.clothHeight * 0.5, 0);
    const boundsRadius = Math.max(this.clothWidth, this.clothHeight) * 1.5 + 2.5;
    geometry.boundingSphere = new THREE.Sphere(boundsCenter, boundsRadius);
    mesh.frustumCulled = true;
    mesh.name = 'inextensible-flag-mesh';
    this.scene.add(mesh);
    return mesh;
  }

  private setupParticleClothMesh(clothMaterial: THREE.MeshPhysicalNodeMaterial): THREE.Mesh {
    const renderSurface = this.activeTopology?.renderSurface;
    const simGridCoordArray = renderSurface?.simGridCoords;
    const fabricUvArray = renderSurface?.fabricUvs;
    const indices = renderSurface?.indices;
    if (!renderSurface || !simGridCoordArray || !fabricUvArray || !indices) {
      throw new Error('Particle render surface is missing topology buffers');
    }

    const vertexCount = simGridCoordArray.length / 2;
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3));
    geometry.setAttribute('simGridCoord', new THREE.BufferAttribute(simGridCoordArray, 2));
    geometry.setAttribute('uv', new THREE.BufferAttribute(fabricUvArray, 2));
    geometry.setAttribute('fabricUv', new THREE.BufferAttribute(fabricUvArray, 2));
    geometry.setIndex(indices);
    this.clothGeometry = geometry;
    this.clothSimGridCoords = simGridCoordArray;
    this.visibleClothSimGridCoords = simGridCoordArray;
    this.clothRenderQuads = buildClothRenderQuads(indices);
    this.simEdgeLookup = undefined;
    this.particleRenderBaseIndices = new Uint32Array(indices);
    this.particleRenderTriangleEdgeIds = this.buildParticleRenderTriangleEdgeIds(indices, simGridCoordArray);
    this.lastBrokenEdgeCount = 0;

    const mesh = new THREE.Mesh(geometry, clothMaterial);
    const bounds = new THREE.Box3();
    for (const vertex of this.clothVertices) {
      bounds.expandByPoint(vertex.position);
    }
    const boundsCenter = bounds.getCenter(new THREE.Vector3());
    const boundsRadius = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1) + 2.5;
    geometry.boundingSphere = new THREE.Sphere(boundsCenter, boundsRadius);
    mesh.frustumCulled = true;
    mesh.name = 'inextensible-assembly-cloth-mesh';
    this.scene.add(mesh);
    return mesh;
  }

  private buildParticleRenderTriangleEdgeIds(indices: readonly number[], simGridCoordArray: Float32Array): Int32Array {
    const pairToEdgeId = new Map<string, number>();
    const pairKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (const edge of this.clothEdges) {
      pairToEdgeId.set(pairKey(edge.vertex0.id, edge.vertex1.id), edge.id);
    }

    const ids = new Int32Array(indices.length).fill(-1);
    const simVertexForRenderIndex = (index: number): number => Math.round(simGridCoordArray[index * 2] ?? 0);
    for (let i = 0; i < indices.length; i += 3) {
      const r0 = indices[i]!;
      const r1 = indices[i + 1]!;
      const r2 = indices[i + 2]!;
      const v0 = simVertexForRenderIndex(r0);
      const v1 = simVertexForRenderIndex(r1);
      const v2 = simVertexForRenderIndex(r2);
      ids[i] = v0 === v1 ? -1 : pairToEdgeId.get(pairKey(v0, v1)) ?? -1;
      ids[i + 1] = v1 === v2 ? -1 : pairToEdgeId.get(pairKey(v1, v2)) ?? -1;
      ids[i + 2] = v2 === v0 ? -1 : pairToEdgeId.get(pairKey(v2, v0)) ?? -1;
    }
    return ids;
  }
}

function nonEmptyUint32Array(values: Uint32Array): Uint32Array {
  return values.length > 0 ? values : new Uint32Array([0]);
}
