import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

interface StrandThreadAuditResult {
  frameCount: number;
  brokenEdgeCount: number;
  requiredCount: number;
  renderedCount: number;
  missingEdgeIds: number[];
  extraEdgeIds: number[];
}

async function waitForFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.waitForFunction(
    (target) => (window.__multiMaterialClothStats?.().frameCount ?? 0) >= target,
    count,
    { timeout: 45_000 },
  );
}

async function waitForStableStrandCoverage(
  page: import('@playwright/test').Page,
  maxAttempts = 40,
): Promise<StrandThreadAuditResult> {
  let lastAudit: StrandThreadAuditResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(250);
    lastAudit = await page.evaluate(async () => window.__multiMaterialAuditStrandThreads?.() ?? null);
    expect(lastAudit, 'assembly strand audit API should be available').not.toBeNull();

    if (
      lastAudit!.brokenEdgeCount > 0 &&
      lastAudit!.requiredCount > 0 &&
      lastAudit!.missingEdgeIds.length === 0 &&
      lastAudit!.requiredCount === lastAudit!.renderedCount
    ) {
      return lastAudit!;
    }
  }

  return lastAudit!;
}

test.describe('multi-material assembly strand threads', () => {
  test('renders GPU strand threads for uncovered edges after tearing', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    await waitForFrames(page, 120);

    const startFrame = await page.evaluate(async () => {
      await window.__multiMaterialForceTearThresholdForTest?.(1.02);
      window.__multiMaterialApplySettings?.({
        renderStrandThreads: true,
        strandThreadRadius: 0.01,
        tearStretchThreshold: 1.02,
        tearSdfCornerRadius: 0.28,
        windStrength: 22,
        windTurbulence: 12,
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
      if (!measure) {
        throw new Error('Missing __multiMaterialMeasurePerformance hook');
      }

      for (const patchKey of ['dangle-soft', 'dangle-stiff', 'banner-c'] as const) {
        const target = targets[patchKey];
        if (!target) {
          continue;
        }
        await measure({
          label: `tear-${patchKey}`,
          durationMs: 3_000,
          warmupMs: 150,
          grab: {
            ndcX: target.ndcX,
            ndcY: target.ndcY,
            dragNdcPerFrame: { x: 0.004, y: -0.008 },
          },
        });
      }
    });

    await waitForFrames(page, startFrame + 480);

    const audit = await waitForStableStrandCoverage(page);
    expect(audit.brokenEdgeCount, 'expected at least one torn edge').toBeGreaterThan(0);
    expect(audit.requiredCount, 'expected dangling edges to need strand visuals').toBeGreaterThan(0);
    expect(audit.missingEdgeIds).toEqual([]);
    expect(audit.extraEdgeIds).toEqual([]);
    expect(audit.renderedCount).toBe(audit.requiredCount);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
