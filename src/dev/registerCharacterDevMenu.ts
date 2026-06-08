import type { ClothSimulation } from '../cloth';
import type { AnimatedCharacterSceneRig } from '../character/AnimatedCharacter.ts';
import {
  createGarmentStudioControls,
  type GarmentStudioControls,
} from '../garments/GarmentStudioControls';
import type { GarmentPresetEnvelope } from '../garments/garmentSchema';
import { embedGuiInDock } from '../ui/ControlsDock.ts';
import { makeDraggable } from '../ui/draggableFloating.ts';
import { createDevMenuShell, type DevMenuShell } from './DevMenuShell.ts';
import {
  createBreastPhysicsPanelDefinition,
  createButtPhysicsPanelDefinition,
  createEyeBlinkPanelDefinition,
} from './panels/characterBodyPanels.ts';
import { createClothPanelDefinition } from './panels/clothPanel.ts';
import { createCharacterSdfPanelDefinition } from './panels/characterSdfPanel.ts';
import { createPhysicsPosePanelDefinition } from './panels/physicsPosePanel.ts';
import type { DevPanelDefinition } from './DevMenuShell.ts';
import { createWrappedGarmentPanelDefinition } from './panels/wrappedGarmentPanel.ts';
import type { WrappedGarmentBuilderOptions, WrappedGarmentProofKind, WrappedGarmentProofReport } from '../garments/wrappedGarmentBuilder.ts';

export interface RegisterCharacterDevMenuOptions {
  readonly cloth: ClothSimulation;
  readonly rig: AnimatedCharacterSceneRig;
  readonly toolbar?: HTMLElement | null;
  readonly initialGarmentPreset: GarmentPresetEnvelope;
  readonly onGarmentGenerate: (preset: GarmentPresetEnvelope) => Promise<void>;
  readonly onGarmentFitDebugChange: (visible: boolean) => void;
  readonly onLoadWrappedProof?: (
    proof: WrappedGarmentProofKind,
    options?: WrappedGarmentBuilderOptions,
  ) => Promise<WrappedGarmentProofReport>;
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
  menu.register(createCharacterSdfPanelDefinition({
    id: 'character-sdf',
    title: 'Bone SDF tuning',
    testId: 'character-sdf-controls',
    side: 'left',
    defaultOpen: true,
    rig: options.rig,
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
      const garmentTitle = garmentControls.gui.domElement.querySelector<HTMLElement>('.lil-title');
      if (garmentTitle) {
        makeDraggable(container, { handle: garmentTitle });
      }
      return garmentControls.gui;
    },
  };
  menu.register(garmentPanel);

  if (options.onLoadWrappedProof) {
    menu.register(createWrappedGarmentPanelDefinition({
      onLoadProof: options.onLoadWrappedProof,
    }));
  }

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
