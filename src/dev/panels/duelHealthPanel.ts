import {
  brokenPercentForZeroHealth,
  zeroBelowRemainingFromBrokenPercent,
} from '../../sim/duelShirtHealth.ts';
import type { CharacterDuelScene } from '../../scenes/characterDuel/CharacterDuelScene.ts';
import type { ClothSimulation } from '../../cloth';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

export function createDuelHealthPanelDefinition(
  duel: CharacterDuelScene,
  cloth: ClothSimulation,
): DevPanelDefinition {
  return {
    id: 'duel-health',
    title: 'Duel health',
    side: 'left',
    testId: 'duel-health-controls',
    defaultOpen: true,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Duel health',
        testId: 'duel-health-controls',
      });

      const state = {
        brokenPercentForZero: brokenPercentForZeroHealth(cloth.getDuelShirtHealthDisplayConfig()),
        autoRematch: duel.getAutoRematchEnabled(),
        roundEndHoldSec: duel.getRoundEndHoldSec(),
        roundCount: 1,
        lastWinner: '—',
        remainingA: 1,
        remainingB: 1,
        brokenA: 0,
        brokenB: 0,
        healthA: 1,
        healthB: 1,
        refresh: () => refreshFromScene(),
      };

      const refreshFromScene = (): void => {
        const debug = duel.getShirtHealthDebug();
        const metrics = debug.metrics;
        state.brokenPercentForZero = brokenPercentForZeroHealth(debug.displayConfig);
        state.autoRematch = duel.getAutoRematchEnabled();
        state.roundEndHoldSec = duel.getRoundEndHoldSec();
        state.roundCount = debug.round.roundCount;
        state.lastWinner = debug.round.lastRoundWinner ?? '—';
        state.remainingA = metrics?.remainingA ?? 1;
        state.remainingB = metrics?.remainingB ?? 1;
        state.brokenA = metrics?.brokenFractionA ?? 0;
        state.brokenB = metrics?.brokenFractionB ?? 0;
        state.healthA = debug.health.fighterA;
        state.healthB = debug.health.fighterB;
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      };

      const displayFolder = gui.addFolder('Display mapping (CPU)');
      displayFolder.add(state, 'brokenPercentForZero', 0, 100, 1).name('Zero at % broken (0–100)').onFinishChange((value: number) => {
        cloth.setDuelShirtHealthDisplayConfig({
          zeroBelowRemainingRatio: zeroBelowRemainingFromBrokenPercent(value),
        });
        refreshFromScene();
      });
      displayFolder.add(state, 'autoRematch').name('Auto rematch').onChange((value: boolean) => {
        duel.setAutoRematchEnabled(value);
        refreshFromScene();
      });
      displayFolder.add(state, 'roundEndHoldSec', 0.1, 2, 0.1).name('Hold at 0 (sec)').onFinishChange((value: number) => {
        duel.setRoundEndHoldSec(value);
      });
      displayFolder.open();

      const liveFolder = gui.addFolder('Live');
      liveFolder.add(state, 'healthA').name('Display HP A').disable();
      liveFolder.add(state, 'healthB').name('Display HP B').disable();
      liveFolder.add(state, 'remainingA').name('Cloth remain A').disable();
      liveFolder.add(state, 'remainingB').name('Cloth remain B').disable();
      liveFolder.add(state, 'brokenA').name('Broken frac A').disable();
      liveFolder.add(state, 'brokenB').name('Broken frac B').disable();
      liveFolder.add(state, 'roundCount').name('Round').disable();
      liveFolder.add(state, 'lastWinner').name('Last winner').disable();
      liveFolder.add(state, 'refresh').name('Refresh');
      liveFolder.open();

      refreshFromScene();
      return gui;
    },
  };
}
