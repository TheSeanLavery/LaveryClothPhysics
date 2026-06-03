import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const garmentTypes = [
  'tshirt',
  'skirt',
  'pleatedSkirt',
  'elasticShorts',
  'trousers',
  'jeans',
] as const;

test.describe('Character clothing generator', () => {
  test('generates every supported garment type on the character page', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="character-garment-generator-controls"]')).toBeVisible();

    for (const garmentType of garmentTypes) {
      const stats = await page.evaluate(
        (type) => window.__characterGarmentGenerate?.(type, undefined, `Character ${type}`),
        garmentType,
      );
      expect(stats?.garmentType).toBe(garmentType);
      expect(stats?.vertexCount ?? 0).toBeGreaterThan(200);
      expect(stats?.faceCount ?? 0).toBeGreaterThan(250);
      expect(stats?.edgeCount ?? 0).toBeGreaterThan(300);
      expect(stats?.validationIssueCount).toBe(0);

      await waitForAnimationFrames(page, 20);

      const preset = await page.evaluate(() => window.__characterGarmentGetPreset?.());
      const activeStats = await page.evaluate(() => window.__characterGarmentStats?.());
      const clothStats = await page.evaluate(() => window.__characterClothStats?.());

      expect(preset?.garmentType).toBe(garmentType);
      expect(activeStats?.garmentType).toBe(garmentType);
      expect(activeStats?.vertexCount).toBe(stats?.vertexCount);
      expect(clothStats?.particleCount ?? 0).toBeGreaterThan(200);
      expect(clothStats?.hasNaN).toBe(false);
      expect(Number.isFinite(clothStats?.centerX)).toBe(true);
      expect(Number.isFinite(clothStats?.centerY)).toBe(true);
      expect(Number.isFinite(clothStats?.centerZ)).toBe(true);
      expect(Number.isFinite(clothStats?.maxStretch)).toBe(true);
    }

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('keeps a snug skirt attached at the character hips after settling', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });

    await page.evaluate(() =>
      window.__characterGarmentGenerate?.('skirt', {
        waistRadius: 0.11,
        hemRadius: 0.32,
        length: 0.46,
        panelCount: 12,
        gridSpacing: 0.04,
      }, 'Snug character skirt')
    );
    await waitForAnimationFrames(page, 45);

    const fit = await page.evaluate(() => window.__characterGarmentFitReport?.());
    const settled = await page.evaluate(() => window.__characterGarmentSettledFitReport?.());
    const clothStats = await page.evaluate(() => window.__characterClothStats?.());

    expect(fit?.garmentType).toBe('skirt');
    expect(fit?.fixedVertexCount).toBe(0);
    expect(fit?.waistDropFromHips ?? 999).toBeLessThan(0.08);
    expect(fit?.maxWaistRadius ?? 999).toBeLessThan(0.36);
    expect(settled?.waistDropFromHips ?? 999).toBeLessThan(0.1);
    expect(settled?.maxWaistRadius ?? 999).toBeLessThan(0.42);
    expect(clothStats?.hasNaN).toBe(false);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('routes overlong trouser legs to separate leg holes without foot clumping', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });

    await page.evaluate(() =>
      window.__characterGarmentGenerate?.('trousers', {
        waistCircumference: 0.58,
        hipCircumference: 0.72,
        rise: 0.28,
        inseam: 1.1,
        thighCircumference: 0.34,
        kneeCircumference: 0.24,
        hemCircumference: 0.18,
        hipEase: -0.04,
        seatEase: -0.04,
        gridSpacing: 0.04,
      }, 'Overlong character trousers')
    );
    await waitForAnimationFrames(page, 45);

    const fit = await page.evaluate(() => window.__characterGarmentFitReport?.());
    const settled = await page.evaluate(() => window.__characterGarmentSettledFitReport?.());
    const clothStats = await page.evaluate(() => window.__characterClothStats?.());

    expect(fit?.garmentType).toBe('trousers');
    expect(fit?.fixedVertexCount).toBe(0);
    expect(fit?.leftHemCenterX ?? 1).toBeLessThan(-0.02);
    expect(fit?.rightHemCenterX ?? -1).toBeGreaterThan(0.02);
    expect(fit?.minLeftRightHemGap ?? 0).toBeGreaterThan(0.08);
    expect(fit?.hemAssignment).toBe('correct');
    expect(fit?.leftHemToLeftFoot ?? 999).toBeLessThan(fit?.leftHemToRightFoot ?? 0);
    expect(fit?.rightHemToRightFoot ?? 999).toBeLessThan(fit?.rightHemToLeftFoot ?? 0);
    expect(fit?.minHemOpeningDistance ?? 0).toBeGreaterThan(0.035);
    expect(fit?.hemBottomY ?? -999).toBeGreaterThanOrEqual((fit?.targetHemBottomY ?? 999) - 0.01);
    expect(settled?.minLeftRightHemGap ?? 0).toBeGreaterThan(0.06);
    expect(settled?.hemAssignment).toBe('correct');
    expect(settled?.leftHemToLeftFoot ?? 999).toBeLessThan(settled?.leftHemToRightFoot ?? 0);
    expect(settled?.rightHemToRightFoot ?? 999).toBeLessThan(settled?.rightHemToLeftFoot ?? 0);
    expect(settled?.minHemOpeningDistance ?? 0).toBeGreaterThan(0.03);
    expect(settled?.hemBottomY ?? -999).toBeGreaterThanOrEqual((settled?.targetHemBottomY ?? 999) - 0.035);
    expect(clothStats?.hasNaN).toBe(false);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});

async function waitForAnimationFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.evaluate(
    (frameCount) =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = () => {
          frames++;
          if (frames >= frameCount) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}
