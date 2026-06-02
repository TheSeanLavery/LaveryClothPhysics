import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const PRESET_NAME = 'Playwright garment preset';

test.describe('clothing generator studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mode=garment');
    await expect(page.locator('[data-testid="sim-status"]')).toContainText('running', { timeout: 20_000 });
    await expect(page.locator('[data-testid="garment-studio-controls"]')).toBeVisible();

    await page.evaluate(async (name) => {
      const presets = await window.__garmentStudioListPresets?.();
      for (const preset of presets ?? []) {
        if (preset.name === name) {
          await window.__garmentStudioDeletePreset?.(preset.id);
        }
      }
    }, PRESET_NAME);
  });

  test('generates, saves, loads, and server-saves versioned garment presets', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    const initial = await page.evaluate(() => window.__garmentStudioStats?.());
    expect(initial?.garmentType).toBe('tshirt');
    expect(initial?.validationIssueCount).toBe(0);
    expect(initial?.vertexCount).toBeGreaterThan(100);

    const skirt = await page.evaluate(() =>
      window.__garmentStudioGenerate?.('pleatedSkirt', {
        waistRadius: 0.28,
        hemRadius: 0.48,
        length: 0.7,
        panelCount: 18,
        segmentsHeight: 18,
        pleatDepth: 0.055,
        pleatCount: 14,
      }, 'Playwright pleated skirt'),
    );
    expect(skirt?.garmentType).toBe('pleatedSkirt');
    expect(skirt?.validationIssueCount).toBe(0);
    expect(skirt?.stitchEdgeCount).toBeGreaterThan(0);
    expect(skirt?.materialFullnessRatio).toBeGreaterThan(1.5);

    for (const garmentType of ['trousers', 'jeans'] as const) {
      const generated = await page.evaluate((kind) =>
        window.__garmentStudioGenerate?.(kind, { gridSpacing: 0.04 }, `Playwright ${kind}`),
      garmentType);
      expect(generated?.garmentType).toBe(garmentType);
      expect(generated?.validationIssueCount).toBe(0);
      expect(generated?.stitchEdgeCount).toBeGreaterThan(0);
      await page.waitForTimeout(750);
      const physicsStats = await page.evaluate(() => window.__garmentStudioPhysicsStats?.());
      expect(physicsStats?.hasNaN).toBe(false);
    }

    const saved = await page.evaluate((name) =>
      window.__garmentStudioSavePreset?.(name, 'pleatedSkirt', {
        waistRadius: 0.28,
        hemRadius: 0.48,
        length: 0.7,
        panelCount: 18,
        segmentsHeight: 18,
        pleatDepth: 0.055,
        pleatCount: 14,
      }),
    PRESET_NAME);
    expect(saved?.schemaVersion).toBe(5);
    expect(saved?.garmentType).toBe('pleatedSkirt');

    await page.evaluate(() => window.__garmentStudioGenerate?.('tshirt', undefined, 'Temporary shirt'));
    const loaded = await page.evaluate((id) => window.__garmentStudioLoadPreset?.(id!), saved!.id);
    const loadedStats = await page.evaluate(() => window.__garmentStudioStats?.());
    expect(loaded?.id).toBe(saved?.id);
    expect(loadedStats?.garmentType).toBe('pleatedSkirt');
    expect(loadedStats?.validationIssueCount).toBe(0);

    const serverSave = await page.evaluate(() => window.__garmentStudioSaveServerFixture?.());
    expect(serverSave).toMatchObject({ ok: true });
    expect((serverSave as { latestPath?: string }).latestPath).toBe('tests/fixtures/garment-presets/latest.json');
    await cleanupServerFixture(serverSave);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});

async function cleanupServerFixture(payload: unknown): Promise<void> {
  const paths = new Set<string>();
  if (typeof payload === 'object' && payload !== null) {
    const maybePaths = payload as { latestPath?: unknown; savedPath?: unknown };
    if (typeof maybePaths.latestPath === 'string') {
      paths.add(maybePaths.latestPath);
    }
    if (typeof maybePaths.savedPath === 'string') {
      paths.add(maybePaths.savedPath);
    }
  }

  await Promise.all([...paths].map((path) => rm(path, { force: true })));
}
