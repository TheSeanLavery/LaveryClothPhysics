import GUI from 'lil-gui';
import {
  createGarmentPresetEnvelope,
  defaultGarmentParams,
  normalizeGarmentParams,
  upgradeGarmentPreset,
  type GarmentGeneratorParams,
  type GarmentPresetEnvelope,
  type GarmentType,
} from './garmentSchema';
import { makeDraggableLilGui } from '../ui/draggableFloating.ts';
import {
  deleteGarmentPreset,
  getGarmentPreset,
  importGarmentPreset,
  listGarmentPresets,
  saveGarmentPreset,
  type GarmentPresetSummary,
} from '../storage/garmentPresetDb';

export interface GarmentStudioControlsOptions {
  readonly onGenerate: (preset: GarmentPresetEnvelope) => Promise<void> | void;
  readonly title?: string;
  readonly testId?: string;
  readonly position?: 'left' | 'right';
  readonly initialPreset?: GarmentPresetEnvelope;
  readonly initialGarmentType?: GarmentType;
  readonly initialPresetName?: string;
  readonly showServerFixture?: boolean;
  readonly showExport?: boolean;
  /** When set, garment type is fixed (e.g. duel T-shirt panel). */
  readonly lockGarmentType?: boolean;
}

export interface GarmentStudioControls {
  readonly gui: GUI;
  readonly getCurrentPreset: () => GarmentPresetEnvelope;
  readonly applyPreset: (preset: GarmentPresetEnvelope) => Promise<void>;
  readonly refreshPresets: () => Promise<void>;
}

type MutableParams = Record<string, number | string | boolean>;

