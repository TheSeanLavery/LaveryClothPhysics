import WebGPU from 'three/addons/capabilities/WebGPU.js';
import * as THREE from 'three/webgpu';
import {
  cloneClothSettings,
  createClothControls,
  createClothSimulation,
  deleteFlagSettingsPreset,
  getFlagSettingsPreset,
  listFlagSettingsPresets,
  normalizeClothSettings,
  saveFlagSettingsPreset,
  type ClothSimulation,
  type ClothSimulationSettings,
  type FlagSettingsPresetSummary,
  type StoredFlagSettingsPreset,
} from './cloth';
import {
  createTubePageAssembly,
  measureTShirtSleeves,
  type TubeAssemblySpawnKind,
} from './app/tubeAssemblies';
import { setupDeveloperDashboard } from './app/devDashboard';
import { getAppMode } from './app/routes';
import {
  createCharacterReproRecorder,
  type CharacterReproSaveResult,
} from './app/characterReproRecorder';
import { FabricPlanePreview, createFabricPlaneControls } from './debug/FabricPlanePreview';
import { createGarmentStudioControls } from './garments/GarmentStudioControls';
import {
  createGarmentPresetEnvelope,
  type GarmentGeneratorParamsByType,
  type GarmentPresetEnvelope,
  type GarmentType,
} from './garments/garmentSchema';
import {
  generateGarmentPresetAssembly,
  type GarmentAssemblyStats,
} from './garments/garmentGenerator';
import {
  deleteGarmentPreset,
  getGarmentPreset,
  listGarmentPresets,
  saveGarmentPreset,
  type GarmentPresetSummary,
} from './storage/garmentPresetDb';
import {
  AnimatedCharacterSceneRig,
  type BoneSdfCollisionProbe,
  type BoneSdfFitReport,
  type BoneSdfMeshCoverageReport,
  type BreastVisualAlignmentReport,
  type CharacterStats,
  type ShirtAnchorReport,
} from './character/AnimatedCharacter';
import {
  CharacterGarmentFlow,
  type CharacterGarmentFitReport,
  type CharacterShirtSurfaceReport,
} from './character/characterGarmentFlow';
import {
  CharacterSdfTool,
  type CharacterSdfToolStats,
} from './character/sdf/CharacterSdfTool';
import type {
  CharacterSdfFitQualityReport,
  CharacterSdfPresetEnvelope,
} from './character/sdf';
import type {
  AssemblyStrainReport,
  BodyArmDrapeReport,
  EdgeCapsuleClearanceReport,
  PerCapsuleClearanceReport,
  ShirtSdfClearanceReport,
  TriangleCapsuleClearanceReport,
  TriangleQualityReport,
} from './character/shirtDressing';
import { getFabricNormalMapStatsForTest } from './textures/createFabricNormalMap';

declare global {
  interface Window {
    __characterStats?: () => CharacterStats;
    __characterBoneSdfs?: () => ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>;
    __characterBoneSdfFitReport?: () => BoneSdfFitReport;
    __characterBoneSdfMeshCoverageReport?: () => BoneSdfMeshCoverageReport;
    __characterBreastVisualAlignmentReport?: () => BreastVisualAlignmentReport;
    __characterBlendTo?: (kind: 'tpose' | 'idle' | 'dance') => void;
    __characterSetTearThreshold?: (threshold: number) => void;
    __characterReloadShirtForTest?: () => Promise<void>;
    __characterGarmentStats?: () => GarmentAssemblyStats;
    __characterGarmentFitReport?: () => CharacterGarmentFitReport;
    __characterGarmentSettledFitReport?: () => Promise<CharacterGarmentFitReport>;
    __characterGarmentSetFitDebugVisible?: (visible: boolean) => void;
    __characterGarmentGetPreset?: () => GarmentPresetEnvelope;
    __characterGarmentGenerate?: <T extends GarmentType>(
      garmentType: T,
      params?: Partial<GarmentGeneratorParamsByType[T]>,
      name?: string,
    ) => Promise<GarmentAssemblyStats>;
    __characterClothStats?: () => ReturnType<ClothSimulation['getStats']>;
    __characterTearProtectionReport?: () => {
      active: boolean;
      restoreThreshold: number;
      currentThreshold: number;
    };
    __characterShirtSdfClearanceReport?: () => ShirtSdfClearanceReport;
    __characterShirtPerCapsuleClearanceReport?: () => PerCapsuleClearanceReport;
    __characterShirtBodyArmDrapeReport?: () => BodyArmDrapeReport;
    __characterShirtEdgeClearanceReport?: () => EdgeCapsuleClearanceReport;
    __characterShirtTriangleClearanceReport?: () => TriangleCapsuleClearanceReport;
    __characterShirtStrainReport?: () => AssemblyStrainReport;
    __characterShirtTriangleQualityReport?: () => TriangleQualityReport;
    __characterSettledShirtSurfaceReport?: () => Promise<CharacterShirtSurfaceReport>;
    __characterProbeBoneSdfCollision?: () => BoneSdfCollisionProbe;
    __characterShirtAnchorReport?: () => ShirtAnchorReport;
    __characterSdfToolStats?: () => CharacterSdfToolStats;
    __characterSdfToolCapsules?: () => ReturnType<CharacterSdfTool['getCapsules']>;
    __characterSdfToolReport?: () => CharacterSdfFitQualityReport;
    __characterSdfToolPreset?: () => CharacterSdfPresetEnvelope;
    __characterSdfToolSetGlobalRadiusScale?: (scale: number) => CharacterSdfFitQualityReport;
    __characterReproRecorder?: {
      start: () => Promise<void>;
      stopAndSave: () => Promise<CharacterReproSaveResult>;
      isRecording: () => boolean;
    };
    __characterClothReadbackStats?: () => ReturnType<ClothSimulation['getReadbackStats']>;
    __zeroGravityTubeReset?: () => Promise<void>;
    __zeroGravityTubeSpawnShape?: (kind: TubeAssemblySpawnKind) => Promise<number>;
    __zeroGravityTubeClearSpawnedShapes?: () => Promise<void>;
    __zeroGravityTubeReadbackStats?: () => ReturnType<ClothSimulation['getReadbackStats']>;
    __zeroGravityTubeSetTearThreshold?: (threshold: number) => void;
    __zeroGravityTubeSetShapePressure?: (pressure: number) => void;
    __zeroGravityTubeGetSettings?: () => ClothSimulationSettings;
    __zeroGravityTubeApplySettings?: (partial: Partial<ClothSimulationSettings>) => Promise<void>;
    __zeroGravityTubeListSettingsPresets?: () => Promise<FlagSettingsPresetSummary[]>;
    __zeroGravityTubeSaveSettingsPreset?: (
      name: string,
      existingId?: string,
    ) => Promise<StoredFlagSettingsPreset>;
    __zeroGravityTubeLoadSettingsPreset?: (id: string) => Promise<StoredFlagSettingsPreset>;
    __zeroGravityTubeDeleteSettingsPreset?: (id: string) => Promise<void>;
    __zeroGravityTubeShapeStats?: () => {
      activeShape: TubeAssemblySpawnKind | null;
      vertexCount: number;
      faceCount: number;
      stitchEdgeCount: number;
      simulated: boolean;
      sleeveStats?: {
        crossSectionHeight: number;
        crossSectionDepth: number;
        cuffDrop: number;
        vertexCount: number;
      };
    };
    __garmentStudioStats?: () => GarmentAssemblyStats | null;
    __garmentStudioPhysicsStats?: () => ReturnType<ClothSimulation['getStats']>;
    __garmentStudioReadbackStats?: () => ReturnType<ClothSimulation['getReadbackStats']>;
    __garmentStudioGetPreset?: () => GarmentPresetEnvelope;
    __garmentStudioGenerate?: <T extends GarmentType>(
      garmentType: T,
      params?: Partial<GarmentGeneratorParamsByType[T]>,
      name?: string,
    ) => Promise<GarmentAssemblyStats>;
    __garmentStudioListPresets?: () => Promise<GarmentPresetSummary[]>;
    __garmentStudioSavePreset?: <T extends GarmentType>(
      name: string,
      garmentType: T,
      params?: Partial<GarmentGeneratorParamsByType[T]>,
      existingId?: string,
    ) => Promise<GarmentPresetEnvelope>;
    __garmentStudioLoadPreset?: (id: string) => Promise<GarmentPresetEnvelope>;
    __garmentStudioDeletePreset?: (id: string) => Promise<void>;
    __garmentStudioSaveServerFixture?: () => Promise<unknown>;
  }
}

