import './animationClipEditorPopup.css';
import { makeDraggable } from '../../ui/draggableFloating.ts';
import {
  createAnimationClipEditorPanel,
  type AnimationClipEditorPanel,
  type AnimationClipEditorTarget,
} from './AnimationClipEditorPanel.ts';

export type AnimationClipEditorTargetProvider =
  | AnimationClipEditorTarget
  | (() => AnimationClipEditorTarget);

export interface AnimationClipEditorOpenOptions {
  readonly target: AnimationClipEditorTargetProvider;
  readonly initialSubclipId?: string;
  readonly lockSubclipId?: boolean;
}

export interface AnimationClipEditorPopupOptions {
  readonly testId?: string;
  readonly onLibraryChanged?: () => void;
}

export interface AnimationClipEditorPopup {
  readonly element: HTMLElement;
  open(options: AnimationClipEditorOpenOptions): void;
  close(): void;
  isOpen(): boolean;
  getPanel(): AnimationClipEditorPanel;
  dispose(): void;
}

export function createAnimationClipEditorPopup(
  options: AnimationClipEditorPopupOptions = {},
): AnimationClipEditorPopup {
  const shell = document.createElement('div');
  shell.className = 'animation-clip-editor-popup';
  shell.dataset.testid = options.testId ?? 'animation-clip-editor-popup';

  const backdrop = document.createElement('div');
  backdrop.className = 'animation-clip-editor-popup__backdrop';
  backdrop.dataset.testid = 'animation-clip-editor-popup-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'animation-clip-editor-popup__dialog';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'animation-clip-editor-popup__close';
  closeBtn.setAttribute('aria-label', 'Close clip editor');
  closeBtn.textContent = '×';
  closeBtn.dataset.testid = 'animation-clip-editor-popup-close';

  shell.append(backdrop, dialog, closeBtn);
  document.body.append(shell);

  let targetProvider: (() => AnimationClipEditorTarget) = () => ({
    getMixer: () => null,
    getLoadedRoot: () => null,
    getBones: () => [],
    getSourceFile: () => null,
  });

  const panel = createAnimationClipEditorPanel({
    testId: 'animation-clip-editor-panel',
    container: dialog,
    target: () => targetProvider(),
    onLibraryChanged: options.onLibraryChanged,
  });
  makeDraggable(dialog, { handle: '.animation-clip-editor__header' });

  let open = false;
  let lockSubclipId = false;

  function setOpen(next: boolean): void {
    open = next;
    shell.classList.toggle('is-open', next);
  }

  function close(): void {
    setOpen(false);
    lockSubclipId = false;
    panel.setSubclipIdLocked(false);
  }

  backdrop.addEventListener('click', () => close());
  closeBtn.addEventListener('click', () => close());

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      close();
    }
  };
  window.addEventListener('keydown', onKeyDown);

  return {
    element: shell,
    open(openOptions: AnimationClipEditorOpenOptions): void {
      targetProvider = typeof openOptions.target === 'function'
        ? openOptions.target
        : () => openOptions.target;
      lockSubclipId = openOptions.lockSubclipId ?? false;
      panel.setSubclipIdLocked(lockSubclipId);
      setOpen(true);
      panel.refresh();
      if (openOptions.initialSubclipId) {
        panel.loadFromSubclip(openOptions.initialSubclipId);
      }
    },
    close,
    isOpen: () => open,
    getPanel: () => panel,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      panel.dispose();
      shell.remove();
    },
  };
}
