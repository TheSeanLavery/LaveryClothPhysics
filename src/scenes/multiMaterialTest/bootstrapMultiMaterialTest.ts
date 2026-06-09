import * as THREE from 'three';
import {
  createClothSimulation,
  normalizeClothSettings,
  type ClothSimulation,
  type ClothSimulationStats,
} from '../../cloth';
import {
  buildAssemblyMaterialMaps,
  buildPatchSegmentColorsFromLibrary,
  type AssemblyMaterialMaps,
} from '../../cloth/clothMaterialPhysics.ts';
import { applyMyPresetToCharacterCloth } from '../../cloth/myPresetDefaults.ts';
import {
  createMultiMaterialTestAssembly,
  MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT,
  MULTI_MATERIAL_DEFAULT_PIN_TOP_Y,
  patchIdToMaterialKey,
} from '../../cloth/multiMaterialTestAssembly.ts';
import {
  ensureClothMaterialLibrarySeeded,
  fetchClothMaterialLibrary,
} from '../../cloth/clothMaterialsLibrary.ts';
import type { ClothMaterialsPanelApi } from '../../dev/panels/clothMaterialsPanelApi.ts';
import { registerMultiMaterialDevMenu } from '../../dev/registerMultiMaterialDevMenu.ts';
import type { InextensibleFlagSettings } from '../../sim/InextensibleFlagSettings.ts';
import { wireClothCanvasInteraction } from '../../ui/wireClothCanvasInteraction.ts';
import { wireMultiMaterialMaterialEditor } from './wireMultiMaterialMaterialEditor.ts';
import { wireMultiMaterialReproRecorder } from './wireMultiMaterialReproRecorder.ts';
import { wireMultiMaterialSnapshot } from './wireMultiMaterialSnapshot.ts';

export interface MultiMaterialTestStats {
  readonly particleCount: number;
  readonly vertexCount: number;
  readonly patchCount: number;
  readonly materialCount: number;
}

export interface MultiMaterialPatchGrabTarget {
  readonly patchKey: string;
  readonly patchId: string;
  readonly ndcX: number;
  readonly ndcY: number;
}

export interface MultiMaterialGrabDragOptions {
  readonly ndcX: number;
  readonly ndcY: number;
  readonly dragNdcPerFrame?: { readonly x: number; readonly y: number };
}

export interface MultiMaterialPerformanceMeasureOptions {
  readonly label: string;
  readonly durationMs?: number;
  readonly warmupMs?: number;
  readonly grabMode?: boolean;
  readonly grab?: MultiMaterialGrabDragOptions;
}

export interface MultiMaterialPerformanceSample {
  readonly label: string;
  readonly durationMs: number;
  readonly rafFps: number;
  readonly simFps: number;
  readonly particleCount: number;
  readonly grabMode: boolean;
  readonly grabActive: boolean;
  readonly readbackDelta: {
    readonly healthStarted: number;
    readonly topologyStarted: number;
    readonly bbVisualStarted: number;
    readonly healthSkippedRuntime: number;
    readonly topologySkippedDisabled: number;
  };
}

function readbackDelta(
  before: ReturnType<ClothSimulation['getReadbackStats']>,
  after: ReturnType<ClothSimulation['getReadbackStats']>,
): MultiMaterialPerformanceSample['readbackDelta'] {
  return {
    healthStarted: after.healthStarted - before.healthStarted,
    topologyStarted: after.topologyStarted - before.topologyStarted,
    bbVisualStarted: after.bbVisualStarted - before.bbVisualStarted,
    healthSkippedRuntime: after.healthSkippedRuntime - before.healthSkippedRuntime,
    topologySkippedDisabled: after.topologySkippedDisabled - before.topologySkippedDisabled,
  };
}

function buildPatchGrabTargets(
  assembly: ReturnType<typeof createMultiMaterialTestAssembly>,
  camera: THREE.PerspectiveCamera,
): Record<string, MultiMaterialPatchGrabTarget> {
  const scratch = new THREE.Vector3();
  const targets: Record<string, MultiMaterialPatchGrabTarget> = {};
  const sums = new Map<string, { x: number; y: number; z: number; count: number; patchId: string }>();

  for (const vertex of assembly.vertices) {
    const patchKey = patchIdToMaterialKey(vertex.patchId);
    const bucket = sums.get(patchKey) ?? { x: 0, y: 0, z: 0, count: 0, patchId: vertex.patchId };
    bucket.x += vertex.position[0];
    bucket.y += vertex.position[1];
    bucket.z += vertex.position[2];
    bucket.count += 1;
    sums.set(patchKey, bucket);
  }

  for (const [patchKey, bucket] of sums) {
    if (bucket.count <= 0) {
      continue;
    }
    scratch.set(bucket.x / bucket.count, bucket.y / bucket.count, bucket.z / bucket.count);
    scratch.project(camera);
    targets[patchKey] = {
      patchKey,
      patchId: bucket.patchId,
      ndcX: scratch.x,
      ndcY: scratch.y,
    };
  }

  return targets;
}

