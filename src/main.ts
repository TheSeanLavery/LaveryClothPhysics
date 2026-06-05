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
import { makeDraggable } from './ui/draggableFloating.ts';
import { wireClothCanvasInteraction } from './ui/wireClothCanvasInteraction.ts';
import { getAppMode } from './app/routes';
import { bootstrapCharacterDuel } from './scenes/characterDuel/bootstrapCharacterDuel.ts';
import { bootstrapClothRenderTest } from './scenes/clothRenderTest/bootstrapClothRenderTest.ts';
import { bootstrapMultiMaterialTest } from './scenes/multiMaterialTest/bootstrapMultiMaterialTest.ts';
import { applyMyPresetToCharacterCloth } from './cloth/myPresetDefaults.ts';
import type { CharacterDuelStats } from './scenes/characterDuel/bootstrapCharacterDuel.ts';
import type { DuelControlMode } from './scenes/characterDuel/characterDuelConfig.ts';
import {
  createCharacterReproRecorder,
  type CharacterReproSaveResult,
} from './app/characterReproRecorder';
import { FabricPlanePreview, createFabricPlaneControls } from './debug/FabricPlanePreview';
import { registerCharacterDevMenu } from './dev/registerCharacterDevMenu.ts';
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
import catalogJson from './animations/animationCatalog.json';

