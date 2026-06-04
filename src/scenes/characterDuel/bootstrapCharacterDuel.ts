import {
  createClothSimulation,
  type ClothSimulation,
} from '../../cloth';
import {
  addDuelArena,
  CharacterDuelScene,
  type CharacterDuelStats,
} from './CharacterDuelScene.ts';
import { createAnimationClipEditorPopup } from '../../animations/clipEditor/index.ts';
import { createAnimationFsmPanel } from '../../animations/fsm/index.ts';
import { getSubclipLibrary, refreshSubclipLibraryFromServer } from '../../animations/animationSubclip.ts';
import {
  buildCharacterDuelAnimationSetup,
  getCharacterDuelAnimationSetup,
  refreshCharacterDuelAnimationFromServer,
  saveCharacterDuelAnimationSetup,
} from './characterDuelAnimation.ts';
import { auditDuelStartupShirtsWithSim } from './duelShirtStartupAudit.ts';
import {
  CHARACTER_DUEL_CONFIG,
  DUEL_CAMERA,
  type DuelControlMode,
} from './characterDuelConfig.ts';
import { resolveProfileFacingParameters } from '../../animations/characterAnimationProfile.ts';
import {
  auditFacingSuite,
  type FacingAlignmentSample,
} from '../../character/facingAlignmentAudit.ts';
import {
  auditFacingTurn,
  type FacingSample,
  type FacingTurnVerdict,
} from '../../character/facingTurnAudit.ts';
import {
  meshBindYawFromMeasuredForward,
} from '../../character/rigForwardMeasure.ts';
import { createDuelFloatingControls } from './duelFloatingControls.ts';
import { createDuelHealthBars } from './duelHealthBars.ts';

