import {
  createCharacterGarmentControls,
  type CharacterGarmentOptionsHost,
} from '../../character/characterGarmentFlow.ts';
import type { CharacterDuelScene } from '../../scenes/characterDuel/CharacterDuelScene.ts';
import { CHARACTER_DUEL_CONFIG } from '../../scenes/characterDuel/characterDuelConfig.ts';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export function createDuelShirtPanelDefinition(duel: CharacterDuelScene): DevPanelDefinition {
  return {
    id: 'duel-shirts',
    title: 'Duel shirts',
    side: 'left',
    testId: 'duel-shirt-controls',
    defaultOpen: true,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Duel shirts',
        testId: 'duel-shirt-controls',
      });

      const shirtHost: CharacterGarmentOptionsHost = {
        options: CHARACTER_DUEL_CONFIG.shirtOptions,
      };
      const redress = (): void => {
        void duel.redressMergedShirts();
      };
      createCharacterGarmentControls(gui, shirtHost, redress);

      const actionsFolder = gui.addFolder('Duel actions');
      actionsFolder.add({ redress }, 'redress').name('Redress both fighters');
      actionsFolder.add(
        { settle: () => void duel.waitForMergedShirtSimSettle() },
        'settle',
      ).name('Wait shirt settle');
      actionsFolder.open();

      return gui;
    },
  };
}
