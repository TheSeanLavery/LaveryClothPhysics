import type { CharacterDuelScene } from '../../scenes/characterDuel/CharacterDuelScene.ts';
import { duelShirtPresetState } from '../../scenes/characterDuel/characterDuelConfig.ts';
import { createGarmentStudioControls } from '../../garments/GarmentStudioControls.ts';
import { embedGuiInDock } from '../../ui/ControlsDock.ts';
import { makeDraggable } from '../../ui/draggableFloating.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export function createDuelShirtPanelDefinition(duel: CharacterDuelScene): DevPanelDefinition {
  return {
    id: 'duel-shirts',
    title: 'Duel shirts',
    side: 'left',
    testId: 'duel-shirt-controls',
    defaultOpen: true,
    create: (container) => {
      const garmentControls = createGarmentStudioControls({
        title: 'Duel T-shirt',
        testId: 'duel-shirt-controls',
        position: 'left',
        initialPreset: duelShirtPresetState.preset,
        initialGarmentType: 'tshirt',
        showServerFixture: false,
        showExport: true,
        lockGarmentType: true,
        onGenerate: async (preset) => {
          duelShirtPresetState.preset = preset;
          await duel.redressMergedShirts();
        },
      });

      const guiEl = garmentControls.gui.domElement;
      guiEl.remove();
      container.appendChild(guiEl);
      embedGuiInDock(guiEl);
      const title = guiEl.querySelector<HTMLElement>('.lil-title');
      if (title) {
        makeDraggable(container, { handle: title });
      }

      return {
        id: 'duel-shirts',
        title: 'Duel shirts',
        testId: 'duel-shirt-controls',
        destroy: () => garmentControls.gui.destroy(),
      };
    },
  };
}
