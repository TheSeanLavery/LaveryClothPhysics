import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import {
  countAnimationFrames,
  readDuelSimFrameCount,
  waitForDuelRunning,
} from './helpers/duelBootProbe';

/**
 * Fast smoke: duel must boot, sim must advance frames, and must not hang on error/initializing.
 */
test.describe('Duel boot (fast fail)', () => {
  test('character duel reaches running sim without freezing', async ({ page }) => {
    test.setTimeout(35_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=character-duel');

    const { frameCount } = await waitForDuelRunning(page, {
      maxBootMs: 28_000,
      stallMs: 10_000,
      pollMs: 150,
    });

    expect(frameCount).toBeGreaterThan(5);

    const rafFrames = await countAnimationFrames(page, 500);
    expect(rafFrames).toBeGreaterThan(12);

    const simAfter = await readDuelSimFrameCount(page);
    expect(simAfter).toBeGreaterThan(frameCount);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
