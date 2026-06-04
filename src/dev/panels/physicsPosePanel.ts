import type GUI from 'lil-gui';
import type { AnimatedCharacterSceneRig } from '../../character/AnimatedCharacter.ts';
import type { PhysicsPoseRigConfig } from '../../character/physicsPoseRig.ts';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export type DuelPhysicsPoseFighter = 'A' | 'B';

export interface PhysicsPosePanelRigSource {
  readonly label?: string;
  getRig(): AnimatedCharacterSceneRig;
}

export interface PhysicsPosePanelOptions {
  readonly id: string;
  readonly title: string;
  readonly testId: string;
  readonly side?: 'left' | 'right';
  readonly defaultOpen?: boolean;
  /** Single rig (character mode). */
  readonly rig?: AnimatedCharacterSceneRig;
  /** A/B selector (duel mode). */
  readonly rigA?: AnimatedCharacterSceneRig;
  readonly rigB?: AnimatedCharacterSceneRig;
}

function bindPhysicsPoseGui(
  gui: GUI,
  getRig: () => AnimatedCharacterSceneRig,
): void {
  const uiState = { showTarget: false };

  const configProxy = new Proxy({} as PhysicsPoseRigConfig, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') {
        return undefined;
      }
      return getRig().getPhysicsPoseConfig()[prop as keyof PhysicsPoseRigConfig];
    },
    set(_target, prop: string | symbol, value: unknown) {
      if (typeof prop !== 'string') {
        return false;
      }
      (getRig().getPhysicsPoseConfig() as Record<string, unknown>)[prop] = value;
      return true;
    },
  });

  gui.add(configProxy, 'enabled').name('Enabled');
  gui.add(configProxy, 'globalFollow', 0, 1, 0.01).name('Global follow');

  const poseSpine = gui.addFolder('Spine');
  poseSpine.add(configProxy, 'stiffnessSpine', 4, 120, 1).name('Stiffness');
  poseSpine.add(configProxy, 'dampingSpine', 0.5, 40, 0.5).name('Damping');
  poseSpine.add(configProxy, 'maxAngularSpeedSpine', 1, 20, 0.5).name('Max speed rad/s');

  const poseArms = gui.addFolder('Arms');
  poseArms.add(configProxy, 'stiffnessArm', 4, 120, 1).name('Stiffness');
  poseArms.add(configProxy, 'dampingArm', 0.5, 40, 0.5).name('Damping');
  poseArms.add(configProxy, 'maxAngularSpeedArm', 1, 24, 0.5).name('Max speed rad/s');

  const poseHands = gui.addFolder('Hands');
  poseHands.add(configProxy, 'stiffnessHand', 4, 120, 1).name('Stiffness');
  poseHands.add(configProxy, 'dampingHand', 0.5, 40, 0.5).name('Damping');
  poseHands.add(configProxy, 'maxAngularSpeedHand', 1, 28, 0.5).name('Max speed rad/s');

  const poseLegs = gui.addFolder('Legs');
  poseLegs.add(configProxy, 'stiffnessLeg', 4, 120, 1).name('Stiffness');
  poseLegs.add(configProxy, 'dampingLeg', 0.5, 40, 0.5).name('Damping');
  poseLegs.add(configProxy, 'maxAngularSpeedLeg', 1, 20, 0.5).name('Max speed rad/s');

  const poseHead = gui.addFolder('Head');
  poseHead.add(configProxy, 'stiffnessHead', 4, 120, 1).name('Stiffness');
  poseHead.add(configProxy, 'dampingHead', 0.5, 40, 0.5).name('Damping');
  poseHead.add(configProxy, 'maxAngularSpeedHead', 1, 18, 0.5).name('Max speed rad/s');

  gui.add(uiState, 'showTarget').name('Show target rig').onChange((visible: boolean) => {
    getRig().setPhysicsPoseTargetRigVisible(visible);
  });
  gui.add({ snap: () => getRig().getPhysicsPoseRig().snapDisplayToTarget() }, 'snap').name('Snap display to target');
}

export function createPhysicsPosePanelDefinition(
  options: PhysicsPosePanelOptions,
): DevPanelDefinition {
  const hasDuelRigs = options.rigA !== undefined && options.rigB !== undefined;
  const hasSingleRig = options.rig !== undefined;
  if (hasDuelRigs === hasSingleRig) {
    throw new Error('Physics pose panel requires either rig or rigA+rigB');
  }

  return {
    id: options.id,
    title: options.title,
    side: options.side ?? 'left',
    testId: options.testId,
    defaultOpen: options.defaultOpen,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: options.title,
        testId: options.testId,
      });

      if (options.rig) {
        bindPhysicsPoseGui(gui, () => options.rig!);
        return gui;
      }

      const selector = { fighter: 'A' as DuelPhysicsPoseFighter };
      const getActiveRig = (): AnimatedCharacterSceneRig => (
        selector.fighter === 'B' ? options.rigB! : options.rigA!
      );

      gui.add(selector, 'fighter', { A: 'Fighter A', B: 'Fighter B' }).name('Fighter').onChange(() => {
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
        getActiveRig().setPhysicsPoseTargetRigVisible(false);
      });

      bindPhysicsPoseGui(gui, getActiveRig);
      return gui;
    },
  };
}