export async function bootstrapCharacterDuel(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<void> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Character Duel';
  }

  const duelHint = document.createElement('p');
  duelHint.dataset.testid = 'duel-controls-hint';
  duelHint.textContent =
    'A: WASD+Space · B: Arrows+Enter · M: AI · Green=look intent · Orange=mesh facing · Console: __duelFacingDebug("A").meshAlignErrorDeg';
  document.querySelector('#overlay')?.append(duelHint);

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

  const toolbar = document.querySelector<HTMLElement>('#toolbar');
  if (toolbar) {
    toolbar.style.display = 'flex';
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
  cloth.clothMesh.visible = false;
  cloth.camera.position.set(...DUEL_CAMERA.position);
  cloth.controls.target.set(...DUEL_CAMERA.target);
  cloth.controls.update();

  addDuelArena(cloth.scene);
  const duel = new CharacterDuelScene(cloth, CHARACTER_DUEL_CONFIG.cloth.tearStretchThreshold);
  duel.setControlMode(initialControl);

  await Promise.all([
    refreshSubclipLibraryFromServer(),
    refreshCharacterDuelAnimationFromServer(),
  ]);
  const duelSetup = getCharacterDuelAnimationSetup();

  statusEl.textContent = 'loading (character duel)';

  let last = performance.now();
  let bootTickActive = true;
  const bootTick = (now: number): void => {
    if (!bootTickActive) {
      return;
    }
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    duel.update(delta);
    cloth.render();
    requestAnimationFrame(bootTick);
  };
  requestAnimationFrame(bootTick);

  await duel.load({ setup: duelSetup });
  bootTickActive = false;

  duel.startFighting();

  const updateStatus = (sim: ClothSimulation): void => {
    const stats = duel.getStats();
    statusEl.textContent = `running (character duel · ${stats.controlMode})`;
    backendEl.textContent = `backend: ${sim.renderer.backend.constructor.name} (duel cloth)`;
    particlesEl.textContent = `duel particles: ${stats.particleCount} · vertices: ${stats.vertexCount}`;
  };
  updateStatus(cloth);

  duel.rigA.setXrayVisible(false);
  duel.rigB.setXrayVisible(false);

  let bonesVisibleA = false;
  let bonesVisibleB = false;

  const bonesABtn = document.createElement('button');
  bonesABtn.type = 'button';
  bonesABtn.id = 'duel-bones-a-btn';
  bonesABtn.dataset.testid = 'duel-bones-a-btn';
  bonesABtn.textContent = 'Bones A';
  toolbar?.append(bonesABtn);

  const bonesBBtn = document.createElement('button');
  bonesBBtn.type = 'button';
  bonesBBtn.id = 'duel-bones-b-btn';
  bonesBBtn.dataset.testid = 'duel-bones-b-btn';
  bonesBBtn.textContent = 'Bones B';
  toolbar?.append(bonesBBtn);

  bonesABtn.addEventListener('click', () => {
    bonesVisibleA = !bonesVisibleA;
    duel.rigA.setXrayVisible(bonesVisibleA);
    bonesABtn.classList.toggle('active', bonesVisibleA);
  });
  bonesBBtn.addEventListener('click', () => {
    bonesVisibleB = !bonesVisibleB;
    duel.rigB.setXrayVisible(bonesVisibleB);
    bonesBBtn.classList.toggle('active', bonesVisibleB);
  });

  const facingBtn = document.createElement('button');
  facingBtn.type = 'button';
  facingBtn.id = 'duel-facing-debug-btn';
  facingBtn.dataset.testid = 'duel-facing-debug-btn';
  facingBtn.textContent = 'Facing arrows';
  facingBtn.classList.add('active');
  toolbar?.append(facingBtn);
  facingBtn.addEventListener('click', () => {
    duel.setFacingDebugVisible(!duel.facingDebugVisible);
    facingBtn.classList.toggle('active', duel.facingDebugVisible);
  });

  cloth.setSimGridDebugVisible(false);
  cloth.setGrabModeEnabled(false);
  cloth.setShootModeEnabled(false);

  createDuelFloatingControls({ cloth, duel, toolbar });
  const healthBars = createDuelHealthBars();

  async function persistDuelAnimationSetup(): Promise<void> {
    const setup = buildCharacterDuelAnimationSetup(
      duel.controllerA.getProfile(),
      duel.controllerB.getProfile(),
    );
    await saveCharacterDuelAnimationSetup(setup);
  }

  async function afterClipLibraryChanged(): Promise<void> {
    await refreshSubclipLibraryFromServer();
    await Promise.all([
      duel.controllerA.fsm.preload(),
      duel.controllerB.fsm.preload(),
    ]);
    fsmPanel.refresh();
  }

  const clipEditorPopup = createAnimationClipEditorPopup({
    testId: 'duel-animation-clip-editor-popup',
    onLibraryChanged: () => {
      void afterClipLibraryChanged();
    },
  });

  const fsmPanel = createAnimationFsmPanel({
    testId: 'duel-animation-fsm-panel',
    targets: [
      { label: 'Fighter A', controller: duel.controllerA },
      { label: 'Fighter B', controller: duel.controllerB },
    ],
    onTargetChange: () => {
      if (clipEditorPopup.isOpen()) {
        clipEditorPopup.close();
      }
    },
    onDuelSetupPersist: persistDuelAnimationSetup,
    openClipEditor: (openOptions) => clipEditorPopup.open(openOptions),
  });

  const DUEL_GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Enter', 'KeyM',
  ]);

  const isTypingTarget = (target: EventTarget | null): boolean => (
    target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!DUEL_GAME_KEYS.has(event.code)) {
      return;
    }
    if (isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    duel.handleKeyDown(event.code);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!DUEL_GAME_KEYS.has(event.code)) {
      return;
    }
    if (isTypingTarget(event.target)) {
      return;
    }
    event.preventDefault();
    duel.handleKeyUp(event.code);
  };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  window.__duelStats = () => duel.getStats();
  window.__duelShirtHealth = () => duel.getShirtHealth();
  window.__duelShirtHealthDebug = () => duel.getShirtHealthDebug();
  window.__duelFacingDebug = (fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.getFacingDebug();
  };

  window.__duelAuditFacingTurn = async (options: {
    fighter?: 'A' | 'B';
    key: string;
    expectedIntentMeshYawRad: number;
    durationMs?: number;
    sampleIntervalMs?: number;
    maxTurnErrorRad?: number;
    maxTotalTurnRad?: number;
  }): Promise<{
    samples: FacingSample[];
    verdict: FacingTurnVerdict;
  }> => {
    const fighter = options.fighter ?? 'A';
    const durationMs = options.durationMs ?? 1_200;
    const sampleIntervalMs = options.sampleIntervalMs ?? 50;
    const read = (): FacingAlignmentSample => readFacingAlignmentSample(fighter);
    const samples: FacingSample[] = [read()];
    duel.handleKeyDown(options.key);
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
      samples.push({ ...read(), tMs: performance.now() - start });
    }
    duel.handleKeyUp(options.key);
    const verdict = auditFacingTurn(samples, options.expectedIntentMeshYawRad, {
      maxTurnErrorRad: options.maxTurnErrorRad,
      maxTotalTurnRad: options.maxTotalTurnRad,
    });
    return { samples, verdict };
  };

  const readFacingAlignmentSample = (fighter: 'A' | 'B'): FacingAlignmentSample => {
    const d = (fighter === 'B' ? duel.controllerB : duel.controllerA).getFacingDebug();
    return {
      tMs: 0,
      yawRad: d.actualYaw,
      desiredYawRad: d.desiredYaw,
      intentMeshYawRad: d.intentMeshYaw,
      mode: d.mode,
      meshForwardYawRad: d.meshForwardYaw,
      meshAlignErrorDeg: d.meshAlignErrorDeg,
    };
  };

  window.__duelAuditFacingSuite = async (options: {
    fighter?: 'A' | 'B';
    walkKey: string;
    expectedWalkIntentMeshYawRad: number;
    idleSettleMs?: number;
    walkDurationMs?: number;
    sampleIntervalMs?: number;
  }) => {
    const fighter = options.fighter ?? 'A';
    const idleSettleMs = options.idleSettleMs ?? 600;
    const walkDurationMs = options.walkDurationMs ?? 1_600;
    const sampleIntervalMs = options.sampleIntervalMs ?? 40;

    const idleSamples: FacingAlignmentSample[] = [];
    const idleStart = performance.now();
    while (performance.now() - idleStart < idleSettleMs) {
      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
      idleSamples.push({ ...readFacingAlignmentSample(fighter), tMs: performance.now() - idleStart });
    }

    const walkSamples: FacingAlignmentSample[] = [readFacingAlignmentSample(fighter)];
    duel.handleKeyDown(options.walkKey);
    const walkStart = performance.now();
    while (performance.now() - walkStart < walkDurationMs) {
      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
      walkSamples.push({ ...readFacingAlignmentSample(fighter), tMs: performance.now() - walkStart });
    }
    duel.handleKeyUp(options.walkKey);

    const verdict = auditFacingSuite({
      idleSamples,
      walkSamples,
      expectedWalkIntentMeshYawRad: options.expectedWalkIntentMeshYawRad,
      idleMaxAlignErrorDeg: 25,
      walkMaxAlignErrorDeg: 32,
      turnOptions: {
        maxTurnErrorRad: 0.55,
        maxTotalTurnRad: Math.PI + 0.25,
        maxSignFlips: 2,
      },
    });
    return { idleSamples, walkSamples, verdict };
  };

  window.__duelSetFacingDebugVisible = (visible: boolean) => {
    duel.setFacingDebugVisible(visible);
  };
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
  window.__duelWaitForSettledShirts = () => duel.waitForMergedShirtSimSettle();
  window.__duelRunRigDressSequence = (fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.prepareRigForGarmentDress();
  };
  window.__duelIsRigDressReady = (fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.isRigDressReady();
  };
  window.__duelAuditStartupShirts = () => auditDuelStartupShirtsWithSim(duel, {
    expectedSeparationX: CHARACTER_DUEL_CONFIG.spawnSeparation,
  });
  window.__duelAnimationFsmSnapshot = (fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.fsm.getSnapshot();
  };
  window.__duelAnimationSubclipLibrary = () => getSubclipLibrary();
  window.__duelAnimationSetup = async () => {
    await refreshCharacterDuelAnimationFromServer();
    const { getCharacterDuelAnimationSetup } = await import('./characterDuelAnimation.ts');
    return getCharacterDuelAnimationSetup();
  };
  window.__duelSaveAnimationSetup = persistDuelAnimationSetup;
  window.__duelSetBonesVisible = (fighter: 'A' | 'B', visible: boolean) => {
    if (fighter === 'A') {
      bonesVisibleA = visible;
      duel.rigA.setXrayVisible(visible);
      bonesABtn.classList.toggle('active', visible);
    } else {
      bonesVisibleB = visible;
      duel.rigB.setXrayVisible(visible);
      bonesBBtn.classList.toggle('active', visible);
    }
  };
  window.__duelGetBonesVisible = (fighter: 'A' | 'B') => (
    fighter === 'A' ? bonesVisibleA : bonesVisibleB
  );
  window.__duelRedressShirts = () => duel.redressMergedShirts();
  window.__duelAnimationFsmForceState = (state: string, fighter: 'A' | 'B' = 'A') => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    return controller.fsm.forceState(state as 'tpose' | 'idle' | 'walk' | 'attack');
  };

  window.__duelRequestAttack = async (fighter: 'A' | 'B' = 'A') => {
    const attacker = fighter === 'B' ? duel.controllerB : duel.controllerA;
    const target = fighter === 'B' ? duel.controllerA : duel.controllerB;
    const targetPos = target.getWorldPosition();
    return {
      canAttack: attacker.canAttackNow(),
      started: await attacker.playAttackToward(targetPos),
      state: attacker.getState(),
      controlMode: duel.getControlMode(),
    };
  };

  window.__duelSimulateKey = (code: string, phase: 'down' | 'up') => {
    if (phase === 'down') {
      duel.handleKeyDown(code);
    } else {
      duel.handleKeyUp(code);
    }
  };

  window.__duelMeasureRigForward = (fighter: 'A' | 'B' = 'A', zeroRootYaw = true) => {
    const rig = fighter === 'B' ? duel.rigB : duel.rigA;
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    const savedRootY = rig.root.rotation.y;
    if (zeroRootYaw) {
      rig.root.rotation.y = 0;
      rig.root.updateMatrixWorld(true);
    }
    const forwardYawRad = rig.measureForwardYaw();
    if (zeroRootYaw) {
      rig.root.rotation.y = savedRootY;
      rig.root.updateMatrixWorld(true);
    }
    const forwardYawDeg = forwardYawRad !== null ? (forwardYawRad * 180) / Math.PI : null;
    const meshBindYaw =
      forwardYawRad !== null ? meshBindYawFromMeasuredForward(forwardYawRad) : null;
    const facing = resolveProfileFacingParameters(controller.getProfile().parameters);
    return {
      fighter,
      fsmState: controller.getState(),
      rootRotationY: savedRootY,
      forwardYawRad,
      forwardYawDeg,
      recommendedMeshBindYaw: meshBindYaw,
      profileMeshBindYaw: facing.meshBindYaw,
      profileStanceYawOffset: facing.stanceYawOffset,
    };
  };

  window.__duelApplyFacingFromAudit = (fighter: 'A' | 'B', meshBindYaw: number, stanceYawOffset = 0) => {
    const controller = fighter === 'B' ? duel.controllerB : duel.controllerA;
    const profile = controller.getProfile();
    controller.applyProfile({
      ...profile,
      parameters: {
        ...profile.parameters,
        meshBindYaw,
        stanceYawOffset,
      },
    });
  };

  last = performance.now();
  const tick = (now: number): void => {
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    duel.update(delta);
    cloth.update(delta);
    const shirtHealth = duel.getShirtHealth();
    healthBars.update({
      camera: cloth.camera,
      renderer: cloth.renderer,
      rigA: duel.rigA,
      rigB: duel.rigB,
      healthA: shirtHealth.fighterA,
      healthB: shirtHealth.fighterB,
    });
    cloth.render();
    updateStatus(cloth);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  updateStatus(cloth);
}

export type { CharacterDuelStats };
