import type { ClothSimulation } from '../cloth';
import type { CharacterDuelScene } from '../scenes/characterDuel/CharacterDuelScene.ts';
import { createDevMenuShell, type DevMenuShell } from './DevMenuShell.ts';
import { createClothPanelDefinition } from './panels/clothPanel.ts';
import { createCharacterSdfPanelDefinition } from './panels/characterSdfPanel.ts';
import { createDuelHealthPanelDefinition } from './panels/duelHealthPanel.ts';
import { createDuelFighterModelPanelDefinition } from './panels/duelFighterModelPanel.ts';
import { createDuelShirtPanelDefinition } from './panels/duelShirtPanel.ts';
import { createMovementSmoothingPanelDefinition } from './panels/movementSmoothingPanel.ts';
import { createPhysicsPosePanelDefinition } from './panels/physicsPosePanel.ts';

export interface RegisterDuelDevMenuOptions {
  readonly cloth: ClothSimulation;
  readonly duel: CharacterDuelScene;
  readonly toolbar?: HTMLElement | null;
}

export function registerDuelDevMenu(options: RegisterDuelDevMenuOptions): DevMenuShell {
  const menu = createDevMenuShell({
    toolbar: options.toolbar,
    menuLabel: 'Dev',
    menuTestId: 'dev-menu-btn',
  });

  menu.register(createDuelFighterModelPanelDefinition(options.duel));
  menu.register(createDuelHealthPanelDefinition(options.duel, options.cloth));
  menu.register(createDuelShirtPanelDefinition(options.duel));
  menu.register(createClothPanelDefinition(options.cloth, {
    id: 'duel-cloth',
    title: 'Character Duel Cloth',
    testId: 'duel-controls',
    collisionUi: 'boneSdf',
    defaultOpen: true,
  }));
  menu.register(createCharacterSdfPanelDefinition({
    id: 'duel-sdf',
    title: 'Bone SDF tuning',
    testId: 'duel-sdf-controls',
    side: 'left',
    defaultOpen: true,
    rigA: options.duel.rigA,
    rigB: options.duel.rigB,
    getSquashReport: () => options.duel.getMergedSquashReport(),
    getAllSquashRigs: () => [options.duel.rigA, options.duel.rigB],
  }));
  menu.register(createMovementSmoothingPanelDefinition(options.duel));
  menu.register(createPhysicsPosePanelDefinition({
    id: 'duel-physics-pose',
    title: 'Physics pose',
    testId: 'duel-physics-pose-controls',
    side: 'left',
    defaultOpen: false,
    rigA: options.duel.rigA,
    rigB: options.duel.rigB,
  }));

  return menu;
}
