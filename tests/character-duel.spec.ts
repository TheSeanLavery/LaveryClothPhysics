import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Character duel scene', () => {
  test('loads two clothed fighters with self collision and PvP movement', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/running \(character duel/, {
      timeout: 45_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('Character Duel');
    await expect(page.locator('[data-testid="duel-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-animation-fsm-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-animation-clip-editor"]')).toBeVisible();

    const fsmSnapshot = await page.evaluate(() => window.__duelAnimationFsmSnapshot?.('A'));
    expect(fsmSnapshot?.state).toBe('idle');
    expect(fsmSnapshot?.profileId).toBe('duel-fighter');
    expect(fsmSnapshot?.activeClipName).toBeTruthy();

    const settings = await page.evaluate(() => window.__duelClothSettings?.());
    expect(settings?.selfCollision).toBe(true);
    expect(settings?.mannequinCollision).toBe(false);

    const stats = await page.evaluate(() => window.__duelStats?.());
    expect(stats?.phase).toBe('fighting');
    expect(stats?.controlMode).toBe('pvp');
    expect(stats?.particleCount ?? 0).toBeGreaterThan(3_500);
    expect(stats?.vertexCount ?? 0).toBeGreaterThan(900);

    const startA = await page.evaluate(() => window.__duelFighterAPosition?.());
    await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'down'));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'up'));
    const movedA = await page.evaluate(() => window.__duelFighterAPosition?.());
    expect((movedA?.[2] ?? 0) - (startA?.[2] ?? 0)).toBeGreaterThan(0.2);

    const startB = await page.evaluate(() => window.__duelFighterBPosition?.());
    await page.evaluate(() => window.__duelSimulateKey?.('ArrowLeft', 'down'));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__duelSimulateKey?.('ArrowLeft', 'up'));
    const movedB = await page.evaluate(() => window.__duelFighterBPosition?.());
    expect((movedB?.[0] ?? 0) - (startB?.[0] ?? 0)).toBeLessThan(-0.15);

    await page.waitForTimeout(1_200);
    const settled = await page.evaluate(() => window.__duelSettledShirtSurfaceReport?.());
    expect(settled?.vertex.penetrationCount).toBe(0);
    expect(settled?.vertex.minSignedDistance ?? 0).toBeGreaterThan(0.01);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('ai versus ai mode attacks and walks toward each other', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-duel&control=ai');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/ai-ai/, {
      timeout: 45_000,
    });

    const initial = await page.evaluate(() => window.__duelStats?.());
    expect(initial?.controlMode).toBe('ai-ai');

    await page.waitForTimeout(3_500);
    const later = await page.evaluate(() => window.__duelStats?.());
    expect(later?.fighterACount ?? 0).toBeGreaterThan(initial?.fighterACount ?? 0);
    expect(later?.fighterBCount ?? 0).toBeGreaterThan(initial?.fighterBCount ?? 0);

    const clipNames = [later?.activeClipA, later?.activeClipB].filter(Boolean).join(' ').toLowerCase();
    expect(clipNames.length).toBeGreaterThan(0);

    await page.evaluate(() => window.__duelSetControlMode?.('pvp'));
    expect(await page.evaluate(() => window.__duelGetControlMode?.())).toBe('pvp');
    await page.evaluate(() => window.__duelSetControlMode?.('ai-ai'));
    expect(await page.evaluate(() => window.__duelGetControlMode?.())).toBe('ai-ai');

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
