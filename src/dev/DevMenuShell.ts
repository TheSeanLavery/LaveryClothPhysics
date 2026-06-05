import GUI from 'lil-gui';
import { embedGuiInDock, type ControlsDockSide } from '../ui/ControlsDock.ts';
import { makeDraggable } from '../ui/draggableFloating.ts';
import './devMenuShell.css';

export interface DevPanelHandle {
  readonly id: string;
  readonly title: string;
  readonly testId: string;
  destroy(): void;
}

export interface DevPanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly side: ControlsDockSide;
  readonly testId: string;
  readonly defaultOpen?: boolean;
  readonly create: (container: HTMLElement) => DevPanelHandle | GUI;
}

export interface DevMenuShell {
  register(definition: DevPanelDefinition): DevPanelHandle;
  setPanelOpen(id: string, open: boolean): void;
  isPanelOpen(id: string): boolean;
  setAllOpen(open: boolean): void;
  destroy(): void;
}

export interface CreateDevMenuShellOptions {
  readonly toolbar?: HTMLElement | null;
  readonly menuLabel?: string;
  readonly menuTestId?: string;
}

interface RegisteredPanel {
  readonly definition: DevPanelDefinition;
  readonly shell: HTMLElement;
  readonly handle: DevPanelHandle;
  open: boolean;
}

function normalizePanelHandle(
  definition: DevPanelDefinition,
  result: DevPanelHandle | GUI,
): DevPanelHandle {
  if (result instanceof GUI) {
    return {
      id: definition.id,
      title: definition.title,
      testId: definition.testId,
      destroy: () => result.destroy(),
    };
  }
  return result;
}

