import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from '../helpers/consoleCapture';

test.describe('random tear geometry', () => {
  const waitFrames = async (page: import('@playwright/test').Page, count: number) => {
    await page.evaluate(
      async (frames) => {
        const start = window.__flagSim?.frameCount ?? 0;
        await new Promise<void>((resolve) => {
          const tick = () => {
            if ((window.__flagSim?.frameCount ?? 0) >= start + frames) {
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          tick();
        });
      },
      count,
    );
  };

  test('SDF topology does not render bridges across random broken segments', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 30_000 });
    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 90, undefined, {
      timeout: 12_000,
    });

    const report = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 0,
        selfCollision: false,
        renderStrandThreads: false,
        tearMeshing: 'sdf',
        tearSdfCornerRadius: 0.35,
        renderSubdivisions: 3,
      });
      window.__flagSimResetFlag?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return window.__flagSimAuditRandomTears?.({
        seed: 0x51df00d,
        samples: 12,
        tearsPerSample: 7,
        maxSimTriangleEdge: 1.05,
      });
    });

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
    expect(report, 'random tear audit hook should return a report').not.toBeNull();
    expect(report!.trianglesChecked, JSON.stringify(report, null, 2)).toBeGreaterThan(100);
    expect(report!.crossComponentTriangles, JSON.stringify(report, null, 2)).toBe(0);
    expect(report!.brokenEdgeCrossingTriangles, JSON.stringify(report, null, 2)).toBe(0);
    expect(report!.overlongTriangles, JSON.stringify(report, null, 2)).toBe(0);
    expect(report!.issues, JSON.stringify(report, null, 2)).toEqual([]);
  });

  test('high gravity tearing does not leave visible hanging bridge triangles', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 30_000 });
    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 90, undefined, {
      timeout: 12_000,
    });

    const report = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 0,
        gravity: 0.012,
        tearStretchThreshold: 1.04,
        constraintIterations: 5,
        selfCollision: false,
        renderStrandThreads: false,
        tearMeshing: 'sdf',
        renderSubdivisions: 3,
      });
      window.__flagSimResetFlag?.();
      return null;
    });
    expect(report).toBeNull();

    await waitFrames(page, 260);
    const audit = await page.evaluate(async () =>
      window.__flagSimAuditVisibleWorldGeometry?.({ maxWorldTriangleEdge: 0.75 }),
    );

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
    expect(audit, 'visible world geometry audit should return a report').not.toBeNull();
    expect(audit!.trianglesChecked, JSON.stringify(audit, null, 2)).toBeGreaterThan(100);
    expect(audit!.overlongWorldTriangles, JSON.stringify(audit, null, 2)).toBe(0);
    expect(audit!.issues, JSON.stringify(audit, null, 2)).toEqual([]);
  });
});
