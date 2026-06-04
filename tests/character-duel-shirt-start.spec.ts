import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

/**
 * Startup suite: spawn layout, facing (green≈orange), settled sim shirt clearance.
 */
test.describe('Character duel shirt at startup', () => {
  test('fighters spawn with shirts settled on body and facing aligned', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect
      .poll(async () => (await page.evaluate(() => window.__duelStats?.().phase)) ?? 'loading')
      .toMatch(/^(ready|fighting)$/);

    await page.waitForTimeout(600);
    const audit = await page.evaluate(async () => window.__duelAuditStartupShirts?.());
    expect(audit, '__duelAuditStartupShirts missing').toBeTruthy();
    expect(
      audit!.passed,
      `startup audit failed:\n${audit!.failures.join('\n')}\n`
        + `vertices=${audit!.settledVertexCount} `
        + `penetrations=${audit!.settledPenetrationCount} `
        + `minClear=${audit!.settledMinSignedDistance}\n`
        + `A align=${audit!.fighterA.meshAlignErrorDeg}° B align=${audit!.fighterB.meshAlignErrorDeg}°`,
    ).toBe(true);

    expect(audit!.settledPenetrationCount).toBe(0);
    expect(audit!.settledVertexCount).toBeGreaterThan(500);
    expect(audit!.settledMinSignedDistance).toBeGreaterThan(0.008);

    const stats = await page.evaluate(() => window.__duelStats?.());
    expect(stats?.particleCount ?? 0).toBeGreaterThan(3_500);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
