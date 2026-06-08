import type { Page } from '@playwright/test';

export type RecordedPointerEvent = {
  readonly type: 'pointer';
  readonly phase: 'move' | 'down' | 'up' | 'cancel' | 'leave';
  readonly t: number;
  readonly clientX: number;
  readonly clientY: number;
};

export type RecordedActionEvent = {
  readonly type: 'action';
  readonly name: string;
  readonly t: number;
  readonly details?: Record<string, unknown>;
};

export type RecordedEvent =
  | RecordedPointerEvent
  | RecordedActionEvent
  | { readonly type: 'note'; readonly t: number; readonly message?: string };

export interface ClothReproFixture {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly events: readonly RecordedEvent[];
}

export interface ReplayClothReproOptions {
  readonly maxPointerDelayMs?: number;
  readonly onAction?: (page: Page, event: RecordedActionEvent) => Promise<void>;
}

export async function replayClothRepro(
  page: Page,
  recording: ClothReproFixture,
  options: ReplayClothReproOptions = {},
): Promise<void> {
  const maxPointerDelayMs = options.maxPointerDelayMs ?? 40;
  let previousT = 0;

  for (const event of recording.events) {
    const delay = Math.min(maxPointerDelayMs, Math.max(0, event.t - previousT));
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }
    previousT = event.t;

    if (event.type === 'action') {
      if (options.onAction) {
        await options.onAction(page, event);
      }
      continue;
    }

    if (event.type !== 'pointer') {
      continue;
    }

    if (event.phase === 'move') {
      await page.mouse.move(event.clientX, event.clientY);
    } else if (event.phase === 'down') {
      await page.mouse.move(event.clientX, event.clientY);
      await page.mouse.down();
    } else if (event.phase === 'up' || event.phase === 'cancel' || event.phase === 'leave') {
      await page.mouse.move(event.clientX, event.clientY);
      await page.mouse.up();
    }
  }
}
