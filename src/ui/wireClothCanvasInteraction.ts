import type { ClothSimulation } from '../cloth';
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';

/** Responsive grab tuning for lab scenes (flag defaults). */
export const LAB_CLOTH_GRAB_SETTINGS: Pick<
  InextensibleFlagSettings,
  'grabRadius' | 'grabStiffness' | 'grabMaxStep' | 'grabVelocityCarry' | 'grabPointerMaxStep'
> = {
  grabRadius: 0.11,
  grabStiffness: 0.55,
  grabMaxStep: 0.018,
  grabVelocityCarry: 0,
  grabPointerMaxStep: 0.045,
};

/** Screen-space pick radius (NDC) for lab scenes with smaller on-screen cloth. */
export const LAB_CLOTH_GRAB_PICK_RADIUS_NDC = 0.042;

export type ClothPointerDownResult = 'handled' | 'continue';

export interface WireClothCanvasInteractionOptions {
  cloth: ClothSimulation;
  /** Show `#toolbar` (default true). */
  showToolbar?: boolean;
  showGrabButton?: boolean;
  showShootButton?: boolean;
  /** Wire `#reset-flag-btn` when `onResetView` is set (default true when provided). */
  wireResetButton?: boolean;
  initialGrabEnabled?: boolean;
  initialShootEnabled?: boolean;
  /** Applies {@link LAB_CLOTH_GRAB_SETTINGS} before wiring pointers. */
  applyLabGrabSettings?: boolean;
  onResetView?: () => void;
  /** Return `handled` to skip default grab/shoot pointer-down behavior. */
  onPointerDown?: (
    event: PointerEvent,
    ndc: { x: number; y: number },
  ) => ClothPointerDownResult;
  onPointerMove?: (event: PointerEvent, ndc: { x: number; y: number }) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onGrabToggle?: (enabled: boolean) => void;
  onShootToggle?: (enabled: boolean) => void;
}

export interface ClothCanvasInteractionState {
  grabMode: boolean;
  shootMode: boolean;
  grabButtonActive: boolean;
  shootButtonActive: boolean;
  orbitControlsEnabled: boolean;
}

export interface ClothCanvasInteractionHandle {
  syncInteractionUi: () => void;
  setGrabEnabled: (enabled: boolean) => void;
  setShootEnabled: (enabled: boolean) => void;
  getState: () => ClothCanvasInteractionState;
  dispose: () => void;
}

export function pointerEventToNdc(
  canvas: HTMLElement,
  event: PointerEvent,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * 2 - 1 : 0,
    y: rect.height > 0 ? -((event.clientY - rect.top) / rect.height) * 2 + 1 : 0,
  };
}

