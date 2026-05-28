import GUI from 'lil-gui';
import type { InextensibleFlagSimulation } from '../sim/InextensibleFlagSimulation';

export function createInextensibleFlagControls(sim: InextensibleFlagSimulation): GUI {
  const gui = new GUI({ title: 'Inextensible Flag', width: 320 });
  gui.domElement.setAttribute('data-testid', 'flag-controls');
  gui.domElement.style.position = 'fixed';
  gui.domElement.style.top = '12px';
  gui.domElement.style.right = '12px';
  gui.domElement.style.zIndex = '20';
  gui.domElement.style.maxHeight = 'calc(100vh - 24px)';
  gui.domElement.style.overflow = 'auto';

  const settings = sim.settings;
  const sync = () => sim.applySettings();

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add({ reset: () => sim.resetCamera() }, 'reset').name('Reset view');

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
