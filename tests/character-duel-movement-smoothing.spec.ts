import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Character duel movement smoothing', () => {
  test('fighter A coasts after releasing walk key instead of stopping instantly', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect
      .poll(async () => (await page.evaluate(() => window.__duelStats?.().phase)) ?? 'loading')
      .toMatch(/^(ready|fighting)$/);

    await page.evaluate(() => {
      window.__duelSimulateKey?.('KeyS', 'down');
    });
    await page.waitForTimeout(900);

    const peak = await page.evaluate(() => window.__duelMovementDebug?.('A'));
    expect(peak?.speed ?? 0).toBeGreaterThan(0.5);

    await page.evaluate(() => {
      window.__duelSimulateKey?.('KeyS', 'up');
    });

    const coastSamples = await page.evaluate(async () => {
      const samples: number[] = [];
      for (let i = 0; i < 18; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        samples.push(window.__duelMovementDebug?.('A').speed ?? 0);
      }
      return samples;
    });

    expect(coastSamples[0] ?? 0).toBeGreaterThan(0.15);
    expect(Math.max(...coastSamples)).toBeGreaterThan(0.2);
    expect(coastSamples[coastSamples.length - 1] ?? 1).toBeLessThan(0.12);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
