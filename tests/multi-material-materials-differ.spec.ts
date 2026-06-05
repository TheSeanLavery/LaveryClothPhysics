import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const SETTLE_SECONDS = 8;

test.describe('Multi-material physics', () => {
  test('soft dangles hang lower than stiff dangles after settle', async ({ page }) => {
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

    const bendScales = await page.evaluate(() => window.__multiMaterialMaterialBendScales?.());
    expect(bendScales?.['dangle-soft'] ?? 1).toBeLessThan((bendScales?.['dangle-stiff'] ?? 0) * 0.5);

    await page.evaluate((seconds) => window.__multiMaterialWaitWallClockForTest?.(seconds), SETTLE_SECONDS);

    const analysis = await page.evaluate(() => window.__multiMaterialDangleHangAnalysisForTest?.());
    expect(analysis?.soft.meanY).toBeLessThan(analysis?.stiff.meanY - 0.01);
    expect(analysis?.soft.lowestY).toBeLessThan(analysis?.stiff.lowestY - 0.01);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
