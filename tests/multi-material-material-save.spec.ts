import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Multi-material material library', () => {
  test('saved tear threshold persists and applies per patch', async ({ page }) => {
    test.setTimeout(90_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    await page.waitForFunction(
      () => (window.__multiMaterialStats?.().particleCount ?? 0) > 40,
      undefined,
      { timeout: 30_000 },
    );

    const softTear = 1.25;
    const stiffTear = 6.5;

    await page.evaluate(async ({ softTearValue, stiffTearValue }) => {
      const response = await fetch('/__cloth/materials');
      const library = await response.json() as {
        materials: Array<{
          id: string;
          name: string;
          settings: Record<string, unknown>;
          physics: Record<string, unknown>;
        }>;
      };

      const updateMaterial = (name: string, tearStretchThreshold: number) => {
        const material = library.materials.find((entry) => entry.name === name);
        if (!material) {
          throw new Error(`Missing material ${name}`);
        }
        material.settings = { ...material.settings, tearStretchThreshold };
      };

      updateMaterial('Dangle soft', softTearValue);
      updateMaterial('Dangle stiff', stiffTearValue);

      const save = await fetch('/__cloth/materials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(library),
      });
      if (!save.ok) {
        throw new Error(`Failed to save cloth materials (${save.status})`);
      }

      await window.__multiMaterialRefreshLibrary?.();
    }, { softTearValue: softTear, stiffTearValue: stiffTear });

    const tearScales = await page.evaluate(() => window.__multiMaterialMaterialTearThresholdScales?.());
    expect(tearScales?.['dangle-soft'] ?? 0).toBeCloseTo(softTear, 2);
    expect(tearScales?.['dangle-stiff'] ?? 0).toBeCloseTo(stiffTear, 2);

    const reloaded = await page.evaluate(async () => {
      const response = await fetch('/__cloth/materials');
      const library = await response.json() as {
        materials: Array<{ name: string; settings: { tearStretchThreshold?: number } }>;
      };
      return {
        soft: library.materials.find((entry) => entry.name === 'Dangle soft')?.settings.tearStretchThreshold,
        stiff: library.materials.find((entry) => entry.name === 'Dangle stiff')?.settings.tearStretchThreshold,
      };
    });

    expect(reloaded.soft).toBeCloseTo(softTear, 2);
    expect(reloaded.stiff).toBeCloseTo(stiffTear, 2);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
