import {
  createClothReproRecorder,
  type ClothReproRecorder,
  type ClothReproSaveResult,
} from '../../app/clothReproRecorder';
import type { ClothSimulation, ClothSimulationStats } from '../../cloth';
import type { InextensibleFlagSettings } from '../../sim/InextensibleFlagSettings.ts';
import type { ClothCanvasInteractionHandle } from '../../ui/wireClothCanvasInteraction.ts';

export interface WireMultiMaterialReproRecorderOptions {
  readonly cloth: ClothSimulation;
  readonly toolbar: HTMLElement | null;
  readonly getInteractionState: () => ReturnType<ClothCanvasInteractionHandle['getState']>;
  readonly getSceneStats: () => {
    readonly particleCount: number;
    readonly vertexCount: number;
    readonly patchCount: number;
    readonly materialCount: number;
  };
  readonly onSettingsApplied?: (partial: Partial<InextensibleFlagSettings>) => void;
}

export interface MultiMaterialReproRecorderHandle {
  readonly recorder: ClothReproRecorder;
  readonly wrapApplySettings: (
    applySettings: (partial: Partial<InextensibleFlagSettings>) => void,
  ) => (partial: Partial<InextensibleFlagSettings>) => void;
  readonly dispose: () => void;
}

type RecordButtonState = 'idle' | 'recording' | 'saving' | 'saved' | 'downloaded' | 'error';

export function wireMultiMaterialReproRecorder(
  options: WireMultiMaterialReproRecorderOptions,
): MultiMaterialReproRecorderHandle {
  const canvas = options.cloth.renderer.domElement;

  const captureState = (): Record<string, unknown> => ({
    capturedAt: new Date().toISOString(),
    appMode: 'multi-material',
    frameCount: options.cloth.getStats().frameCount,
    settings: {
      renderStrandThreads: options.cloth.settings.renderStrandThreads,
      strandThreadRadius: options.cloth.settings.strandThreadRadius,
      tearStretchThreshold: options.cloth.settings.tearStretchThreshold,
      tearMeshing: options.cloth.settings.tearMeshing,
      tearSdfCornerRadius: options.cloth.settings.tearSdfCornerRadius,
      tearFringeWidth: options.cloth.settings.tearFringeWidth,
      windStrength: options.cloth.settings.windStrength,
      windTurbulence: options.cloth.settings.windTurbulence,
      grabStiffness: options.cloth.settings.grabStiffness,
      grabMaxStep: options.cloth.settings.grabMaxStep,
      selfCollision: options.cloth.settings.selfCollision,
      flagColor: options.cloth.settings.flagColor,
    },
    interaction: options.getInteractionState(),
    scene: options.getSceneStats(),
    readback: options.cloth.getReadbackStats(),
  });

  const recorder = createClothReproRecorder({
    canvas,
    kind: 'multi-material-repro',
    saveEndpoint: '/__recordings/multi-material-repro',
    downloadFilenamePrefix: 'multi-material-repro',
    captureState,
  });

  const recordButton = document.createElement('button');
  recordButton.type = 'button';
  recordButton.id = 'record-multi-material-repro-btn';
  recordButton.dataset.testid = 'record-multi-material-repro-btn';
  recordButton.textContent = 'Record Repro';
  options.toolbar?.appendChild(recordButton);

  const setRecordButtonState = (state: RecordButtonState): void => {
    recordButton.classList.toggle('active', state === 'recording');
    recordButton.disabled = state === 'saving';
    recordButton.title = state === 'downloaded'
      ? 'Dev save failed, so the recording was downloaded instead.'
      : state === 'saved'
        ? 'Saved to tests/fixtures/multi-material-repros/latest.json'
        : '';
    recordButton.textContent = state === 'recording'
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

  recordButton.addEventListener('click', () => {
    void (async () => {
      if (!recorder.isRecording()) {
        setRecordButtonState('recording');
        await recorder.start();
        recorder.recordAction('record-button-start');
        return;
      }

      recorder.recordAction('record-button-stop');
      setRecordButtonState('saving');
      const result: ClothReproSaveResult = await recorder.stopAndSave();
      if (result.ok) {
        console.info(
          `Multi-material repro saved to ${result.latestPath ?? 'tests/fixtures/multi-material-repros/latest.json'}`,
        );
        setRecordButtonState('saved');
      } else if (result.downloaded) {
        console.warn(`Multi-material repro save failed; downloaded JSON instead: ${result.error ?? 'unknown error'}`);
        setRecordButtonState('downloaded');
      } else {
        console.error(`Multi-material repro recording failed: ${result.error ?? 'unknown error'}`);
        setRecordButtonState('error');
      }
      window.setTimeout(() => setRecordButtonState('idle'), 2_500);
    })();
  });

  window.__multiMaterialReproRecorder = {
    start: () => recorder.start(),
    stopAndSave: () => recorder.stopAndSave(),
    isRecording: () => recorder.isRecording(),
    recordAction: (name, details) => recorder.recordAction(name, details),
    recordNote: (message) => recorder.recordNote(message),
  };

  const wrapApplySettings = (
    applySettings: (partial: Partial<InextensibleFlagSettings>) => void,
  ): ((partial: Partial<InextensibleFlagSettings>) => void) => {
    return (partial) => {
      recorder.recordAction('apply-settings', { partial });
      applySettings(partial);
      options.onSettingsApplied?.(partial);
    };
  };

  return {
    recorder,
    wrapApplySettings,
    dispose: () => {
      recordButton.remove();
      delete window.__multiMaterialReproRecorder;
    },
  };
}

declare global {
  interface Window {
    __multiMaterialReproRecorder?: {
      start: () => Promise<void>;
      stopAndSave: () => Promise<ClothReproSaveResult>;
      isRecording: () => boolean;
      recordAction: (name: string, details?: Record<string, unknown>) => void;
      recordNote: (message: string) => void;
    };
    __multiMaterialReplayStrandAudit?: () => Promise<Record<string, unknown> | null>;
    __multiMaterialClothStats?: () => ClothSimulationStats;
  }
}
