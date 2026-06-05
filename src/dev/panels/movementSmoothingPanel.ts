import type { CharacterAnimationProfile } from '../../animations/characterAnimationProfile.ts';
import type { CharacterController } from '../../character/CharacterController.ts';
import type { CharacterDuelScene } from '../../scenes/characterDuel/CharacterDuelScene.ts';
import { createDockedGui } from '../DevMenuShell.ts';
import type { DevPanelDefinition } from '../DevMenuShell.ts';

function applyMovementParams(
  controller: CharacterController,
  patch: Partial<CharacterAnimationProfile['parameters']>,
): void {
  const profile = controller.getProfile();
  controller.applyProfile({
    ...profile,
    parameters: { ...profile.parameters, ...patch },
  });
}

export function createMovementSmoothingPanelDefinition(
  duel: CharacterDuelScene,
): DevPanelDefinition {
  return {
    id: 'duel-movement-smoothing',
    title: 'Movement smoothing',
    side: 'left',
    testId: 'duel-movement-smoothing-controls',
    defaultOpen: false,
    create: (container) => {
      const gui = createDockedGui(container, {
        title: 'Movement smoothing',
        testId: 'duel-movement-smoothing-controls',
      });

      const base = duel.controllerA.getProfile().parameters;
      const state = {
        moveAccel: base.moveAccel ?? 8,
        moveDecel: base.moveDecel ?? 2.5,
        inputSmoothTau: base.inputSmoothTau ?? 0.1,
        moveStopSpeed: base.moveStopSpeed ?? 0.04,
        turnSpeed: base.turnSpeed,
        turnAccel: base.turnAccel ?? 10,
        turnDecel: base.turnDecel ?? 6,
        walkDirectionSmoothTau: base.walkDirectionSmoothTau ?? 0.12,
        attackStepRampSec: base.attackStepRampSec ?? 0.15,
        attackFacingTurnSpeed: base.attackFacingTurnSpeed ?? 14,
        speedA: 0,
        speedB: 0,
        refresh: () => refreshLive(),
      };

      const refreshLive = (): void => {
        state.speedA = duel.controllerA.getMovementDebug().speed;
        state.speedB = duel.controllerB.getMovementDebug().speed;
        gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      };

      const applyAll = (patch: Partial<CharacterAnimationProfile['parameters']>): void => {
        applyMovementParams(duel.controllerA, patch);
        applyMovementParams(duel.controllerB, patch);
        refreshLive();
      };

      const translationFolder = gui.addFolder('Translation');
      translationFolder.add(state, 'moveAccel', 1, 20, 0.5).name('Accel (m/s²)').onFinishChange((value: number) => {
        applyAll({ moveAccel: value });
      });
      translationFolder.add(state, 'moveDecel', 0.5, 10, 0.25).name('Decel (m/s²)').onFinishChange((value: number) => {
        applyAll({ moveDecel: value });
      });
      translationFolder.add(state, 'inputSmoothTau', 0, 0.4, 0.01).name('Input smooth (s)').onFinishChange((value: number) => {
        applyAll({ inputSmoothTau: value });
      });
      translationFolder.add(state, 'moveStopSpeed', 0.01, 0.2, 0.005).name('Stop speed (m/s)').onFinishChange((value: number) => {
        applyAll({ moveStopSpeed: value });
      });
      translationFolder.open();

      const turnFolder = gui.addFolder('Turning');
      turnFolder.add(state, 'turnSpeed', 2, 12, 0.25).name('Max turn (rad/s)').onFinishChange((value: number) => {
        applyAll({ turnSpeed: value });
      });
      turnFolder.add(state, 'turnAccel', 2, 24, 0.5).name('Turn accel (rad/s²)').onFinishChange((value: number) => {
        applyAll({ turnAccel: value });
      });
      turnFolder.add(state, 'turnDecel', 1, 16, 0.5).name('Turn decel (rad/s²)').onFinishChange((value: number) => {
        applyAll({ turnDecel: value });
      });
      turnFolder.add(state, 'walkDirectionSmoothTau', 0, 0.4, 0.01).name('Dir smooth (s)').onFinishChange((value: number) => {
        applyAll({ walkDirectionSmoothTau: value });
      });
      turnFolder.open();

      const attackFolder = gui.addFolder('Attack');
      attackFolder.add(state, 'attackStepRampSec', 0.05, 0.5, 0.01).name('Step ramp (s)').onFinishChange((value: number) => {
        applyAll({ attackStepRampSec: value });
      });
      attackFolder.add(state, 'attackFacingTurnSpeed', 0, 24, 0.5).name('Face turn (rad/s)').onFinishChange((value: number) => {
        applyAll({ attackFacingTurnSpeed: value });
      });
      attackFolder.open();

      const liveFolder = gui.addFolder('Live');
      liveFolder.add(state, 'speedA').name('Speed A (m/s)').disable();
      liveFolder.add(state, 'speedB').name('Speed B (m/s)').disable();
      liveFolder.open();

      const interval = window.setInterval(refreshLive, 120);
      return {
        id: 'duel-movement-smoothing',
        title: 'Movement smoothing',
        testId: 'duel-movement-smoothing-controls',
        destroy: () => {
          window.clearInterval(interval);
          gui.destroy();
        },
      };
    },
  };
}