async function bootstrapFlag(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const sim = await createClothSimulation({
    container: document.body,
    statusEl,
    backendEl,
    particlesEl,
  });
  window.__flagSimRefreshHealth = () => sim.refreshHealthFromGpu();
  window.__flagSimSetFabric = (settings) => sim.setFabricSettings(settings);
  window.__flagSimReadbackStats = () => sim.getReadbackStats();
  window.__flagSimSetFabricTextureSource = (source) => sim.setFabricTextureSource(source);
  window.__flagSimSetWind = (strength) => sim.setWindStrength(strength);
  window.__flagSimCaptureFlagCanvas = () => sim.captureFlagCanvas();
  window.__flagSimAnalyzeBlackSpots = () => sim.analyzeBlackSpots();
  window.__flagSimRenderDiagnostics = () => sim.getRenderDiagnostics();
  window.__flagSimCompareFabric = () => sim.compareFabricWeaveOnOff();
  window.__flagSimFabricTextureStats = () => getFabricNormalMapStatsForTest();
  window.__flagSimSetSelfCollision = (enabled) => sim.setSelfCollision(enabled);
  window.__flagSimResetFlag = () => sim.resetFlag();
  window.__flagSimSelfCollisionReport = () => sim.getSelfCollisionReport();
  window.__flagSimProbeSelfCollision = (passes) => sim.probeSelfCollisionDispatch(passes);
  window.__flagSimCompareSelfCollision = () => sim.compareSelfCollisionEffect();
  window.__flagSimGetSettings = () => cloneClothSettings(sim.settings);
  window.__flagSimApplySettings = (partial) => sim.loadSettingsPreset(normalizeClothSettings(partial));
  window.__flagSimListSettingsPresets = () => listFlagSettingsPresets();
  window.__flagSimSaveSettingsPreset = (name, existingId) =>
    saveFlagSettingsPreset(name, cloneClothSettings(sim.settings), existingId);
  window.__flagSimLoadSettingsPreset = async (id) => {
    const stored = await getFlagSettingsPreset(id);
    if (!stored) {
      throw new Error(`Preset not found: ${id}`);
    }
    await sim.loadSettingsPreset(stored.settings);
    return stored;
  };
  window.__flagSimDeleteSettingsPreset = (id) => deleteFlagSettingsPreset(id);
  window.__flagSimFireBb = (ndcX, ndcY) => sim.fireBbForTest(ndcX, ndcY);
  window.__flagSimReadBbSamples = () => sim.readBbProjectileSamples();
  window.__flagSimMeasureBbMotion = (options) => sim.measureBbMotionSmoothness(options);
  window.__flagSimMeasureBbClothBlocking = (options) => sim.measureBbClothBlocking(options);
  window.__flagSimAuditStrandThreads = () => sim.auditStrandThreadCoverage();
  window.__flagSimAuditRandomTears = (options) => sim.auditRandomTornGeometryForTest(options);
  window.__flagSimAuditVisibleWorldGeometry = (options) => sim.auditVisibleWorldGeometryForTest(options);
  createClothControls(sim, { title: 'Inextensible Flag', testId: 'flag-controls' });

  const canvas = sim.renderer.domElement;
  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');

  const syncInteractionUi = (): void => {
    document.body.classList.toggle('grab-mode', sim.isGrabModeOn());
    document.body.classList.toggle('shoot-mode', sim.isShootModeOn());
    grabToggleBtn?.classList.toggle('active', sim.isGrabModeOn());
    shootToggleBtn?.classList.toggle('active', sim.isShootModeOn());
  };

  grabToggleBtn?.addEventListener('click', () => {
    sim.setGrabModeEnabled(!sim.isGrabModeOn());
    syncInteractionUi();
    if (!sim.isGrabModeOn()) {
      document.body.classList.remove('grabbing');
      sim.controls.enabled = true;
    }
  });

  shootToggleBtn?.addEventListener('click', () => {
    sim.setShootModeEnabled(!sim.isShootModeOn());
    syncInteractionUi();
    if (!sim.isShootModeOn()) {
      sim.controls.enabled = true;
    }
  });

  const updateMouseNdc = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    sim.setMousePointerNdc(x, y);
  };

  canvas.addEventListener('pointermove', (event) => {
    updateMouseNdc(event);
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    updateMouseNdc(event);

    if (sim.isShootModeOn()) {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      sim.fireBb(x, y);
      return;
    }

    if (!sim.isGrabModeOn()) {
      return;
    }

    if (!sim.canBeginGrabAttempt()) {
      return;
    }

    sim.beginGrabAttempt();
    sim.controls.enabled = false;
    document.body.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
  });

  const releaseGrab = (event: PointerEvent): void => {
    if (!sim.isGrabPointerDown()) {
      return;
    }

    sim.endGrabAttempt();
    sim.controls.enabled = true;
    document.body.classList.remove('grabbing');

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  canvas.addEventListener('pointerup', releaseGrab);
  canvas.addEventListener('pointercancel', releaseGrab);

  canvas.addEventListener('pointerleave', () => {
    sim.clearMousePointer();
  });

  const resetFlagBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  resetFlagBtn?.addEventListener('click', () => sim.resetFlag());

  window.addEventListener('resize', () => sim.resize());

  sim.renderer.setAnimationLoop(() => {
    sim.update();
    sim.render();
  });
}

async function bootstrapFabricPlane(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Fabric Plane Preview';
  }

  const preview = new FabricPlanePreview(document.body, statusEl, backendEl, particlesEl);
  await preview.init();
  createFabricPlaneControls(preview);

  window.addEventListener('resize', () => preview.resize());

  preview.renderer.setAnimationLoop(() => {
    preview.render();
  });

  window.__fabricPlaneSetDebugView = (mode: 'shaded' | 'uv' | 'normalMap' | 'albedo') =>
    preview.setDebugView(mode);
}

