import type { ClothSimulation } from '../cloth';
import type { AnimatedCharacterSceneRig } from '../character/AnimatedCharacter.ts';
import {
  createGarmentStudioControls,
  type GarmentStudioControls,
} from '../garments/GarmentStudioControls';
import type { GarmentPresetEnvelope } from '../garments/garmentSchema';
import { embedGuiInDock } from '../ui/ControlsDock.ts';
import { createDevMenuShell, type DevMenuShell } from './DevMenuShell.ts';
import {
  createBreastPhysicsPanelDefinition,
  createButtPhysicsPanelDefinition,
  createEyeBlinkPanelDefinition,
} from './panels/characterBodyPanels.ts';
import { createClothPanelDefinition } from './panels/clothPanel.ts';
import { createPhysicsPosePanelDefinition } from './panels/physicsPosePanel.ts';
import type { DevPanelDefinition } from './DevMenuShell.ts';

export interface RegisterCharacterDevMenuOptions {
  readonly cloth: ClothSimulation;
  readonly rig: AnimatedCharacterSceneRig;
  readonly toolbar?: HTMLElement | null;
  readonly initialGarmentPreset: GarmentPresetEnvelope;
  readonly onGarmentGenerate: (preset: GarmentPresetEnvelope) => Promise<void>;
  readonly onGarmentFitDebugChange: (visible: boolean) => void;
}

export interface CharacterDevMenu extends DevMenuShell {
  readonly garmentControls: GarmentStudioControls;
}

export function registerCharacterDevMenu(
  options: RegisterCharacterDevMenuOptions,
): CharacterDevMenu {
  const menu = createDevMenuShell({
    toolbar: options.toolbar,
    menuLabel: 'Dev',
    menuTestId: 'dev-menu-btn',
  });

  menu.register(createClothPanelDefinition(options.cloth, {
    id: 'character-cloth',
    title: 'Animated Character Cloth',
    testId: 'character-controls',
    collisionUi: 'boneSdf',
    defaultOpen: true,
  }));

  const garmentControls = createGarmentStudioControls({
    title: 'Character Clothing Generator',
    testId: 'character-garment-generator-controls',
    position: 'left',
    initialPreset: options.initialGarmentPreset,
    showServerFixture: false,
    showExport: true,
    onGenerate: options.onGarmentGenerate,
  });
  garmentControls.gui.open();

  const garmentPanel: DevPanelDefinition = {
    id: 'character-garment',
    title: 'Garment generator',
    side: 'left',
    testId: 'character-garment-generator-controls',
    defaultOpen: true,
    create: (container) => {
      const guiEl = garmentControls.gui.domElement;
      guiEl.remove();
      container.appendChild(guiEl);
      embedGuiInDock(guiEl);
      const garmentDebugState = { fitDebugVisible: false };
      garmentControls.gui
        .add(garmentDebugState, 'fitDebugVisible')
        .name('Show fit debug')
        .onChange(options.onGarmentFitDebugChange);
      return garmentControls.gui;
    },
  };
  menu.register(garmentPanel);

  menu.register(createPhysicsPosePanelDefinition({
    id: 'character-physics-pose',
    title: 'Physics pose',
    testId: 'character-physics-pose-controls',
    side: 'left',
    defaultOpen: false,
    rig: options.rig,
  }));
  menu.register(createBreastPhysicsPanelDefinition(options.rig));
  menu.register(createButtPhysicsPanelDefinition(options.rig));
  menu.register(createEyeBlinkPanelDefinition(options.rig));

  return Object.assign(menu, { garmentControls });
}