export function createDevMenuShell(options: CreateDevMenuShellOptions = {}): DevMenuShell {
  const panels = new Map<string, RegisteredPanel>();
  const sideStacks = new Map<ControlsDockSide, HTMLElement>();
  const menuLabel = options.menuLabel ?? 'Dev';
  const menuTestId = options.menuTestId ?? 'dev-menu-btn';

  const popover = document.createElement('div');
  popover.className = 'dev-menu-popover';
  popover.dataset.testid = 'dev-menu-popover';
  popover.hidden = true;

  const popoverTitle = document.createElement('div');
  popoverTitle.className = 'dev-menu-popover__title';
  popoverTitle.textContent = 'Panels';
  popover.appendChild(popoverTitle);

  const panelList = document.createElement('div');
  panelList.className = 'dev-menu-popover__list';
  popover.appendChild(panelList);

  const popoverActions = document.createElement('div');
  popoverActions.className = 'dev-menu-popover__actions';
  const showAllBtn = document.createElement('button');
  showAllBtn.type = 'button';
  showAllBtn.textContent = 'Show all';
  const hideAllBtn = document.createElement('button');
  hideAllBtn.type = 'button';
  hideAllBtn.textContent = 'Hide all';
  popoverActions.append(showAllBtn, hideAllBtn);
  popover.appendChild(popoverActions);
  document.body.appendChild(popover);
  const stopPopoverDrag = makeDraggable(popover, { handle: popoverTitle });

  let menuBtn: HTMLButtonElement | undefined;
  let popoverOpen = false;

  const getSideStack = (side: ControlsDockSide): HTMLElement => {
    let stack = sideStacks.get(side);
    if (!stack) {
      stack = document.createElement('div');
      stack.className = `dev-menu-side-stack dev-menu-side-stack--${side}`;
      stack.dataset.testid = side === 'left' ? 'dev-menu-stack-left' : 'dev-menu-stack-right';
      document.body.appendChild(stack);
      sideStacks.set(side, stack);
    }
    return stack;
  };

  const syncMenuBtnActive = (): void => {
    const anyOpen = [...panels.values()].some((p) => p.open);
    if (!popoverOpen) {
      menuBtn?.classList.toggle('active', anyOpen);
    }
  };

  const setPopoverOpen = (open: boolean): void => {
    popoverOpen = open;
    popover.hidden = !open;
    if (open) {
      menuBtn?.classList.add('active');
      menuBtn?.setAttribute('aria-expanded', 'true');
    } else {
      menuBtn?.removeAttribute('aria-expanded');
      syncMenuBtnActive();
    }
  };

  const refreshPanelRow = (entry: RegisteredPanel): void => {
    const row = panelList.querySelector<HTMLLabelElement>(`[data-panel-id="${entry.definition.id}"]`);
    const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (input) {
      input.checked = entry.open;
    }
  };

  const setPanelOpen = (id: string, open: boolean): void => {
    const entry = panels.get(id);
    if (!entry) {
      return;
    }
    entry.open = open;
    entry.shell.style.display = open ? '' : 'none';
    refreshPanelRow(entry);
    syncMenuBtnActive();
  };

  const setAllOpen = (open: boolean): void => {
    for (const id of panels.keys()) {
      setPanelOpen(id, open);
    }
  };

  showAllBtn.addEventListener('click', () => setAllOpen(true));
  hideAllBtn.addEventListener('click', () => setAllOpen(false));

  if (options.toolbar) {
    menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.dataset.testid = menuTestId;
    menuBtn.textContent = menuLabel;
    menuBtn.setAttribute('aria-haspopup', 'true');
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      setPopoverOpen(!popoverOpen);
    });
    options.toolbar.append(menuBtn);
  }

  document.addEventListener('click', (event) => {
    if (!popoverOpen) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && (popover.contains(target) || menuBtn?.contains(target))) {
      return;
    }
    setPopoverOpen(false);
  });

  const register = (definition: DevPanelDefinition): DevPanelHandle => {
    if (panels.has(definition.id)) {
      throw new Error(`Dev panel already registered: ${definition.id}`);
    }

    const shell = document.createElement('div');
    shell.className = 'dev-menu-panel-shell';
    shell.dataset.testid = definition.testId;
    getSideStack(definition.side).appendChild(shell);

    const result = definition.create(shell);
    const handle = normalizePanelHandle(definition, result);

    const open = definition.defaultOpen ?? true;
    const entry: RegisteredPanel = { definition, shell, handle, open };
    panels.set(definition.id, entry);
    shell.style.display = open ? '' : 'none';
    const lilTitle = shell.querySelector<HTMLElement>('.lil-title');
    if (lilTitle) {
      makeDraggable(shell, { handle: lilTitle });
    } else {
      makeDraggable(shell);
    }

    const row = document.createElement('label');
    row.className = 'dev-menu-popover__row';
    row.dataset.panelId = definition.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = open;
    checkbox.addEventListener('change', () => {
      setPanelOpen(definition.id, checkbox.checked);
    });
    const label = document.createElement('span');
    label.textContent = definition.title;
    row.append(checkbox, label);
    panelList.appendChild(row);

    syncMenuBtnActive();
    return handle;
  };

  const destroy = (): void => {
    stopPopoverDrag();
    setPopoverOpen(false);
    for (const entry of panels.values()) {
      entry.handle.destroy();
      entry.shell.remove();
    }
    panels.clear();
    panelList.replaceChildren();
    for (const stack of sideStacks.values()) {
      stack.remove();
    }
    sideStacks.clear();
    popover.remove();
    menuBtn?.remove();
    menuBtn = undefined;
  };

  return {
    register,
    setPanelOpen,
    isPanelOpen: (id) => panels.get(id)?.open ?? false,
    setAllOpen,
    destroy,
  };
}

export function createDockedGui(
  container: HTMLElement,
  options: { title: string; testId: string; width?: number },
): GUI {
  const gui = new GUI({
    title: options.title,
    width: options.width ?? 320,
    container,
  });
  gui.domElement.setAttribute('data-testid', `${options.testId}-gui`);
  embedGuiInDock(gui.domElement);
  return gui;
}
