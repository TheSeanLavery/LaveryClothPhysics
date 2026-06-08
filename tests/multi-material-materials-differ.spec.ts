import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Multi-material physics', () => {
  test('material dampening scales and patch colors differ per cloth type', async ({ page }) => {
    test.setTimeout(90_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000,
    });

    await page.waitForFunction(
      () => (window.__multiMaterialStats?.().particleCount ?? 0) > 40,
      undefined,
      { timeout: 30_000 },
    );

    const dampeningScales = await page.evaluate(() => window.__multiMaterialMaterialDampeningScales?.());
    expect(dampeningScales?.['dangle-soft'] ?? 0).toBeGreaterThan((dampeningScales?.['dangle-stiff'] ?? 1) + 0.005);

    const patchColors = await page.evaluate(() => window.__multiMaterialPatchColors?.());
    expect(patchColors?.['banner-a']).toBe('#4fa3ff');
    expect(patchColors?.['banner-b']).toBe('#ff6b4a');
    expect(patchColors?.['banner-c']).toBe('#7ee787');
    expect(patchColors?.['dangle-soft']).toBe('#d2a8ff');
    expect(patchColors?.['dangle-stiff']).toBe('#ffdc5a');

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