export async function bootstrapMultiMaterialTest(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<ClothSimulation> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Multi-Material Cloth Test';
  }

  const toolbar = document.querySelector<HTMLElement>('#toolbar');
  if (toolbar) {
    toolbar.style.display = 'flex';
  }

  await ensureClothMaterialLibrarySeeded();
  let library = await fetchClothMaterialLibrary();

  const colorByKey = buildPatchSegmentColorsFromLibrary(library);

  const assembly = createMultiMaterialTestAssembly({
    layout: {
      bannerMaterialIds: ['banner-a', 'banner-b', 'banner-c'],
      dangleMaterialIds: ['dangle-soft', 'dangle-stiff'],
    },
  });

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
    },
  );

  Object.assign(cloth.settings, applyMyPresetToCharacterCloth(cloth.settings), {
    renderStrandThreads: true,
    strandThreadRadius: 0.012,
    flagColor: '#f4f8ff',
  });
  cloth.applySettings();
  await cloth.init();

  let materialMaps = buildAssemblyMaterialMaps(library, cloth.settings);
  const patchColorsByKey: Record<string, string> = { ...colorByKey };
  const applyMaterialLibrary = (
    nextLibrary: typeof library,
    options: { readonly refreshColors?: boolean } = {},
  ): void => {
    materialMaps = buildAssemblyMaterialMaps(nextLibrary, cloth.settings);
    const nextPatchColors = buildPatchSegmentColorsFromLibrary(nextLibrary);
    const refreshColors = options.refreshColors ?? true;
    Object.assign(patchColorsByKey, nextPatchColors);
    cloth.refreshAssemblyMaterialScalars({
      materialBendStiffnessByKey: materialMaps.bendStiffness,
      materialDampeningByKey: materialMaps.dampening,
      materialStructuralScaleByKey: materialMaps.structural,
      materialCompressionScaleByKey: materialMaps.compression,
      materialTearThresholdByKey: materialMaps.tearThreshold,
      globalTearStretchThreshold: cloth.settings.tearStretchThreshold,
      globalDampening: cloth.settings.dampening,
      globalBendStiffness: cloth.settings.bendStiffness,
      ...(refreshColors ? { patchSegmentColorByKey: nextPatchColors } : {}),
    });
  };

  await cloth.loadClothAssembly(assembly, {
    pinVertexYAtOrAbove: MULTI_MATERIAL_DEFAULT_PIN_TOP_Y + MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT,
    stitchWeldMode: 'weld',
    materialBendStiffnessByKey: materialMaps.bendStiffness,
    materialDampeningByKey: materialMaps.dampening,
    materialStructuralScaleByKey: materialMaps.structural,
    materialCompressionScaleByKey: materialMaps.compression,
    materialTearThresholdByKey: materialMaps.tearThreshold,
    globalTearStretchThreshold: cloth.settings.tearStretchThreshold,
    globalDampening: cloth.settings.dampening,
    globalBendStiffness: cloth.settings.bendStiffness,
    patchSegmentColorByKey: colorByKey,
    resolvePatchMaterialKey: patchIdToMaterialKey,
  });
  cloth.resetFlag();

  cloth.clothMesh.visible = true;
  cloth.camera.position.set(0, 0.15, 2.8);
  cloth.controls.target.set(0.35, -0.15, 0);
  cloth.controls.update();

  let materialPanelApi: ClothMaterialsPanelApi | undefined;

  registerMultiMaterialDevMenu({
    toolbar,
    cloth,
    library,
    onMaterialsPanelReady: (api) => {
      materialPanelApi = api;
    },
    onMaterialsChanged: async (nextLibrary) => {
      library = nextLibrary;
      applyMaterialLibrary(nextLibrary);
    },
    onPreviewMaterial: (materialId, draft) => {
      const previewLibrary = {
        ...library,
        materials: library.materials.map((material) => (
          material.id === materialId
            ? {
                ...material,
                color: draft.color,
                settings: {
                  dampening: draft.dampening,
                  bendStiffness: draft.bendStiffness,
                  tearStretchThreshold: draft.tearStretchThreshold,
                },
                physics: {
                  ...material.physics,
                  structuralScale: draft.structuralScale,
                  compressionScale: draft.compressionScale,
                },
              }
            : material
        )),
      };
      applyMaterialLibrary(previewLibrary);
    },
  });

  wireMultiMaterialMaterialEditor({
    cloth,
    getLibraryScales: () => materialMaps,
    getPatchColors: () => patchColorsByKey,
    getPanelApi: () => materialPanelApi,
    getPresentationWait: () => cloth.waitForPresentationCompile(),
  });

  const patchIds = new Set(assembly.vertices.map((vertex) => vertex.patchId));

  window.__multiMaterialAssembly = () => assembly;
  window.__multiMaterialMaterialDampeningScales = () => materialMaps.dampening;
  window.__multiMaterialMaterialTearThresholdScales = () => materialMaps.tearThreshold;
  window.__multiMaterialMaterialStructuralScales = () => materialMaps.structural;
  window.__multiMaterialWaitWallClockForTest = (seconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, seconds) * 1000);
  });
  window.__multiMaterialReadVertexPositionsForTest = async () => {
    const snapshot = await cloth.readGarmentVertexPositionsForTest(assembly);
    return {
      particleCount: snapshot.particleCount,
      renderVertexCount: snapshot.renderVertexCount,
      positions: snapshot.positions.map((p) => [...p] as [number, number, number]),
    };
  };
  window.__multiMaterialDangleHangAnalysisForTest = async () => {
    const snapshot = await cloth.readGarmentVertexPositionsForTest(assembly);
    const positions = snapshot.positions;
    const analyze = (needle: string) => {
      let sum = 0;
      let count = 0;
      let lowest = Number.POSITIVE_INFINITY;
      for (const vertex of assembly.vertices) {
        if (!vertex.patchId.includes(needle)) {
          continue;
        }
        const position = positions[vertex.id];
        if (!position) {
          continue;
        }
        sum += position[1];
        count += 1;
        lowest = Math.min(lowest, position[1]);
      }
      return { meanY: count > 0 ? sum / count : Number.NaN, lowestY: lowest };
    };
    const soft = analyze('dangle-soft');
    const stiff = analyze('dangle-stiff');
    return { soft, stiff };
  };
  window.__multiMaterialStats = (): MultiMaterialTestStats => ({
    particleCount: cloth.getStats().particleCount,
    vertexCount: assembly.vertices.length,
    patchCount: patchIds.size,
    materialCount: library.materials.length,
  });
  window.__multiMaterialPatchColors = () => patchColorsByKey;
  window.__multiMaterialRefreshLibrary = async () => {
    await ensureClothMaterialLibrarySeeded();
    const nextLibrary = await fetchClothMaterialLibrary();
    library = nextLibrary;
    applyMaterialLibrary(nextLibrary);
    return nextLibrary;
  };

  let applySettingsForHooks = (partial: Partial<InextensibleFlagSettings>): void => {
    cloth.loadSettingsPreset(normalizeClothSettings(partial));
  };

  let reproRecorder!: ReturnType<typeof wireMultiMaterialReproRecorder>;

  const interaction = wireClothCanvasInteraction({
    cloth,
    applyLabGrabSettings: true,
    initialGrabEnabled: true,
    onResetView: () => {
      reproRecorder.recorder.recordAction('reset-view');
      cloth.resetFlag();
      cloth.controls.reset();
    },
    onPointerMove: (event) => {
      reproRecorder.recorder.recordPointer('move', event);
    },
    onPointerDown: (event, ndc) => {
      reproRecorder.recorder.recordPointer('down', event);
      if (cloth.isShootModeOn()) {
        reproRecorder.recorder.recordAction('shoot-bb', { ndcX: ndc.x, ndcY: ndc.y });
        return;
      }
      if (cloth.isGrabModeOn()) {
        reproRecorder.recorder.recordAction('grab-begin', { ndcX: ndc.x, ndcY: ndc.y });
      }
    },
    onPointerUp: (event) => {
      reproRecorder.recorder.recordPointer(
        event.type === 'pointercancel' ? 'cancel' : 'up',
        event,
      );
      if (cloth.isGrabPointerDown()) {
        reproRecorder.recorder.recordAction('grab-end');
      }
    },
    onGrabToggle: (enabled) => {
      reproRecorder.recorder.recordAction('toggle-grab', { enabled });
    },
    onShootToggle: (enabled) => {
      reproRecorder.recorder.recordAction('toggle-shoot', { enabled });
    },
  });

  reproRecorder = wireMultiMaterialReproRecorder({
    cloth,
    toolbar,
    getInteractionState: () => interaction.getState(),
    getSceneStats: () => ({
      particleCount: cloth.getStats().particleCount,
      vertexCount: assembly.vertices.length,
      patchCount: patchIds.size,
      materialCount: library.materials.length,
    }),
  });
  applySettingsForHooks = reproRecorder.wrapApplySettings(applySettingsForHooks);

  wireMultiMaterialSnapshot({
    cloth,
    toolbar,
    getInteractionState: () => interaction.getState(),
    getSceneStats: () => ({
      particleCount: cloth.getStats().particleCount,
      vertexCount: assembly.vertices.length,
      patchCount: patchIds.size,
      materialCount: library.materials.length,
    }),
  });

  window.__multiMaterialInteractionState = () => interaction.getState();
  window.__multiMaterialClothStats = (): ClothSimulationStats => cloth.getStats();
  window.__multiMaterialReadbackStats = () => cloth.getReadbackStats();
  window.__multiMaterialApplySettings = (partial: Partial<InextensibleFlagSettings>) => {
    applySettingsForHooks(partial);
  };
  window.__multiMaterialAuditStrandThreads = () => cloth.auditStrandThreadCoverage();
  window.__multiMaterialAuditConnectivity = () => cloth.auditAssemblyConnectivity();
  window.__multiMaterialParticleRenderEdgeKindsForTest = () => cloth.getParticleRenderEdgeKindAudit();
  window.__multiMaterialForceTearThresholdForTest = async (threshold: number) => {
    const patchKeys = ['banner-a', 'banner-b', 'banner-c', 'dangle-soft', 'dangle-stiff'];
    const materialTearThresholdByKey = Object.fromEntries(
      patchKeys.map((patchKey) => [patchKey, threshold]),
    );
    await cloth.loadSettingsPreset(
      normalizeClothSettings({ ...cloth.settings, tearStretchThreshold: threshold }),
    );
    cloth.refreshAssemblyMaterialScalars({
      materialTearThresholdByKey,
      globalTearStretchThreshold: threshold,
    });
  };
  window.__multiMaterialSetGrabMode = (enabled: boolean) => {
    cloth.setGrabModeEnabled(enabled);
    document.body.classList.toggle('grab-mode', enabled);
    cloth.controls.enabled = !enabled;
  };
  window.__multiMaterialEndGrab = () => {
    cloth.endGrabAttempt();
    document.body.classList.remove('grabbing');
  };
  window.__multiMaterialPatchGrabTargets = () => buildPatchGrabTargets(assembly, cloth.camera);
  window.__multiMaterialMeasurePerformance = async (
    options: MultiMaterialPerformanceMeasureOptions,
  ): Promise<MultiMaterialPerformanceSample> => {
    const durationMs = Math.max(250, options.durationMs ?? 2_000);
    const warmupMs = Math.max(0, options.warmupMs ?? 400);

    window.__multiMaterialEndGrab?.();
    window.__multiMaterialSetGrabMode?.(options.grabMode ?? false);
    cloth.clearMousePointer();

    if (warmupMs > 0) {
      await new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const tick = () => {
          if (performance.now() - startedAt >= warmupMs) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }

    let ndcX = options.grab?.ndcX ?? 0;
    let ndcY = options.grab?.ndcY ?? 0;
    const grabbing = options.grab !== undefined;
    if (grabbing) {
      cloth.setMousePointerNdc(ndcX, ndcY);
      cloth.beginGrabAttempt();
      document.body.classList.add('grabbing');
    }

    const readbackBefore = cloth.getReadbackStats();
    const simBefore = cloth.getStats().frameCount;
    let rafFrames = 0;
    const startedAt = performance.now();

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (options.grab?.dragNdcPerFrame) {
          ndcX += options.grab.dragNdcPerFrame.x;
          ndcY += options.grab.dragNdcPerFrame.y;
          cloth.setMousePointerNdc(ndcX, ndcY);
        }
        rafFrames += 1;
        if (performance.now() - startedAt >= durationMs) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const seconds = durationMs / 1_000;
    const sample: MultiMaterialPerformanceSample = {
      label: options.label,
      durationMs,
      rafFps: rafFrames / seconds,
      simFps: (cloth.getStats().frameCount - simBefore) / seconds,
      particleCount: cloth.getStats().particleCount,
      grabMode: cloth.isGrabModeOn(),
      grabActive: grabbing,
      readbackDelta: readbackDelta(readbackBefore, cloth.getReadbackStats()),
    };

    window.__multiMaterialEndGrab?.();
    return sample;
  };

  statusEl.textContent = 'running (multi-material cloth test)';
  backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name}`;
  particlesEl.textContent = `patches: ${patchIds.size} · materials: ${library.materials.length}`;

  window.addEventListener('resize', () => cloth.resize());
  cloth.renderer.setAnimationLoop(() => {
    cloth.update();
    cloth.render();
  });

  return cloth;
}
