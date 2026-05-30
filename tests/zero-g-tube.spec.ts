import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('GPU cloth tube scene', () => {
  test('boots a tube-shaped cloth scene with grab and shoot controls', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('GPU Cloth Tube');
    await expect(page.locator('[data-testid="tube-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="sim-particles"]')).toContainText('tube particles:');

    const initialStats = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(initialStats?.particleCount).toBeGreaterThan(500);
    expect(initialStats?.triangleCount).toBeGreaterThan(1000);
    expect(initialStats?.grabMode).toBe(true);

    await page.evaluate(() => window.__zeroGravityTubeSetShoot?.(true));
    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);

    await page.waitForTimeout(250);
    const afterShot = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterShot?.projectileCount).toBeGreaterThan(0);
    expect(afterShot?.shootMode).toBe(true);

    await page.evaluate(() => window.__zeroGravityTubeReset?.());
    const afterReset = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterReset?.projectileCount).toBe(0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('tube stays stable under zero force without solver wiggle', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    const before = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(before?.gravity).toBe(0);
    expect(before?.pressure).toBe(0);
    expect(before?.hasNaN).toBe(false);

    await page.waitForTimeout(2_000);

    const after = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(after?.hasNaN).toBe(false);
    expect(Math.abs((after?.centerY ?? 0) - (before?.centerY ?? 0))).toBeLessThan(0.01);
    expect(Math.abs((after?.minY ?? 0) - (before?.minY ?? 0))).toBeLessThan(0.005);
    expect(Math.abs((after?.maxY ?? 0) - (before?.maxY ?? 0))).toBeLessThan(0.005);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('GPU cloth tube scene maintains interactive frame cadence', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.waitForTimeout(500);
    const frameCount = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const startedAt = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - startedAt >= 2_000) {
              resolve(frames);
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

    expect(frameCount).toBeGreaterThan(80);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('small perturbation stays bounded with self-collision enabled', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(() => {
      window.__zeroGravityTubeSetGravity?.(0);
      window.__zeroGravityTubeReset?.();
      window.__zeroGravityTubeSetShoot?.(true);
    });
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => window.__zeroGravityTubeStats?.());

    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);
    await page.waitForTimeout(2_000);

    const afterShot = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterShot?.hasNaN).toBe(false);
    expect(afterShot?.triangleCount).toBeGreaterThan(1000);
    expect(Math.abs((afterShot?.centerY ?? 0) - (before?.centerY ?? 0))).toBeLessThan(0.25);
    expect((afterShot?.minY ?? 0)).toBeGreaterThan((before?.minY ?? 0) - 0.25);
    expect((afterShot?.maxY ?? 0)).toBeLessThan((before?.maxY ?? 0) + 0.25);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
