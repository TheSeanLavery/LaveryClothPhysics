import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Character T-shirt dress alignment', () => {
  test('dresses shirt forward on torso with sleeves on correct arms in character mode', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });

    await page.locator('[data-testid="blend-tpose-btn"]').click();
    await page.evaluate(() => window.__characterForceTposeForTest?.());
    await page.evaluate(() => window.__characterReloadShirtForTest?.());
    await page.waitForTimeout(800);

    const report = await page.evaluate(() => window.__characterTShirtDressAlignmentReport?.());
    expect(report, '__characterTShirtDressAlignmentReport missing').toBeTruthy();
    expect(
      report!.passed,
      `dress alignment failed:\n${report!.failures.join('\n')}\n`
        + `forward=${report!.forwardAlignment.toFixed(3)} back=${report!.backAlignment.toFixed(3)} `
        + `yawErr=${report!.shirtForwardYawErrorDeg.toFixed(1)}° `
        + `L arm=${report!.leftSleeveMeanArmDistance.toFixed(3)} R arm=${report!.rightSleeveMeanArmDistance.toFixed(3)} `
        + `L side=${report!.leftSleeveSideProjection.toFixed(3)} R side=${report!.rightSleeveSideProjection.toFixed(3)}`,
    ).toBe(true);

    expect(report!.forwardAlignment).toBeGreaterThan(0.02);
    expect(report!.backAlignment).toBeLessThan(-0.02);
    expect(report!.shirtForwardYawErrorDeg).toBeLessThan(35);
    expect(report!.leftSleeveAxisErrorDeg).toBeLessThan(72);
    expect(report!.rightSleeveAxisErrorDeg).toBeLessThan(72);
    expect(report!.leftSleeveMeanArmDistance).toBeLessThan(0.42);
    expect(report!.rightSleeveMeanArmDistance).toBeLessThan(0.42);
    expect(report!.leftSleeveSideProjection).toBeLessThan(-0.04);
    expect(report!.rightSleeveSideProjection).toBeGreaterThan(0.04);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('dresses duel fighter shirts on arms before sim settle', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect
      .poll(async () => (await page.evaluate(() => window.__duelStats?.().phase)) ?? 'loading')
      .toMatch(/^(ready|fighting)$/);

    const audit = await page.evaluate(() => window.__duelTShirtDressAlignmentAudit?.());
    expect(audit, '__duelTShirtDressAlignmentAudit missing').toBeTruthy();
    expect(
      audit!.passed,
      `duel dress alignment failed:\n`
        + `A: ${audit!.fighterA.failures.join('; ')}\n`
        + `B: ${audit!.fighterB.failures.join('; ')}`,
    ).toBe(true);

    for (const fighter of [audit!.fighterA, audit!.fighterB]) {
      expect(fighter.forwardAlignment).toBeGreaterThan(0.02);
      expect(fighter.shirtForwardYawErrorDeg).toBeLessThan(35);
      expect(fighter.intentForwardAlignment ?? 0).toBeGreaterThan(0.02);
      expect(fighter.leftSleeveMeanArmDistance).toBeLessThan(0.42);
      expect(fighter.rightSleeveMeanArmDistance).toBeLessThan(0.42);
      expect(fighter.leftSleeveAxisErrorDeg).toBeLessThan(72);
      expect(fighter.rightSleeveAxisErrorDeg).toBeLessThan(72);
    }

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
