import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import {
  assertClothVertexBaseline,
  type ClothVertexBaselineFixture,
} from './helpers/clothVertexBaseline';

const UPDATE_BASELINE = process.env.UPDATE_MULTI_MATERIAL_BASELINE === '1';
const BASELINE_PATH = 'tests/fixtures/multi-material-cloth-baseline/settled.json';
const SETTLE_SECONDS = 5;

test.describe('Multi-material cloth baseline', () => {
  test('settled assembly vertices match golden snapshot', async ({ page }) => {
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

    await page.evaluate((seconds) => window.__multiMaterialWaitWallClockForTest?.(seconds), SETTLE_SECONDS);

    const snapshot = await page.evaluate(async () => {
      const result = await window.__multiMaterialReadVertexPositionsForTest?.();
      if (!result) {
        throw new Error('Missing __multiMaterialReadVertexPositionsForTest');
      }
      return {
        version: 1,
        presetSource: 'multi-material-test',
        particleCount: result.particleCount,
        renderVertexCount: result.renderVertexCount,
        positions: result.positions,
      } satisfies ClothVertexBaselineFixture;
    });

    expect(snapshot.particleCount).toBeGreaterThan(40);
    expect(snapshot.renderVertexCount).toBeGreaterThan(80);

    if (UPDATE_BASELINE) {
      mkdirSync('tests/fixtures/multi-material-cloth-baseline', { recursive: true });
      writeFileSync(BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      return;
    }

    const golden = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ClothVertexBaselineFixture;
    assertClothVertexBaseline(snapshot, golden, { positionToleranceL2: 0.12 });
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
