import GUI from 'lil-gui';
import type { InextensibleFlagSimulation } from '../sim/InextensibleFlagSimulation';
import { cloneFlagSettings } from '../sim/settingsPreset';
import {
  deleteFlagSettingsPreset,
  getFlagSettingsPreset,
  listFlagSettingsPresets,
  saveFlagSettingsPreset,
  type FlagSettingsPresetSummary,
} from '../storage/flagSettingsDb';

export interface InextensibleFlagControlsOptions {
  title?: string;
  testId?: string;
  collisionUi?: 'mannequin' | 'boneSdf';
}

function refreshGuiControllers(gui: GUI): void {
  gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
}

function safePresetFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'cloth-settings'}.json`;
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

export function createInextensibleFlagControls(
  sim: InextensibleFlagSimulation,
  options: InextensibleFlagControlsOptions = {},
): GUI {
  const gui = new GUI({ title: options.title ?? 'Inextensible Flag', width: 320 });
  gui.domElement.setAttribute('data-testid', options.testId ?? 'flag-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  gui.domElement.style.right = '12px';
  gui.domElement.style.zIndex = '20';
  gui.domElement.style.maxHeight = 'calc(100vh - 24px)';
  gui.domElement.style.overflow = 'auto';

  const settings = sim.settings;
  const sync = () => sim.applySettings();

  const presetsFolder = gui.addFolder('Saved settings');
  const presetOptions: Record<string, string> = { '': '(select preset)' };
  let presetSummaries: FlagSettingsPresetSummary[] = [];

  const presetsState = {
    selectedPresetId: '',
    presetName: 'My preset',
    status: 'Ready',
    async refreshPresetList() {
      presetSummaries = await listFlagSettingsPresets();
      for (const key of Object.keys(presetOptions)) {
        delete presetOptions[key];
      }
      presetOptions[''] = '(select preset)';
      for (const preset of presetSummaries) {
        presetOptions[preset.id] = preset.name;
      }
      presetController.options(presetOptions);
      if (!presetSummaries.some((preset) => preset.id === presetsState.selectedPresetId)) {
        presetsState.selectedPresetId = '';
      }
      presetController.updateDisplay();
    },
    async savePreset() {
      try {
        presetsState.status = 'Saving…';
        statusController.updateDisplay();
        const saved = await saveFlagSettingsPreset(
          presetsState.presetName,
          cloneFlagSettings(settings),
          presetsState.selectedPresetId || undefined,
        );
        presetsState.selectedPresetId = saved.id;
        presetsState.presetName = saved.name;
        presetsState.status = `Saved "${saved.name}"`;
        await presetsState.refreshPresetList();
      } catch (error) {
        presetsState.status = error instanceof Error ? error.message : 'Save failed';
      } finally {
        statusController.updateDisplay();
      }
    },
    async loadPreset() {
      const selectedId = getSelectedPresetId();
      if (!selectedId) {
        presetsState.status = 'Select a preset to load';
        statusController.updateDisplay();
        return;
      }

      try {
        presetsState.status = 'Loading…';
        statusController.updateDisplay();
        const stored = await getFlagSettingsPreset(selectedId);
        if (!stored) {
          presetsState.status = 'Preset not found';
          statusController.updateDisplay();
          return;
        }

        await sim.loadSettingsPreset(stored.settings);
        presetsState.selectedPresetId = selectedId;
        presetsState.presetName = stored.name;
        refreshGuiControllers(gui);
        presetsState.status = `Loaded "${stored.name}"`;
      } catch (error) {
        presetsState.status = error instanceof Error ? error.message : 'Load failed';
      } finally {
        statusController.updateDisplay();
      }
    },
    async deletePreset() {
      const selectedId = getSelectedPresetId();
      if (!selectedId) {
        presetsState.status = 'Select a preset to delete';
        statusController.updateDisplay();
        return;
      }

      const name = presetSummaries.find((preset) => preset.id === selectedId)?.name;
      try {
        await deleteFlagSettingsPreset(selectedId);
        presetsState.selectedPresetId = '';
        presetsState.status = name ? `Deleted "${name}"` : 'Preset deleted';
        await presetsState.refreshPresetList();
      } catch (error) {
        presetsState.status = error instanceof Error ? error.message : 'Delete failed';
      } finally {
        statusController.updateDisplay();
      }
    },
    async exportPresetJson() {
      const selectedId = getSelectedPresetId();
      try {
        if (selectedId) {
          const stored = await getFlagSettingsPreset(selectedId);
          if (!stored) {
            presetsState.status = 'Preset not found';
            statusController.updateDisplay();
            return;
          }
          downloadJson(safePresetFilename(stored.name), {
            type: 'lavery-cloth-settings-preset',
            version: 1,
            preset: stored,
          });
          presetsState.status = `Exported "${stored.name}"`;
          statusController.updateDisplay();
          return;
        }

        const name = presetsState.presetName.trim() || 'Current settings';
        downloadJson(safePresetFilename(name), {
          type: 'lavery-cloth-settings-preset',
          version: 1,
          preset: {
            id: null,
            name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            settings: cloneFlagSettings(settings),
          },
        });
        presetsState.status = `Exported "${name}"`;
      } catch (error) {
        presetsState.status = error instanceof Error ? error.message : 'Export failed';
      } finally {
        statusController.updateDisplay();
      }
    },
  };

  const presetNameController = presetsFolder.add(presetsState, 'presetName').name('Preset name');
  presetNameController.domElement.setAttribute('data-testid', 'preset-name-input');
  const presetController = presetsFolder
    .add(presetsState, 'selectedPresetId', presetOptions)
    .name('Saved preset')
    .onChange(() => {
      const selected = presetSummaries.find((preset) => preset.id === presetsState.selectedPresetId);
      if (selected) {
        presetsState.presetName = selected.name;
        presetNameController.updateDisplay();
      }
    });
  presetController.domElement.setAttribute('data-testid', 'preset-select');

  const getSelectedPresetId = (): string => {
    const select = presetController.domElement.querySelector('select');
    if (select instanceof HTMLSelectElement) {
      return select.value;
    }
    return String(presetController.getValue() ?? '');
  };
  const savePresetController = presetsFolder.add(presetsState, 'savePreset').name('Save preset');
  savePresetController.domElement.setAttribute('data-testid', 'preset-save-btn');
  const loadPresetController = presetsFolder.add(presetsState, 'loadPreset').name('Load preset');
  loadPresetController.domElement.setAttribute('data-testid', 'preset-load-btn');
  const exportPresetController = presetsFolder.add(presetsState, 'exportPresetJson').name('Export JSON');
  exportPresetController.domElement.setAttribute('data-testid', 'preset-export-btn');
  presetsFolder.add(presetsState, 'deletePreset').name('Delete preset');
  const statusController = presetsFolder.add(presetsState, 'status').name('Status').disable();
  statusController.domElement.setAttribute('data-testid', 'preset-status');
  void presetsState.refreshPresetList();
  presetsFolder.open();

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add({ reset: () => sim.resetCamera() }, 'reset').name('Reset view');
  cameraFolder.add({ resetFlag: () => sim.resetFlag() }, 'resetFlag').name('Reset flag');
  cameraFolder
    .add(settings, 'showSimGridDebug')
    .name('Sim grid debug')
    .onChange(() => sim.setSimGridDebugVisible(settings.showSimGridDebug));

  const physicsFolder = gui.addFolder('Physics (PBD constraints)');
  physicsFolder
    .add(settings, 'constraintIterations', 1, 48, 1)
    .name('Constraint iterations')
    .onChange(sync);
  physicsFolder.add(settings, 'bendStiffness', 0, 1, 0.01).name('Bend stiff').onChange(sync);
  physicsFolder
    .add(settings, 'minCompression', 0.7, 1, 0.01)
    .name('Min compression')
    .onChange(sync);
  physicsFolder.add(settings, 'clothThickness', 0.005, 0.06, 0.001).name('Cloth thickness').onChange(sync);
  physicsFolder.add(settings, 'selfCollision').name('Self collision').onChange(sync);
  physicsFolder.add(settings, 'poleCollision').name('Pole collision').onChange(sync);
  physicsFolder.add(settings, 'dampening', 0.8, 0.9999, 0.0001).name('Dampening').onChange(sync);
  physicsFolder.add(settings, 'gravity', 0, 0.001, 0.00001).name('Gravity').onChange(sync);
  if (options.collisionUi === 'boneSdf') {
    const sdfFolder = gui.addFolder('Bone SDF collision');
    sdfFolder
      .add(settings, 'mannequinMargin', 0, 0.05, 0.001)
      .name('Collider clearance')
      .onChange(sync);
    sdfFolder
      .add(settings, 'mannequinFriction', 0, 0.95, 0.01)
      .name('Contact friction')
      .onChange(sync);
    sdfFolder.open();
  } else {
    physicsFolder.add(settings, 'mannequinCollision').name('Mannequin collision').onChange(sync);
    physicsFolder.add(settings, 'showMannequin').name('Show mannequin').onChange(sync);
    physicsFolder.add(settings, 'mannequinMargin', 0, 0.05, 0.001).name('Mannequin margin').onChange(sync);
    physicsFolder.add(settings, 'mannequinFriction', 0, 0.95, 0.01).name('Mannequin friction').onChange(sync);
  }

  const tearingFolder = gui.addFolder('Tearing & BB');
  tearingFolder
    .add(settings, 'tearStretchThreshold', 1.0, 20.0, 0.01)
    .name('Strain tear ratio')
    .onChange(sync);
  tearingFolder
    .add(settings, 'tearFringeWidth', 0.01, 0.35, 0.005)
    .name('Tear fringe width')
    .onChange(sync);
  tearingFolder
    .add(settings, 'tearMeshing', ['edge-cull', 'sdf'])
    .name('Tear meshing')
    .onChange(sync);
  tearingFolder
    .add(settings, 'tearSdfCornerRadius', 0, 0.49, 0.01)
    .name('SDF hole radius')
    .onChange(sync);
  tearingFolder.add(settings, 'showBridgeSplinters').name('Show strand bridges').onChange(sync);
  tearingFolder.add(settings, 'renderStrandThreads').name('Strand threads (visual)').onChange(sync);
  tearingFolder
    .add(settings, 'strandThreadRadius', 0.001, 0.02, 0.0005)
    .name('Thread radius')
    .onChange(sync);
  tearingFolder.add(settings, 'bbSpeed', 0, 80, 1).name('BB speed').onChange(sync);
  tearingFolder
    .add(settings, 'bbVisualRadius', 0.005, 0.08, 0.001)
    .name('BB size')
    .onChange(sync);
  tearingFolder
    .add(settings, 'bbHitRadius', 0.01, 0.2, 0.001)
    .name('BB force reach')
    .onChange(sync);
  tearingFolder
    .add(settings, 'bbForceStrength', 0, 5, 0.05)
    .name('BB force strength')
    .onChange(sync);
  tearingFolder
    .add(settings, 'bbRestitution', 0, 1, 0.01)
    .name('BB bounce')
    .onChange(sync);
  tearingFolder
    .add(settings, 'bbFabricSoftness', 0.1, 1, 0.01)
    .name('Fabric softness')
    .onChange(sync);
  tearingFolder.open();

  const windFolder = gui.addFolder('Wind');
  windFolder.add(settings, 'windStrength', 0, 20, 0.1).name('Strength').onChange(sync);
  windFolder.add(settings, 'windTurbulence', 0, 10, 0.05).name('Turbulence').onChange(sync);
  windFolder.add(settings, 'windDirectionX', -2, 2, 0.01).name('Dir X').onChange(sync);
  windFolder.add(settings, 'windDirectionY', -2, 2, 0.01).name('Dir Y').onChange(sync);
  windFolder.add(settings, 'windDirectionZ', -2, 2, 0.01).name('Dir Z').onChange(sync);

  const zoneAFolder = windFolder.addFolder('Zone A');
  zoneAFolder.add(settings, 'zoneAStrength', 0, 10, 0.05).name('Strength').onChange(sync);
  zoneAFolder.add(settings, 'zoneARadius', 0.05, 8, 0.05).name('Radius').onChange(sync);
  zoneAFolder.add(settings, 'zoneASpeed', 0, 5, 0.01).name('Move speed').onChange(sync);
  zoneAFolder.add(settings, 'zoneADirX', -2, 2, 0.01).name('Dir X').onChange(sync);
  zoneAFolder.add(settings, 'zoneADirY', -2, 2, 0.01).name('Dir Y').onChange(sync);
  zoneAFolder.add(settings, 'zoneADirZ', -2, 2, 0.01).name('Dir Z').onChange(sync);

  const zoneBFolder = windFolder.addFolder('Zone B');
  zoneBFolder.add(settings, 'zoneBStrength', 0, 10, 0.05).name('Strength').onChange(sync);
  zoneBFolder.add(settings, 'zoneBRadius', 0.05, 8, 0.05).name('Radius').onChange(sync);
  zoneBFolder.add(settings, 'zoneBSpeed', 0, 5, 0.01).name('Move speed').onChange(sync);
  zoneBFolder.add(settings, 'zoneBDirX', -2, 2, 0.01).name('Dir X').onChange(sync);
  zoneBFolder.add(settings, 'zoneBDirY', -2, 2, 0.01).name('Dir Y').onChange(sync);
  zoneBFolder.add(settings, 'zoneBDirZ', -2, 2, 0.01).name('Dir Z').onChange(sync);

  const resolutionFolder = gui.addFolder('Resolution');
  resolutionFolder
    .add(settings, 'renderSubdivisions', 1, 10, 1)
    .name('Render subdiv (×sim)')
    .onFinishChange(() => {
      void sim.rebuildRenderMesh();
    });
  resolutionFolder
    .add(settings, 'renderGeometrySmoothing', 0, 3, 0.01)
    .name('Geometry smooth')
    .onChange(sync);
  const resolutionPresets = {
    preset: 'Medium',
    applyPreset() {
      const presets: Record<string, { segmentsX: number; segmentsY: number }> = {
        Low: { segmentsX: 16, segmentsY: 8 },
        Medium: { segmentsX: 32, segmentsY: 12 },
        High: { segmentsX: 48, segmentsY: 18 },
        Ultra: { segmentsX: 64, segmentsY: 24 },
      };
      const next = presets[resolutionPresets.preset];
      if (!next) return;
      settings.segmentsX = next.segmentsX;
      settings.segmentsY = next.segmentsY;
      segmentsXController.updateDisplay();
      segmentsYController.updateDisplay();
      void sim.rebuildFlag();
    },
  };

  const segmentsXController = resolutionFolder
    .add(settings, 'segmentsX', 4, 128, 1)
    .name('Segments X (fly)')
    .onFinishChange(() => {
      void sim.rebuildFlag();
    });
  const segmentsYController = resolutionFolder
    .add(settings, 'segmentsY', 4, 96, 1)
    .name('Segments Y (hoist)')
    .onFinishChange(() => {
      void sim.rebuildFlag();
    });
  resolutionFolder
    .add(resolutionPresets, 'preset', ['Low', 'Medium', 'High', 'Ultra'])
    .name('Preset')
    .onChange(() => resolutionPresets.applyPreset());

  const materialFolder = gui.addFolder('Flag');
  materialFolder.addColor(settings, 'flagColor').name('Color').onChange(sync);
  materialFolder.add(settings, 'flatShading').name('Flat shading').onChange(sync);
  materialFolder.add(settings, 'roughness', 0, 1, 0.01).name('Roughness').onChange(sync);
  materialFolder.add(settings, 'sheen', 0, 1, 0.01).name('Sheen').onChange(sync);
  materialFolder.add(settings, 'sheenRoughness', 0, 1, 0.01).name('Sheen rough').onChange(sync);
  materialFolder.add(settings, 'emissiveIntensity', 0, 3, 0.01).name('Emissive').onChange(sync);

  const fabricFolder = materialFolder.addFolder('Fabric weave');
  fabricFolder
    .add(settings, 'fabricTextureSource', ['procedural', 'denim-512'])
    .name('Texture source')
    .onFinishChange(() => {
      void sim.rebuildRenderMesh();
    });
  fabricFolder.add(settings, 'fabricColorTint', 0, 1, 0.01).name('Color tint').onChange(sync);
  fabricFolder.add(settings, 'fabricNormalStrength', 0, 2, 0.01).name('Weave strength').onChange(sync);
  fabricFolder.add(settings, 'fabricNormalScale', 0, 2, 0.01).name('Weave scale').onChange(sync);
  fabricFolder.add(settings, 'fabricTiling', 1, 24, 0.5).name('Weave tiling').onChange(sync);
  fabricFolder.open();

  const lightingFolder = gui.addFolder('Lighting');
  lightingFolder.add(settings, 'exposure', 0.1, 6, 0.01).name('Exposure').onChange(sync);
  lightingFolder.add(settings, 'ambientIntensity', 0, 5, 0.01).name('Ambient').onChange(sync);
  lightingFolder.add(settings, 'hemiIntensity', 0, 6, 0.01).name('Hemisphere').onChange(sync);
  lightingFolder.add(settings, 'keyLightIntensity', 0, 10, 0.01).name('Key light').onChange(sync);
  lightingFolder.add(settings, 'fillLightIntensity', 0, 10, 0.01).name('Fill light').onChange(sync);
  lightingFolder.add(settings, 'backLightIntensity', 0, 10, 0.01).name('Back light').onChange(sync);
  lightingFolder.add(settings, 'rimLightIntensity', 0, 10, 0.01).name('Rim light').onChange(sync);

  physicsFolder.open();
  resolutionFolder.open();
  windFolder.open();
  materialFolder.open();

  return gui;
}
