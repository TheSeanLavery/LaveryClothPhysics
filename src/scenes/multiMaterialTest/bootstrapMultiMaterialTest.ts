import {
  createClothSimulation,
  type ClothSimulation,
} from '../../cloth';
import { buildMaterialBendScaleByPatchKey } from '../../cloth/clothMaterialBend.ts';
import { getMyPresetSettings } from '../../cloth/myPresetDefaults.ts';
import {
  createMultiMaterialTestAssembly,
  materialColorByPatch,
  MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT,
  MULTI_MATERIAL_DEFAULT_PIN_TOP_Y,
  patchIdToMaterialKey,
} from '../../cloth/multiMaterialTestAssembly.ts';
import {
  ensureClothMaterialLibrarySeeded,
  fetchClothMaterialLibrary,
} from '../../cloth/clothMaterialsLibrary.ts';
import { registerMultiMaterialDevMenu } from '../../dev/registerMultiMaterialDevMenu.ts';
import { wireClothCanvasInteraction } from '../../ui/wireClothCanvasInteraction.ts';

export interface MultiMaterialTestStats {
  readonly particleCount: number;
  readonly vertexCount: number;
  readonly patchCount: number;
  readonly materialCount: number;
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
  const library = await fetchClothMaterialLibrary();

  const colorByKey: Record<string, string> = {
    'banner-a': library.materials.find((m) => m.name === 'Banner A')?.color ?? '#4fa3ff',
    'banner-b': library.materials.find((m) => m.name === 'Banner B')?.color ?? '#ff6b4a',
    'banner-c': library.materials.find((m) => m.name === 'Banner C')?.color ?? '#7ee787',
    'dangle-soft': library.materials.find((m) => m.name === 'Dangle soft')?.color ?? '#d2a8ff',
    'dangle-stiff': library.materials.find((m) => m.name === 'Dangle stiff')?.color ?? '#ffdc5a',
  };

  const assembly = createMultiMaterialTestAssembly({
    layout: {
      bannerMaterialIds: ['banner-a', 'banner-b', 'banner-c'],
      dangleMaterialIds: ['dangle-soft', 'dangle-stiff'],
    },
  });

  const dominantPatch = assembly.vertices[0]?.patchId ?? 'banner-a';
  const baseSettings = getMyPresetSettings();
  const materialBendScaleByKey = buildMaterialBendScaleByPatchKey(library, baseSettings);
  const primaryColor = materialColorByPatch(dominantPatch, colorByKey);

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

  Object.assign(cloth.settings, {
    ...baseSettings,
    flagColor: primaryColor,
    gravity: baseSettings.gravity,
    selfCollision: true,
    mannequinCollision: false,
    showMannequin: false,
    windStrength: 0,
    windTurbulence: 0,
    zoneAStrength: 0,
    zoneBStrength: 0,
    shapePressure: 0,
    tearStretchThreshold: Math.max(baseSettings.tearStretchThreshold, 2.5),
  });
  cloth.applySettings();
  await cloth.init();

  await cloth.loadClothAssembly(assembly, {
    pinVertexYAtOrAbove: MULTI_MATERIAL_DEFAULT_PIN_TOP_Y + MULTI_MATERIAL_DEFAULT_BANNER_HEIGHT,
    pinVertexYEqual: MULTI_MATERIAL_DEFAULT_PIN_TOP_Y,
    pinOnlyPatchIdContaining: '-dangle-',
    materialBendScaleByKey,
    resolvePatchMaterialKey: patchIdToMaterialKey,
  });
  cloth.resetFlag();

  const patchColors = new Map<string, string>();
  for (const vertex of assembly.vertices) {
    if (!patchColors.has(vertex.patchId)) {
      patchColors.set(vertex.patchId, materialColorByPatch(vertex.patchId, colorByKey));
    }
  }

  cloth.clothMesh.visible = true;
  cloth.camera.position.set(0, 0.15, 2.8);
  cloth.controls.target.set(0.35, -0.15, 0);
  cloth.controls.update();

  registerMultiMaterialDevMenu({
    toolbar,
    cloth,
    library,
  });

  const patchIds = new Set(assembly.vertices.map((vertex) => vertex.patchId));

  window.__multiMaterialAssembly = () => assembly;
  window.__multiMaterialMaterialBendScales = () => materialBendScaleByKey;
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
  window.__multiMaterialPatchColors = () => Object.fromEntries(patchColors);
  window.__multiMaterialRefreshLibrary = () => ensureClothMaterialLibrarySeeded();

  const interaction = wireClothCanvasInteraction({
    cloth,
    applyLabGrabSettings: true,
    initialGrabEnabled: true,
    onResetView: () => {
      cloth.resetFlag();
      cloth.controls.reset();
    },
  });
  window.__multiMaterialInteractionState = () => interaction.getState();

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