async function bootstrapCharacterPreview(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Animated Mixamo Character';
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) {
    resetBtn.textContent = 'Reset view';
  }

  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  if (grabToggleBtn) {
    grabToggleBtn.textContent = 'Grab';
  }

  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  if (shootToggleBtn) {
    shootToggleBtn.textContent = 'Shoot';
  }
  const toolbar = document.querySelector<HTMLElement>('#toolbar');
  const bonesToggleBtn = document.createElement('button');
  bonesToggleBtn.type = 'button';
  bonesToggleBtn.id = 'bones-toggle-btn';
  bonesToggleBtn.dataset.testid = 'bones-toggle-btn';
  bonesToggleBtn.textContent = 'Bones';
  toolbar?.appendChild(bonesToggleBtn);

  const blendTposeBtn = document.createElement('button');
  blendTposeBtn.type = 'button';
  blendTposeBtn.id = 'blend-tpose-btn';
  blendTposeBtn.dataset.testid = 'blend-tpose-btn';
  blendTposeBtn.textContent = 'T-Pose';
  blendTposeBtn.classList.add('active');
  toolbar?.appendChild(blendTposeBtn);

  const blendIdleBtn = document.createElement('button');
  blendIdleBtn.type = 'button';
  blendIdleBtn.id = 'blend-idle-btn';
  blendIdleBtn.dataset.testid = 'blend-idle-btn';
  blendIdleBtn.textContent = 'Blend Idle';
  toolbar?.appendChild(blendIdleBtn);

  const blendDanceBtn = document.createElement('button');
  blendDanceBtn.type = 'button';
  blendDanceBtn.id = 'blend-dance-btn';
  blendDanceBtn.dataset.testid = 'blend-dance-btn';
  blendDanceBtn.textContent = 'Blend Dance';
  toolbar?.appendChild(blendDanceBtn);

  const recordReproBtn = document.createElement('button');
  recordReproBtn.type = 'button';
  recordReproBtn.id = 'record-repro-btn';
  recordReproBtn.dataset.testid = 'record-repro-btn';
  recordReproBtn.textContent = 'Record Repro';
  toolbar?.appendChild(recordReproBtn);

  const cloth = await createClothSimulation(
    {
      container: document.body,
      statusEl,
      backendEl,
      particlesEl,
    },
    {
      autoInit: false,
      isolated: true,
      pinMode: 'none',
      initialShape: 'tube',
      tubeRadius: 0.34,
      width: Math.PI * 2 * 0.34,
      height: 1.1,
      segmentsX: 49,
      segmentsY: 36,
    },
  );
  Object.assign(cloth.settings, {
    windStrength: 0,
    windTurbulence: 0,
    zoneAStrength: 0,
    zoneBStrength: 0,
    gravity: 0.000025,
    clothThickness: 0.003,
    selfCollision: false,
    poleCollision: false,
    mannequinCollision: false,
    showMannequin: false,
    renderStrandThreads: false,
    showSimGridDebug: false,
    grabStiffness: 0.12,
    grabMaxStep: 0.002,
    grabVelocityCarry: 0,
    grabPointerMaxStep: 0.005,
    tearStretchThreshold: 999,
    shapePressure: 0,
    flagColor: '#ff4fa3',
    fabricTextureSource: 'procedural',
  });
  cloth.applySettings();
  await cloth.init();

  const rig = new AnimatedCharacterSceneRig(cloth.scene);
  await rig.load();
  cloth.settings.mannequinFriction = 0.85;
  cloth.settings.mannequinCollision = false;
  cloth.applySettings();
  const garmentFlow = new CharacterGarmentFlow(cloth, rig, particlesEl);
  await garmentFlow.load();
  cloth.setSimGridDebugVisible(false);
  cloth.setGrabModeEnabled(false);
  cloth.setShootModeEnabled(false);
  cloth.camera.position.set(0, 0.95, 2.6);
  cloth.controls.target.set(0, 0.9, 0);
  cloth.controls.update();
  statusEl.textContent = 'running (animated character cloth)';
  backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name} (character cloth)`;
  particlesEl.textContent = `character cloth particles: ${cloth.getStats().particleCount}`;
  const characterGui = createClothControls(cloth, {
    title: 'Animated Character Cloth',
    testId: 'character-controls',
    collisionUi: 'boneSdf',
  });
  let garmentGenerateQueue = Promise.resolve<GarmentAssemblyStats>(garmentFlow.getStats());
  const characterGeneratorControls = createGarmentStudioControls({
    title: 'Character Clothing Generator',
    testId: 'character-garment-generator-controls',
    position: 'left',
    initialPreset: garmentFlow.getActivePreset(),
    showServerFixture: false,
    showExport: true,
    onGenerate: (preset) => {
      garmentGenerateQueue = garmentGenerateQueue.then(() => garmentFlow.loadPreset(preset)).catch((error: unknown) => {
        console.error(error);
        throw error;
      });
      return garmentGenerateQueue;
    },
  });
  characterGeneratorControls.gui.open();
  const garmentDebugState = { fitDebugVisible: false };
  characterGeneratorControls.gui
    .add(garmentDebugState, 'fitDebugVisible')
    .name('Show fit debug')
    .onChange((visible: boolean) => {
      garmentFlow.setFitDebugVisible(visible);
    });
  const reloadCurrentCharacterGarment = (): Promise<GarmentAssemblyStats> => {
    garmentGenerateQueue = garmentGenerateQueue.then(() =>
      garmentFlow.loadPreset(characterGeneratorControls.getCurrentPreset()),
    ).catch((error: unknown) => {
      console.error(error);
      throw error;
    });
    return garmentGenerateQueue;
  };

  // --- Breast physics GUI ---
  const breastGui = characterGui.addFolder('Breast physics');
  const bp = rig.getBreastPhysics();
  const bpConfig = bp.config;
  breastGui.add(bpConfig, 'stiffnessY', 10, 200, 1).name('Stiffness Y');
  breastGui.add(bpConfig, 'stiffnessX', 10, 200, 1).name('Stiffness X');
  breastGui.add(bpConfig, 'stiffnessZ', 10, 200, 1).name('Stiffness Z');
  breastGui.add(bpConfig, 'dampingY', 0.5, 20, 0.1).name('Damping Y');
  breastGui.add(bpConfig, 'dampingX', 0.5, 20, 0.1).name('Damping X');
  breastGui.add(bpConfig, 'dampingZ', 0.5, 20, 0.1).name('Damping Z');
  breastGui.add(bpConfig, 'responseY', 0.01, 0.5, 0.005).name('Response Y');
  breastGui.add(bpConfig, 'responseX', 0.01, 0.5, 0.005).name('Response X');
  breastGui.add(bpConfig, 'responseZ', 0.01, 0.5, 0.005).name('Response Z');
  breastGui.add(bpConfig, 'maxOffsetY', 0.01, 0.2, 0.005).name('Max offset Y');
  breastGui.add(bpConfig, 'maxOffsetX', 0.01, 0.2, 0.005).name('Max offset X');
  breastGui.add(bpConfig, 'maxOffsetZ', 0.01, 0.2, 0.005).name('Max offset Z');
  breastGui.add({ slap: () => bp.applyImpulse('both', 0, 1.0, -1.5) }, 'slap').name('Test slap');
  breastGui.add({ reset: () => bp.reset() }, 'reset').name('Reset springs');

  window.__characterBreastPhysics = () => rig.getBreastPhysics().snapshot();
  window.__characterPokeBreast = (side: 'left' | 'right' | 'both', dx = 0, dy = 0.5, dz = 0) => {
    rig.getBreastPhysics().applyImpulse(side, dx, dy, dz);
  };
  window.__characterSlapBreast = (side: 'left' | 'right' | 'both', strength = 3.0) => {
    rig.getBreastPhysics().applyImpulse(side, (Math.random() - 0.5) * strength, strength * 0.6, -strength);
    if (side !== 'both') {
      const other = side === 'left' ? 'right' : 'left';
      rig.getBreastPhysics().applyImpulse(other, (Math.random() - 0.5) * strength * 0.3, strength * 0.15, -strength * 0.25);
    }
  };
  window.__characterBreastMorphInfo = () => rig.getBreastMorphInfo();
  window.__characterStats = () => rig.getStats();
  window.__characterBoneSdfs = () => rig.getBoneSdfSummary();
  window.__characterBoneSdfFitReport = () => rig.getBoneSdfFitReport();
  window.__characterBoneSdfMeshCoverageReport = () => rig.getBoneSdfMeshCoverageReport();
  window.__characterBreastVisualAlignmentReport = () => rig.getBreastVisualAlignmentReport();
  window.__characterBlendTo = (kind: 'tpose' | 'idle' | 'dance') => rig.blendToAnimation(kind);
  window.__characterSetTearThreshold = (threshold: number) => garmentFlow.setTearThreshold(threshold);
  window.__characterReloadShirtForTest = () => reloadCurrentCharacterGarment().then(() => undefined);
  window.__characterGarmentStats = () => garmentFlow.getStats();
  window.__characterGarmentFitReport = () => garmentFlow.getFitReport();
  window.__characterGarmentSettledFitReport = () => garmentFlow.settledFitReport();
  window.__characterGarmentSetFitDebugVisible = (visible: boolean) => {
    garmentDebugState.fitDebugVisible = visible;
    garmentFlow.setFitDebugVisible(visible);
  };
  window.__characterGarmentGetPreset = () => characterGeneratorControls.getCurrentPreset();
  window.__characterGarmentGenerate = async (garmentType, params, name) => {
    const preset = createGarmentPresetEnvelope(name ?? `Character ${garmentType}`, garmentType, params);
    await characterGeneratorControls.applyPreset(preset);
    return garmentFlow.getStats();
  };
  window.__characterClothStats = () => cloth.getStats();
  window.__characterTearProtectionReport = () => garmentFlow.tearProtectionReport();
  window.__characterShirtSdfClearanceReport = () => garmentFlow.sdfClearanceReport();
  window.__characterShirtPerCapsuleClearanceReport = () => garmentFlow.perCapsuleClearanceReport();
  window.__characterShirtEdgeClearanceReport = () => garmentFlow.edgeClearanceReport();
  window.__characterShirtTriangleClearanceReport = () => garmentFlow.triangleClearanceReport();
  window.__characterShirtStrainReport = () => garmentFlow.strainReport();
  window.__characterShirtTriangleQualityReport = () => garmentFlow.triangleQualityReport();
  window.__characterSettledShirtSurfaceReport = () => garmentFlow.settledSurfaceReport();
  window.__characterShirtBodyArmDrapeReport = () => garmentFlow.bodyArmDrapeReport();
  window.__characterProbeBoneSdfCollision = () => ({
    sampleCount: 0,
    sdfCount: rig.getBoneSdfSummary().length,
    penetrationsBefore: 0,
    penetrationsAfter: 0,
    maxPushDistance: 0,
    averagePushDistance: 0,
    hitBoneNames: [],
  });
  window.__characterShirtAnchorReport = () => garmentFlow.anchorReport();

  let characterReproRecorder!: ReturnType<typeof createCharacterReproRecorder>;

  const syncInteractionUi = (): void => {
    document.body.classList.toggle('grab-mode', cloth.isGrabModeOn());
    document.body.classList.toggle('shoot-mode', cloth.isShootModeOn());
    grabToggleBtn?.classList.toggle('active', cloth.isGrabModeOn());
    shootToggleBtn?.classList.toggle('active', cloth.isShootModeOn());
  };
  syncInteractionUi();
  grabToggleBtn?.addEventListener('click', () => {
    cloth.setGrabModeEnabled(!cloth.isGrabModeOn());
    syncInteractionUi();
    characterReproRecorder.recordAction('toggle-grab', { enabled: cloth.isGrabModeOn() });
    if (!cloth.isGrabModeOn()) {
      document.body.classList.remove('grabbing');
      cloth.controls.enabled = true;
    }
  });
  shootToggleBtn?.addEventListener('click', () => {
    cloth.setShootModeEnabled(!cloth.isShootModeOn());
    syncInteractionUi();
    characterReproRecorder.recordAction('toggle-shoot', { enabled: cloth.isShootModeOn() });
    if (!cloth.isShootModeOn()) {
      cloth.controls.enabled = true;
    }
  });
  let bonesVisible = false;
  rig.setXrayVisible(bonesVisible);
  bonesToggleBtn.classList.toggle('active', bonesVisible);
  bonesToggleBtn.addEventListener('click', () => {
    bonesVisible = !bonesVisible;
    rig.setXrayVisible(bonesVisible);
    bonesToggleBtn.classList.toggle('active', bonesVisible);
    characterReproRecorder.recordAction('toggle-bones', { enabled: bonesVisible });
  });
  blendIdleBtn.addEventListener('click', () => {
    rig.transitionToIdle(0.85);
    blendTposeBtn.classList.remove('active');
    blendIdleBtn.classList.add('active');
    blendDanceBtn.classList.remove('active');
    characterReproRecorder.recordAction('blend-idle');
  });
  blendDanceBtn.addEventListener('click', () => {
    rig.transitionToDance(0.85);
    blendTposeBtn.classList.remove('active');
    blendDanceBtn.classList.add('active');
    blendIdleBtn.classList.remove('active');
    characterReproRecorder.recordAction('blend-dance');
  });
  blendTposeBtn.addEventListener('click', () => {
    rig.blendToAnimation('tpose', 0.45);
    blendTposeBtn.classList.add('active');
    blendIdleBtn.classList.remove('active');
    blendDanceBtn.classList.remove('active');
    characterReproRecorder.recordAction('blend-tpose');
  });
  resetBtn?.addEventListener('click', () => {
    cloth.controls.reset();
    characterReproRecorder.recordAction('reset-view');
  });

  // --- Breast slap interaction ---
  const slapToggleBtn = document.createElement('button');
  slapToggleBtn.type = 'button';
  slapToggleBtn.id = 'slap-toggle-btn';
  slapToggleBtn.dataset.testid = 'slap-toggle-btn';
  slapToggleBtn.textContent = 'Slap';
  toolbar?.appendChild(slapToggleBtn);

  let slapMode = false;
  const SLAP_HIT_RADIUS = 0.16;
  const SLAP_BASE_STRENGTH = 2.5;     // minimum impulse on a still click
  const SLAP_VELOCITY_SCALE = 12.0;   // how much mouse speed amplifies the hit
  const SLAP_FORWARD_PUSH = 1.2;      // extra push into the body on impact
  const slapRaycaster = new THREE.Raycaster();
  const slapNdc = new THREE.Vector2();

  // Track pointer velocity for swipe-based slap direction
  let slapPointerHistory: { x: number; y: number; t: number }[] = [];

  slapToggleBtn.addEventListener('click', () => {
    slapMode = !slapMode;
    slapToggleBtn.classList.toggle('active', slapMode);
    characterReproRecorder.recordAction('toggle-slap', { enabled: slapMode });
    if (slapMode) {
      cloth.setGrabModeEnabled(false);
      cloth.setShootModeEnabled(false);
      syncInteractionUi();
    }
  });

  const slapHitTest = (ndcX: number, ndcY: number): {
    side: 'left' | 'right';
    point: THREE.Vector3;
    center: THREE.Vector3;
  } | null => {
    const centers = rig.getBreastWorldCenters();
    if (!centers) return null;

    slapNdc.set(ndcX, ndcY);
    slapRaycaster.setFromCamera(slapNdc, cloth.camera);
    const ray = slapRaycaster.ray;

    let bestDist = SLAP_HIT_RADIUS;
    let bestSide: 'left' | 'right' | null = null;
    let bestCenter: THREE.Vector3 | null = null;

    for (const [side, center] of [['left', centers.left], ['right', centers.right]] as const) {
      const closest = new THREE.Vector3();
      ray.closestPointToPoint(center, closest);
      const dist = closest.distanceTo(center);
      if (dist < bestDist) {
        bestDist = dist;
        bestSide = side;
        bestCenter = center;
      }
    }

    if (!bestSide || !bestCenter) return null;
    const hitPoint = new THREE.Vector3();
    ray.closestPointToPoint(bestCenter, hitPoint);
    return { side: bestSide, point: hitPoint, center: bestCenter };
  };

  /**
   * Compute swipe velocity from pointer history.
   * Returns NDC units/second in x and y.
   */
  const getSlapSwipeVelocity = (): { vx: number; vy: number } => {
    const now = performance.now();
    // Only use samples from the last 100ms
    const recent = slapPointerHistory.filter((s) => now - s.t < 100);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.001) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  };

  const canvas = cloth.renderer.domElement;
  const captureCharacterReproState = async (): Promise<Record<string, unknown>> => {
    let settledSurface: CharacterShirtSurfaceReport | { error: string } | null = null;
    try {
      settledSurface = await garmentFlow.settledSurfaceReport();
    } catch (error) {
      settledSurface = { error: error instanceof Error ? error.message : String(error) };
    }

    return {
      capturedAt: new Date().toISOString(),
      appMode: 'character',
      characterStats: rig.getStats(),
      clothStats: cloth.getStats(),
      clothSettings: cloneClothSettings(cloth.settings),
      camera: {
        position: cloth.camera.position.toArray(),
        quaternion: cloth.camera.quaternion.toArray(),
        fov: cloth.camera.fov,
        near: cloth.camera.near,
        far: cloth.camera.far,
      },
      controls: {
        target: cloth.controls.target.toArray(),
        enabled: cloth.controls.enabled,
      },
      interaction: {
        grabMode: cloth.isGrabModeOn(),
        shootMode: cloth.isShootModeOn(),
        slapMode,
        bonesVisible,
      },
      shirtAnchor: garmentFlow.anchorReport(),
      settledSurface,
      boneSdfs: rig.getBoneSdfSummary(),
    };
  };
  characterReproRecorder = createCharacterReproRecorder({
    canvas,
    captureState: captureCharacterReproState,
  });
  window.__characterReproRecorder = {
    start: () => characterReproRecorder.start(),
    stopAndSave: () => characterReproRecorder.stopAndSave(),
    isRecording: () => characterReproRecorder.isRecording(),
  };
  window.__characterClothReadbackStats = () => cloth.getReadbackStats();

  const setRecordButtonState = (state: 'idle' | 'recording' | 'saving' | 'saved' | 'downloaded' | 'error'): void => {
    recordReproBtn.classList.toggle('active', state === 'recording');
    recordReproBtn.disabled = state === 'saving';
    recordReproBtn.title = state === 'downloaded'
      ? 'Dev save failed, so the recording was downloaded instead.'
      : state === 'saved'
        ? 'Saved to tests/fixtures/character-repros/latest.json'
        : '';
    recordReproBtn.textContent = state === 'recording'
      ? 'Stop & Save'
      : state === 'saving'
        ? 'Saving...'
        : state === 'saved'
          ? 'Saved Repro'
          : state === 'downloaded'
            ? 'Downloaded Repro'
            : state === 'error'
              ? 'Record Failed'
              : 'Record Repro';
  };
  recordReproBtn.addEventListener('click', () => {
    void (async () => {
      if (!characterReproRecorder.isRecording()) {
        setRecordButtonState('recording');
        await characterReproRecorder.start();
        characterReproRecorder.recordAction('record-button-start');
        return;
      }

      characterReproRecorder.recordAction('record-button-stop');
      setRecordButtonState('saving');
      const result = await characterReproRecorder.stopAndSave();
      if (result.ok) {
        console.info(`Character repro saved to ${result.latestPath ?? 'tests/fixtures/character-repros/latest.json'}`);
        setRecordButtonState('saved');
      } else if (result.downloaded) {
        console.warn(`Character repro save failed; downloaded JSON instead: ${result.error ?? 'unknown error'}`);
        setRecordButtonState('downloaded');
      } else {
        console.error(`Character repro recording failed: ${result.error ?? 'unknown error'}`);
        setRecordButtonState('error');
      }
      window.setTimeout(() => setRecordButtonState('idle'), 2_500);
    })();
  });

  const toNdc = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0,
      y: rect.height > 0 ? -((event.clientY - rect.top) / rect.height) * 2 + 1 : 0,
    };
  };
  const updateMouseNdc = (event: PointerEvent): void => {
    const ndc = toNdc(event);
    cloth.setMousePointerNdc(ndc.x, ndc.y);
  };
  canvas.addEventListener('pointermove', (event) => {
    updateMouseNdc(event);
    characterReproRecorder.recordPointer('move', event);

    // Track pointer movement for slap velocity
    if (slapMode) {
      const ndc = toNdc(event);
      const now = performance.now();
      slapPointerHistory.push({ x: ndc.x, y: ndc.y, t: now });
      // Keep only the last 150ms of samples
      slapPointerHistory = slapPointerHistory.filter((s) => now - s.t < 150);
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    updateMouseNdc(event);
    characterReproRecorder.recordPointer('down', event);

    // Slap mode: swipe-velocity–based impact on breast
    if (slapMode) {
      const ndc = toNdc(event);
      const hit = slapHitTest(ndc.x, ndc.y);
      if (hit) {
        const swipe = getSlapSwipeVelocity();
        const swipeSpeed = Math.sqrt(swipe.vx * swipe.vx + swipe.vy * swipe.vy);

        // Impulse = base push + velocity-amplified directional hit
        const impulseX = swipe.vx * SLAP_VELOCITY_SCALE + (hit.point.x - hit.center.x) * SLAP_BASE_STRENGTH;
        const impulseY = swipe.vy * SLAP_VELOCITY_SCALE + (hit.point.y - hit.center.y) * SLAP_BASE_STRENGTH;
        // Always push into the body (forward/Z) on impact
        const impulseZ = -(SLAP_BASE_STRENGTH + swipeSpeed * SLAP_FORWARD_PUSH);

        rig.getBreastPhysics().applyImpulse(hit.side, impulseX, impulseY, impulseZ);
        characterReproRecorder.recordAction('slap-hit', {
          side: hit.side,
          impulse: [impulseX, impulseY, impulseZ],
          swipeSpeed,
        });

        // If both breasts are close to the hit, give the other a smaller sympathetic jiggle
        const otherSide = hit.side === 'left' ? 'right' : 'left';
        rig.getBreastPhysics().applyImpulse(otherSide, impulseX * 0.3, impulseY * 0.3, impulseZ * 0.25);
      }
      // Clear history after slap
      slapPointerHistory = [];
      return;
    }

    if (cloth.isShootModeOn()) {
      const rect = canvas.getBoundingClientRect();
      const fired = cloth.fireBb(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      characterReproRecorder.recordAction('shoot-bb', { fired: fired !== null });
      return;
    }
    if (!cloth.isGrabModeOn()) {
      return;
    }
    if (!cloth.canBeginGrabAttempt()) {
      return;
    }
    cloth.beginGrabAttempt();
    characterReproRecorder.recordAction('grab-begin');
    cloth.controls.enabled = false;
    document.body.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
  });
  const releaseGrab = (event: PointerEvent): void => {
    characterReproRecorder.recordPointer(event.type === 'pointercancel' ? 'cancel' : 'up', event);
    if (!cloth.isGrabPointerDown()) {
      return;
    }
    cloth.endGrabAttempt();
    characterReproRecorder.recordAction('grab-end');
    cloth.controls.enabled = true;
    document.body.classList.remove('grabbing');
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', releaseGrab);
  canvas.addEventListener('pointercancel', releaseGrab);
  canvas.addEventListener('pointerleave', (event) => {
    characterReproRecorder.recordPointer('leave', event);
    cloth.clearMousePointer();
  });

  window.addEventListener('resize', () => cloth.resize());
  const timer = new THREE.Timer();
  cloth.renderer.setAnimationLoop(() => {
    timer.update();
    const delta = Math.min(timer.getDelta(), 1 / 30);
    rig.update(delta);
    syncCharacterBoneSdfsToGpu(cloth, rig);
    cloth.update();
    cloth.render();
  });
}

async function bootstrapCharacterSdfTool(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Character SDF Tool';
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) {
    resetBtn.textContent = 'Reset view';
  }
  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  if (grabToggleBtn) {
    grabToggleBtn.style.display = 'none';
  }
  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  if (shootToggleBtn) {
    shootToggleBtn.style.display = 'none';
  }

  const tool = new CharacterSdfTool(document.body, statusEl, backendEl, particlesEl);
  await tool.load();
  tool.createControls();
  resetBtn?.addEventListener('click', () => {
    tool.controls.reset();
  });

  window.__characterSdfToolStats = () => tool.getStats();
  window.__characterSdfToolCapsules = () => tool.getCapsules();
  window.__characterSdfToolReport = () => tool.getReport();
  window.__characterSdfToolPreset = () => tool.getPreset();
  window.__characterSdfToolSetGlobalRadiusScale = (scale: number) => tool.setGlobalRadiusScale(scale);

  window.addEventListener('resize', () => tool.resize());
  tool.renderer.setAnimationLoop(() => {
    tool.update();
    tool.render();
  });
}

async function bootstrapZeroGravityTube(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'GPU Cloth Tube';
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) {
    resetBtn.textContent = 'Reset cloth';
  }

  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  if (grabToggleBtn) {
    grabToggleBtn.textContent = 'Grab';
  }

  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  if (shootToggleBtn) {
    shootToggleBtn.textContent = 'Shoot';
  }

  const cloth = await createClothSimulation(
    {
      container: document.body,
      statusEl,
      backendEl,
      particlesEl,
    },
    {
      autoInit: false,
      isolated: true,
      pinMode: 'none',
      initialShape: 'tube',
      tubeRadius: 0.34,
      width: Math.PI * 2 * 0.34,
      height: 1.1,
      segmentsX: 49,
      segmentsY: 36,
    },
  );
  Object.assign(cloth.settings, {
    windStrength: 0,
    windTurbulence: 0,
    zoneAStrength: 0,
    zoneBStrength: 0,
    gravity: 0,
    clothThickness: 0.003,
    selfCollision: true,
    poleCollision: false,
    renderStrandThreads: false,
    tearStretchThreshold: 999,
  });
  cloth.applySettings();
  await cloth.init();
  cloth.setGrabModeEnabled(true);
  statusEl.textContent = 'running (flag solver tube)';
  backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name} (flag solver tube)`;
  particlesEl.textContent = `tube particles: ${cloth.getStats().particleCount}`;
  const gui = createClothControls(cloth, { title: 'GPU Cloth Tube', testId: 'tube-controls' });

  let spawnedAssemblyStats = {
    activeShape: null as TubeAssemblySpawnKind | null,
    vertexCount: 0,
    faceCount: 0,
    stitchEdgeCount: 0,
    simulated: false,
    sleeveStats: undefined as ReturnType<typeof measureTShirtSleeves> | undefined,
  };
  let shapePressurePulseTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let tearStrengthPulseTimeout: ReturnType<typeof window.setTimeout> | null = null;
  let tearStrengthRestoreValue = cloth.settings.tearStretchThreshold;

  const clearShapePressurePulse = (): void => {
    if (shapePressurePulseTimeout !== null) {
      window.clearTimeout(shapePressurePulseTimeout);
      shapePressurePulseTimeout = null;
    }
  };

  const setShapePressure = (pressure: number): void => {
    cloth.settings.shapePressure = pressure;
    cloth.applySettings();
  };

  const pulseShapePressure = (pressure: number, durationMs: number): void => {
    clearShapePressurePulse();
    setShapePressure(pressure);
    shapePressurePulseTimeout = window.setTimeout(() => {
      shapePressurePulseTimeout = null;
      setShapePressure(0);
    }, durationMs);
  };

  const clearTearStrengthPulse = (): void => {
    if (tearStrengthPulseTimeout !== null) {
      window.clearTimeout(tearStrengthPulseTimeout);
      tearStrengthPulseTimeout = null;
    }
  };

  const pulseInfiniteTearStrength = (durationMs: number): void => {
    clearTearStrengthPulse();
    tearStrengthRestoreValue = cloth.settings.tearStretchThreshold;
    cloth.settings.tearStretchThreshold = 999_999;
    cloth.applySettings();
    tearStrengthPulseTimeout = window.setTimeout(() => {
      tearStrengthPulseTimeout = null;
      cloth.settings.tearStretchThreshold = tearStrengthRestoreValue;
      cloth.applySettings();
    }, durationMs);
  };

  const clearSpawnedAssembly = async (): Promise<void> => {
    clearShapePressurePulse();
    clearTearStrengthPulse();
    cloth.settings.mannequinCollision = false;
    cloth.settings.showMannequin = false;
    setShapePressure(0);
    await cloth.rebuildFlag();
    cloth.setGrabModeEnabled(true);
    spawnedAssemblyStats = {
      activeShape: null,
      vertexCount: 0,
      faceCount: 0,
      stitchEdgeCount: 0,
      simulated: false,
      sleeveStats: undefined,
    };
    particlesEl.textContent = `tube particles: ${cloth.getStats().particleCount}`;
  };

  const spawnAssembly = async (kind: TubeAssemblySpawnKind): Promise<number> => {
    clearShapePressurePulse();
    clearTearStrengthPulse();
    cloth.settings.mannequinCollision = false;
    cloth.settings.showMannequin = false;
    setShapePressure(0);
    const assembly = createTubePageAssembly(kind);
    await cloth.loadClothAssembly(assembly);
    if (kind === 'tshirt') {
      cloth.settings.mannequinCollision = true;
      cloth.settings.showMannequin = true;
      cloth.applySettings();
      pulseShapePressure(0.00005, 100);
      pulseInfiniteTearStrength(100);
    }
    cloth.setGrabModeEnabled(true);
    spawnedAssemblyStats = {
      activeShape: kind,
      vertexCount: assembly.vertices.length,
      faceCount: assembly.faces.length,
      stitchEdgeCount: assembly.stitchEdges.length,
      simulated: true,
      sleeveStats: kind === 'tshirt' ? measureTShirtSleeves(assembly) : undefined,
    };
    particlesEl.textContent = `${kind} cloth particles: ${cloth.getStats().particleCount}`;
    return assembly.faces.length;
  };

  const assemblyActions = {
    box: () => void spawnAssembly('box'),
    octagonalTube: () => void spawnAssembly('octagonalTube'),
    pyramid: () => void spawnAssembly('pyramid'),
    tshirt: () => void spawnAssembly('tshirt'),
    clear: () => void clearSpawnedAssembly(),
  };
  const assemblyFolder = gui.addFolder('Assembly Spawner');
  assemblyFolder.add(assemblyActions, 'box').name('Spawn stitched box');
  assemblyFolder.add(assemblyActions, 'octagonalTube').name('Spawn octagonal tube');
  assemblyFolder.add(assemblyActions, 'pyramid').name('Spawn pyramid');
  assemblyFolder.add(assemblyActions, 'tshirt').name('Spawn T-shirt');
  assemblyFolder.add(assemblyActions, 'clear').name('Clear spawned shape');

  const activeBbCount = (): number => {
    const pool = cloth.getBbPool();
    let count = 0;
    for (let i = 0; i < pool.maxCount; i++) {
      if (pool.getProjectile(i).alive) {
        count++;
      }
    }
    return count;
  };

  window.__zeroGravityTubeStats = () => {
    const stats = cloth.getStats();
    const indexCount = cloth.clothGeometry.index ? cloth.clothGeometry.index.count : 0;
    const drawCount = Number.isFinite(cloth.clothGeometry.drawRange.count)
      ? cloth.clothGeometry.drawRange.count
      : indexCount;
    return {
      particleCount: stats.particleCount,
      triangleCount: drawCount / 3,
      projectileCount: activeBbCount(),
      grabMode: cloth.isGrabModeOn(),
      shootMode: cloth.isShootModeOn(),
      centerY: stats.centerY,
      minY: stats.minY,
      maxY: stats.maxY,
      maxParticleSpeed: 0,
      hasNaN: stats.hasNaN,
      gravity: cloth.settings.gravity,
      pressure: cloth.settings.shapePressure,
      tearStretchThreshold: cloth.settings.tearStretchThreshold,
      grabRadius: cloth.settings.grabRadius,
      mannequinCollision: cloth.settings.mannequinCollision,
    };
  };
  window.__zeroGravityTubeReset = async () => {
    cloth.resetFlag();
    await cloth.refreshBbVisualsFromGpu();
  };
  window.__zeroGravityTubeSetGrab = (enabled) => cloth.setGrabModeEnabled(enabled);
  window.__zeroGravityTubeSetShoot = (enabled) => cloth.setShootModeEnabled(enabled);
  window.__zeroGravityTubeSetGravity = (gravity) => {
    cloth.settings.gravity = gravity;
    cloth.applySettings();
  };
  window.__zeroGravityTubeSetTearThreshold = (threshold) => {
    clearTearStrengthPulse();
    cloth.settings.tearStretchThreshold = threshold;
    cloth.applySettings();
  };
  window.__zeroGravityTubeSetShapePressure = (pressure) => {
    clearShapePressurePulse();
    setShapePressure(pressure);
  };
  window.__zeroGravityTubeGetSettings = () => cloneClothSettings(cloth.settings);
  window.__zeroGravityTubeApplySettings = async (partial) => {
    await cloth.loadSettingsPreset(normalizeClothSettings({ ...cloth.settings, ...partial }));
  };
  window.__zeroGravityTubeListSettingsPresets = () => listFlagSettingsPresets();
  window.__zeroGravityTubeSaveSettingsPreset = (name, existingId) =>
    saveFlagSettingsPreset(name, cloneClothSettings(cloth.settings), existingId);
  window.__zeroGravityTubeLoadSettingsPreset = async (id) => {
    const stored = await getFlagSettingsPreset(id);
    if (!stored) {
      throw new Error(`Preset not found: ${id}`);
    }
    await cloth.loadSettingsPreset(stored.settings);
    return stored;
  };
  window.__zeroGravityTubeDeleteSettingsPreset = (id) => deleteFlagSettingsPreset(id);
  window.__zeroGravityTubeFire = (ndcX, ndcY) => cloth.fireBbForTest(ndcX, ndcY) !== null;
  window.__zeroGravityTubeReadbackStats = () => cloth.getReadbackStats();
  window.__zeroGravityTubeSpawnShape = spawnAssembly;
  window.__zeroGravityTubeClearSpawnedShapes = clearSpawnedAssembly;
  window.__zeroGravityTubeShapeStats = () => spawnedAssemblyStats;

  const syncButtons = () => {
    document.body.classList.toggle('grab-mode', cloth.isGrabModeOn());
    document.body.classList.toggle('shoot-mode', cloth.isShootModeOn());
    grabToggleBtn?.classList.toggle('active', cloth.isGrabModeOn());
    shootToggleBtn?.classList.toggle('active', cloth.isShootModeOn());
  };

  resetBtn?.addEventListener('click', () => cloth.resetFlag());
  grabToggleBtn?.addEventListener('click', () => {
    cloth.setGrabModeEnabled(!cloth.isGrabModeOn());
    syncButtons();
  });
  shootToggleBtn?.addEventListener('click', () => {
    cloth.setShootModeEnabled(!cloth.isShootModeOn());
    syncButtons();
  });
  syncButtons();

  const canvas = cloth.renderer.domElement;
  const updateMouseNdc = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    cloth.setMousePointerNdc(x, y);
  };

  canvas.addEventListener('pointermove', (event) => {
    updateMouseNdc(event);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    updateMouseNdc(event);
    if (cloth.isShootModeOn()) {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      cloth.fireBb(x, y);
      return;
    }
    if (!cloth.isGrabModeOn()) {
      return;
    }
    cloth.beginGrabAttempt();
    cloth.controls.enabled = false;
    document.body.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
  });
  const releaseGrab = (event: PointerEvent): void => {
    if (!cloth.isGrabPointerDown()) {
      return;
    }
    cloth.endGrabAttempt();
    cloth.controls.enabled = true;
    document.body.classList.remove('grabbing');
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', releaseGrab);
  canvas.addEventListener('pointercancel', releaseGrab);
  canvas.addEventListener('pointerleave', () => cloth.clearMousePointer());

  window.addEventListener('resize', () => cloth.resize());
  cloth.renderer.setAnimationLoop(() => {
    cloth.update();
    cloth.render();
  });
}

