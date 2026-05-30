import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('zero-g garment sandbox', () => {
  test('boots, spawns clothing, clears, and allows canvas dragging', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=garments');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (zero gravity garments)',
      { timeout: 15_000 },
    );
    await expect(page.locator('#overlay h1')).toHaveText('Zero-G Clothing Sandbox');
    await expect(page.locator('[data-testid="sim-particles"]')).toContainText('garments: 5');

    await page.evaluate(() => window.__garmentSandboxSpawn?.('dress'));
    await expect(page.locator('[data-testid="sim-particles"]')).toContainText('garments: 6');

    const canvas = page.locator('[data-testid="sim-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.5, { steps: 8 });
    await page.mouse.up();

    await page.evaluate(() => window.__garmentSandboxClear?.());
    await expect(page.locator('[data-testid="sim-particles"]')).toContainText('garments: 0');

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
