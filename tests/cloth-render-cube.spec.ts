import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const CLOTH_CUBE_URL = '/?mode=cloth-cube';
const EXPECTED_COLOR = { r: 224, g: 64, b: 128 };

test.describe('cloth render cube', () => {
  test('magenta assembly cube renders and survives edge breaks', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto(CLOTH_CUBE_URL);
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running/i, { timeout: 20_000 });

    await page.waitForFunction(() => (window.__clothRenderTest?.().frameCount ?? 0) > 120, undefined, {
      timeout: 15_000,
    });
    await page.waitForTimeout(500);

    const snapshot = await page.evaluate(() => window.__clothRenderTest?.());
    expect(snapshot?.particleCount, 'cube assembly should spawn particles').toBeGreaterThan(80);
    expect(snapshot?.edgeCount, 'cube assembly should have structural edges').toBeGreaterThan(80);

    const diagnostics = await page.evaluate(async () => window.__clothRenderTestDiagnostics?.());
    const ignoredErrors = consoleCapture.errors.filter(
      (line) => !line.includes('Flag render validation failed'),
    );
    expect(ignoredErrors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
    expect(diagnostics?.screenBounds).not.toBeNull();
    expect(diagnostics?.meshRegion).not.toBeNull();

    const cloth = diagnostics!.meshRegion!;
    expect(cloth.clothPixelCount, 'no cloth pixels in projected mesh bounds').toBeGreaterThan(250);
    expect(cloth.clothMeanLuma, `cloth looks black (luma=${cloth.clothMeanLuma})`).toBeGreaterThan(35);
    expect(
      cloth.clothBlackRatio,
      `${(cloth.clothBlackRatio * 100).toFixed(1)}% of cloth pixels are near-black`,
    ).toBeLessThan(0.4);

    const { r: meanR, g: meanG, b: meanB } = cloth.clothMeanRgb;
    expect(meanR, `expected magenta-ish R, got rgb=${JSON.stringify(cloth.clothMeanRgb)}`).toBeGreaterThan(
      meanB + 12,
    );
    expect(meanR, `expected strong red channel, got rgb=${cloth.clothMeanRgb}`).toBeGreaterThan(
      EXPECTED_COLOR.r * 0.35,
    );
    expect(meanG, `expected moderate green, got rgb=${cloth.clothMeanRgb}`).toBeGreaterThan(20);
    expect(meanG, `green should stay below red for #e04080, got rgb=${cloth.clothMeanRgb}`).toBeLessThan(
      meanR * 0.85,
    );

    const broken = await page.evaluate(() => window.__clothRenderTestBreakCenterRing?.() ?? 0);
    expect(broken, 'breaking a center edge ring should affect at least one edge').toBeGreaterThan(0);

    await page.waitForFunction(
      () => (window.__clothRenderTest?.().brokenEdgeCount ?? 0) > 0,
      undefined,
      { timeout: 8_000 },
    );
    await page.waitForTimeout(800);

    const afterBreak = await page.evaluate(async () => ({
      snapshot: window.__clothRenderTest?.(),
      diagnostics: await window.__clothRenderTestDiagnostics?.(),
      audit: await window.__clothRenderTestAuditVisible?.({ maxWorldTriangleEdge: 1.25 }),
    }));

    expect(afterBreak.snapshot?.brokenEdgeCount).toBeGreaterThan(0);
    const clothAfter = afterBreak.diagnostics?.meshRegion;
    expect(clothAfter?.clothPixelCount, 'cloth vanished after tearing edges').toBeGreaterThan(120);
    expect(clothAfter?.clothMeanLuma, 'cloth went fully dark after tear').toBeGreaterThan(25);
    expect(afterBreak.audit?.issues ?? ['missing audit']).toEqual([]);
    expect(afterBreak.audit?.overlongWorldTriangles ?? 99).toBeLessThan(6);
  });
});
