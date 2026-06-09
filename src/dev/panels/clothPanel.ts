import { createClothControls, type ClothSimulation } from '../../cloth';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export interface ClothDevPanelOptions {
  readonly id?: string;
  readonly title: string;
  readonly testId: string;
  readonly side?: 'left' | 'right';
  readonly defaultOpen?: boolean;
  readonly collisionUi?: 'mannequin' | 'boneSdf';
  readonly perMaterialSolver?: boolean;
}

export function createClothPanelDefinition(
  cloth: ClothSimulation,
  options: ClothDevPanelOptions,
): DevPanelDefinition {
  return {
    id: options.id ?? 'cloth',
    title: options.title,
    side: options.side ?? 'right',
    testId: options.testId,
    defaultOpen: options.defaultOpen,
    create: (container) => createClothControls(cloth, {
      title: options.title,
      testId: `${options.testId}-gui`,
      collisionUi: options.collisionUi,
      perMaterialSolver: options.perMaterialSolver,
      container,
    }),
  };
}
