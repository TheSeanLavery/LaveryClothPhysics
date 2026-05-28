import { expect, test } from '@playwright/test';

const failurePattern = /(error|exception|invalid|wgsl|typeerror|failed to compile)/i;

function attachConsoleCollector(page: import('@playwright/test').Page): string[] {
  const consoleProblems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || (msg.type() === 'warning' && failurePattern.test(text))) {
      consoleProblems.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleProblems.push(`[pageerror] ${error.message}`);
  });
  return consoleProblems;
}

test.describe('Fabric weave visibility', () => {
  test('procedural normal map texture has measurable weave variation', async ({ page }) => {
    const consoleProblems = attachConsoleCollector(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    const stats = await page.evaluate(() => window.__flagSimFabricTextureStats?.());
    expect(stats).toBeDefined();
    expect(stats!.varianceR).toBeGreaterThan(8);
    expect(stats!.varianceG).toBeGreaterThan(8);
    expect(stats!.maxChannelRange).toBeGreaterThan(12);

    expect(consoleProblems).toEqual([]);
  });

  test('fabric off vs on produces a measurable canvas difference on the flag', async ({ page }) => {
    const consoleProblems = attachConsoleCollector(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(async () => {
      await window.__flagSimRefreshHealth?.();
      const sim = window.__flagSim;
      return sim?.isHealthy === true && sim.frameCount > 60;
    }, undefined, { timeout: 20_000 });

    await page.evaluate(async () => {
      await window.__flagSimSetFabricTextureSource?.('procedural');
    });

    await page.waitForFunction(async () => {
      await window.__flagSimRefreshHealth?.();
      const sim = window.__flagSim;
      return sim?.isHealthy === true && sim.frameCount > 30;
    }, undefined, { timeout: 20_000 });

    const result = await page.evaluate(async () => window.__flagSimCompareFabric?.());
    expect(result).toBeDefined();
    expect(result!.off.flagPixelCount).toBeGreaterThan(500);
    expect(result!.on.flagPixelCount).toBeGreaterThan(500);

    expect(
      result!.compare.meanRgbDiff,
      `weave should change flag pixels (meanRgbDiff=${result!.compare.meanRgbDiff.toFixed(3)})`,
    ).toBeGreaterThan(2);

    expect(
      result!.compare.lumaVarianceDelta,
      `weave should increase luma variance (lumaVarianceDelta=${result!.compare.lumaVarianceDelta.toFixed(3)})`,
    ).toBeGreaterThan(1);

    expect(
      result!.on.neighborDiffMean,
      `woven flag should have local contrast (neighborDiffMean=${result!.on.neighborDiffMean.toFixed(3)})`,
    ).toBeGreaterThanOrEqual(result!.off.neighborDiffMean);

    expect(consoleProblems).toEqual([]);
  });

  test('fabric tiling changes the rendered pattern', async ({ page }) => {
    const consoleProblems = attachConsoleCollector(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(async () => {
      await window.__flagSimRefreshHealth?.();
      const sim = window.__flagSim;
      return sim?.isHealthy === true && sim.frameCount > 60;
    }, undefined, { timeout: 20_000 });

    await page.evaluate(async () => {
      await window.__flagSimSetFabricTextureSource?.('procedural');
    });

    await page.waitForFunction(async () => {
      await window.__flagSimRefreshHealth?.();
      const sim = window.__flagSim;
      return sim?.isHealthy === true && sim.frameCount > 30;
    }, undefined, { timeout: 20_000 });

    const result = await page.evaluate(async () => {
      window.__flagSimSetWind?.(0);

      const captureAtTiling = async (tiling: number) => {
        window.__flagSimSetFabric?.({
          fabricNormalStrength: 1.5,
          fabricNormalScale: 1.2,
          fabricTiling: tiling,
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return window.__flagSimCaptureFlagCanvas?.();
      };

      const coarse = await captureAtTiling(4);
      const fine = await captureAtTiling(18);
      return { coarse, fine };
    });

    expect(result).toBeDefined();
    expect(result!.coarse).toBeDefined();
    expect(result!.fine).toBeDefined();

    expect(
      result!.fine!.lumaVariance,
      `fine tiling should increase micro contrast (coarse=${result!.coarse!.lumaVariance.toFixed(3)}, fine=${result!.fine!.lumaVariance.toFixed(3)})`,
    ).toBeGreaterThan(result!.coarse!.lumaVariance * 1.005);

    expect(consoleProblems).toEqual([]);
  });
});