export function wireClothCanvasInteraction(
  options: WireClothCanvasInteractionOptions,
): ClothCanvasInteractionHandle {
  const { cloth } = options;
  const canvas = cloth.renderer.domElement;

  if (options.applyLabGrabSettings) {
    Object.assign(cloth.settings, LAB_CLOTH_GRAB_SETTINGS);
    cloth.applySettings();
    cloth.setGrabPickRadiusNdc(LAB_CLOTH_GRAB_PICK_RADIUS_NDC);
  }

  const toolbar = document.querySelector<HTMLElement>('#toolbar');
  if (options.showToolbar !== false && toolbar) {
    toolbar.style.display = 'flex';
  }

  const grabToggleBtn = document.querySelector<HTMLButtonElement>('#grab-toggle-btn');
  const shootToggleBtn = document.querySelector<HTMLButtonElement>('#shoot-toggle-btn');
  const resetFlagBtn = document.querySelector<HTMLButtonElement>('#reset-flag-btn');

  if (options.showGrabButton !== false && grabToggleBtn) {
    grabToggleBtn.style.display = '';
  }
  if (options.showShootButton !== false && shootToggleBtn) {
    shootToggleBtn.style.display = '';
  }

  if (options.initialGrabEnabled !== undefined) {
    cloth.setGrabModeEnabled(options.initialGrabEnabled);
  }
  if (options.initialShootEnabled !== undefined) {
    cloth.setShootModeEnabled(options.initialShootEnabled);
  }

  const syncOrbitControls = (): void => {
    cloth.controls.enabled = !(cloth.isGrabModeOn() || cloth.isShootModeOn());
  };

  const syncInteractionUi = (): void => {
    document.body.classList.toggle('grab-mode', cloth.isGrabModeOn());
    document.body.classList.toggle('shoot-mode', cloth.isShootModeOn());
    grabToggleBtn?.classList.toggle('active', cloth.isGrabModeOn());
    shootToggleBtn?.classList.toggle('active', cloth.isShootModeOn());
    syncOrbitControls();
  };

  const setGrabEnabled = (enabled: boolean): void => {
    cloth.setGrabModeEnabled(enabled);
    if (!enabled) {
      document.body.classList.remove('grabbing');
      if (cloth.isGrabPointerDown()) {
        cloth.endGrabAttempt();
      }
    }
    syncInteractionUi();
  };

  const setShootEnabled = (enabled: boolean): void => {
    cloth.setShootModeEnabled(enabled);
    if (!enabled && cloth.isGrabPointerDown()) {
      cloth.endGrabAttempt();
      document.body.classList.remove('grabbing');
    }
    syncInteractionUi();
  };

  const onGrabClick = (): void => {
    setGrabEnabled(!cloth.isGrabModeOn());
    options.onGrabToggle?.(cloth.isGrabModeOn());
  };

  const onShootClick = (): void => {
    setShootEnabled(!cloth.isShootModeOn());
    options.onShootToggle?.(cloth.isShootModeOn());
  };

  const onResetClick = (): void => {
    options.onResetView?.();
  };

  const updateMouseNdc = (event: PointerEvent): { x: number; y: number } => {
    const ndc = pointerEventToNdc(canvas, event);
    cloth.setMousePointerNdc(ndc.x, ndc.y);
    return ndc;
  };

  const onPointerMove = (event: PointerEvent): void => {
    const ndc = updateMouseNdc(event);
    options.onPointerMove?.(event, ndc);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    const ndc = updateMouseNdc(event);
    if (options.onPointerDown?.(event, ndc) === 'handled') {
      return;
    }

    if (cloth.isShootModeOn()) {
      event.preventDefault();
      event.stopPropagation();
      cloth.fireBb(ndc.x, ndc.y);
      return;
    }

    if (!cloth.isGrabModeOn()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cloth.beginGrabAttempt();
    document.body.classList.add('grabbing');
    canvas.setPointerCapture(event.pointerId);
  };

  const releaseGrab = (event: PointerEvent): void => {
    options.onPointerUp?.(event);
    if (!cloth.isGrabPointerDown()) {
      return;
    }
    cloth.endGrabAttempt();
    document.body.classList.remove('grabbing');
    syncOrbitControls();
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const onPointerLeave = (): void => {
    cloth.clearMousePointer();
  };

  grabToggleBtn?.addEventListener('click', onGrabClick);
  shootToggleBtn?.addEventListener('click', onShootClick);
  if (options.onResetView && options.wireResetButton !== false) {
    resetFlagBtn?.addEventListener('click', onResetClick);
  }
  const capture = { capture: true };
  canvas.addEventListener('pointermove', onPointerMove, capture);
  canvas.addEventListener('pointerdown', onPointerDown, capture);
  canvas.addEventListener('pointerup', releaseGrab, capture);
  canvas.addEventListener('pointercancel', releaseGrab, capture);
  canvas.addEventListener('pointerleave', onPointerLeave);

  syncInteractionUi();

  return {
    syncInteractionUi,
    setGrabEnabled,
    setShootEnabled,
    getState: () => ({
      grabMode: cloth.isGrabModeOn(),
      shootMode: cloth.isShootModeOn(),
      grabButtonActive: grabToggleBtn?.classList.contains('active') ?? false,
      shootButtonActive: shootToggleBtn?.classList.contains('active') ?? false,
      orbitControlsEnabled: cloth.controls.enabled,
    }),
    dispose: () => {
      grabToggleBtn?.removeEventListener('click', onGrabClick);
      shootToggleBtn?.removeEventListener('click', onShootClick);
      if (options.onResetView && options.wireResetButton !== false) {
        resetFlagBtn?.removeEventListener('click', onResetClick);
      }
      canvas.removeEventListener('pointermove', onPointerMove, capture);
      canvas.removeEventListener('pointerdown', onPointerDown, capture);
      canvas.removeEventListener('pointerup', releaseGrab, capture);
      canvas.removeEventListener('pointercancel', releaseGrab, capture);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      document.body.classList.remove('grab-mode', 'shoot-mode', 'grabbing');
      cloth.clearMousePointer();
      cloth.controls.enabled = true;
    },
  };
}
