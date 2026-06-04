import { expect, type Page } from '@playwright/test';

export interface DuelBootProbeOptions {
  /** Hard cap on total boot wait (default 28s). */
  maxBootMs?: number;
  /** Fail if status text unchanged this long (default 10s). */
  stallMs?: number;
  /** Poll interval (default 150ms). */
  pollMs?: number;
  /** Sim frameCount must increase by at least this much after running (default 2). */
  minSimFrameDelta?: number;
  /** Wall time to observe sim frame advancement (default 600ms). */
  frameWindowMs?: number;
}

const RUNNING_PATTERN = /running \(character duel/;
const FATAL_STATUS_PATTERN = /error:|byteLength|WebGPU unavailable/i;

/**
 * Wait for character-duel to reach a live sim loop. Fails fast on boot errors or stalls.
 */
export async function waitForDuelRunning(
  page: Page,
  options: DuelBootProbeOptions = {},
): Promise<{ frameCount: number; status: string }> {
  const maxBootMs = options.maxBootMs ?? 28_000;
  const stallMs = options.stallMs ?? 10_000;
  const pollMs = options.pollMs ?? 150;
  const minSimFrameDelta = options.minSimFrameDelta ?? 2;
  const frameWindowMs = options.frameWindowMs ?? 600;

  const statusLocator = page.locator('[data-testid="sim-status"]');
  const startedAt = Date.now();
  let lastStatus = (await statusLocator.textContent()) ?? '';
  let lastChangeAt = startedAt;

  while (Date.now() - startedAt < maxBootMs) {
    const status = (await statusLocator.textContent()) ?? '';
    const state = await statusLocator.getAttribute('data-state');

    if (FATAL_STATUS_PATTERN.test(status)) {
      throw new Error(`Duel boot failed: ${status}`);
    }

    if (status !== lastStatus) {
      lastStatus = status;
      lastChangeAt = Date.now();
    } else if (Date.now() - lastChangeAt >= stallMs) {
      throw new Error(`Duel boot stalled for ${stallMs}ms on status: "${status}" (state=${state ?? 'n/a'})`);
    }

    if (RUNNING_PATTERN.test(status)) {
      const frame0 = await readDuelSimFrameCount(page);
      await page.waitForTimeout(frameWindowMs);
      const frame1 = await readDuelSimFrameCount(page);
      const rafDelta = await countAnimationFrames(page, 400);

      if (frame1 - frame0 >= minSimFrameDelta && rafDelta >= 8) {
        return { frameCount: frame1, status };
      }

      if (Date.now() - lastChangeAt >= stallMs) {
        throw new Error(
          `Duel sim frozen after "${status}": sim frames ${frame0}→${frame1}, raf=${rafDelta}`,
        );
      }
    }

    await page.waitForTimeout(pollMs);
  }

  throw new Error(`Duel boot timed out after ${maxBootMs}ms (last status: "${lastStatus}")`);
}

export async function readDuelSimFrameCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__duelClothStats?.().frameCount ?? 0);
}

export async function readDuelShirtHealthMin(page: Page): Promise<number> {
  const health = await page.evaluate(() => window.__duelShirtHealth?.());
  return Math.min(health?.fighterA ?? 0, health?.fighterB ?? 0);
}

export async function countAnimationFrames(page: Page, durationMs: number): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const startedAt = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - startedAt >= duration) {
            resolve(frames);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

/** Assert duel HP is healthy within a short window (post-calibration). */
export async function expectDuelShirtHealthReady(page: Page, minHealth = 0.85): Promise<void> {
  await expect
    .poll(() => readDuelShirtHealthMin(page), {
      timeout: 5_000,
      intervals: [50, 100, 200, 400],
    })
    .toBeGreaterThan(minHealth);
}
