import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from '../helpers/consoleCapture';

test.describe('smoke', () => {
  test('flag cloth pixels are lit denim, not black or background', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 15_000 });

    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 180, undefined, { timeout: 12_000 });
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 2_000 });

    const diagnostics = await page.evaluate(async () => window.__flagSimRenderDiagnostics?.());
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
    expect(diagnostics?.screenBounds).not.toBeNull();
    expect(diagnostics?.meshRegion).not.toBeNull();

    expect(
      diagnostics!.backgroundMeanLuma,
      `canvas readback looks broken (bgLuma=${diagnostics!.backgroundMeanLuma.toFixed(1)})`,
    ).toBeGreaterThan(10);

    const cloth = diagnostics!.meshRegion!;

    expect(cloth.clothPixelCount, 'no cloth pixels found in projected mesh bounds').toBeGreaterThan(400);
    expect(
      cloth.clothMeanLuma,
      `flag cloth is black (clothLuma=${cloth.clothMeanLuma.toFixed(2)}, rgb=${JSON.stringify(cloth.clothMeanRgb)})`,
    ).toBeGreaterThan(40);
    expect(
      cloth.clothBlackRatio,
      `${(cloth.clothBlackRatio * 100).toFixed(1)}% of cloth pixels are near-black`,
    ).toBeLessThan(0.35);
    expect(
      cloth.clothPureBlackRatio,
      `${(cloth.clothPureBlackRatio * 100).toFixed(1)}% of cloth pixels are pure black (normal/shader failure)`,
    ).toBeLessThan(0.08);
    expect(
      cloth.clothMeanLuma - diagnostics!.backgroundMeanLuma,
      `cloth same as background (cloth=${cloth.clothMeanLuma.toFixed(1)} bg=${diagnostics!.backgroundMeanLuma.toFixed(1)})`,
    ).toBeGreaterThan(8);
    expect(diagnostics!.fabricTextureSource).toBe('denim-512');
  });
});
