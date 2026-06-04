import type { AnimatedCharacterSceneRig } from '../../character/AnimatedCharacter.ts';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export function createBreastPhysicsPanelDefinition(
  rig: AnimatedCharacterSceneRig,
): DevPanelDefinition {
  return {
    id: 'breast-physics',
    title: 'Breast physics',
    side: 'left',
    testId: 'character-breast-controls',
    defaultOpen: false,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Breast physics',
        testId: 'character-breast-controls',
      });
      const bp = rig.getBreastPhysics();
      const bpConfig = bp.config;
      gui.add(bpConfig, 'stiffnessY', 10, 200, 1).name('Stiffness Y');
      gui.add(bpConfig, 'stiffnessX', 10, 200, 1).name('Stiffness X');
      gui.add(bpConfig, 'stiffnessZ', 10, 200, 1).name('Stiffness Z');
      gui.add(bpConfig, 'dampingY', 0.5, 20, 0.1).name('Damping Y');
      gui.add(bpConfig, 'dampingX', 0.5, 20, 0.1).name('Damping X');
      gui.add(bpConfig, 'dampingZ', 0.5, 20, 0.1).name('Damping Z');
      gui.add(bpConfig, 'responseY', 0.01, 0.5, 0.005).name('Response Y');
      gui.add(bpConfig, 'responseX', 0.01, 0.5, 0.005).name('Response X');
      gui.add(bpConfig, 'responseZ', 0.01, 0.5, 0.005).name('Response Z');
      gui.add(bpConfig, 'maxOffsetY', 0.01, 0.2, 0.005).name('Max offset Y');
      gui.add(bpConfig, 'maxOffsetX', 0.01, 0.2, 0.005).name('Max offset X');
      gui.add(bpConfig, 'maxOffsetZ', 0.01, 0.2, 0.005).name('Max offset Z');
      gui.add({ slap: () => bp.applyImpulse('both', 0, 1.0, -1.5) }, 'slap').name('Test slap');
      gui.add({ reset: () => bp.reset() }, 'reset').name('Reset springs');
      return gui;
    },
  };
}

export function createButtPhysicsPanelDefinition(
  rig: AnimatedCharacterSceneRig,
): DevPanelDefinition {
  return {
    id: 'butt-physics',
    title: 'Butt physics',
    side: 'left',
    testId: 'character-butt-controls',
    defaultOpen: false,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Butt physics',
        testId: 'character-butt-controls',
      });
      const buttPlacement = rig.buttPlacement;
      gui.add(buttPlacement, 'dropY', 0, 0.25, 0.005).name('Drop');
      gui.add(buttPlacement, 'backZ', 0.04, 0.25, 0.005).name('Back offset');
      gui.add(buttPlacement, 'sideX', 0.05, 0.2, 0.005).name('Side spread');
      gui.add(buttPlacement, 'radius', 0.04, 0.2, 0.005).name('Capsule size');
      const buttShape = rig.buttShape;
      gui.add(buttShape, 'volume', 0, 3, 0.05).name('Volume');
      gui.add(buttShape, 'lift', -1, 2, 0.05).name('Lift');
      gui.add(buttShape, 'projection', 0, 0.4, 0.01).name('Projection');
      gui.add(buttShape, 'width', -2, 2, 0.05).name('Width');
      const buttPhysics = rig.getButtPhysics();
      const buttConfig = buttPhysics.config;
      gui.add(buttConfig, 'stiffnessY', 10, 200, 1).name('Stiffness Y');
      gui.add(buttConfig, 'stiffnessX', 10, 200, 1).name('Stiffness X');
      gui.add(buttConfig, 'stiffnessZ', 10, 200, 1).name('Stiffness Z');
      gui.add(buttConfig, 'dampingY', 0.5, 20, 0.1).name('Damping Y');
      gui.add(buttConfig, 'dampingX', 0.5, 20, 0.1).name('Damping X');
      gui.add(buttConfig, 'dampingZ', 0.5, 20, 0.1).name('Damping Z');
      gui.add(buttConfig, 'responseY', 0.01, 0.5, 0.005).name('Response Y');
      gui.add(buttConfig, 'responseX', 0.01, 0.5, 0.005).name('Response X');
      gui.add(buttConfig, 'responseZ', 0.01, 0.5, 0.005).name('Response Z');
      gui.add(buttConfig, 'maxOffsetY', 0.01, 0.2, 0.005).name('Max offset Y');
      gui.add(buttConfig, 'maxOffsetX', 0.01, 0.2, 0.005).name('Max offset X');
      gui.add(buttConfig, 'maxOffsetZ', 0.01, 0.2, 0.005).name('Max offset Z');
      gui.add({ slap: () => buttPhysics.applyImpulse('both', 0, 1.0, 1.5) }, 'slap').name('Test slap');
      gui.add({ reset: () => buttPhysics.reset() }, 'reset').name('Reset springs');
      return gui;
    },
  };
}

export function createEyeBlinkPanelDefinition(
  rig: AnimatedCharacterSceneRig,
): DevPanelDefinition {
  return {
    id: 'eye-blink',
    title: 'Eye blink',
    side: 'left',
    testId: 'character-eye-controls',
    defaultOpen: false,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Eye blink',
        testId: 'character-eye-controls',
      });
      const eyeConfig = rig.eyeBlink.config;
      gui.add(eyeConfig, 'enabled').name('Auto-blink');
      gui.add(eyeConfig, 'minInterval', 0.5, 10, 0.1).name('Min interval');
      gui.add(eyeConfig, 'maxInterval', 1, 15, 0.1).name('Max interval');
      gui.add(eyeConfig, 'blinkDuration', 0.05, 0.5, 0.01).name('Blink speed');
      gui.add(eyeConfig, 'doubleBlinkChance', 0, 1, 0.05).name('Double-blink chance');
      gui.add(eyeConfig, 'manualClose', 0, 1, 0.01).name('Manual close');
      gui.add({ blink: () => rig.eyeBlink.triggerBlink() }, 'blink').name('Blink now');
      return gui;
    },
  };
}
