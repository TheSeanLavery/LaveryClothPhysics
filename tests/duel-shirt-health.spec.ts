import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import {
  expectDuelShirtHealthReady,
  waitForDuelRunning,
} from './helpers/duelBootProbe';

/**
 * Duel shirt HP must be full after load; uses fast boot probe (no 45s blind wait).
 */
test.describe('Duel shirt health', () => {
  test('starts near full HP after character duel boots', async ({ page }) => {
    test.setTimeout(35_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=character-duel');

    await waitForDuelRunning(page, { maxBootMs: 28_000, stallMs: 10_000 });
    await expectDuelShirtHealthReady(page, 0.85);

    const barA = page.locator('[data-testid="duel-health-bar-a"]');
    await expect(barA).toHaveAttribute('data-health', /0\.8[5-9]|0\.9|1\.0/, { timeout: 3_000 });

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
