import type GUI from 'lil-gui';
import type { AnimatedCharacterSceneRig } from '../../character/AnimatedCharacter.ts';
import {
  getCharacterSdfPreset,
  importCharacterSdfPreset,
  listCharacterSdfPresets,
  saveCharacterSdfPreset,
  type CharacterSdfPresetSummary,
} from '../../character/sdf';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export type CharacterSdfFighter = 'A' | 'B' | 'Both';

export interface CharacterSdfPanelOptions {
  readonly id: string;
  readonly title: string;
  readonly testId: string;
  readonly side?: 'left' | 'right';
  readonly defaultOpen?: boolean;
  readonly rig?: AnimatedCharacterSceneRig;
  readonly rigA?: AnimatedCharacterSceneRig;
  readonly rigB?: AnimatedCharacterSceneRig;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function syncStateFromRig(
  state: {
    globalRadiusScale: number;
    globalRadiusBias: number;
    surfaceBand: number;
    runtimeScale: number;
    softExtras: boolean;
    showSdfDebug: boolean;
    nearSurfaceRatio: number;
    outsideHoleRatio: number;
    insideBlobRatio: number;
    meanAbsDistance: number;
    capsuleCount: number;
  },
  rig: AnimatedCharacterSceneRig,
): void {
  const preset = rig.getCharacterSdfPreset();
  state.globalRadiusScale = preset?.globalRadiusScale ?? 1;
  state.globalRadiusBias = preset?.globalRadiusBias ?? 0;
  state.surfaceBand = preset?.surfaceBand ?? 0.035;
  state.runtimeScale = rig.getBoneSdfRuntimeScale();
  state.softExtras = rig.getIncludeSoftCollisionExtras();
  state.showSdfDebug = rig.getStats().xrayVisible;
  const report = rig.getCharacterSdfFitReport();
  state.nearSurfaceRatio = report?.nearSurfaceRatio ?? 0;
  state.outsideHoleRatio = report?.outsideHoleRatio ?? 0;
  state.insideBlobRatio = report?.insideBlobRatio ?? 0;
  state.meanAbsDistance = report?.meanAbsDistance ?? 0;
  state.capsuleCount = rig.getStats().sdfCapsuleCount;
}

function applyPresetPatch(
  rigs: readonly AnimatedCharacterSceneRig[],
  patch: Parameters<AnimatedCharacterSceneRig['patchCharacterSdfPreset']>[0],
): void {
  for (const rig of rigs) {
    rig.patchCharacterSdfPreset(patch);
  }
}

function bindCharacterSdfGui(
  gui: GUI,
  getRigs: () => readonly AnimatedCharacterSceneRig[],
): void {
  const state = {
    globalRadiusScale: 1,
    globalRadiusBias: 0,
    surfaceBand: 0.035,
    runtimeScale: 1,
    softExtras: true,
    showSdfDebug: false,
    nearSurfaceRatio: 0,
    outsideHoleRatio: 0,
    insideBlobRatio: 0,
    meanAbsDistance: 0,
    capsuleCount: 0,
    presetId: '',
    shrinkAll: () => {
      applyPresetPatch(getRigs(), { globalRadiusScale: state.globalRadiusScale * 0.96 });
      refreshFromRigs();
    },
    growAll: () => {
      applyPresetPatch(getRigs(), { globalRadiusScale: state.globalRadiusScale * 1.04 });
      refreshFromRigs();
    },
    rebuild: () => {
      for (const rig of getRigs()) {
        rig.rebuildCharacterSdfsFromPreset();
      }
      refreshFromRigs();
    },
    refreshReport: () => refreshFromRigs(),
    savePreset: async () => {
      const rig = getRigs()[0];
      const preset = rig?.getCharacterSdfPreset();
      if (!preset) {
        return;
      }
      const saved = await saveCharacterSdfPreset(preset);
      state.presetId = saved.id;
      await refreshPresetList();
      refreshFromRigs();
    },
    exportJson: () => {
      const preset = getRigs()[0]?.getCharacterSdfPreset();
      if (preset) {
        downloadJson('character-sdf-preset.json', preset);
      }
    },
    importJson: () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        void file.text().then(async (text) => {
          const raw = JSON.parse(text) as unknown;
          const imported = await importCharacterSdfPreset(raw);
          for (const rig of getRigs()) {
            rig.setCharacterSdfPreset(imported);
          }
          state.presetId = imported.id;
          await refreshPresetList();
          refreshFromRigs();
        }).catch((error: unknown) => {
          console.error('Failed to import character SDF preset', error);
        });
      };
      input.click();
    },
    loadSelectedPreset: async () => {
      if (!state.presetId) {
        return;
      }
      const preset = await getCharacterSdfPreset(state.presetId);
      if (!preset) {
        return;
      }
      for (const rig of getRigs()) {
        rig.setCharacterSdfPreset(preset);
      }
      refreshFromRigs();
    },
  };

  let presetSummaries: CharacterSdfPresetSummary[] = [];
  const presetNameById = new Map<string, string>();

  const refreshPresetList = async (): Promise<void> => {
    presetSummaries = await listCharacterSdfPresets();
    presetNameById.clear();
    for (const summary of presetSummaries) {
      presetNameById.set(summary.id, summary.name);
    }
    presetController.options(makePresetOptions());
    presetController.updateDisplay();
  };

  const makePresetOptions = (): Record<string, string> => {
    const options: Record<string, string> = { '': '(select preset)' };
    for (const summary of presetSummaries) {
      options[summary.id] = summary.name;
    }
    return options;
  };

  const refreshFromRigs = (): void => {
    const rig = getRigs()[0];
    if (!rig) {
      return;
    }
    syncStateFromRig(state, rig);
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
  };

  const fitFolder = gui.addFolder('Fit (rebuilds capsules)');
  fitFolder.add(state, 'globalRadiusScale', 0.5, 1.2, 0.01).name('Global radius scale').onFinishChange((value: number) => {
    applyPresetPatch(getRigs(), { globalRadiusScale: value });
    refreshFromRigs();
  });
  fitFolder.add(state, 'globalRadiusBias', -0.05, 0.05, 0.001).name('Global radius bias').onFinishChange((value: number) => {
    applyPresetPatch(getRigs(), { globalRadiusBias: value });
    refreshFromRigs();
  });
  fitFolder.add(state, 'surfaceBand', 0.005, 0.08, 0.001).name('Report band').onFinishChange((value: number) => {
    applyPresetPatch(getRigs(), { surfaceBand: value });
    refreshFromRigs();
  });
  fitFolder.add(state, 'shrinkAll').name('Shrink all 4%');
  fitFolder.add(state, 'growAll').name('Grow all 4%');
  fitFolder.add(state, 'rebuild').name('Rebuild SDFs');
  fitFolder.open();

  const liveFolder = gui.addFolder('Live (no rebuild)');
  liveFolder.add(state, 'runtimeScale', 0.5, 1.2, 0.01).name('Runtime scale').onChange((value: number) => {
    for (const rig of getRigs()) {
      rig.setBoneSdfRadiusScale(value);
    }
  });
  liveFolder.add(state, 'softExtras').name('Soft extras (rails)').onChange((value: boolean) => {
    for (const rig of getRigs()) {
      rig.setIncludeSoftCollisionExtras(value);
    }
    refreshFromRigs();
  });
  liveFolder.add(state, 'showSdfDebug').name('Show SDF debug').onChange((value: boolean) => {
    for (const rig of getRigs()) {
      rig.setXrayVisible(value);
    }
  });
  liveFolder.open();

  const reportFolder = gui.addFolder('Fit report');
  reportFolder.add(state, 'capsuleCount').name('Capsule count').disable();
  reportFolder.add(state, 'nearSurfaceRatio').name('Near surface').disable();
  reportFolder.add(state, 'outsideHoleRatio').name('Under / holes').disable();
  reportFolder.add(state, 'insideBlobRatio').name('Over / blobs').disable();
  reportFolder.add(state, 'meanAbsDistance').name('Mean abs error').disable();
  reportFolder.add(state, 'refreshReport').name('Refresh report');

  const presetFolder = gui.addFolder('Preset');
  const presetController = presetFolder.add(state, 'presetId', makePresetOptions()).name('Saved preset');
  presetFolder.add(state, 'loadSelectedPreset').name('Load preset');
  presetFolder.add(state, 'savePreset').name('Save to browser');
  presetFolder.add(state, 'exportJson').name('Export JSON');
  presetFolder.add(state, 'importJson').name('Import JSON');

  refreshFromRigs();
  void refreshPresetList();
}

