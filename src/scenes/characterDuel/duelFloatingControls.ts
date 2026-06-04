import GUI from 'lil-gui';
import {
  createClothControls,
  type ClothSimulation,
} from '../../cloth';
import {
  createCharacterGarmentControls,
  type CharacterGarmentOptionsHost,
} from '../../character/characterGarmentFlow.ts';
import { createControlsDock, embedGuiInDock } from '../../ui/ControlsDock.ts';
import type { CharacterDuelScene } from './CharacterDuelScene.ts';
import { CHARACTER_DUEL_CONFIG } from './characterDuelConfig.ts';

export interface DuelFloatingControls {
  setPanelsVisible(visible: boolean): void;
  readonly clothGui: GUI;
}

export function createDuelFloatingControls(options: {
  cloth: ClothSimulation;
  duel: CharacterDuelScene;
  toolbar: HTMLElement | null | undefined;
}): DuelFloatingControls {
  const { cloth, duel, toolbar } = options;

  const shirtDock = createControlsDock({
    side: 'left',
    testId: 'duel-shirt-controls',
  });
  const clothDock = createControlsDock({
    side: 'right',
    testId: 'duel-controls',
    zIndex: 21,
  });

  const shirtGui = new GUI({
    title: 'Duel shirts',
    width: 320,
    container: shirtDock.container,
  });
  shirtGui.domElement.setAttribute('data-testid', 'duel-shirt-controls-gui');
  embedGuiInDock(shirtGui.domElement);

  const shirtHost: CharacterGarmentOptionsHost = {
    options: CHARACTER_DUEL_CONFIG.shirtOptions,
  };
  const redress = (): void => {
    void duel.redressMergedShirts();
  };
  createCharacterGarmentControls(shirtGui, shirtHost, redress);

  const actionsFolder = shirtGui.addFolder('Duel actions');
  actionsFolder.add({ redress }, 'redress').name('Redress both fighters');
  actionsFolder.add(
    { settle: () => void duel.waitForMergedShirtSimSettle() },
    'settle',
  ).name('Wait shirt settle');
  actionsFolder.open();

  const clothGui = createClothControls(cloth, {
    title: 'Character Duel Cloth',
    testId: 'duel-controls-gui',
    collisionUi: 'boneSdf',
    container: clothDock.container,
  });

  let panelsVisible = true;
  const docks = [shirtDock, clothDock];

  const setPanelsVisible = (visible: boolean): void => {
    panelsVisible = visible;
    for (const dock of docks) {
      dock.setVisible(visible);
    }
    toggleBtn?.classList.toggle('active', visible);
  };

  let toggleBtn: HTMLButtonElement | undefined;
  if (toolbar) {
    toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.dataset.testid = 'duel-panels-toggle-btn';
    toggleBtn.textContent = 'Panels';
    toggleBtn.classList.add('active');
    toggleBtn.addEventListener('click', () => setPanelsVisible(!panelsVisible));
    toolbar.append(toggleBtn);
  }

  return { setPanelsVisible, clothGui };
}
