import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from '../helpers/consoleCapture';

test.describe('smoke', () => {
  test('no THREE shader warnings and flag cloth is visible', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 15_000 });
    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 180, undefined, { timeout: 12_000 });
    await page.waitForTimeout(800);

    const diagnostics = await page.evaluate(async () => window.__flagSimRenderDiagnostics?.());

    expect(
      consoleCapture.errors,
      `Console errors:\n${formatCapturedConsole(consoleCapture)}`,
    ).toEqual([]);
    expect(
      consoleCapture.threeMessages,
      `THREE shader warnings must be empty:\n${consoleCapture.threeMessages.join('\n')}`,
    ).toEqual([]);
    expect(
      consoleCapture.warnings.filter((line) => /THREE\.|WebGPU|WGSL|shader/i.test(line)),
      `Suspicious console warnings:\n${consoleCapture.warnings.join('\n')}`,
    ).toEqual([]);

    expect(diagnostics?.screenBounds).not.toBeNull();
    expect(diagnostics?.meshRegion).not.toBeNull();

    const cloth = diagnostics!.meshRegion!;
    expect(cloth.clothPixelCount, 'flag mesh produced no visible pixels').toBeGreaterThan(400);
    expect(
      cloth.clothMeanLuma,
      `flag is black/invisible (clothLuma=${cloth.clothMeanLuma.toFixed(2)})`,
    ).toBeGreaterThan(40);
    expect(
      cloth.clothPureBlackRatio,
      `${(cloth.clothPureBlackRatio * 100).toFixed(1)}% of cloth pixels are pure black`,
    ).toBeLessThan(0.08);
  });
});