export function createCharacterSdfPanelDefinition(
  options: CharacterSdfPanelOptions,
): DevPanelDefinition {
  const hasDuelRigs = options.rigA !== undefined && options.rigB !== undefined;
  const hasSingleRig = options.rig !== undefined;
  if (hasDuelRigs === hasSingleRig) {
    throw new Error('Character SDF panel requires either rig or rigA+rigB');
  }

  return {
    id: options.id,
    title: options.title,
    side: options.side ?? 'left',
    testId: options.testId,
    defaultOpen: options.defaultOpen ?? false,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: options.title,
        testId: options.testId,
      });

      if (options.rig) {
        bindCharacterSdfGui(gui, () => [options.rig!]);
        return gui;
      }

      const selector = { fighter: 'Both' as CharacterSdfFighter };
      const getRigs = (): AnimatedCharacterSceneRig[] => {
        if (selector.fighter === 'A') {
          return [options.rigA!];
        }
        if (selector.fighter === 'B') {
          return [options.rigB!];
        }
        return [options.rigA!, options.rigB!];
      };

      gui.add(selector, 'fighter', { Both: 'Both fighters', A: 'Fighter A', B: 'Fighter B' }).name('Apply to').onChange(() => {
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      });

      bindCharacterSdfGui(gui, getRigs);
      return gui;
    },
  };
}
