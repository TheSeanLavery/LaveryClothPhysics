import type GUI from 'lil-gui';
import {
  deleteClothMaterial,
  fetchClothMaterialLibrary,
  upsertClothMaterial,
} from '../../cloth/clothMaterialsLibrary.ts';
import { MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS } from '../../cloth/clothMaterialBend.ts';
import {
  createClothMaterialDefinition,
  duplicateClothMaterial,
  type ClothMaterialDefinition,
  type ClothMaterialLibrary,
} from '../../cloth/clothMaterialSchema.ts';
import { getMyPresetSettings } from '../../cloth/myPresetDefaults.ts';
import { createDockedGui, type DevPanelDefinition } from '../DevMenuShell.ts';
import type {
  ClothMaterialEditorField,
  ClothMaterialEditorState,
  ClothMaterialsPanelApi,
} from './clothMaterialsPanelApi.ts';

type GuiController = ReturnType<GUI['add']>;

export interface ClothMaterialsPanelOptions {
  readonly id?: string;
  readonly title?: string;
  readonly testId?: string;
  readonly side?: 'left' | 'right';
  readonly defaultOpen?: boolean;
  readonly library: ClothMaterialLibrary;
  readonly defaultMaterialName?: string;
  readonly onMaterialsChanged?: (library: ClothMaterialLibrary) => void | Promise<void>;
  readonly onPanelReady?: (api: ClothMaterialsPanelApi) => void;
  /** Apply the current editor fields to the running sim without persisting. */
  readonly onPreviewMaterial?: (
    materialId: string,
    draft: {
      readonly color: string;
      readonly dampening: number;
      readonly bendStiffness: number;
      readonly tearStretchThreshold: number;
      readonly tearThresholdScale: number;
      readonly structuralScale: number;
      readonly bendScale: number;
      readonly compressionScale: number;
    },
  ) => void | Promise<void>;
}

function resolveDefaultMaterialId(
  library: ClothMaterialLibrary,
  preferredName?: string,
): string {
  const preferred = preferredName
    ? library.materials.find((entry) => entry.name === preferredName)
    : undefined;
  if (preferred) {
    return preferred.id;
  }

  for (const binding of MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS) {
    const material = library.materials.find((entry) => entry.name === binding.libraryMaterialName);
    if (material) {
      return material.id;
    }
  }

  return library.materials[0]?.id ?? '';
}

