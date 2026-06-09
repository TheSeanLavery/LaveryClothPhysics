import type GUI from 'lil-gui';
import {
  deleteClothMaterial,
  fetchClothMaterialLibrary,
  upsertClothMaterial,
} from '../../cloth/clothMaterialsLibrary.ts';
import { MULTI_MATERIAL_LIBRARY_PATCH_BINDINGS } from '../../cloth/clothMaterialBend.ts';
import {
  CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES,
  CLOTH_SOLVER_SLIDER_RANGES,
} from '../../cloth/clothSolverSliderRanges.ts';
import {
  createClothMaterialDefinition,
  duplicateClothMaterial,
  type ClothMaterialDefinition,
  type ClothMaterialLibrary,
} from '../../cloth/clothMaterialSchema.ts';
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
      readonly structuralScale: number;
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
        structuralScale: 1,
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
          dampening: material.settings.dampening,
          bendStiffness: material.settings.bendStiffness,
          tearStretchThreshold: material.settings.tearStretchThreshold,
          structuralScale: material.physics.structuralScale,
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
        editor.structuralScale = snapshot.structuralScale;
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
          structuralScale: editor.structuralScale,
          compressionScale: editor.compressionScale,
        });
      };

      refreshMaterialList();

      controllers.name = panelGui.add(editor, 'name').name('Name');
      controllers.color = panelGui
        .addColor(editor, 'color')
        .name('Color')
        .onChange(previewMaterial)
        .onFinishChange(previewMaterial);

      const solverFolder = panelGui.addFolder('Solver');
      const dampeningRange = CLOTH_SOLVER_SLIDER_RANGES.dampening;
      const bendRange = CLOTH_SOLVER_SLIDER_RANGES.bendStiffness;
      const tearRange = CLOTH_SOLVER_SLIDER_RANGES.tearStretchThreshold;
      controllers.dampening = solverFolder
        .add(editor, 'dampening', dampeningRange.min, dampeningRange.max, dampeningRange.step)
        .name('Dampening')
        .onChange(previewMaterial);
      controllers.bendStiffness = solverFolder
        .add(editor, 'bendStiffness', bendRange.min, bendRange.max, bendRange.step)
        .name('Bend stiffness')
        .onChange(previewMaterial);
      controllers.tearStretchThreshold = solverFolder
        .add(editor, 'tearStretchThreshold', tearRange.min, tearRange.max, tearRange.step)
        .name('Tear strain ratio')
        .onChange(previewMaterial);
      solverFolder.open();

      const physicsFolder = panelGui.addFolder('Advanced (not wired yet)');
      const structuralRange = CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES.structuralScale;
      const compressionRange = CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES.compressionScale;
      const frictionRange = CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES.friction;
      const damageRange = CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES.damageRate;
      const healthRange = CLOTH_MATERIAL_PHYSICS_SLIDER_RANGES.maxHealth;
      controllers.structuralScale = physicsFolder
        .add(editor, 'structuralScale', structuralRange.min, structuralRange.max, structuralRange.step)
        .name('Structural scale')
        .onChange(previewMaterial);
      controllers.compressionScale = physicsFolder
        .add(editor, 'compressionScale', compressionRange.min, compressionRange.max, compressionRange.step)
        .name('Compression scale')
        .onChange(previewMaterial);
      controllers.friction = physicsFolder
        .add(editor, 'friction', frictionRange.min, frictionRange.max, frictionRange.step)
        .name('Friction');
      controllers.damageRate = physicsFolder
        .add(editor, 'damageRate', damageRange.min, damageRange.max, damageRange.step)
        .name('Damage rate');
      controllers.maxHealth = physicsFolder
        .add(editor, 'maxHealth', healthRange.min, healthRange.max, healthRange.step)
        .name('Max health');

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
            dampening: editor.dampening,
            bendStiffness: editor.bendStiffness,
            tearStretchThreshold: editor.tearStretchThreshold,
          },
          physics: {
            ...existing.physics,
            structuralScale: editor.structuralScale,
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
        getEditorState: () => ({
          materialId: activeMaterialId,
          materialName: library.materials.find((entry) => entry.id === activeMaterialId)?.name ?? '',
          name: editor.name,
          color: editor.color,
          dampening: editor.dampening,
          bendStiffness: editor.bendStiffness,
          tearStretchThreshold: editor.tearStretchThreshold,
          structuralScale: editor.structuralScale,
          compressionScale: editor.compressionScale,
          friction: editor.friction,
          damageRate: editor.damageRate,
          maxHealth: editor.maxHealth,
        }),
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
          const created = createClothMaterialDefinition('New material', {
            color: '#ffffff',
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
