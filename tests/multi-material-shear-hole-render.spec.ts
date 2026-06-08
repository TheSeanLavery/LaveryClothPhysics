import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

async function waitForFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.waitForFunction(
    (target) => (window.__multiMaterialClothStats?.().frameCount ?? 0) >= target,
    count,
    { timeout: 45_000 },
  );
}

test.describe('multi-material shear center-hole render', () => {
  test('exposes edge-kind attributes and tears with shear-hole settings', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    await waitForFrames(page, 120);

    const edgeKinds = await page.evaluate(() => window.__multiMaterialParticleRenderEdgeKindsForTest?.() ?? null);
    expect(edgeKinds?.hasEdgeKindBuffer).toBe(true);
    expect(edgeKinds?.shearEdgeCount ?? 0).toBeGreaterThan(0);

    const startFrame = await page.evaluate(async () => {
      await window.__multiMaterialForceTearThresholdForTest?.(1.02);
      window.__multiMaterialApplySettings?.({
        tearStretchThreshold: 1.02,
        tearMeshing: 'sdf',
        tearSdfCornerRadius: 0.35,
        tearFringeWidth: 0.075,
        tearCenterHoleRadius: 0.38,
        tearCornerKeepWidth: 0.62,
        windStrength: 18,
        windTurbulence: 10,
        grabStiffness: 0.35,
        grabMaxStep: 0.01,
        selfCollision: true,
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return window.__multiMaterialClothStats?.().frameCount ?? 0;
    });

    await page.evaluate(async () => {
      const measure = window.__multiMaterialMeasurePerformance;
      const targets = window.__multiMaterialPatchGrabTargets?.() ?? {};
      const target = targets['dangle-soft'];
      if (!measure || !target) {
        throw new Error('Missing dangle-soft grab target for shear-hole render test');
      }

      await measure({
        label: 'shear-hole-dangle-soft',
        durationMs: 4_500,
        warmupMs: 200,
        grab: {
          ndcX: target.ndcX,
          ndcY: target.ndcY,
          dragNdcPerFrame: { x: 0.003, y: -0.01 },
        },
      });
    });

    await waitForFrames(page, startFrame + 540);

    const connectivity = await page.evaluate(async () => window.__multiMaterialAuditConnectivity?.() ?? null);
    expect(connectivity?.brokenEdgeCount ?? 0).toBeGreaterThan(0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
