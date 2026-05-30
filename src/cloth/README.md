# Cloth Module

Reusable entrypoint for the WebGPU cloth simulation package.

```ts
import {
  createClothControls,
  createClothSimulation,
  defaultClothSettings,
  normalizeClothSettings,
} from './cloth';

const simulation = await createClothSimulation({
  container: document.body,
  statusEl,
  backendEl,
  particlesEl,
});

createClothControls(simulation);
simulation.loadSettingsPreset(
  normalizeClothSettings({
    ...defaultClothSettings(),
    segmentsX: 64,
    segmentsY: 32,
  }),
);
```

The current implementation is still backed by `InextensibleFlagSimulation`, but consumers should import through `src/cloth` so future garment, panel, or pattern-based cloth implementations can replace the backend without changing app code.

Exports include:

- Simulation factory and settings helpers.
- The right-side lil-gui control panel.
- Matte cotton material helpers and denim texture loading.
- SDF tear meshing/topology utilities.
- Test/audit report types for regression coverage.