declare global {
  interface Window {
    __characterStats?: () => CharacterStats;
    __characterBoneSdfs?: () => ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>;
    __characterBoneSdfsForCloth?: () => ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummaryForCloth']>;
    __characterPatchSdfSquashConfig?: (
      patch: Partial<import('./character/sdf').SdfSquashConfig>,
    ) => void;
    __characterSdfSquashReport?: () => import('./character/sdf').SdfSquashReport | null;
    __characterBoneSdfFitReport?: () => BoneSdfFitReport;
    __characterBoneSdfMeshCoverageReport?: () => BoneSdfMeshCoverageReport;
    __characterSdfPreset?: () => import('./character/sdf').CharacterSdfPresetEnvelope | null;
    __characterSdfQualityReport?: () => import('./character/sdf').CharacterSdfFitQualityReport | null;
    __characterPatchSdfGlobalRadiusScale?: (scale: number) => void;
    __characterSetSdfRuntimeScale?: (scale: number) => void;
    __characterBreastVisualAlignmentReport?: () => BreastVisualAlignmentReport;
    __characterButtPhysics?: () => ReturnType<ReturnType<AnimatedCharacterSceneRig['getButtPhysics']>['snapshot']>;
    __characterButtMorphInfo?: () => ReturnType<AnimatedCharacterSceneRig['getButtMorphInfo']>;
    __characterSlapButt?: (side: 'left' | 'right' | 'both', strength?: number) => void;
    __characterBlink?: () => void;
    __characterBlinkState?: () => number;
    __characterBlinkDebug?: () => ReturnType<AnimatedCharacterSceneRig['getBlinkInfo']>;
    __characterSetManualClose?: (value: number) => void;
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
    /** TEST ONLY — GPU readback of settled shirt vertices for physics regression. */
    __characterReadClothVertexPositionsForTest?: () => Promise<{
      particleCount: number;
      renderVertexCount: number;
      positions: [number, number, number][];
      presetSource: string;
    }>;
    __characterForceTposeForTest?: () => void;
    __characterIsShirtReadyForTest?: () => {
      ready: boolean;
      characterLoaded: boolean;
      garmentType: string;
      garmentVertexCount: number;
      clothParticleCount: number;
    };
    /** TEST ONLY — wall-clock wait; production animation loop keeps simulating. */
    __characterWaitWallClockForTest?: (seconds: number) => Promise<void>;
    __characterPhysicsPoseStats?: () => {
      enabled: boolean;
      pairCount: number;
      maxTargetDisplayAngleRad: number;
      maxTargetDisplayAngleDeg: number;
      lastStepSec: number;
    };
    __characterPhysicsPoseConfig?: () => Record<string, number | boolean>;
    __characterPhysicsPoseSnapDisplay?: () => void;
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
    __duelStats?: () => CharacterDuelStats;
    __duelFighterModels?: () => { readonly fighterA: string; readonly fighterB: string };
    __duelSwapFighterModel?: (fighter: 'A' | 'B', modelId: string) => Promise<void>;
    __duelPhysicsPoseStats?: (fighter?: 'A' | 'B') => {
      enabled: boolean;
      pairCount: number;
      maxTargetDisplayAngleRad: number;
      maxTargetDisplayAngleDeg: number;
      lastStepSec: number;
    };
    __duelPhysicsPoseConfig?: (fighter?: 'A' | 'B') => Record<string, number | boolean>;
    __duelPhysicsPoseSnapDisplay?: (fighter?: 'A' | 'B') => void;
    __duelShirtHealth?: () => { fighterA: number; fighterB: number };
    __duelFacingDebug?: (fighter?: 'A' | 'B') => import('./character/CharacterController.ts').FacingDebugSnapshot;
    __duelAuditFacingTurn?: (options: {
      fighter?: 'A' | 'B';
      key: string;
      expectedIntentMeshYawRad: number;
      durationMs?: number;
      sampleIntervalMs?: number;
      maxTurnErrorRad?: number;
      maxTotalTurnRad?: number;
    }) => Promise<{
      samples: import('./character/facingTurnAudit.ts').FacingSample[];
      verdict: import('./character/facingTurnAudit.ts').FacingTurnVerdict;
    }>;
    __duelAuditFacingSuite?: (options: {
      fighter?: 'A' | 'B';
      walkKey: string;
      expectedWalkIntentMeshYawRad: number;
      idleSettleMs?: number;
      walkDurationMs?: number;
      sampleIntervalMs?: number;
    }) => Promise<{
      idleSamples: import('./character/facingAlignmentAudit.ts').FacingAlignmentSample[];
      walkSamples: import('./character/facingAlignmentAudit.ts').FacingAlignmentSample[];
      verdict: import('./character/facingAlignmentAudit.ts').FacingSuiteVerdict;
    }>;
    __duelSetFacingDebugVisible?: (visible: boolean) => void;
    __duelSetControlMode?: (mode: DuelControlMode) => void;
    __duelGetControlMode?: () => DuelControlMode;
    __duelFighterAPosition?: () => [number, number, number];
    __duelFighterBPosition?: () => [number, number, number];
    __duelClothStats?: () => ReturnType<ClothSimulation['getStats']>;
    __duelClothReadbackStats?: () => ReturnType<ClothSimulation['getReadbackStats']>;
    __duelClothSettings?: () => Pick<
      ClothSimulationSettings,
      'selfCollision' | 'mannequinCollision' | 'gravity'
    >;
    __duelSettledShirtSurfaceReport?: () => Promise<{ vertex: ShirtSdfClearanceReport }>;
    __duelWaitForSettledShirts?: () => Promise<void>;
    __duelAuditStartupShirts?: () => Promise<import('./scenes/characterDuel/duelShirtStartupAudit.ts').DuelStartupShirtAudit>;
    __duelSimulateKey?: (code: string, phase: 'down' | 'up') => void;
    __duelAnimationFsmSnapshot?: (fighter?: 'A' | 'B') => import('./animations/CharacterAnimationStateMachine.ts').FsmSnapshot;
    __duelAnimationFsmForceState?: (state: string, fighter?: 'A' | 'B') => Promise<void>;
    __duelAnimationSubclipLibrary?: () => import('./animations/animationSubclip.ts').AnimationSubclipLibrary;
    __duelAnimationSetup?: () => Promise<import('./scenes/characterDuel/characterDuelAnimation.ts').CharacterDuelAnimationSetup>;
    __duelSaveAnimationSetup?: () => Promise<void>;
    __duelRedressShirts?: () => Promise<void>;
    __duelSetBonesVisible?: (fighter: 'A' | 'B', visible: boolean) => void;
    __duelGetBonesVisible?: (fighter: 'A' | 'B') => boolean;
    __duelMeasureRigForward?: (fighter?: 'A' | 'B') => {
      fighter: 'A' | 'B';
      fsmState: string;
      rootRotationY: number;
      forwardYawRad: number | null;
      forwardYawDeg: number | null;
      recommendedMeshBindYaw: number | null;
      profileMeshBindYaw: number;
      profileStanceYawOffset: number;
    };
    __duelApplyFacingFromAudit?: (fighter: 'A' | 'B', meshBindYaw: number, stanceYawOffset?: number) => void;
    __animationSubclipLibrary?: () => Promise<import('./animations/animationSubclip.ts').AnimationSubclipLibrary>;
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
  // Debug/test only: full vertex GPU readback — not used by the animation loop.
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

  wireClothCanvasInteraction({
    cloth: sim,
    onResetView: () => sim.resetFlag(),
  });

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

  const animationsBtn = document.createElement('button');
  animationsBtn.type = 'button';
  animationsBtn.id = 'animations-toggle-btn';
  animationsBtn.dataset.testid = 'animations-toggle-btn';
  animationsBtn.textContent = 'Animations';
  toolbar?.appendChild(animationsBtn);

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
  Object.assign(cloth.settings, applyMyPresetToCharacterCloth(cloth.settings));
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
  let garmentGenerateQueue = Promise.resolve<GarmentAssemblyStats>(garmentFlow.getStats());
  const characterDevMenu = registerCharacterDevMenu({
    cloth,
    rig,
    toolbar,
    initialGarmentPreset: garmentFlow.getActivePreset(),
    onGarmentGenerate: (preset) => {
      garmentGenerateQueue = garmentGenerateQueue.then(() => garmentFlow.loadPreset(preset)).catch((error: unknown) => {
        console.error(error);
        throw error;
      });
      return garmentGenerateQueue;
    },
    onGarmentFitDebugChange: (visible) => garmentFlow.setFitDebugVisible(visible),
  });
  const reloadCurrentCharacterGarment = (): Promise<GarmentAssemblyStats> => {
    garmentGenerateQueue = garmentGenerateQueue.then(() =>
      garmentFlow.loadPreset(characterDevMenu.garmentControls.getCurrentPreset()),
    ).catch((error: unknown) => {
      console.error(error);
      throw error;
    });
    return garmentGenerateQueue;
  };

  // --- Animation browser panel (toggled via toolbar button) ---
  // Ratings are saved to data/animationRatings.json via the dev server.
  type Rating = 'up' | 'down' | null;
  const ratings: Record<string, Rating> = {};
  // Load from disk on init
  try {
    const diskRatings = await fetch('/__animations/ratings').then((r) => r.json());
    Object.assign(ratings, diskRatings);
  } catch { /* no ratings yet */ }
  const saveRatings = () => {
    fetch('/__animations/ratings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ratings),
    }).catch(() => {});
  };
  const getRating = (file: string): Rating => ratings[file] ?? null;
  const setRating = (file: string, r: Rating) => { if (r) ratings[file] = r; else delete ratings[file]; saveRatings(); };

  const animPanel = document.createElement('div');
  animPanel.id = 'animation-panel';
  animPanel.style.cssText = `
    position: fixed; right: 0; top: 0; bottom: 0; width: 260px;
    background: rgba(14,18,27,0.94); color: #c8d6e5; overflow-y: auto;
    font-family: monospace; font-size: 12px; z-index: 200;
    border-left: 1px solid #2a3448; padding: 8px 0; display: none;
  `;

  const animTitle = document.createElement('div');
  animTitle.style.cssText = 'padding: 8px 12px; font-size: 13px; font-weight: bold; color: #fff; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  animTitle.textContent = `Animations (${Object.values(catalogJson.categories).flat().length})`;
  animPanel.appendChild(animTitle);

  const animNowPlaying = document.createElement('div');
  animNowPlaying.style.cssText = 'padding: 4px 12px; color: #5cc8ff; font-size: 11px; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  animNowPlaying.textContent = 'Now playing: T-Pose';
  animPanel.appendChild(animNowPlaying);

  // Filter bar: All / Liked / Disliked + Export
  let animFilter: 'all' | 'up' | 'down' = 'all';
  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'padding: 4px 12px 6px; display: flex; gap: 4px; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  const filterBtnStyle = (active: boolean) => `
    padding: 3px 8px; border: 1px solid ${active ? '#5cc8ff' : '#2a3448'}; border-radius: 3px;
    background: ${active ? 'rgba(92,200,255,0.15)' : 'none'}; color: ${active ? '#5cc8ff' : '#7f8fa6'};
    cursor: pointer; font-family: monospace; font-size: 10px;
  `;
  const filterAll = document.createElement('button');
  filterAll.textContent = 'All';
  filterAll.type = 'button';
  const filterLiked = document.createElement('button');
  filterLiked.textContent = 'Liked';
  filterLiked.type = 'button';
  const filterDisliked = document.createElement('button');
  filterDisliked.textContent = 'Disliked';
  filterDisliked.type = 'button';
  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Save';
  exportBtn.type = 'button';
  exportBtn.title = 'Save ratings to disk';
  filterBar.append(filterAll, filterLiked, filterDisliked, exportBtn);
  animPanel.appendChild(filterBar);

  const syncFilterButtons = () => {
    filterAll.style.cssText = filterBtnStyle(animFilter === 'all');
    filterLiked.style.cssText = filterBtnStyle(animFilter === 'up');
    filterDisliked.style.cssText = filterBtnStyle(animFilter === 'down');
    exportBtn.style.cssText = filterBtnStyle(false);
  };
  syncFilterButtons();

  const animSearch = document.createElement('input');
  animSearch.type = 'text';
  animSearch.placeholder = 'Search...';
  animSearch.style.cssText = `
    width: calc(100% - 24px); margin: 4px 12px 8px; padding: 5px 8px;
    background: #1a2030; border: 1px solid #2a3448; color: #c8d6e5;
    border-radius: 4px; font-family: monospace; font-size: 11px; outline: none;
  `;
  animPanel.appendChild(animSearch);

  let animActiveBtn: HTMLElement | null = null;
  const animRows: { row: HTMLElement; file: string; name: string }[] = [];
  const animSections: HTMLElement[] = [];

  for (const [category, anims] of Object.entries(catalogJson.categories)) {
    const section = document.createElement('div');
    section.dataset.category = category;
    const header = document.createElement('div');
    header.style.cssText = 'padding: 5px 12px; color: #7f8fa6; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; user-select: none;';
    header.textContent = `${category} (${(anims as any[]).length})`;
    const list = document.createElement('div');
    header.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
    });

    for (const anim of anims as any[]) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; padding: 2px 6px 2px 12px;';
      row.dataset.file = anim.file;
      row.dataset.animName = anim.name;

      // Play button (animation name)
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.textContent = anim.name;
      playBtn.style.cssText = `
        flex: 1; text-align: left; padding: 3px 6px; background: none; border: none;
        color: #c8d6e5; cursor: pointer; font-family: monospace; font-size: 11px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
      `;
      playBtn.addEventListener('mouseenter', () => { if (row !== animActiveBtn) row.style.background = 'rgba(92,200,255,0.06)'; });
      playBtn.addEventListener('mouseleave', () => { if (row !== animActiveBtn) row.style.background = 'none'; });
      playBtn.addEventListener('click', async () => {
        const url = `/assets/characters/${anim.file}`;
        animNowPlaying.textContent = `Loading: ${anim.name}...`;
        animNowPlaying.style.color = '#ffc048';
        if (animActiveBtn) { animActiveBtn.style.background = 'none'; animActiveBtn.querySelector('button')!.style.color = '#c8d6e5'; }
        row.style.background = 'rgba(92,200,255,0.12)';
        playBtn.style.color = '#5cc8ff';
        animActiveBtn = row;
        try {
          await rig.loadAndPlayAnimation(url, 0.5, anim.loop);
          animNowPlaying.textContent = `Now playing: ${anim.name}`;
          animNowPlaying.style.color = '#5cc8ff';
        } catch (e) {
          animNowPlaying.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
          animNowPlaying.style.color = '#ff4f4f';
        }
      });

      // Thumbs up
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.textContent = '+';
      upBtn.title = 'Like';
      const thumbStyle = (active: boolean, color: string) => `
        width: 22px; height: 22px; padding: 0; border: none; border-radius: 3px; cursor: pointer;
        font-size: 13px; line-height: 22px; text-align: center;
        background: ${active ? color : 'none'}; color: ${active ? '#fff' : '#555'};
      `;
      // Thumbs down
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.textContent = '-';
      downBtn.title = 'Dislike';

      const syncThumbs = () => {
        const r = getRating(anim.file);
        upBtn.style.cssText = thumbStyle(r === 'up', 'rgba(46,204,113,0.5)');
        downBtn.style.cssText = thumbStyle(r === 'down', 'rgba(231,76,60,0.5)');
      };
      syncThumbs();

      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRating(anim.file, getRating(anim.file) === 'up' ? null : 'up');
        syncThumbs();
        applyFilters();
      });
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setRating(anim.file, getRating(anim.file) === 'down' ? null : 'down');
        syncThumbs();
        applyFilters();
      });

      row.append(playBtn, upBtn, downBtn);
      list.appendChild(row);
      animRows.push({ row, file: anim.file, name: anim.name });
    }

    section.appendChild(header);
    section.appendChild(list);
    animPanel.appendChild(section);
    animSections.push(section);
  }

  const applyFilters = () => {
    const q = animSearch.value.toLowerCase();
    for (const sec of animSections) {
      let vis = 0;
      for (const { row, file, name } of animRows) {
        if (row.parentElement?.parentElement !== sec) continue;
        const nameMatch = !q || name.toLowerCase().includes(q);
        const r = getRating(file);
        const ratingMatch = animFilter === 'all' || (animFilter === 'up' && r === 'up') || (animFilter === 'down' && r === 'down');
        const show = nameMatch && ratingMatch;
        row.style.display = show ? 'flex' : 'none';
        if (show) vis++;
      }
      (sec as HTMLElement).style.display = vis > 0 || (!q && animFilter === 'all') ? 'block' : 'none';
    }
  };

  animSearch.addEventListener('input', applyFilters);
  filterAll.addEventListener('click', () => { animFilter = 'all'; syncFilterButtons(); applyFilters(); });
  filterLiked.addEventListener('click', () => { animFilter = animFilter === 'up' ? 'all' : 'up'; syncFilterButtons(); applyFilters(); });
  filterDisliked.addEventListener('click', () => { animFilter = animFilter === 'down' ? 'all' : 'down'; syncFilterButtons(); applyFilters(); });
  exportBtn.addEventListener('click', () => {
    saveRatings();
    exportBtn.textContent = 'Saved!';
    setTimeout(() => { exportBtn.textContent = 'Save'; }, 1500);
  });

  document.body.appendChild(animPanel);
  makeDraggable(animPanel, { handle: animTitle });

  let animPanelOpen = false;
  animationsBtn.addEventListener('click', () => {
    animPanelOpen = !animPanelOpen;
    animPanel.style.display = animPanelOpen ? 'block' : 'none';
    animationsBtn.classList.toggle('active', animPanelOpen);
  });

  window.__characterBreastPhysics = () => rig.getBreastPhysics().snapshot();
  window.__characterButtPhysics = () => rig.getButtPhysics().snapshot();
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
  window.__characterSlapButt = (side: 'left' | 'right' | 'both', strength = 3.0) => {
    const spreadSign = side === 'left' ? -1 : side === 'right' ? 1 : (Math.random() > 0.5 ? 1 : -1);
    rig.getButtPhysics().applyImpulse(side, spreadSign * strength * 0.8, strength * 0.4, strength * 0.3);
    if (side !== 'both') {
      const other = side === 'left' ? 'right' : 'left';
      rig.getButtPhysics().applyImpulse(other, spreadSign * strength * 0.25, strength * 0.15, strength * 0.1);
    }
  };
  window.__characterBreastMorphInfo = () => rig.getBreastMorphInfo();
  window.__characterButtMorphInfo = () => rig.getButtMorphInfo();
  window.__characterBlink = () => rig.eyeBlink.triggerBlink();
  window.__characterBlinkState = () => rig.eyeBlink.getBlinkAmount();
  window.__characterBlinkDebug = () => rig.getBlinkInfo();
  window.__characterSetManualClose = (value: number) => {
    rig.eyeBlink.config.manualClose = value;
  };
  window.__characterTestLoadAnimation = async (url: string) => {
    try {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const loader = new FBXLoader();
      const root = await loader.loadAsync(url);
      const clips = root.animations ?? [];
      if (clips.length === 0) return { ok: false, error: 'No animation clips' };
      const clip = clips[0]!;
      const quatTracks = clip.tracks.filter((t: { name: string }) => t.name.includes('quaternion'));
      return {
        ok: true,
        clipName: clip.name,
        duration: Math.round(clip.duration * 100) / 100,
        trackCount: clip.tracks.length,
        quaternionTracks: quatTracks.length,
      };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
  window.__characterStats = () => rig.getStats();
  window.__characterPhysicsPoseStats = () => rig.getPhysicsPoseStats();
  window.__characterPhysicsPoseConfig = () => rig.getPhysicsPoseConfig();
  window.__characterPhysicsPoseSnapDisplay = () => {
    rig.getPhysicsPoseRig().snapDisplayToTarget();
  };
  window.__characterBoneSdfs = () => rig.getBoneSdfSummary();
  window.__characterBoneSdfsForCloth = () => rig.getBoneSdfSummaryForCloth();
  window.__characterPatchSdfSquashConfig = (patch) => {
    rig.setSdfSquashConfig(patch);
    rig.resetSdfSquashState();
  };
  window.__characterSdfSquashReport = () => rig.getSdfSquashReport();
  window.__characterBoneSdfFitReport = () => rig.getBoneSdfFitReport();
  window.__characterBoneSdfMeshCoverageReport = () => rig.getBoneSdfMeshCoverageReport();
  window.__characterSdfPreset = () => rig.getCharacterSdfPreset();
  window.__characterSdfQualityReport = () => rig.getCharacterSdfFitReport();
  window.__characterPatchSdfGlobalRadiusScale = (scale: number) => {
    rig.patchCharacterSdfPreset({ globalRadiusScale: scale });
  };
  window.__characterSetSdfRuntimeScale = (scale: number) => {
    rig.setBoneSdfRadiusScale(scale);
  };
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
  window.__characterGarmentGetPreset = () => characterDevMenu.garmentControls.getCurrentPreset();
  window.__characterGarmentGenerate = async (garmentType, params, name) => {
    const preset = createGarmentPresetEnvelope(name ?? `Character ${garmentType}`, garmentType, params);
    await characterDevMenu.garmentControls.applyPreset(preset);
    return garmentFlow.getStats();
  };
  window.__characterClothStats = () => cloth.getStats();
  window.__characterIsShirtReadyForTest = () => {
    const character = rig.getStats();
    const garment = garmentFlow.getStats();
    const clothStats = cloth.getStats();
    const clothParticleCount = clothStats.particleCount;
    const garmentVertexCount = garment.vertexCount;
    const characterLoaded = character.loaded;
    const shirtSimSpawned = clothParticleCount >= 3_500 && garmentVertexCount >= 4_000;
    return {
      ready: characterLoaded
        && garment.garmentType === 'tshirt'
        && shirtSimSpawned
        && !clothStats.hasNaN,
      characterLoaded,
      garmentType: garment.garmentType,
      garmentVertexCount,
      clothParticleCount,
    };
  };
  window.__characterForceTposeForTest = () => {
    rig.setAnimationSpeed(0);
    rig.transitionToTpose(0);
    const physicsPose = rig.getPhysicsPoseRig();
    physicsPose.config.enabled = false;
    physicsPose.snapDisplayToTarget();
  };
  window.__characterWaitWallClockForTest = (seconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, seconds) * 1000);
  });
  window.__characterReadClothVertexPositionsForTest = async () => {
    const snapshot = await cloth.readGarmentVertexPositionsForTest(garmentFlow.getAssembly());
    return {
      ...snapshot,
      positions: snapshot.positions.map((p) => [...p] as [number, number, number]),
      presetSource: 'src/animations/my-preset.json',
    };
  };
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
    region: 'breast' | 'butt';
    point: THREE.Vector3;
    center: THREE.Vector3;
  } | null => {
    slapNdc.set(ndcX, ndcY);
    slapRaycaster.setFromCamera(slapNdc, cloth.camera);
    const ray = slapRaycaster.ray;

    let bestDist = SLAP_HIT_RADIUS;
    let bestSide: 'left' | 'right' | null = null;
    let bestRegion: 'breast' | 'butt' = 'breast';
    let bestCenter: THREE.Vector3 | null = null;

    const breastCenters = rig.getBreastWorldCenters();
    if (breastCenters) {
      for (const [side, center] of [['left', breastCenters.left], ['right', breastCenters.right]] as const) {
        const closest = new THREE.Vector3();
        ray.closestPointToPoint(center, closest);
        const dist = closest.distanceTo(center);
        if (dist < bestDist) {
          bestDist = dist;
          bestSide = side;
          bestRegion = 'breast';
          bestCenter = center;
        }
      }
    }

    const buttCenters = rig.getButtWorldCenters();
    if (buttCenters) {
      for (const [side, center] of [['left', buttCenters.left], ['right', buttCenters.right]] as const) {
        const closest = new THREE.Vector3();
        ray.closestPointToPoint(center, closest);
        const dist = closest.distanceTo(center);
        if (dist < bestDist) {
          bestDist = dist;
          bestSide = side;
          bestRegion = 'butt';
          bestCenter = center;
        }
      }
    }

    if (!bestSide || !bestCenter) return null;
    const hitPoint = new THREE.Vector3();
    ray.closestPointToPoint(bestCenter, hitPoint);
    return { side: bestSide, region: bestRegion, point: hitPoint, center: bestCenter };
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

    // Slap mode: swipe-velocity-based impact on breast or butt.
    if (slapMode) {
      const ndc = toNdc(event);
      const hit = slapHitTest(ndc.x, ndc.y);
      if (hit) {
        const targetPhysics = hit.region === 'butt' ? rig.getButtPhysics() : rig.getBreastPhysics();
        const swipe = getSlapSwipeVelocity();
        const swipeSpeed = Math.sqrt(swipe.vx * swipe.vx + swipe.vy * swipe.vy);

        // Impulse = base push + velocity-amplified directional hit.
        const impulseX = swipe.vx * SLAP_VELOCITY_SCALE + (hit.point.x - hit.center.x) * SLAP_BASE_STRENGTH;
        const impulseY = swipe.vy * SLAP_VELOCITY_SCALE + (hit.point.y - hit.center.y) * SLAP_BASE_STRENGTH;
        const impulseZ = hit.region === 'butt'
          ? (SLAP_BASE_STRENGTH + swipeSpeed * SLAP_FORWARD_PUSH) * 0.3
          : -(SLAP_BASE_STRENGTH + swipeSpeed * SLAP_FORWARD_PUSH);

        targetPhysics.applyImpulse(hit.side, impulseX, impulseY, impulseZ);
        characterReproRecorder.recordAction('slap-hit', {
          side: hit.side,
          region: hit.region,
          impulse: [impulseX, impulseY, impulseZ],
          swipeSpeed,
        });

        // Give the opposite side a smaller sympathetic jiggle.
        const otherSide = hit.side === 'left' ? 'right' : 'left';
        targetPhysics.applyImpulse(otherSide, impulseX * 0.3, impulseY * 0.3, impulseZ * 0.25);
      }
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

async function bootstrapAnimationBrowser(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) heading.textContent = 'Animation Browser';

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) resetBtn.textContent = 'Reset view';

  // Hide shoot button, repurpose grab
  const shootBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  if (shootBtn) shootBtn.style.display = 'none';
  const grabBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  if (grabBtn) grabBtn.style.display = 'none';

  // Create cloth sim (for the scene/renderer)
  const cloth = await createClothSimulation(
    { container: document.body, statusEl, backendEl, particlesEl },
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
    windStrength: 0, windTurbulence: 0, zoneAStrength: 0, zoneBStrength: 0,
    gravity: 0.000025, clothThickness: 0.003, selfCollision: false,
    poleCollision: false, mannequinCollision: false, showMannequin: false,
    renderStrandThreads: false, showSimGridDebug: false, tearStretchThreshold: 999,
    shapePressure: 0, flagColor: '#ff4fa3', fabricTextureSource: 'procedural',
  });
  cloth.applySettings();
  await cloth.init();

  const rig = new AnimatedCharacterSceneRig(cloth.scene);
  await rig.load();
  cloth.settings.mannequinCollision = false;
  cloth.applySettings();

  cloth.setGrabModeEnabled(false);
  cloth.setShootModeEnabled(false);
  cloth.camera.position.set(0, 0.95, 2.6);
  cloth.controls.target.set(0, 0.9, 0);
  cloth.controls.update();

  statusEl.textContent = 'running (animation browser)';
  backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name}`;
  particlesEl.textContent = `animations: ${Object.values(catalogJson.categories).flat().length}`;

  // --- Build animation list panel ---
  const panel = document.createElement('div');
  panel.id = 'animation-panel';
  panel.style.cssText = `
    position: fixed; left: 0; top: 0; bottom: 0; width: 280px;
    background: rgba(14,18,27,0.92); color: #c8d6e5; overflow-y: auto;
    font-family: monospace; font-size: 12px; z-index: 100;
    border-right: 1px solid #2a3448; padding: 8px 0;
  `;

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'padding: 8px 12px; font-size: 14px; font-weight: bold; color: #fff; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  titleEl.textContent = `Animations (${Object.values(catalogJson.categories).flat().length})`;
  panel.appendChild(titleEl);

  // Now playing indicator
  const nowPlaying = document.createElement('div');
  nowPlaying.style.cssText = 'padding: 4px 12px; color: #5cc8ff; font-size: 11px; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  nowPlaying.textContent = 'Now playing: Idle';
  panel.appendChild(nowPlaying);

  // Search box
  const searchBox = document.createElement('input');
  searchBox.type = 'text';
  searchBox.placeholder = 'Search animations...';
  searchBox.style.cssText = `
    width: calc(100% - 24px); margin: 4px 12px 8px; padding: 6px 8px;
    background: #1a2030; border: 1px solid #2a3448; color: #c8d6e5;
    border-radius: 4px; font-family: monospace; font-size: 12px; outline: none;
  `;
  panel.appendChild(searchBox);

  const editClipRow = document.createElement('div');
  editClipRow.style.cssText = 'padding: 0 12px 8px; border-bottom: 1px solid #2a3448; margin-bottom: 4px;';
  const editClipBtn = document.createElement('button');
  editClipBtn.type = 'button';
  editClipBtn.textContent = 'Edit clip…';
  editClipBtn.dataset.testid = 'animation-browser-edit-clip';
  editClipBtn.style.cssText = `
    width: 100%; padding: 6px 8px; background: #1a2436; border: 1px solid #2a3448;
    color: #c8d6e5; border-radius: 4px; cursor: pointer; font-family: monospace; font-size: 12px;
  `;
  editClipRow.appendChild(editClipBtn);
  panel.appendChild(editClipRow);

  // Category sections
  const categoryEls: HTMLElement[] = [];
  let activeButton: HTMLButtonElement | null = null;

  for (const [category, anims] of Object.entries(catalogJson.categories)) {
    const section = document.createElement('div');
    section.dataset.category = category;

    const header = document.createElement('div');
    header.style.cssText = 'padding: 6px 12px; color: #7f8fa6; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; user-select: none;';
    header.textContent = `${category} (${anims.length})`;
    const list = document.createElement('div');
    list.style.cssText = 'display: block;';

    header.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
      header.style.color = list.style.display === 'none' ? '#7f8fa6' : '#5cc8ff';
    });

    for (const anim of anims) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = anim.name;
      btn.title = anim.file;
      btn.dataset.file = anim.file;
      btn.dataset.animName = anim.name;
      btn.dataset.loop = String(anim.loop);
      btn.style.cssText = `
        display: block; width: 100%; text-align: left; padding: 5px 12px 5px 20px;
        background: none; border: none; color: #c8d6e5; cursor: pointer;
        font-family: monospace; font-size: 12px; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      `;
      btn.addEventListener('mouseenter', () => {
        if (btn !== activeButton) btn.style.background = 'rgba(92,200,255,0.08)';
      });
      btn.addEventListener('mouseleave', () => {
        if (btn !== activeButton) btn.style.background = 'none';
      });
      btn.addEventListener('click', async () => {
        const file = btn.dataset.file!;
        selectedSourceFile = file;
        const loop = btn.dataset.loop === 'true';
        const url = `/assets/characters/${file}`;
        nowPlaying.textContent = `Loading: ${anim.name}...`;
        nowPlaying.style.color = '#ffc048';

        if (activeButton) {
          activeButton.style.background = 'none';
          activeButton.style.color = '#c8d6e5';
        }
        btn.style.background = 'rgba(92,200,255,0.15)';
        btn.style.color = '#5cc8ff';
        activeButton = btn;

        try {
          const clipName = await rig.loadAndPlayAnimation(url, 0.5, loop);
          nowPlaying.textContent = `Now playing: ${anim.name}`;
          nowPlaying.style.color = '#5cc8ff';
        } catch (e) {
          nowPlaying.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
          nowPlaying.style.color = '#ff4f4f';
        }
      });
      list.appendChild(btn);
    }

    section.appendChild(header);
    section.appendChild(list);
    panel.appendChild(section);
    categoryEls.push(section);
  }

  // Search filter
  searchBox.addEventListener('input', () => {
    const query = searchBox.value.toLowerCase();
    for (const section of categoryEls) {
      const buttons = section.querySelectorAll('button');
      let visibleCount = 0;
      buttons.forEach((btn) => {
        const name = btn.dataset.animName?.toLowerCase() ?? '';
        const match = !query || name.includes(query);
        (btn as HTMLElement).style.display = match ? 'block' : 'none';
        if (match) visibleCount++;
      });
      // Hide entire category if no matches
      (section as HTMLElement).style.display = visibleCount > 0 || !query ? 'block' : 'none';
    }
  });

  document.body.appendChild(panel);
  makeDraggable(panel, { handle: titleEl });

  let selectedSourceFile: string | null = 'mixamo/idle.fbx';

  const { createAnimationClipEditorPopup } = await import('./animations/clipEditor/index.ts');
  const { refreshSubclipLibraryFromServer } = await import('./animations/animationSubclip.ts');
  await refreshSubclipLibraryFromServer();

  const clipEditorTarget = () => ({
    label: 'Animation Browser',
    getMixer: () => rig.getMixer(),
    getLoadedRoot: () => rig.getLoadedRoot(),
    getBones: () => rig.getBones(),
    getSourceFile: () => selectedSourceFile,
    setSourceFile: (file: string) => {
      selectedSourceFile = file;
    },
  });

  const clipEditorPopup = createAnimationClipEditorPopup({
    testId: 'animation-clip-editor-popup',
    onLibraryChanged: () => refreshSubclipLibraryFromServer(),
  });

  editClipBtn.addEventListener('click', () => {
    clipEditorPopup.open({ target: clipEditorTarget });
  });

  window.__animationSubclipLibrary = async () => {
    await refreshSubclipLibraryFromServer();
    const { getSubclipLibrary } = await import('./animations/animationSubclip.ts');
    return getSubclipLibrary();
  };

  // Shift the canvas to make room for the panel
  const canvas = cloth.renderer.domElement;
  canvas.style.marginLeft = '280px';
  canvas.style.width = 'calc(100% - 280px)';
  cloth.resize();

  resetBtn?.addEventListener('click', () => cloth.controls.reset());

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

function syncCharacterBoneSdfsToGpu(cloth: ClothSimulation, rig: AnimatedCharacterSceneRig): void {
  cloth.setBoneSdfCapsules(rig.getBoneSdfSummaryForCloth());
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

  if (mode === 'character-duel') {
    await bootstrapCharacterDuel(statusEl, backendEl, particlesEl);
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

  if (mode === 'animations') {
    await bootstrapAnimationBrowser(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'cloth-cube') {
    await bootstrapClothRenderTest(statusEl, backendEl, particlesEl);
    return;
  }

  if (mode === 'multi-material') {
    await bootstrapMultiMaterialTest(statusEl, backendEl, particlesEl);
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
