import type { ClothSimulation } from '../cloth';
import type { ClothMaterialLibrary } from '../cloth/clothMaterialSchema.ts';
import { createDevMenuShell } from './DevMenuShell.ts';
import { createClothPanelDefinition } from './panels/clothPanel.ts';
import { createClothMaterialsPanelDefinition } from './panels/clothMaterialsPanel.ts';

export function registerMultiMaterialDevMenu(options: {
  readonly toolbar?: HTMLElement | null;
  readonly cloth: ClothSimulation;
  readonly library: ClothMaterialLibrary;
  readonly onMaterialsChanged?: (library: ClothMaterialLibrary) => void | Promise<void>;
  readonly onPreviewMaterial?: Parameters<typeof createClothMaterialsPanelDefinition>[0]['onPreviewMaterial'];
}): void {
  const menu = createDevMenuShell({ toolbar: options.toolbar, menuLabel: 'Dev' });
  menu.register(createClothPanelDefinition(options.cloth, {
    id: 'multi-material-cloth',
    title: 'Multi-Material Cloth',
    testId: 'multi-material-controls',
    collisionUi: 'mannequin',
    defaultOpen: true,
  }));

  menu.register(createClothMaterialsPanelDefinition({
    library: options.library,
    onMaterialsChanged: options.onMaterialsChanged,
    onPreviewMaterial: options.onPreviewMaterial,
  }));
}
