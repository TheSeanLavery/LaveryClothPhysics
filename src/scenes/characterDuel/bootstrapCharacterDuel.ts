import {
  createClothControls,
  createClothSimulation,
  type ClothSimulation,
} from '../../cloth';
import {
  addDuelArena,
  CharacterDuelScene,
  type CharacterDuelStats,
} from './CharacterDuelScene.ts';
import { createAnimationClipEditorPanel } from '../../animations/clipEditor/index.ts';
import { createAnimationFsmPanel } from '../../animations/fsm/index.ts';
import { getSubclipLibrary, refreshSubclipLibraryFromServer } from '../../animations/animationSubclip.ts';
import { CHARACTER_DUEL_CONFIG, type DuelControlMode } from './characterDuelConfig.ts';

export async function bootstrapCharacterDuel(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Character Duel';
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

  const controlParam = new URLSearchParams(window.location.search).get('control');
  const initialControl: DuelControlMode = controlParam === 'ai' ? 'ai-ai' : 'pvp';

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
    gravity: CHARACTER_DUEL_CONFIG.cloth.gravity,
    clothThickness: CHARACTER_DUEL_CONFIG.cloth.clothThickness,
    selfCollision: CHARACTER_DUEL_CONFIG.cloth.selfCollision,
    poleCollision: false,
    mannequinCollision: CHARACTER_DUEL_CONFIG.cloth.mannequinCollision,
    showMannequin: false,
    renderStrandThreads: false,
    showSimGridDebug: false,
    grabStiffness: 0.12,
    grabMaxStep: 0.002,
    grabVelocityCarry: 0,
    grabPointerMaxStep: 0.005,
    tearStretchThreshold: CHARACTER_DUEL_CONFIG.cloth.tearStretchThreshold,
    shapePressure: 0,
    flagColor: '#4fa3ff',
    fabricTextureSource: 'procedural',
    mannequinFriction: 0.85,
  });
  cloth.applySettings();
  await cloth.init();

  addDuelArena(cloth.scene);
  const duel = new CharacterDuelScene(cloth, CHARACTER_DUEL_CONFIG.cloth.tearStretchThreshold);
  duel.setControlMode(initialControl);

  statusEl.textContent = 'loading (character duel)';
  await duel.load();
  duel.startFighting();

  cloth.setSimGridDebugVisible(false);
  cloth.setGrabModeEnabled(false);
  cloth.setShootModeEnabled(false);
  cloth.camera.position.set(0, 1.05, 5.2);
  cloth.controls.target.set(0, 0.95, 0);
  cloth.controls.update();

  createClothControls(cloth, {
    title: 'Character Duel Cloth',
    testId: 'duel-controls',
    collisionUi: 'boneSdf',
  });

  await refreshSubclipLibraryFromServer();

  let clipEditor!: ReturnType<typeof createAnimationClipEditorPanel>;

  const fsmPanel = createAnimationFsmPanel({
    testId: 'duel-animation-fsm-panel',
    targets: [
      { label: 'Fighter A', controller: duel.controllerA },
      { label: 'Fighter B', controller: duel.controllerB },
    ],
    onTargetChange: () => clipEditor.refresh(),
  });

  clipEditor = createAnimationClipEditorPanel({
    testId: 'duel-animation-clip-editor',
    target: fsmPanel.getActiveClipEditorTarget(),
    onLibraryChanged: () => {
      void refreshSubclipLibraryFromServer();
      clipEditor.refresh();
    },
  });
  clipEditor.element.style.position = 'fixed';
  clipEditor.element.style.top = '12px';
  clipEditor.element.style.right = '400px';
  clipEditor.element.style.width = 'min(340px, calc(100vw - 420px))';
  clipEditor.element.style.zIndex = '119';

  const onKeyDown = (event: KeyboardEvent): void => {
    duel.handleKeyDown(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    duel.handleKeyUp(event.code);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const updateStatus = (sim: ClothSimulation): void => {
    const stats = duel.getStats();
    statusEl.textContent = `running (character duel · ${stats.controlMode})`;
    backendEl.textContent = `backend: ${sim.renderer.backend.constructor.name} (duel cloth)`;
    particlesEl.textContent = `duel particles: ${stats.particleCount} · vertices: ${stats.vertexCount}`;
  };

  window.__duelStats = () => duel.getStats();
  window.__duelSetControlMode = (mode: DuelControlMode) => duel.setControlMode(mode);
  window.__duelGetControlMode = () => duel.getControlMode();
  window.__duelFighterAPosition = () => duel.getStats().positionA;
  window.__duelFighterBPosition = () => duel.getStats().positionB;
  window.__duelClothStats = () => cloth.getStats();
  window.__duelClothSettings = () => ({
    selfCollision: cloth.settings.selfCollision,
    mannequinCollision: cloth.settings.mannequinCollision,
    gravity: cloth.settings.gravity,
  });
  window.__duelSettledShirtSurfaceReport = () => duel.getSettledShirtSurfaceReport();
  window.__duelAnimationFsmSnapshot = (fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.fsm.getSnapshot();
  };
  window.__duelAnimationSubclipLibrary = () => getSubclipLibrary();
  window.__duelAnimationFsmForceState = (state: string, fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.fsm.forceState(state as 'tpose' | 'idle' | 'walk' | 'attack');
  };

  window.__duelSimulateKey = (code: string, phase: 'down' | 'up') => {
    if (phase === 'down') {
      duel.handleKeyDown(code);
    } else {
      duel.handleKeyUp(code);
    }
  };

  let last = performance.now();
  const tick = (now: number): void => {
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    duel.update(delta);
    cloth.update(delta);
    cloth.render();
    updateStatus(cloth);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  updateStatus(cloth);
}

export type { CharacterDuelStats };
