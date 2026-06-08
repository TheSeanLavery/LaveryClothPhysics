import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

interface StrandGapAuditResult {
  frameCount: number;
  brokenEdgeCount: number;
  requiredCount: number;
  renderedCount: number;
  missingEdgeIds: number[];
  extraEdgeIds: number[];
  tornAdjacentCount: number;
  tornAdjacentVisibleCount: number;
  tornAdjacentMissingEdgeIds: number[];
}

async function waitForFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.waitForFunction(
    (target) => (window.__multiMaterialClothStats?.().frameCount ?? 0) >= target,
    count,
    { timeout: 45_000 },
  );
}

async function waitForSdfGapStrands(
  page: import('@playwright/test').Page,
  maxAttempts = 48,
): Promise<StrandGapAuditResult> {
  let lastAudit: StrandGapAuditResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(250);
    lastAudit = await page.evaluate(async () => window.__multiMaterialAuditStrandThreads?.() ?? null);
    expect(lastAudit, 'strand gap audit API should be available').not.toBeNull();

    if (
      lastAudit!.brokenEdgeCount > 0 &&
      lastAudit!.tornAdjacentCount > 0 &&
      lastAudit!.tornAdjacentMissingEdgeIds.length === 0 &&
      lastAudit!.tornAdjacentVisibleCount === lastAudit!.tornAdjacentCount
    ) {
      return lastAudit!;
    }
  }

  return lastAudit!;
}

test.describe('multi-material SDF tear gap strand threads', () => {
  test('shows GPU strands on torn-adjacent edges across SDF holes', async ({ page }) => {
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
        strandThreadRadius: 0.014,
        tearStretchThreshold: 1.02,
        tearMeshing: 'sdf',
        tearSdfCornerRadius: 0.35,
        tearFringeWidth: 0.075,
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
        throw new Error('Missing dangle-soft grab target for SDF gap strand test');
      }

      await measure({
        label: 'sdf-gap-dangle-soft',
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

    const audit = await waitForSdfGapStrands(page);
    if (audit.missingEdgeIds.length > 0 || audit.coverageMismatchEdgeIds.length > 0) {
      console.log('strand gap audit debug', {
        missing: audit.missingEdgeIds.slice(0, 20),
        coverageMismatch: audit.coverageMismatchEdgeIds.slice(0, 20),
        tornAdjacentMissing: audit.tornAdjacentMissingEdgeIds.slice(0, 20),
      });
    }
    expect(audit.brokenEdgeCount, 'expected SDF tear to break edges').toBeGreaterThan(0);
    expect(audit.tornAdjacentCount, 'expected active edges along SDF tear boundary').toBeGreaterThan(0);
    expect(audit.tornAdjacentMissingEdgeIds.length).toBeLessThanOrEqual(2);
    expect(audit.tornAdjacentVisibleCount).toBeGreaterThanOrEqual(audit.tornAdjacentCount - 2);
    expect(audit.tornAdjacentVisibleCount, 'SDF tear boundary threads must render').toBeGreaterThan(8);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
