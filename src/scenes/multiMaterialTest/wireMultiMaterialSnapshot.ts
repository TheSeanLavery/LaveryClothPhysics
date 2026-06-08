import {
  createClothSnapshotDocument,
  saveClothSnapshot,
  type ClothSnapshotSaveResult,
  type ClothVisualSnapshot,
} from '../../app/clothSnapshot.ts';
import type { ClothSimulation } from '../../cloth';
import {
  analyzeCanvasFloatingIslands,
  analyzePngBase64FloatingIslands,
  captureCanvasPngBase64,
  type FloatingIslandResult,
} from '../../dev/floatingClothIslands.ts';
import type { InextensibleFlagSettings } from '../../sim/InextensibleFlagSettings.ts';
import type { ClothCanvasInteractionHandle } from '../../ui/wireClothCanvasInteraction.ts';

export interface WireMultiMaterialSnapshotOptions {
  readonly cloth: ClothSimulation;
  readonly toolbar: HTMLElement | null;
  readonly getInteractionState: () => ReturnType<ClothCanvasInteractionHandle['getState']>;
  readonly getSceneStats: () => {
    readonly particleCount: number;
    readonly vertexCount: number;
    readonly patchCount: number;
    readonly materialCount: number;
  };
}

export interface MultiMaterialSnapshotHandle {
  readonly saveSnapshot: () => Promise<ClothSnapshotSaveResult>;
  readonly analyzeCurrentFloatingIslands: () => Promise<FloatingIslandResult | null>;
  readonly analyzeSnapshotFloatingIslands: (
    snapshot: Pick<ClothVisualSnapshot, 'screenshot'>,
  ) => Promise<FloatingIslandResult | null>;
  readonly dispose: () => void;
}

type SnapshotButtonState = 'idle' | 'saving' | 'saved' | 'downloaded' | 'error';

