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
    (target) => (window.__flagSim?.frameCount ?? 0) >= target,
    count,
    { timeout: 30_000 },
  );
}

async function waitForStableStrandCoverage(
  page: import('@playwright/test').Page,
  maxAttempts = 40,
): Promise<StrandThreadAuditResult> {
  let lastAudit: StrandThreadAuditResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(250);
    lastAudit = await page.evaluate(async () => window.__flagSimAuditStrandThreads?.() ?? null);
    expect(lastAudit, 'strand thread audit API should be available').not.toBeNull();

    if (lastAudit!.missingEdgeIds.length === 0 && lastAudit!.requiredCount === lastAudit!.renderedCount) {
      return lastAudit!;
    }
  }

  return lastAudit!;
}

test.describe('strand thread coverage', () => {
  test('every physically connected invisible edge gets a visual strand after tearing', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await waitForFrames(page, 120);

    const startFrame = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        renderStrandThreads: true,
        strandThreadRadius: 0.012,
        showSimGridDebug: false,
        showBridgeSplinters: false,
        windStrength: 16,
        windTurbulence: 8,
        tearStretchThreshold: 1.08,
        selfCollision: false,
        bbSpeed: 28,
        bbForceStrength: 1.8,
      });
      window.__flagSimResetFlag?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return window.__flagSim?.frameCount ?? 0;
    });

    await waitForFrames(page, startFrame + 240);

    await page.evaluate(async () => {
      const shots: Array<[number, number]> = [
        [0.18, -0.08],
        [0.02, 0.04],
        [-0.12, -0.02],
        [0.24, 0.1],
      ];

      for (const [ndcX, ndcY] of shots) {
        window.__flagSimFireBb?.(ndcX, ndcY);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    });

    await waitForFrames(page, startFrame + 420);

    const audit = await waitForStableStrandCoverage(page);

    expect(
      audit.missingEdgeIds,
      `missing strand threads on edge ids: ${audit.missingEdgeIds.join(', ')} ` +
        `(required=${audit.requiredCount}, rendered=${audit.renderedCount}, broken=${audit.brokenEdgeCount})`,
    ).toEqual([]);
    expect(audit.requiredCount, 'expected at least one invisible bridge after tearing').toBeGreaterThan(0);
    expect(audit.renderedCount).toBe(audit.requiredCount);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
