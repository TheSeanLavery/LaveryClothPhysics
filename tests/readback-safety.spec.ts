import { expect, test, type Page } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const HEALTH_READBACK_WARN = /\[ClothSim\] refreshHealthFromGpu called too often/;

type ReadbackStats = NonNullable<Awaited<ReturnType<typeof readFlagReadbackStats>>>;

test.describe('GPU readback scheduling', () => {
  test('flag mode keeps presenting frames with GPU-resident projectile visuals', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 20_000 });
    await waitForFlagFrames(page, 30);

    const before = await readFlagReadbackStats(page);
    const firedSlot = await page.evaluate(() => window.__flagSimFireBb?.(0, 0));
    expect(firedSlot).not.toBeNull();

    const renderedFrames = await countAnimationFrames(page, 1_000);
    const after = await readFlagReadbackStats(page);

    expect(renderedFrames).toBeGreaterThan(20);
    expect(after.bbVisualStarted).toBe(before.bbVisualStarted);
    expect(after.bbVisualCompleted).toBe(before.bbVisualCompleted);
    expect(after.healthStarted).toBe(before.healthStarted);
    expect(after.healthSkippedRuntime).toBeGreaterThan(before.healthSkippedRuntime);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('tube mode renders with GPU-resident projectile visuals', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    const before = await readTubeReadbackStats(page);
    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);

    const renderedFrames = await countAnimationFrames(page, 1_000);
    const after = await readTubeReadbackStats(page);

    expect(renderedFrames).toBeGreaterThan(20);
    expect(after.bbVisualStarted).toBe(before.bbVisualStarted);
    expect(after.bbVisualCompleted).toBe(before.bbVisualCompleted);
    expect(after.topologySkippedDisabled).toBeGreaterThanOrEqual(before.topologySkippedDisabled);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('character mode advances frames while disabled tear topology readbacks are skipped', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });
    await page.waitForFunction(() => Boolean(window.__characterClothReadbackStats), undefined, {
      timeout: 5_000,
    });

    const before = await readCharacterReadbackStats(page);
    const renderedFrames = await countAnimationFrames(page, 1_000);
    const after = await readCharacterReadbackStats(page);

    expect(renderedFrames).toBeGreaterThan(15);
    expect(after.healthStarted).toBe(before.healthStarted);
    expect(after.healthSkippedRuntime).toBeGreaterThan(before.healthSkippedRuntime);
    expect(after.topologySkippedDisabled).toBeGreaterThan(before.topologySkippedDisabled);
    expect(after.bbVisualStarted).toBe(before.bbVisualStarted);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('garment studio keeps readback cadence guarded without projectile sync', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=garment');
    await expect(page.locator('[data-testid="sim-status"]')).toContainText('running', { timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__garmentStudioReadbackStats), undefined, {
      timeout: 5_000,
    });

    const before = await readGarmentReadbackStats(page);
    const renderedFrames = await countAnimationFrames(page, 1_000);
    const after = await readGarmentReadbackStats(page);

    expect(renderedFrames).toBeGreaterThan(20);
    expect(after.healthStarted).toBe(before.healthStarted);
    expect(after.healthSkippedRuntime).toBeGreaterThan(before.healthSkippedRuntime);
    expect(after.topologySkippedDisabled).toBeGreaterThan(before.topologySkippedDisabled);
    expect(after.bbVisualStarted).toBe(before.bbVisualStarted);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('burst refreshHealthFromGpu warns and increments healthWarnings (debug hook only)', async ({
    page,
  }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 20_000 });
    await waitForFlagFrames(page, 30);

    await page.evaluate(async () => {
      await window.__flagSimRefreshHealth?.();
      await window.__flagSimRefreshHealth?.();
      await window.__flagSimRefreshHealth?.();
    });

    const stats = await readFlagReadbackStats(page);
    expect(stats.healthStarted).toBeGreaterThanOrEqual(3);
    expect(stats.healthWarnings).toBeGreaterThan(0);
    expect(consoleCapture.warnings.some((line) => HEALTH_READBACK_WARN.test(line))).toBe(true);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});

async function waitForFlagFrames(page: Page, minFrame: number): Promise<void> {
  await page.waitForFunction((frame) => (window.__flagSim?.frameCount ?? 0) >= frame, minFrame, {
    timeout: 10_000,
  });
}

async function countAnimationFrames(page: Page, durationMs: number): Promise<number> {
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

async function readFlagReadbackStats(page: Page) {
  const stats = await page.evaluate(() => window.__flagSimReadbackStats?.());
  expect(stats).toBeTruthy();
  return stats!;
}

async function readTubeReadbackStats(page: Page): Promise<ReadbackStats> {
  const stats = await page.evaluate(() => window.__zeroGravityTubeReadbackStats?.());
  expect(stats).toBeTruthy();
  return stats!;
}

async function readCharacterReadbackStats(page: Page): Promise<ReadbackStats> {
  const stats = await page.evaluate(() => window.__characterClothReadbackStats?.());
  expect(stats).toBeTruthy();
  return stats!;
}

async function readGarmentReadbackStats(page: Page): Promise<ReadbackStats> {
  const stats = await page.evaluate(() => window.__garmentStudioReadbackStats?.());
  expect(stats).toBeTruthy();
  return stats!;
}