export function wireMultiMaterialSnapshot(
  options: WireMultiMaterialSnapshotOptions,
): MultiMaterialSnapshotHandle {
  const canvas = options.cloth.renderer.domElement;

  const captureSnapshot = async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const screenshot = await captureCanvasPngBase64(canvas);
    const floatingIslands = screenshot
      ? await analyzePngBase64FloatingIslands(screenshot.pngBase64)
      : await analyzeCanvasFloatingIslands(canvas);

    const settings = options.cloth.settings;
    const settingsSnapshot: Partial<InextensibleFlagSettings> = {
      renderStrandThreads: settings.renderStrandThreads,
      strandThreadRadius: settings.strandThreadRadius,
      tearStretchThreshold: settings.tearStretchThreshold,
      tearMeshing: settings.tearMeshing,
      tearSdfCornerRadius: settings.tearSdfCornerRadius,
      tearFringeWidth: settings.tearFringeWidth,
      tearCenterHoleRadius: settings.tearCenterHoleRadius,
      tearCornerKeepWidth: settings.tearCornerKeepWidth,
      windStrength: settings.windStrength,
      windTurbulence: settings.windTurbulence,
      grabStiffness: settings.grabStiffness,
      grabMaxStep: settings.grabMaxStep,
      selfCollision: settings.selfCollision,
      flagColor: settings.flagColor,
    };

    const [connectivity, strandThreads, edgeKinds] = await Promise.all([
      options.cloth.auditAssemblyConnectivity?.() ?? null,
      options.cloth.auditStrandThreadCoverage?.() ?? null,
      Promise.resolve(options.cloth.getParticleRenderEdgeKindAudit?.() ?? null),
    ]);

    return {
      state: {
        capturedAt: new Date().toISOString(),
        appMode: 'multi-material',
        frameCount: options.cloth.getStats().frameCount,
        settings: settingsSnapshot,
        interaction: options.getInteractionState(),
        scene: options.getSceneStats(),
        readback: options.cloth.getReadbackStats(),
      },
      audits: {
        connectivity,
        strandThreads,
        edgeKinds,
      },
      screenshot,
      floatingIslands,
    };
  };

  const saveSnapshot = async (): Promise<ClothSnapshotSaveResult> => {
    const payload = await captureSnapshot();
    const snapshot = createClothSnapshotDocument(
      {
        canvas,
        kind: 'multi-material-snapshot',
        saveEndpoint: '/__recordings/multi-material-snapshot',
        downloadFilenamePrefix: 'multi-material-snapshot',
        captureSnapshot: async () => payload,
      },
      payload,
    );
    return saveClothSnapshot(snapshot, {
      saveEndpoint: '/__recordings/multi-material-snapshot',
      downloadFilenamePrefix: 'multi-material-snapshot',
    });
  };

  const analyzeCurrentFloatingIslands = () => analyzeCanvasFloatingIslands(canvas);
  const analyzeSnapshotFloatingIslands = async (
    snapshot: Pick<ClothVisualSnapshot, 'screenshot'>,
  ): Promise<FloatingIslandResult | null> => {
    if (!snapshot.screenshot?.pngBase64) {
      return null;
    }
    return analyzePngBase64FloatingIslands(snapshot.screenshot.pngBase64);
  };

  const snapshotButton = document.createElement('button');
  snapshotButton.type = 'button';
  snapshotButton.id = 'save-multi-material-snapshot-btn';
  snapshotButton.dataset.testid = 'save-multi-material-snapshot-btn';
  snapshotButton.textContent = 'Save Snapshot';
  options.toolbar?.appendChild(snapshotButton);

  const setSnapshotButtonState = (
    state: SnapshotButtonState,
    floatingIslands: FloatingIslandResult | null = null,
  ): void => {
    snapshotButton.disabled = state === 'saving';
    snapshotButton.title = state === 'downloaded'
      ? 'Dev save failed, so the snapshot was downloaded instead.'
      : state === 'saved' && floatingIslands
        ? floatingIslands.pass
          ? `Saved to tests/fixtures/multi-material-snapshots/latest.json — no floating islands (${floatingIslands.anchorIslandCount} anchors).`
          : `Saved with ${floatingIslands.floatingIslands.length} floating island(s), ${floatingIslands.floatingPixelCount}px debris.`
        : '';
    snapshotButton.textContent = state === 'saving'
      ? 'Saving...'
      : state === 'saved'
        ? floatingIslands?.pass
          ? 'Saved Snapshot ✓'
          : `Saved Snapshot (${floatingIslands?.floatingIslands.length ?? 0} islands)`
        : state === 'downloaded'
          ? 'Downloaded Snapshot'
          : state === 'error'
            ? 'Snapshot Failed'
            : 'Save Snapshot';
  };

  snapshotButton.addEventListener('click', () => {
    void (async () => {
      setSnapshotButtonState('saving');
      try {
        const payload = await captureSnapshot();
        const snapshot = createClothSnapshotDocument(
          {
            canvas,
            kind: 'multi-material-snapshot',
            saveEndpoint: '/__recordings/multi-material-snapshot',
            downloadFilenamePrefix: 'multi-material-snapshot',
            captureSnapshot: async () => payload,
          },
          payload,
        );
        const result = await saveClothSnapshot(snapshot, {
          saveEndpoint: '/__recordings/multi-material-snapshot',
          downloadFilenamePrefix: 'multi-material-snapshot',
        });
        if (result.ok) {
          console.info(
            `Multi-material snapshot saved to ${result.latestPath ?? 'tests/fixtures/multi-material-snapshots/latest.json'}`,
            payload.floatingIslands,
          );
          setSnapshotButtonState('saved', payload.floatingIslands);
        } else if (result.downloaded) {
          console.warn(
            `Multi-material snapshot save failed; downloaded JSON instead: ${result.error ?? 'unknown error'}`,
            payload.floatingIslands,
          );
          setSnapshotButtonState('downloaded', payload.floatingIslands);
        } else {
          console.error(`Multi-material snapshot failed: ${result.error ?? 'unknown error'}`);
          setSnapshotButtonState('error', payload.floatingIslands);
        }
      } catch (error) {
        console.error('Multi-material snapshot failed', error);
        setSnapshotButtonState('error');
      }
      window.setTimeout(() => setSnapshotButtonState('idle'), 3_000);
    })();
  });

  window.__multiMaterialSaveSnapshot = () => saveSnapshot();
  window.__multiMaterialAnalyzeFloatingIslands = () => analyzeCurrentFloatingIslands();
  window.__multiMaterialAnalyzeSnapshotFloatingIslands = (snapshot) => analyzeSnapshotFloatingIslands(snapshot);

  return {
    saveSnapshot,
    analyzeCurrentFloatingIslands,
    analyzeSnapshotFloatingIslands,
    dispose: () => {
      snapshotButton.remove();
      delete window.__multiMaterialSaveSnapshot;
      delete window.__multiMaterialAnalyzeFloatingIslands;
      delete window.__multiMaterialAnalyzeSnapshotFloatingIslands;
    },
  };
}

declare global {
  interface Window {
    __multiMaterialSaveSnapshot?: () => Promise<ClothSnapshotSaveResult>;
    __multiMaterialAnalyzeFloatingIslands?: () => Promise<FloatingIslandResult | null>;
    __multiMaterialAnalyzeSnapshotFloatingIslands?: (
      snapshot: Pick<ClothVisualSnapshot, 'screenshot'>,
    ) => Promise<FloatingIslandResult | null>;
  }
}
