import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

/**
 * Full duel facing suite: idle orange≈green, walk shortest turn, walk orange≈green.
 */
test.describe('Character duel facing', () => {
  test('fighter A: idle align, KeyS shortest turn, walk mesh matches intent', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect
      .poll(async () => (await page.evaluate(() => window.__duelStats?.().phase)) ?? 'loading')
      .toMatch(/^(ready|fighting)$/);

    const before = await page.evaluate(() => window.__duelFighterAPosition?.());
    const suite = await page.evaluate(async () => {
      return window.__duelAuditFacingSuite?.({
        fighter: 'A',
        walkKey: 'KeyS',
        expectedWalkIntentMeshYawRad: 0,
        idleSettleMs: 700,
        walkDurationMs: 1_800,
        sampleIntervalMs: 40,
      });
    });

    expect(suite, '__duelAuditFacingSuite missing').toBeTruthy();
    expect(
      suite!.verdict.passed,
      `facing suite failed:\n${suite!.verdict.failures.join('\n')}\n`
        + `idle median tail err=${suite!.verdict.idleAlign?.medianTailErrorDeg?.toFixed(1)}°\n`
        + `walk median tail err=${suite!.verdict.walkAlign.medianTailErrorDeg.toFixed(1)}° `
        + `max=${suite!.verdict.walkAlign.maxErrorDeg.toFixed(1)}°\n`
        + `walk turn total=${suite!.verdict.walkTurn.totalTurnRad.toFixed(3)} `
        + `expected=${suite!.verdict.walkTurn.expectedShortestTurnRad.toFixed(3)} `
        + `flips=${suite!.verdict.walkTurn.signFlipCount}`,
    ).toBe(true);

    const after = await page.evaluate(() => window.__duelFighterAPosition?.());
    expect((after?.[2] ?? 0) - (before?.[2] ?? 0)).toBeGreaterThan(0.15);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