async function bootstrapGarmentStudio(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Clothing Generator Studio';
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) {
    resetBtn.textContent = 'Regenerate garment';
  }

  const cloth = await createClothSimulation(
    {
      container: document.body,
      statusEl,
      backendEl,
      particlesEl,
    },
    {
      autoInit: false,
      isolated: true,
      pinMode: 'none',
      width: 1.2,
      height: 1.2,
      segmentsX: 24,
      segmentsY: 24,
    },
  );

  Object.assign(cloth.settings, {
    windStrength: 0,
    windTurbulence: 0,
    zoneAStrength: 0,
    zoneBStrength: 0,
    gravity: 0,
    clothThickness: 0.004,
    selfCollision: true,
    poleCollision: false,
    shapePressure: 0,
    renderStrandThreads: false,
    tearStretchThreshold: 999,
  });
  cloth.applySettings();
  await cloth.init();
  cloth.setGrabModeEnabled(true);

  let activePreset = createGarmentPresetEnvelope('Studio T-shirt', 'tshirt', undefined);
  let activeStats: GarmentAssemblyStats | null = null;

  const loadPresetIntoSimulation = async (preset: GarmentPresetEnvelope): Promise<void> => {
    const generated = generateGarmentPresetAssembly(preset);
    activePreset = generated.preset;
    activeStats = generated.stats;
    await cloth.loadClothAssembly(generated.assembly);
    cloth.setGrabModeEnabled(true);
    statusEl.textContent = `running (${preset.garmentType} generator)`;
    backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name} (garment studio)`;
    particlesEl.textContent =
      `${preset.garmentType} particles: ${cloth.getStats().particleCount} ` +
      `faces: ${generated.stats.faceCount} seams: ${generated.stats.stitchEdgeCount}`;
  };

  await loadPresetIntoSimulation(activePreset);

  const physicsGui = createClothControls(cloth, {
    title: 'Garment Physics',
    testId: 'garment-physics-controls',
  });
  physicsGui.close();

  const studioControls = createGarmentStudioControls({
    onGenerate: loadPresetIntoSimulation,
  });

  window.__garmentStudioStats = () => activeStats;
  window.__garmentStudioPhysicsStats = () => cloth.getStats();
  window.__garmentStudioReadbackStats = () => cloth.getReadbackStats();
  window.__garmentStudioGetPreset = () => studioControls.getCurrentPreset();
  window.__garmentStudioGenerate = async (garmentType, params, name) => {
    const preset = createGarmentPresetEnvelope(name ?? `Generated ${garmentType}`, garmentType, params);
    await studioControls.applyPreset(preset);
    return activeStats!;
  };
  window.__garmentStudioListPresets = () => listGarmentPresets();
  window.__garmentStudioSavePreset = async (name, garmentType, params, existingId) => {
    const preset = await saveGarmentPreset(name, garmentType, params ?? {}, existingId);
    await studioControls.refreshPresets();
    return preset;
  };
  window.__garmentStudioLoadPreset = async (id) => {
    const preset = await getGarmentPreset(id);
    if (!preset) {
      throw new Error(`Garment preset not found: ${id}`);
    }
    await studioControls.applyPreset(preset);
    return preset;
  };
  window.__garmentStudioDeletePreset = async (id) => {
    await deleteGarmentPreset(id);
    await studioControls.refreshPresets();
  };
  window.__garmentStudioSaveServerFixture = async () => {
    const response = await fetch('/__garments/presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(studioControls.getCurrentPreset()),
    });
    return response.json();
  };

  const syncButtons = () => {
    document.body.classList.toggle('grab-mode', cloth.isGrabModeOn());
    document.body.classList.toggle('shoot-mode', cloth.isShootModeOn());
    grabToggleBtn?.classList.toggle('active', cloth.isGrabModeOn());
    shootToggleBtn?.classList.toggle('active', cloth.isShootModeOn());
  };

  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  resetBtn?.addEventListener('click', () => void loadPresetIntoSimulation(studioControls.getCurrentPreset()));
  grabToggleBtn?.addEventListener('click', () => {
    cloth.setGrabModeEnabled(!cloth.isGrabModeOn());
    syncButtons();
  });
  shootToggleBtn?.addEventListener('click', () => {
    cloth.setShootModeEnabled(!cloth.isShootModeOn());
    syncButtons();
  });
  syncButtons();

  const canvas = cloth.renderer.domElement;
  const updateMouseNdc = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    cloth.setMousePointerNdc(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  canvas.addEventListener('pointermove', updateMouseNdc);
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    updateMouseNdc(event);
    if (!cloth.isGrabModeOn() || !cloth.canBeginGrabAttempt()) {
      return;
    }
    cloth.beginGrabAttempt();
    cloth.controls.enabled = false;
    document.body.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
  });
  const releaseGrab = (event: PointerEvent): void => {
    if (!cloth.isGrabPointerDown()) {
      return;
    }
    cloth.endGrabAttempt();
    cloth.controls.enabled = true;
    document.body.classList.remove('grabbing');
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', releaseGrab);
  canvas.addEventListener('pointercancel', releaseGrab);
  canvas.addEventListener('pointerleave', () => cloth.clearMousePointer());

  window.addEventListener('resize', () => cloth.resize());
  cloth.renderer.setAnimationLoop(() => {
    cloth.update();
    cloth.render();
  });
}

function syncCharacterBoneSdfsToGpu(cloth: ClothSimulation, rig: AnimatedCharacterSceneRig): void {
  cloth.setBoneSdfCapsules(rig.getBoneSdfSummary());
}

async function bootstrap(): Promise<void> {
  setupDeveloperDashboard();

  const statusEl = document.querySelector<HTMLElement>('[data-testid="sim-status"]');
  const backendEl = document.querySelector<HTMLElement>('[data-testid="sim-backend"]');
  const particlesEl = document.querySelector<HTMLElement>('[data-testid="sim-particles"]');

  if (!statusEl || !backendEl || !particlesEl) {
    throw new Error('Missing simulation status elements');
  }

  if (!WebGPU.isAvailable()) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = 'error: WebGPU unavailable';
    document.body.appendChild(WebGPU.getErrorMessage());
    return;
  }

  const mode = getAppMode();

  if (mode === 'plane') {
    await bootstrapFabricPlane(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'tube') {
    await bootstrapZeroGravityTube(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'character') {
    await bootstrapCharacterPreview(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'character-sdf') {
    await bootstrapCharacterSdfTool(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'garment') {
    await bootstrapGarmentStudio(statusEl, backendEl, particlesEl);
    return;
  }

  await bootstrapFlag(statusEl, backendEl, particlesEl);
}

bootstrap().catch((error: unknown) => {
  const statusEl = document.querySelector<HTMLElement>('[data-testid="sim-status"]');
  if (statusEl) {
    statusEl.dataset.state = 'error';
    statusEl.textContent = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
