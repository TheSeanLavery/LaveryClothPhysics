import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Animation subclips', () => {
  test('animation browser exposes clip editor and bundled subclips', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=animations');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animation browser)', {
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="animation-clip-editor"]')).toBeVisible();

    const library = await page.evaluate(() => window.__animationSubclipLibrary?.());
    expect(library?.subclips['fight-01-jab']?.sourceFile).toBe('rokoko-mixamo/Fight_01_mixamo.fbx');
    expect(library?.subclips['zombie-walk-cycle']?.loop).toBe(true);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('duel mode loads subclips and clip editor beside FSM panel', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="duel-animation-clip-editor"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-animation-fsm-panel"]')).toBeVisible();

    const library = await page.evaluate(() => window.__duelAnimationSubclipLibrary?.());
    expect(library?.subclips['roundhouse-kick']).toBeTruthy();

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
