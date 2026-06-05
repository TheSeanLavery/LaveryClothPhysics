import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import {
  assertClothVertexBaseline,
  CHARACTER_CLOTH_BASELINE_PATH,
  type ClothVertexBaselineFixture,
} from './helpers/clothVertexBaseline';

const UPDATE_BASELINE = process.env.UPDATE_CHARACTER_CLOTH_BASELINE === '1';
const SETTLE_SECONDS = 5;

/**
 * Physics regression for character shirt + my-preset:
 * load the real character mode, wait until the shirt is on the sim,
 * blend to T-pose through production hooks, let the live WebGPU loop settle,
 * then read back vertex positions (test-only) and compare to a golden JSON.
 */
test.describe('Character cloth physics baseline (my-preset)', () => {
  test('settled T-pose vertices match golden snapshot', async ({ page }) => {
    test.setTimeout(180_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (animated character cloth)',
      { timeout: 90_000,
    });

    await page.waitForFunction(() => window.__characterStats?.()?.loaded === true, undefined, {
      timeout: 90_000,
    });
    await expect(page.locator('[data-testid="sim-particles"]')).toHaveText(
      /character tshirt particles: [3-9]\d{3,}/i,
      { timeout: 90_000,
    });

    await page.evaluate(() => window.__characterBlendTo?.('tpose'));
    await page.waitForFunction(
      () => window.__characterStats?.()?.activeClipName?.toLowerCase().includes('t-pose') ?? false,
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate((seconds) => window.__characterWaitWallClockForTest?.(seconds), SETTLE_SECONDS);

    const snapshot = await page.evaluate(async () => {
      const result = await window.__characterReadClothVertexPositionsForTest?.();
      if (!result) {
        throw new Error('Missing __characterReadClothVertexPositionsForTest hook');
      }
      return {
        version: 1,
        presetSource: result.presetSource,
        particleCount: result.particleCount,
        renderVertexCount: result.renderVertexCount,
        positions: result.positions,
      } satisfies ClothVertexBaselineFixture;
    });

    expect(snapshot.presetSource).toBe('src/animations/my-preset.json');
    expect(snapshot.renderVertexCount).toBeGreaterThan(100);
    expect(snapshot.particleCount).toBeGreaterThan(3_500);

    if (UPDATE_BASELINE) {
      writeFileSync(CHARACTER_CLOTH_BASELINE_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      return;
    }

    const golden = JSON.parse(
      readFileSync(CHARACTER_CLOTH_BASELINE_PATH, 'utf8'),
    ) as ClothVertexBaselineFixture;
    assertClothVertexBaseline(snapshot, golden);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