export function createGarmentStudioControls(
  options: GarmentStudioControlsOptions,
): GarmentStudioControls {
  const initialGarmentType = options.initialPreset?.garmentType ?? options.initialGarmentType ?? 'tshirt';
  const gui = new GUI({ title: options.title ?? 'Clothing Generator Studio', width: 360 });
  gui.domElement.setAttribute('data-testid', options.testId ?? 'garment-studio-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  if ((options.position ?? 'left') === 'right') {
    gui.domElement.style.left = 'auto';
    gui.domElement.style.right = '12px';
  } else {
    gui.domElement.style.left = '12px';
    gui.domElement.style.right = 'auto';
  }
  gui.domElement.style.zIndex = '25';
  gui.domElement.style.maxHeight = 'calc(100vh - 24px)';
  gui.domElement.style.overflow = 'auto';
  makeDraggableLilGui(gui);

  let garmentType: GarmentType = initialGarmentType;
  let currentParams = mutableParams(options.initialPreset?.params ?? defaultGarmentParams(garmentType));
  let paramFolder: GUI | null = null;
  let presetSummaries: GarmentPresetSummary[] = [];
  const presetOptions: Record<string, string> = { '': '(select preset)' };

  const state = {
    presetName: options.initialPreset?.name ?? options.initialPresetName ?? defaultPresetName(garmentType),
    selectedPresetId: options.initialPreset?.id ?? '',
    garmentType,
    status: 'Ready',
    async generate() {
      await generateCurrent();
    },
    async saveBrowserPreset() {
      try {
        setStatus('Saving browser preset...');
        const saved = await saveGarmentPreset(
          state.presetName,
          garmentType,
          currentTypedParams(),
          state.selectedPresetId || undefined,
        );
        state.selectedPresetId = saved.id;
        state.presetName = saved.name;
        await refreshPresets();
        await options.onGenerate(saved);
        setStatus(`Saved "${saved.name}"`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
    },
    async loadPreset() {
      if (!state.selectedPresetId) {
        setStatus('Select a garment preset to load');
        return;
      }
      try {
        const preset = await getGarmentPreset(state.selectedPresetId);
        if (!preset) {
          setStatus('Garment preset not found');
          return;
        }
        await applyPreset(preset);
        setStatus(`Loaded "${preset.name}"`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
    },
    async deletePreset() {
      if (!state.selectedPresetId) {
        setStatus('Select a garment preset to delete');
        return;
      }
      try {
        await deleteGarmentPreset(state.selectedPresetId);
        state.selectedPresetId = '';
        await refreshPresets();
        setStatus('Deleted garment preset');
      } catch (error) {
        setStatus(errorMessage(error));
      }
    },
    async saveServerFixture() {
      try {
        const preset = currentPreset();
        const response = await fetch('/__garments/presets', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(preset),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? `Server save failed (${response.status})`);
        }
        setStatus(`Server saved ${payload.savedPath ?? 'garment preset'}`);
      } catch (error) {
        setStatus(errorMessage(error));
      }
    },
    exportJson() {
      const preset = currentPreset();
      downloadJson(safePresetFilename(preset.name), preset);
      setStatus(`Exported "${preset.name}"`);
    },
  };

  const presetFolder = gui.addFolder('Presets');
  const presetNameController = presetFolder.add(state, 'presetName').name('Preset name');
  presetNameController.domElement.setAttribute('data-testid', 'garment-preset-name-input');
  const presetSelectController = presetFolder
    .add(state, 'selectedPresetId', presetOptions)
    .name('Saved preset')
    .onChange(() => {
      const summary = presetSummaries.find((preset) => preset.id === state.selectedPresetId);
      if (summary) {
        state.presetName = summary.name;
        presetNameController.updateDisplay();
      }
    });
  presetSelectController.domElement.setAttribute('data-testid', 'garment-preset-select');
  presetFolder.add(state, 'saveBrowserPreset').name('Save browser preset')
    .domElement.setAttribute('data-testid', 'garment-save-browser-btn');
  presetFolder.add(state, 'loadPreset').name('Load preset')
    .domElement.setAttribute('data-testid', 'garment-load-btn');
  presetFolder.add(state, 'deletePreset').name('Delete preset');
  if (options.showServerFixture ?? true) {
    presetFolder.add(state, 'saveServerFixture').name('Save server fixture')
      .domElement.setAttribute('data-testid', 'garment-save-server-btn');
  }
  if (options.showExport ?? true) {
    presetFolder.add(state, 'exportJson').name('Export JSON')
      .domElement.setAttribute('data-testid', 'garment-export-btn');
  }
  const statusController = presetFolder.add(state, 'status').name('Status').disable();
  statusController.domElement.setAttribute('data-testid', 'garment-status');
  presetFolder.open();

  const generatorFolder = gui.addFolder('Generator');
  if (!options.lockGarmentType) {
    generatorFolder
      .add(state, 'garmentType', {
        'T-shirt': 'tshirt',
        'Skirt': 'skirt',
        'Pleated skirt': 'pleatedSkirt',
        'Elastic shorts': 'elasticShorts',
        'Trousers': 'trousers',
        'Jeans': 'jeans',
      })
      .name('Garment type')
      .onChange((next: GarmentType) => {
        garmentType = next;
        state.garmentType = next;
        state.presetName = defaultPresetName(next);
        currentParams = mutableParams(defaultGarmentParams(next));
        presetNameController.updateDisplay();
        rebuildParamFolder();
        void generateCurrent();
      })
      .domElement.setAttribute('data-testid', 'garment-type-select');
  }
  generatorFolder.add(state, 'generate').name('Generate garment')
    .domElement.setAttribute('data-testid', 'garment-generate-btn');
  generatorFolder.open();

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.display = 'none';
  importInput.setAttribute('data-testid', 'garment-import-input');
  gui.domElement.appendChild(importInput);
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) {
      return;
    }
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const preset = await importGarmentPreset(raw);
      await refreshPresets();
      await applyPreset(preset);
      setStatus(`Imported "${preset.name}"`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      importInput.value = '';
    }
  });
  const importFolder = gui.addFolder('Import');
  importFolder.add({ importJson: () => importInput.click() }, 'importJson').name('Import JSON');

  rebuildParamFolder();
  void refreshPresets();

  function setStatus(message: string): void {
    state.status = message;
    statusController.updateDisplay();
  }

  async function refreshPresets(): Promise<void> {
    presetSummaries = await listGarmentPresets();
    for (const key of Object.keys(presetOptions)) {
      delete presetOptions[key];
    }
    presetOptions[''] = '(select preset)';
    for (const preset of presetSummaries) {
      presetOptions[preset.id] = `${preset.name} (${preset.garmentType})`;
    }
    presetSelectController.options(presetOptions);
    if (!presetSummaries.some((preset) => preset.id === state.selectedPresetId)) {
      state.selectedPresetId = '';
    }
    presetSelectController.updateDisplay();
  }

  async function applyPreset(preset: GarmentPresetEnvelope): Promise<void> {
    const upgraded = upgradeGarmentPreset(preset);
    garmentType = upgraded.garmentType;
    state.garmentType = upgraded.garmentType;
    state.presetName = upgraded.name;
    state.selectedPresetId = upgraded.id;
    currentParams = mutableParams(upgraded.params);
    presetNameController.updateDisplay();
    presetSelectController.updateDisplay();
    generatorFolder.controllersRecursive().forEach((controller) => controller.updateDisplay());
    rebuildParamFolder();
    await options.onGenerate(upgraded);
  }

  function currentTypedParams(): GarmentGeneratorParams {
    return normalizeGarmentParams(garmentType, currentParams as Partial<GarmentGeneratorParams>);
  }

  function currentPreset(): GarmentPresetEnvelope {
    return createGarmentPresetEnvelope(state.presetName, garmentType, currentTypedParams());
  }

  async function generateCurrent(): Promise<void> {
    try {
      const preset = currentPreset();
      await options.onGenerate(preset);
      setStatus(`Generated ${preset.name}`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  function rebuildParamFolder(): void {
    paramFolder?.destroy();
    paramFolder = gui.addFolder('Garment parameters');
    if (garmentType === 'tshirt') {
      addSlider('bodyWidth', 0.12, 1.2, 0.01, 'Body width');
      addSlider('torsoHeight', 0.2, 1.2, 0.01, 'Torso height');
      addSlider('sleeveLength', 0, 0.7, 0.01, 'Sleeve length');
      addSlider('sleeveOpening', 0.02, 0.55, 0.005, 'Sleeve opening');
      addSlider('sleeveTubeRadius', 0.006, 0.22, 0.001, 'Sleeve tube radius');
      addSlider('depth', 0.02, 0.45, 0.005, 'Front/back depth');
      addSlider('gridSpacing', 0.018, 0.08, 0.001, 'Grid spacing');
      addSlider('sleeveHangScale', 0, 1, 0.01, 'Sleeve hang');
      addSlider('sleeveLiftScale', 0, 1, 0.01, 'Sleeve lift');
      addSlider('sleeveVerticalRadiusScale', 0.02, 0.8, 0.01, 'Sleeve vertical radius');
    } else if (garmentType === 'skirt' || garmentType === 'pleatedSkirt') {
      addSlider('waistRadius', 0.045, 0.8, 0.005, 'Waist radius');
      addSlider('hemRadius', 0.065, 1.1, 0.005, 'Hem radius');
      addSlider('length', 0.15, 1.4, 0.01, 'Length');
      if (garmentType === 'skirt') {
        addSlider('panelCount', 4, 36, 1, 'Panel count');
      }
      addSlider('gridSpacing', 0.018, 0.08, 0.001, 'Grid spacing');
      if (garmentType === 'pleatedSkirt') {
        addChoice('waistFinish', {
          'Plain waistband': 'plainBand',
          'Wide waistband': 'wideBand',
          'Elastic waistband': 'elasticBand',
          'Fitted yoke': 'yoke',
        }, 'Waist finish');
        addSlider('waistbandHeight', 0.015, 0.18, 0.001, 'Waistband height');
        addSlider('waistbandStiffness', 0, 1, 0.01, 'Waistband stiffness');
        addSlider('yokeHeight', 0, 0.35, 0.005, 'Yoke height');
        addSlider('waistCompression', 0.55, 1.15, 0.01, 'Waist compression');
        addChoice('pleatType', {
          'Knife pleats': 'knife',
          'Box pleats': 'box',
          'Inverted box pleats': 'invertedBox',
        }, 'Pleat type');
        addSlider('pleatDepth', 0, 0.18, 0.005, 'Pleat depth');
        addSlider('pleatCount', 4, 48, 1, 'Pleat count');
        addSlider('pleatTackDepth', 0, 0.8, 0.01, 'Pleat tack depth');
        addSlider('hemPleatRelease', 0, 1, 0.01, 'Hem pleat release');
      }
    } else {
      addOutseamLengthControl();
      addSlider('waistCircumference', 0.24, 1.4, 0.01, 'Waist circumference');
      addSlider('hipCircumference', 0.32, 1.7, 0.01, 'Hip circumference');
      addSlider('rise', 0.16, 0.5, 0.005, 'Rise');
      addSlider('inseam', 0.06, 1.1, 0.01, 'Inseam / leg length');
      addSlider('thighCircumference', 0.18, 1, 0.01, 'Thigh circumference');
      addSlider('kneeCircumference', 0.14, 0.9, 0.01, 'Knee circumference');
      addSlider('hemCircumference', 0.1, 0.9, 0.01, 'Hem circumference');
      addSlider('hipEase', -0.12, 0.22, 0.005, 'Hip ease');
      addSlider('seatEase', -0.12, 0.22, 0.005, 'Seat ease');
      addSlider('gridSpacing', 0.018, 0.08, 0.001, 'Grid spacing');
      if (garmentType === 'elasticShorts') {
        addSlider('casingHeight', 0.025, 0.12, 0.001, 'Casing height');
      }
      if (garmentType === 'trousers') {
        addSlider('waistbandHeight', 0.02, 0.08, 0.001, 'Waistband height');
        addSlider('flyLength', 0.08, 0.28, 0.005, 'Fly length');
      }
      if (garmentType === 'jeans') {
        addSlider('waistbandHeight', 0.025, 0.075, 0.001, 'Waistband height');
        addSlider('flyLength', 0.08, 0.28, 0.005, 'Fly length');
        addSlider('yokeHeight', 0.035, 0.14, 0.005, 'Yoke height');
        addSlider('frontPocketOpening', 0.08, 0.26, 0.005, 'Front pocket opening');
        addSlider('backPocketHeight', 0.08, 0.24, 0.005, 'Back pocket height');
        addSlider('beltLoopCount', 4, 9, 1, 'Belt loops');
      }
    }
    paramFolder.open();
  }

  function addSlider(property: string, min: number, max: number, step: number, label: string): void {
    paramFolder
      ?.add(currentParams, property, min, max, step)
      .name(label)
      .onFinishChange(() => {
        currentParams = mutableParams(currentTypedParams());
        void generateCurrent();
      });
  }

  function addOutseamLengthControl(): void {
    currentParams.outseamLength = Number(currentParams.rise) + Number(currentParams.inseam);
    paramFolder
      ?.add(currentParams, 'outseamLength', 0.24, 1.45, 0.01)
      .name('Outseam / full length')
      .onFinishChange((next: number) => {
        currentParams.inseam = Math.max(0.06, next - Number(currentParams.rise));
        currentParams = mutableParams(currentTypedParams());
        currentParams.outseamLength = Number(currentParams.rise) + Number(currentParams.inseam);
        rebuildParamFolder();
        void generateCurrent();
      });
  }

  function addChoice(property: string, choices: Record<string, string>, label: string): void {
    paramFolder
      ?.add(currentParams, property, choices)
      .name(label)
      .onChange(() => {
        currentParams = mutableParams(currentTypedParams());
        void generateCurrent();
      });
  }

  return {
    gui,
    getCurrentPreset: currentPreset,
    applyPreset,
    refreshPresets,
  };
}

function mutableParams(params: GarmentGeneratorParams): MutableParams {
  return structuredClone(params) as unknown as MutableParams;
}

function defaultPresetName(garmentType: GarmentType): string {
  if (garmentType === 'pleatedSkirt') {
    return 'My pleated skirt';
  }
  if (garmentType === 'elasticShorts') {
    return 'My elastic shorts';
  }
  if (garmentType === 'trousers') {
    return 'My trousers';
  }
  if (garmentType === 'jeans') {
    return 'My jeans';
  }
  if (garmentType === 'skirt') {
    return 'My skirt';
  }
  return 'My T-shirt';
}

function safePresetFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'garment-preset'}.json`;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
