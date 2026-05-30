import WebGPU from 'three/addons/capabilities/WebGPU.js';
import * as THREE from 'three/webgpu';
import {
  cloneClothSettings,
  createClothControls,
  createClothSimulation,
  createOctagonalTubeAssembly,
  createPyramidAssembly,
  createStitchedBoxAssembly,
  createTShirtAssembly,
  deleteFlagSettingsPreset,
  getFlagSettingsPreset,
  listFlagSettingsPresets,
  normalizeClothSettings,
  saveFlagSettingsPreset,
  type ClothAssembly,
  type ClothSimulation,
  type ClothSimulationSettings,
  type FlagSettingsPresetSummary,
  type StoredFlagSettingsPreset,
} from './cloth';
import { FabricPlanePreview, createFabricPlaneControls } from './debug/FabricPlanePreview';
import {
  ZeroGravityGarmentSandbox,
  createZeroGravityGarmentControls,
  type GarmentSpawnType,
} from './debug/ZeroGravityGarmentSandbox';
import { getFabricNormalMapStatsForTest } from './textures/createFabricNormalMap';

function isFabricPlaneMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'plane';
}

function isGarmentSandboxMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'garments';
}

function isTubeMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'tube';
}

type TubeAssemblySpawnKind = 'box' | 'octagonalTube' | 'pyramid' | 'tshirt';

declare global {
  interface Window {
    __zeroGravityTubeSpawnShape?: (kind: TubeAssemblySpawnKind) => Promise<number>;
    __zeroGravityTubeClearSpawnedShapes?: () => Promise<void>;
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

  let bbVisualSyncBusy = false;
  sim.renderer.setAnimationLoop(async () => {
    if (bbVisualSyncBusy) {
      sim.update();
      sim.render();
      return;
    }

    bbVisualSyncBusy = true;
    try {
      sim.update();
      await sim.refreshBbVisualsFromGpu();
      sim.render();
    } finally {
      bbVisualSyncBusy = false;
    }
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

async function bootstrapGarmentSandbox(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Zero-G Clothing Sandbox';
  }

  const resetBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');
  if (resetBtn) {
    resetBtn.textContent = 'Reset set';
  }

  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  if (grabToggleBtn) {
    grabToggleBtn.textContent = 'Spawn';
  }

  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  if (shootToggleBtn) {
    shootToggleBtn.textContent = 'Clear';
  }

  const sandbox = new ZeroGravityGarmentSandbox(document.body, statusEl, backendEl, particlesEl);
  await sandbox.init();
  createZeroGravityGarmentControls(sandbox);

  window.__garmentSandboxSpawn = (type?: GarmentSpawnType) => sandbox.spawnGarment(type);
  window.__garmentSandboxClear = () => sandbox.clearGarments();
  window.__garmentSandboxReset = () => sandbox.resetStarterSet();

  grabToggleBtn?.addEventListener('click', () => sandbox.spawnGarment());
  shootToggleBtn?.addEventListener('click', () => sandbox.clearGarments());
  resetBtn?.addEventListener('click', () => sandbox.resetStarterSet());

  window.addEventListener('resize', () => sandbox.resize());

  sandbox.renderer.setAnimationLoop(() => {
    sandbox.render();
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
      mannequinCollision: cloth.settings.mannequinCollision,
    };
  };
  window.__zeroGravityTubeReset = () => cloth.resetFlag();
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
  let bbVisualSyncBusy = false;
  cloth.renderer.setAnimationLoop(async () => {
    if (bbVisualSyncBusy) {
      cloth.update();
      cloth.render();
      return;
    }

    bbVisualSyncBusy = true;
    try {
      cloth.update();
      await cloth.refreshBbVisualsFromGpu();
      cloth.render();
    } finally {
      bbVisualSyncBusy = false;
    }
  });
}

function measureTShirtSleeves(assembly: ClothAssembly): {
  crossSectionHeight: number;
  crossSectionDepth: number;
  cuffDrop: number;
  vertexCount: number;
} {
  const sleeveVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('sleeve'));
  const ys = sleeveVertices.map((vertex) => vertex.position[1]);
  const zs = sleeveVertices.map((vertex) => vertex.position[2]);
  const sleeveStats = ['tshirt-left-sleeve', 'tshirt-right-sleeve'].map((patchId) => {
    const vertices = assembly.vertices.filter((vertex) => vertex.patchId === patchId);
    const xs = vertices.map((vertex) => vertex.position[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const isLeft = patchId.includes('left');
    const span = Math.max(0.0001, maxX - minX);
    const cuff = vertices.filter((vertex) =>
      isLeft ? vertex.position[0] < minX + span * 0.12 : vertex.position[0] > maxX - span * 0.12,
    );
    const inner = vertices.filter((vertex) =>
      isLeft ? vertex.position[0] > maxX - span * 0.12 : vertex.position[0] < minX + span * 0.12,
    );
    const averageY = (items: typeof vertices): number =>
      items.reduce((sum, vertex) => sum + vertex.position[1], 0) / Math.max(1, items.length);
    return averageY(inner) - averageY(cuff);
  });

  return {
    crossSectionHeight: Math.max(...ys) - Math.min(...ys),
    crossSectionDepth: Math.max(...zs) - Math.min(...zs),
    cuffDrop: Math.min(...sleeveStats),
    vertexCount: sleeveVertices.length,
  };
}

function createTubePageAssembly(kind: TubeAssemblySpawnKind): ClothAssembly {
  switch (kind) {
    case 'box':
      return createStitchedBoxAssembly({ width: 0.7, height: 0.7, depth: 0.7, segments: 12 });
    case 'octagonalTube':
      return createOctagonalTubeAssembly({ radius: 0.38, height: 0.9, segmentsAround: 4, segmentsHeight: 12 });
    case 'pyramid':
      return createPyramidAssembly({ baseSize: 0.9, height: 0.8, includeBase: true });
    case 'tshirt':
      return createTShirtAssembly({
        bodyWidth: 0.78,
        torsoHeight: 0.86,
        sleeveLength: 0.38,
        sleeveOpening: 0.34,
        sleeveTubeRadius: 0.12,
        depth: 0.32,
        bodySegmentsX: 24,
        bodySegmentsY: 28,
        sleeveSegmentsX: 16,
      });
  }
}

async function bootstrap(): Promise<void> {
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

  if (isFabricPlaneMode()) {
    await bootstrapFabricPlane(statusEl, backendEl, particlesEl);
    return;
  }

  if (isGarmentSandboxMode()) {
    await bootstrapGarmentSandbox(statusEl, backendEl, particlesEl);
    return;
  }

  if (isTubeMode()) {
    await bootstrapZeroGravityTube(statusEl, backendEl, particlesEl);
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
