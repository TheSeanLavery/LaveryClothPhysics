import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import { waitForDuelRunning } from './helpers/duelBootProbe';

test.describe('Duel fighter models', () => {
  test('boots with different fighter models from URL params', async ({ page }) => {
    test.setTimeout(60_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=character-duel&fighterA=crimson-aegis&fighterB=astra-vanguard');

    await waitForDuelRunning(page, {
      maxBootMs: 50_000,
      stallMs: 12_000,
      pollMs: 200,
    });

    const stats = await page.evaluate(() => window.__duelStats?.());
    expect(stats?.fighterAModelId).toBe('crimson-aegis');
    expect(stats?.fighterBModelId).toBe('astra-vanguard');
    expect(stats?.fighterAAssetUrl).toContain('crimson-aegis.fbx');
    expect(stats?.fighterBAssetUrl).toContain('astra-vanguard.fbx');
    await expect(page.locator('[data-testid="duel-fighter-model-controls"]')).toBeVisible();

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
