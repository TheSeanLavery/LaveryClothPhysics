/**
 * Fixed-position shell for lil-gui panels (left / right floating docks).
 */
export type ControlsDockSide = 'left' | 'right';

export interface ControlsDockHandle {
  readonly container: HTMLElement;
  readonly shell: HTMLElement;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface CreateControlsDockOptions {
  side: ControlsDockSide;
  testId: string;
  zIndex?: number;
}

export function createControlsDock(options: CreateControlsDockOptions): ControlsDockHandle {
  const shell = document.createElement('div');
  shell.className = 'controls-dock';
  shell.dataset.testid = options.testId;
  shell.style.position = 'fixed';
  shell.style.top = '12px';
  shell.style.zIndex = String(options.zIndex ?? 20);
  shell.style.maxHeight = 'calc(100vh - 24px)';
  shell.style.overflow = 'auto';
  shell.style.pointerEvents = 'auto';
  if (options.side === 'left') {
    shell.style.left = '12px';
    shell.style.right = 'auto';
  } else {
    shell.style.left = 'auto';
    shell.style.right = '12px';
  }

  document.body.appendChild(shell);

  return {
    container: shell,
    shell,
    setVisible(visible: boolean) {
      shell.style.display = visible ? '' : 'none';
    },
    destroy() {
      shell.remove();
    },
  };
}

/** Reset lil-gui root styles when mounted inside a dock shell. */
export function embedGuiInDock(guiDom: HTMLElement): void {
  guiDom.style.position = 'static';
  guiDom.style.top = 'auto';
  guiDom.style.right = 'auto';
  guiDom.style.left = 'auto';
  guiDom.style.maxHeight = 'none';
  guiDom.style.overflow = 'visible';
}