export function createClothMaterialsPanelDefinition(
  options: ClothMaterialsPanelOptions,
): DevPanelDefinition {
  let library = options.library;
  let activeMaterialId = resolveDefaultMaterialId(library, options.defaultMaterialName);
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

      const controllers: Partial<Record<ClothMaterialEditorField, GuiController>> = {};
      let materialController: GuiController | null = null;

      const setControllerValue = (field: ClothMaterialEditorField, value: string | number): void => {
        const controller = controllers[field];
        if (!controller) {
          return;
        }
        controller.setValue(value);
        controller.updateDisplay();
      };

      const syncEditors = (): void => {
        const material = library.materials.find((entry) => entry.id === activeMaterialId);
        if (!material) {
          return;
        }

        const snapshot: ClothMaterialEditorState = {
          materialId: activeMaterialId,
          materialName: material.name,
          name: material.name,
          color: material.color,
          dampening: material.settings.dampening ?? editor.dampening,
          bendStiffness: material.settings.bendStiffness ?? editor.bendStiffness,
          tearStretchThreshold: material.settings.tearStretchThreshold ?? editor.tearStretchThreshold,
          tearThresholdScale: material.physics.tearThresholdScale,
          structuralScale: material.physics.structuralScale,
          bendScale: material.physics.bendScale,
          compressionScale: material.physics.compressionScale,
          friction: material.physics.friction,
          damageRate: material.physics.damageRate,
          maxHealth: material.physics.maxHealth,
        };

        editor.name = snapshot.name;
        editor.color = snapshot.color;
        editor.dampening = snapshot.dampening;
        editor.bendStiffness = snapshot.bendStiffness;
        editor.tearStretchThreshold = snapshot.tearStretchThreshold;
        editor.tearThresholdScale = snapshot.tearThresholdScale;
        editor.structuralScale = snapshot.structuralScale;
        editor.bendScale = snapshot.bendScale;
        editor.compressionScale = snapshot.compressionScale;
        editor.friction = snapshot.friction;
        editor.damageRate = snapshot.damageRate;
        editor.maxHealth = snapshot.maxHealth;

        (Object.keys(controllers) as ClothMaterialEditorField[]).forEach((field) => {
          setControllerValue(field, snapshot[field]);
        });
      };

      const refreshMaterialList = (): void => {
        const names = Object.fromEntries(library.materials.map((entry) => [entry.id, entry.name]));
        libraryState.materialId = activeMaterialId;
        if (!materialController) {
          materialController = panelGui.add(libraryState, 'materialId', names).name('Material');
          materialController.onChange(() => {
            activeMaterialId = libraryState.materialId;
            syncEditors();
          });
          return;
        }
        materialController.options(names);
        materialController.setValue(activeMaterialId);
        materialController.updateDisplay();
      };

      const previewMaterial = (): void => {
        void options.onPreviewMaterial?.(activeMaterialId, {
          color: editor.color,
          dampening: editor.dampening,
          bendStiffness: editor.bendStiffness,
          tearStretchThreshold: editor.tearStretchThreshold,
          tearThresholdScale: editor.tearThresholdScale,
          structuralScale: editor.structuralScale,
          bendScale: editor.bendScale,
          compressionScale: editor.compressionScale,
        });
      };

      refreshMaterialList();

      controllers.name = panelGui.add(editor, 'name').name('Name');
      controllers.color = panelGui.addColor(editor, 'color').name('Color').onChange(previewMaterial);

      const solverFolder = panelGui.addFolder('Solver');
      controllers.dampening = solverFolder
        .add(editor, 'dampening', 0.9, 0.9999, 0.0001)
        .name('Dampening')
        .onChange(previewMaterial);
      controllers.bendStiffness = solverFolder
        .add(editor, 'bendStiffness', 0, 0.2, 0.0005)
        .name('Bend stiffness')
        .onChange(previewMaterial);
      controllers.tearStretchThreshold = solverFolder
        .add(editor, 'tearStretchThreshold', 0.5, 20, 0.05)
        .name('Tear strain ratio')
        .onChange(previewMaterial);
      solverFolder.open();

      const physicsFolder = panelGui.addFolder('Physics multipliers');
      controllers.tearThresholdScale = physicsFolder
        .add(editor, 'tearThresholdScale', 0.05, 4, 0.05)
        .name('Tear scale')
        .onChange(previewMaterial);
      controllers.structuralScale = physicsFolder
        .add(editor, 'structuralScale', 0.05, 4, 0.05)
        .name('Structural scale')
        .onChange(previewMaterial);
      controllers.bendScale = physicsFolder
        .add(editor, 'bendScale', 0.05, 4, 0.05)
        .name('Bend scale')
        .onChange(previewMaterial);
      controllers.compressionScale = physicsFolder
        .add(editor, 'compressionScale', 0.05, 4, 0.05)
        .name('Compression scale')
        .onChange(previewMaterial);
      controllers.friction = physicsFolder.add(editor, 'friction', 0, 1, 0.01).name('Friction');
      controllers.damageRate = physicsFolder.add(editor, 'damageRate', 0.05, 4, 0.05).name('Damage rate');
      controllers.maxHealth = physicsFolder.add(editor, 'maxHealth', 0.05, 4, 0.05).name('Max health');
      physicsFolder.open();

      syncEditors();

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
        previewMaterial();
      };

      const panelApi: ClothMaterialsPanelApi = {
        getEditorState: () => {
          const material = library.materials.find((entry) => entry.id === activeMaterialId);
          return {
            materialId: activeMaterialId,
            materialName: material?.name ?? '',
            name: editor.name,
            color: editor.color,
            dampening: editor.dampening,
            bendStiffness: editor.bendStiffness,
            tearStretchThreshold: editor.tearStretchThreshold,
            tearThresholdScale: editor.tearThresholdScale,
            structuralScale: editor.structuralScale,
            bendScale: editor.bendScale,
            compressionScale: editor.compressionScale,
            friction: editor.friction,
            damageRate: editor.damageRate,
            maxHealth: editor.maxHealth,
          };
        },
        selectMaterialByName: (name) => {
          const material = library.materials.find((entry) => entry.name === name);
          if (!material) {
            return false;
          }
          activeMaterialId = material.id;
          libraryState.materialId = material.id;
          materialController?.updateDisplay();
          syncEditors();
          return true;
        },
        selectMaterialById: (id) => {
          const material = library.materials.find((entry) => entry.id === id);
          if (!material) {
            return false;
          }
          activeMaterialId = material.id;
          libraryState.materialId = material.id;
          materialController?.updateDisplay();
          syncEditors();
          return true;
        },
        setEditorField: (field, value) => {
          (editor as Record<string, string | number>)[field] = value;
          setControllerValue(field, value);
          previewMaterial();
        },
        previewActiveMaterial: previewMaterial,
        saveActiveMaterial: persistMaterial,
      };

      options.onPanelReady?.(panelApi);

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
