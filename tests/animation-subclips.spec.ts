import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Animation subclips', () => {
  test('animation browser exposes clip editor and bundled subclips', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=animations');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animation browser)', {
      timeout: 45_000,
    });
    await page.locator('[data-testid="animation-browser-edit-clip"]').click();
    await expect(page.locator('[data-testid="animation-clip-editor-popup"]')).toHaveClass(/is-open/);
    await expect(page.locator('[data-testid="animation-clip-editor-panel"]')).toBeVisible();

    const library = await page.evaluate(() => window.__animationSubclipLibrary?.());
    expect(library?.subclips['fight-01-jab']?.sourceFile).toBe('rokoko-mixamo/Fight_01_mixamo.fbx');
    expect(library?.subclips['zombie-walk-cycle']?.loop).toBe(true);

    const findLoop = page.locator('[data-testid="clip-editor-find-loop"]');
    await expect(findLoop).toBeVisible();
    await findLoop.click();
    await expect(page.locator('[data-testid="clip-editor-loop-score"]')).toContainText(/Match score/i, {
      timeout: 15_000,
    });

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('duel mode loads subclips and clip editor beside FSM panel', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect(page.locator('[data-testid="duel-animation-fsm-panel"]')).toBeVisible();

    await page.locator('[data-testid="animation-fsm-edit-clip"]').click();
    await expect(page.locator('[data-testid="duel-animation-clip-editor-popup"]')).toHaveClass(/is-open/);

    const library = await page.evaluate(() => window.__duelAnimationSubclipLibrary?.());
    expect(library?.subclips['roundhouse-kick']).toBeTruthy();

    const setup = await page.evaluate(() => window.__duelAnimationSetup?.());
    expect(setup?.fighterA.profile.id).toBeTruthy();
    expect(setup?.fighterB.profile.id).toBeTruthy();

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
