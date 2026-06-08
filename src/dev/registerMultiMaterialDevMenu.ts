import type { ClothSimulation } from '../cloth';
import {
  deleteClothMaterial,
  fetchClothMaterialLibrary,
  upsertClothMaterial,
} from '../cloth/clothMaterialsLibrary.ts';
import {
  createClothMaterialDefinition,
  duplicateClothMaterial,
  type ClothMaterialDefinition,
  type ClothMaterialLibrary,
} from '../cloth/clothMaterialSchema.ts';
import { getMyPresetSettings } from '../cloth/myPresetDefaults.ts';
import { createDevMenuShell, createDockedGui, type DevPanelDefinition } from './DevMenuShell.ts';
import { createClothPanelDefinition } from './panels/clothPanel.ts';

export function registerMultiMaterialDevMenu(options: {
  readonly toolbar?: HTMLElement | null;
  readonly cloth: ClothSimulation;
  readonly library: ClothMaterialLibrary;
}): void {
  const menu = createDevMenuShell({ toolbar: options.toolbar, menuLabel: 'Dev' });
  menu.register(createClothPanelDefinition(options.cloth, {
    id: 'multi-material-cloth',
    title: 'Multi-Material Cloth',
    testId: 'multi-material-controls',
    collisionUi: 'mannequin',
    defaultOpen: true,
  }));

  let library = options.library;
  let activeMaterialId = library.materials[0]?.id ?? '';
  const libraryState = { materialId: activeMaterialId };

  const materialsPanel: DevPanelDefinition = {
    id: 'cloth-materials',
    title: 'Cloth materials',
    side: 'left',
    testId: 'cloth-materials-controls',
    defaultOpen: true,
    create: (container) => {
      const panelGui = createDockedGui(container, {
        title: 'Cloth materials',
        testId: 'cloth-materials-controls',
        width: 360,
      });

      const editor = {
        name: '',
        color: '#ffffff',
        dampening: 0.9925,
        tearStretchThreshold: 4,
        friction: 0.85,
      };

      let materialController: ReturnType<typeof panelGui.add> | null = null;

      const syncEditors = (): void => {
        const material = library.materials.find((m) => m.id === activeMaterialId);
        if (!material) {
          return;
        }
        editor.name = material.name;
        editor.color = material.color;
        editor.dampening = material.settings.dampening ?? editor.dampening;
        editor.tearStretchThreshold = material.settings.tearStretchThreshold ?? editor.tearStretchThreshold;
        editor.friction = material.physics.friction;
        panelGui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      };

      const refreshMaterialList = (): void => {
        materialController?.destroy();
        const names = Object.fromEntries(library.materials.map((m) => [m.id, m.name]));
        materialController = panelGui.add(libraryState, 'materialId', names).name('Material');
        materialController.onChange(() => {
          activeMaterialId = libraryState.materialId;
          syncEditors();
        });
      };

      refreshMaterialList();
      syncEditors();

      panelGui.add(editor, 'name').name('Name');
      panelGui.addColor(editor, 'color').name('Color');
      panelGui.add(editor, 'dampening', 0.9, 0.9999, 0.0001).name('Dampening');
      panelGui.add(editor, 'tearStretchThreshold', 0.5, 8, 0.05).name('Tear threshold');
      panelGui.add(editor, 'friction', 0, 1, 0.01).name('Friction');

      panelGui.add({
        save: async () => {
          const existing = library.materials.find((m) => m.id === activeMaterialId);
          if (!existing) {
            return;
          }
          const updated: ClothMaterialDefinition = {
            ...existing,
            name: editor.name,
            color: editor.color,
            updatedAt: Date.now(),
            settings: {
              ...existing.settings,
              dampening: editor.dampening,
              tearStretchThreshold: editor.tearStretchThreshold,
              flagColor: editor.color,
            },
            physics: { ...existing.physics, friction: editor.friction },
          };
          await upsertClothMaterial(updated);
          library = await fetchClothMaterialLibrary();
          refreshMaterialList();
          syncEditors();
        },
      }, 'save').name('Save material');

      panelGui.add({
        duplicate: async () => {
          const existing = library.materials.find((m) => m.id === activeMaterialId);
          if (!existing) {
            return;
          }
          const copy = duplicateClothMaterial(existing, `${existing.name} copy`);
          await upsertClothMaterial(copy);
          library = await fetchClothMaterialLibrary();
          libraryState.materialId = copy.id;
          activeMaterialId = copy.id;
          refreshMaterialList();
          syncEditors();
        },
      }, 'duplicate').name('Duplicate');

      panelGui.add({
        create: async () => {
          const base = getMyPresetSettings();
          const created = createClothMaterialDefinition('New material', {
            settings: base,
            color: base.flagColor,
          });
          await upsertClothMaterial(created);
          library = await fetchClothMaterialLibrary();
          libraryState.materialId = created.id;
          activeMaterialId = created.id;
          refreshMaterialList();
          syncEditors();
        },
      }, 'create').name('New material');

      panelGui.add({
        remove: async () => {
          if (library.materials.length <= 1) {
            return;
          }
          await deleteClothMaterial(activeMaterialId);
          library = await fetchClothMaterialLibrary();
          libraryState.materialId = library.materials[0]!.id;
          activeMaterialId = libraryState.materialId;
          refreshMaterialList();
          syncEditors();
        },
      }, 'remove').name('Delete');

      return panelGui;
    },
  };

  menu.register(materialsPanel);
}
