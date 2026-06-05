import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Multi-material cloth test', () => {
  test('loads banner strips, dangling strips, and material library', async ({ page }) => {
    test.setTimeout(45_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 25_000 },
    );
    await expect(page.locator('#overlay h1')).toHaveText('Multi-Material Cloth Test');
    await expect(page.locator('[data-testid="multi-material-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="cloth-materials-controls"]')).toBeVisible();

    await page.waitForFunction(
      () => (window.__multiMaterialStats?.().particleCount ?? 0) > 0,
      undefined,
      { timeout: 15_000 },
    );

    const stats = await page.evaluate(() => window.__multiMaterialStats?.());
    expect(stats?.patchCount).toBeGreaterThanOrEqual(8);
    expect(stats?.materialCount).toBeGreaterThanOrEqual(5);
    expect(stats?.vertexCount).toBeGreaterThan(80);
    expect(stats?.particleCount).toBeGreaterThan(40);

    const patchColors = await page.evaluate(() => window.__multiMaterialPatchColors?.());
    expect(patchColors?.['banner-a']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(patchColors ?? {}).length).toBeGreaterThanOrEqual(8);

    await expect(page.locator('[data-testid="grab-toggle-btn"]')).toBeVisible();
    await page.waitForFunction(
      () => window.__multiMaterialInteractionState?.().grabMode === true,
      undefined,
      { timeout: 5_000 },
    );
    await expect(page.locator('body')).toHaveClass(/grab-mode/);
    const grabState = await page.evaluate(() => window.__multiMaterialInteractionState?.());
    expect(grabState?.grabMode).toBe(true);
    expect(grabState?.grabButtonActive).toBe(true);
    expect(grabState?.orbitControlsEnabled).toBe(false);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
