import WebGPU from 'three/addons/capabilities/WebGPU.js';
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
  createClothControls(cloth, { title: 'GPU Cloth Tube', testId: 'tube-controls' });

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
    return {
      particleCount: stats.particleCount,
      triangleCount: cloth.clothGeometry.index ? cloth.clothGeometry.index.count / 3 : 0,
      projectileCount: activeBbCount(),
      grabMode: cloth.isGrabModeOn(),
      shootMode: cloth.isShootModeOn(),
      centerY: stats.centerY,
      minY: stats.minY,
      maxY: stats.maxY,
      maxParticleSpeed: 0,
      hasNaN: stats.hasNaN,
      gravity: cloth.settings.gravity,
      pressure: 0,
    };
  };
  window.__zeroGravityTubeReset = () => cloth.resetFlag();
  window.__zeroGravityTubeSetGrab = (enabled) => cloth.setGrabModeEnabled(enabled);
  window.__zeroGravityTubeSetShoot = (enabled) => cloth.setShootModeEnabled(enabled);
  window.__zeroGravityTubeSetGravity = (gravity) => {
    cloth.settings.gravity = gravity;
    cloth.applySettings();
  };
  window.__zeroGravityTubeFire = (ndcX, ndcY) => cloth.fireBbForTest(ndcX, ndcY) !== null;

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

  canvas.addEventListener('pointermove', updateMouseNdc);
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
