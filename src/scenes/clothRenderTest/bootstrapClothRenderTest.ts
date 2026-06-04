import {
  createClothSimulation,
  createStitchedBoxAssembly,
  type ClothSimulation,
} from '../../cloth';

/** Magenta cloth cube used by Playwright render validation. */
export const CLOTH_CUBE_TEST_COLOR = '#e04080';

export interface ClothRenderTestSnapshot {
  readonly frameCount: number;
  readonly particleCount: number;
  readonly edgeCount: number;
  readonly brokenEdgeCount: number;
}

export async function bootstrapClothRenderTest(
  statusEl: HTMLElement,
  backendEl: HTMLElement,
  particlesEl: HTMLElement,
): Promise<ClothSimulation> {
  const heading = document.querySelector('#overlay h1');
  if (heading) {
    heading.textContent = 'Cloth Render Test';
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
    },
  );

  const assembly = createStitchedBoxAssembly({
    width: 1.2,
    height: 1.2,
    depth: 1.2,
    segments: 4,
  });

  const testSettings = {
    flagColor: CLOTH_CUBE_TEST_COLOR,
    fabricTextureSource: 'procedural' as const,
    fabricColorTint: 1,
    fabricNormalStrength: 0,
    flatShading: true,
    emissiveIntensity: 0.2,
    gravity: 0,
    shapePressure: 0,
    windStrength: 0,
    windTurbulence: 0,
    selfCollision: false,
    poleCollision: false,
    mannequinCollision: false,
    renderStrandThreads: false,
    tearStretchThreshold: 3.5,
    constraintIterations: 4,
  };
  Object.assign(cloth.settings, testSettings);
  cloth.applySettings();
  await cloth.init();
  await cloth.loadClothAssembly(assembly);
  Object.assign(cloth.settings, testSettings);
  cloth.applySettings();
  cloth.resetFlag();
  cloth.clothMesh.visible = true;

  cloth.camera.position.set(0, 0.4, 3.4);
  cloth.controls.target.set(0, 0, 0);
  cloth.controls.update();

  statusEl.textContent = 'running (cloth cube test)';
  backendEl.textContent = `backend: ${cloth.renderer.backend.constructor.name} (cloth cube)`;
  particlesEl.textContent = `cloth cube particles: ${cloth.getStats().particleCount}`;

  window.__clothRenderTest = () => ({
    frameCount: cloth.getStats().frameCount,
    particleCount: cloth.clothVertices.length,
    edgeCount: cloth.clothEdges.length,
    brokenEdgeCount: cloth.lastBrokenEdgeCount ?? 0,
  });
  window.__clothRenderTestDiagnostics = () => cloth.getRenderDiagnostics();
  window.__clothRenderTestBreakEdges = (edgeIds: readonly number[]) => cloth.breakEdgeIdsForTest(edgeIds);
  window.__clothRenderTestAuditVisible = (options?: { maxWorldTriangleEdge?: number }) =>
    cloth.auditVisibleTriangleSoupForTest(options);
  window.__clothRenderTestDrawRange = () => ({
    start: cloth.clothGeometry.drawRange.start,
    count: cloth.clothGeometry.drawRange.count,
  });
  window.__clothRenderTestMeshVisible = () => cloth.clothMesh.visible;
  window.__clothRenderTestFlagPixels = () => cloth.captureFlagCanvas();
  window.__clothRenderTestPositionExtents = () => cloth.getParticlePositionExtentsForTest();
  window.__clothRenderTestSimGridSample = () => {
    const attr = cloth.clothGeometry.getAttribute('simGridCoord');
    const arr = attr?.array as Float32Array | undefined;
    return arr ? Array.from(arr.slice(0, 18)) : [];
  };
  window.__clothRenderTestBreakCenterRing = () => {
    const edgeCount = cloth.clothEdges.length;
    const ids: number[] = [];
    const start = Math.floor(edgeCount * 0.45);
    const end = Math.min(edgeCount, start + Math.max(8, Math.floor(edgeCount * 0.04)));
    for (let i = start; i < end; i++) {
      ids.push(i);
    }
    return cloth.breakEdgeIdsForTest(ids);
  };

  window.addEventListener('resize', () => cloth.resize());
  cloth.renderer.setAnimationLoop(() => {
    cloth.update();
    cloth.render();
  });

  return cloth;
}
