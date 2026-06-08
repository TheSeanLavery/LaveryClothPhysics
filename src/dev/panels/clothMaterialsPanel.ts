import {
  deleteClothMaterial,
  fetchClothMaterialLibrary,
  upsertClothMaterial,
} from '../../cloth/clothMaterialsLibrary.ts';
import {
  createClothMaterialDefinition,
  duplicateClothMaterial,
  type ClothMaterialDefinition,
  type ClothMaterialLibrary,
} from '../../cloth/clothMaterialSchema.ts';
import { getMyPresetSettings } from '../../cloth/myPresetDefaults.ts';
import { createDockedGui, type DevPanelDefinition } from '../DevMenuShell.ts';

export interface ClothMaterialsPanelOptions {
  readonly id?: string;
  readonly title?: string;
  readonly testId?: string;
  readonly side?: 'left' | 'right';
  readonly defaultOpen?: boolean;
  readonly library: ClothMaterialLibrary;
  readonly onMaterialsChanged?: (library: ClothMaterialLibrary) => void | Promise<void>;
  /** Apply the current editor fields to the running sim without persisting. */
  readonly onPreviewMaterial?: (
    materialId: string,
    draft: {
      readonly dampening: number;
      readonly bendStiffness: number;
      readonly tearStretchThreshold: number;
      readonly tearThresholdScale: number;
      readonly bendScale: number;
    },
  ) => void | Promise<void>;
}

export function createClothMaterialsPanelDefinition(
  options: ClothMaterialsPanelOptions,
): DevPanelDefinition {
  let library = options.library;
  let activeMaterialId = library.materials[0]?.id ?? '';
  const libraryState = { materialId: activeMaterialId };

  return {
    id: options.id ?? 'cloth-materials',
    title: options.title ?? 'Cloth materials',
    side: options.side ?? 'left',
    testId: options.testId ?? 'cloth-materials-controls',
    defaultOpen: options.defaultOpen ?? true,
    create: (container) => {
      const panelGui = createDockedGui(container, {
        title: options.title ?? 'Cloth materials',
        testId: options.testId ?? 'cloth-materials-controls',
        width: 360,
      });

      const editor = {
        name: '',
        color: '#ffffff',
        dampening: 0.9925,
        bendStiffness: 0.01,
        tearStretchThreshold: 4,
        tearThresholdScale: 1,
        structuralScale: 1,
        bendScale: 1,
        compressionScale: 1,
        friction: 0.85,
        damageRate: 1,
        maxHealth: 1,
      };

      let materialController: ReturnType<typeof panelGui.add> | null = null;

      const syncEditors = (): void => {
        const material = library.materials.find((entry) => entry.id === activeMaterialId);
        if (!material) {
          return;
        }
        editor.name = material.name;
        editor.color = material.color;
        editor.dampening = material.settings.dampening ?? editor.dampening;
        editor.bendStiffness = material.settings.bendStiffness ?? editor.bendStiffness;
        editor.tearStretchThreshold = material.settings.tearStretchThreshold ?? editor.tearStretchThreshold;
        editor.tearThresholdScale = material.physics.tearThresholdScale;
        editor.structuralScale = material.physics.structuralScale;
        editor.bendScale = material.physics.bendScale;
        editor.compressionScale = material.physics.compressionScale;
        editor.friction = material.physics.friction;
        editor.damageRate = material.physics.damageRate;
        editor.maxHealth = material.physics.maxHealth;
        panelGui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      };

      const refreshMaterialList = (): void => {
        materialController?.destroy();
        const names = Object.fromEntries(library.materials.map((entry) => [entry.id, entry.name]));
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

      const previewMaterial = (): void => {
        void options.onPreviewMaterial?.(activeMaterialId, {
          dampening: editor.dampening,
          bendStiffness: editor.bendStiffness,
          tearStretchThreshold: editor.tearStretchThreshold,
          tearThresholdScale: editor.tearThresholdScale,
          bendScale: editor.bendScale,
        });
      };

      const solverFolder = panelGui.addFolder('Solver');
      solverFolder.add(editor, 'dampening', 0.9, 0.9999, 0.0001).name('Dampening').onChange(previewMaterial);
      solverFolder.add(editor, 'bendStiffness', 0, 0.2, 0.0005).name('Bend stiffness').onChange(previewMaterial);
      solverFolder
        .add(editor, 'tearStretchThreshold', 0.5, 20, 0.05)
        .name('Tear strain ratio')
        .onChange(previewMaterial);
      solverFolder.open();

      const physicsFolder = panelGui.addFolder('Physics multipliers');
      physicsFolder
        .add(editor, 'tearThresholdScale', 0.05, 4, 0.05)
        .name('Tear scale')
        .onChange(previewMaterial);
      physicsFolder.add(editor, 'structuralScale', 0.05, 4, 0.05).name('Structural scale');
      physicsFolder.add(editor, 'bendScale', 0.05, 4, 0.05).name('Bend scale').onChange(previewMaterial);
      physicsFolder.add(editor, 'compressionScale', 0.05, 4, 0.05).name('Compression scale');
      physicsFolder.add(editor, 'friction', 0, 1, 0.01).name('Friction');
      physicsFolder.add(editor, 'damageRate', 0.05, 4, 0.05).name('Damage rate');
      physicsFolder.add(editor, 'maxHealth', 0.05, 4, 0.05).name('Max health');
      physicsFolder.open();

      const persistMaterial = async (): Promise<void> => {
        const existing = library.materials.find((entry) => entry.id === activeMaterialId);
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
            bendStiffness: editor.bendStiffness,
            tearStretchThreshold: editor.tearStretchThreshold,
            flagColor: editor.color,
          },
          physics: {
            ...existing.physics,
            tearThresholdScale: editor.tearThresholdScale,
            structuralScale: editor.structuralScale,
            bendScale: editor.bendScale,
            compressionScale: editor.compressionScale,
            friction: editor.friction,
            damageRate: editor.damageRate,
            maxHealth: editor.maxHealth,
          },
        };
        await upsertClothMaterial(updated);
        library = await fetchClothMaterialLibrary();
        await options.onMaterialsChanged?.(library);
        refreshMaterialList();
        syncEditors();
      };

      panelGui.add({ save: persistMaterial }, 'save').name('Save material');
      panelGui.add({
        duplicate: async () => {
          const existing = library.materials.find((entry) => entry.id === activeMaterialId);
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
}
