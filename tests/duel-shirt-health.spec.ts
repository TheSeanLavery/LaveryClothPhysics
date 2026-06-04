import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

/**
 * Fail fast: duel shirt HP must be full right after load (not stuck at 0 from edge readback).
 */
test.describe('Duel shirt health', () => {
  test('starts near full HP after character duel boots', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });

    await expect
      .poll(
        async () => {
          const health = await page.evaluate(() => window.__duelShirtHealth?.());
          return Math.min(health?.fighterA ?? 0, health?.fighterB ?? 0);
        },
        { timeout: 8_000, intervals: [100, 250, 500, 1000] },
      )
      .toBeGreaterThan(0.85);

    const barA = page.locator('[data-testid="duel-health-bar-a"]');
    await expect(barA).toHaveAttribute('data-health', /0\.8[5-9]|0\.9|1\.0/);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
