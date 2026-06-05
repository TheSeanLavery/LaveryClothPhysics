import {
  getDefaultCharacterModelId,
  makeCharacterModelOptions,
} from '../../animations/characterModelCatalog.ts';
import type { CharacterDuelScene } from '../../scenes/characterDuel/CharacterDuelScene.ts';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export function createDuelFighterModelPanelDefinition(duel: CharacterDuelScene): DevPanelDefinition {
  return {
    id: 'duel-fighter-models',
    title: 'Fighter models',
    side: 'left',
    testId: 'duel-fighter-model-controls',
    defaultOpen: true,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Fighter models',
        testId: 'duel-fighter-model-controls',
      });

      const modelOptions = makeCharacterModelOptions();
      const state = {
        fighter: 'A' as 'A' | 'B',
        modelId: getDefaultCharacterModelId(),
        fighterAModelId: getDefaultCharacterModelId(),
        fighterBModelId: getDefaultCharacterModelId(),
        status: 'Ready',
        apply: () => {
          state.status = 'Swapping…';
          gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
          void duel.swapFighterModel(state.fighter, state.modelId).then(() => {
            syncFromDuel();
            state.status = 'Ready';
            gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
          }).catch((error: unknown) => {
            state.status = error instanceof Error ? error.message : String(error);
            gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
          });
        },
      };

      const syncFromDuel = (): void => {
        const ids = duel.getFighterModelIds();
        state.fighterAModelId = ids.fighterA;
        state.fighterBModelId = ids.fighterB;
        state.modelId = state.fighter === 'A' ? ids.fighterA : ids.fighterB;
      };

      gui.add(state, 'fighter', { A: 'Fighter A', B: 'Fighter B' }).name('Apply to').onChange(() => {
        syncFromDuel();
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      });
      gui.add(state, 'modelId', modelOptions).name('Character model');
      gui.add(state, 'fighterAModelId').name('Fighter A model').disable();
      gui.add(state, 'fighterBModelId').name('Fighter B model').disable();
      gui.add(state, 'apply').name('Apply + redress shirts');
      gui.add(state, 'status').name('Status').disable();

      syncFromDuel();
      return gui;
    },
  };
}
