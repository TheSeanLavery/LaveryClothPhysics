import type GUI from 'lil-gui';
import './draggableFloating.css';

const NESTED_INTERACTIVE_IGNORE = 'input, select, textarea, a, [contenteditable="true"], [data-no-drag]';

let dragLayerZ = 120;

export interface MakeDraggableOptions {
  /** Drag handle inside `element` (selector or element). Auto-detected when omitted. */
  handle?: HTMLElement | string;
  onDragStart?: () => void;
}

function shouldIgnoreDragStart(target: EventTarget | null, handle: HTMLElement): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const nestedButton = target.closest('button');
  if (nestedButton && nestedButton !== handle && handle.contains(nestedButton)) {
    return true;
  }
  return Boolean(target.closest(NESTED_INTERACTIVE_IGNORE));
}

function resolveHandle(element: HTMLElement, handle?: HTMLElement | string): HTMLElement | null {
  if (handle instanceof HTMLElement) {
    return handle;
  }
  if (typeof handle === 'string') {
    return element.querySelector<HTMLElement>(handle);
  }
  return (
    element.querySelector<HTMLElement>('.lil-title')
    ?? element.querySelector<HTMLElement>('.title')
    ?? element.querySelector<HTMLElement>('.animation-fsm-panel__header')
    ?? element.querySelector<HTMLElement>('.animation-clip-editor__header')
    ?? element.querySelector<HTMLElement>('.dev-menu-popover__title')
    ?? element.querySelector<HTMLElement>('.dev-dashboard__header')
    ?? null
  );
}

function anchorElementToViewport(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  element.style.position = 'fixed';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.margin = '0';
  element.style.transform = 'none';
  if (rect.width > 0) {
    element.style.width = `${rect.width}px`;
  }
  if (rect.height > 0 && element.style.maxHeight) {
    element.style.maxHeight = `${Math.min(rect.height, window.innerHeight - 24)}px`;
  }
}

function clampPosition(left: number, top: number, width: number, height: number): { left: number; top: number } {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - Math.min(height, 48) - margin);
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop),
  };
}

/**
 * Makes a floating panel draggable by its title bar.
 * Returns dispose to remove listeners.
 */
export function makeDraggable(
  element: HTMLElement,
  options: MakeDraggableOptions = {},
): () => void {
  const handle = resolveHandle(element, options.handle);
  if (!handle) {
    return () => {};
  }

  handle.classList.add('floating-drag-handle');

  let dragging = false;
  let pointerId: number | null = null;
  let offsetX = 0;
  let offsetY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    if (!handle.contains(event.target as Node) && event.target !== handle) {
      return;
    }
    if (shouldIgnoreDragStart(event.target, handle)) {
      return;
    }

    anchorElementToViewport(element);
    const rect = element.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    dragging = true;
    pointerId = event.pointerId;
    dragLayerZ += 1;
    element.style.zIndex = String(dragLayerZ);
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('floating-drag-handle--dragging');
    document.body.classList.add('floating-panel-dragging');
    options.onDragStart?.();
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const next = clampPosition(
      event.clientX - offsetX,
      event.clientY - offsetY,
      rect.width,
      rect.height,
    );
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging || (pointerId !== null && event.pointerId !== pointerId)) {
      return;
    }
    dragging = false;
    pointerId = null;
    handle.classList.remove('floating-drag-handle--dragging');
    document.body.classList.remove('floating-panel-dragging');
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', endDrag);
    handle.removeEventListener('pointercancel', endDrag);
    handle.classList.remove('floating-drag-handle', 'floating-drag-handle--dragging');
  };
}

/** Drag a lil-gui panel by its title tab (`.lil-title`). */
export function makeDraggableLilGui(
  gui: GUI | HTMLElement,
  options: Omit<MakeDraggableOptions, 'handle'> = {},
): () => void {
  const root = gui instanceof HTMLElement ? gui : gui.domElement;
  const title = root.querySelector<HTMLElement>('.lil-title');
  if (!title) {
    return () => {};
  }
  return makeDraggable(root, { ...options, handle: title });
}
