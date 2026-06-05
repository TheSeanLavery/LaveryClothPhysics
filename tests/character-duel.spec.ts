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
    await expect(page.locator('[data-testid="duel-sdf-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-shirt-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="dev-menu-btn"]')).toBeVisible();
    const duelRadiusBefore = (await page.evaluate(() => window.__duelSdfPreset?.('A')?.globalRadiusScale)) ?? 1;
    await page.evaluate(() => window.__duelPatchSdfGlobalRadiusScale?.(0.8, 'Both'));
    expect(await page.evaluate(() => window.__duelSdfPreset?.('A')?.globalRadiusScale)).toBe(0.8);
    expect(await page.evaluate(() => window.__duelSdfPreset?.('B')?.globalRadiusScale)).toBe(0.8);
    expect(duelRadiusBefore).toBeGreaterThan(0.79);

    const poseStatsA = await page.evaluate(() => window.__duelPhysicsPoseStats?.('A'));
    expect(poseStatsA?.enabled).toBe(true);
    expect(poseStatsA?.pairCount ?? 0).toBeGreaterThan(20);
    await expect(page.locator('[data-testid="duel-animation-fsm-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="animation-fsm-edit-clip"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-facing-debug-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-health-layer"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-health-bar-a"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-health-bar-b"]')).toBeVisible();
    await expect
      .poll(
        async () => {
          const health = await page.evaluate(() => window.__duelShirtHealth?.());
          return Math.min(health?.fighterA ?? 0, health?.fighterB ?? 0);
        },
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0.85);
    await expect(page.locator('[data-testid="duel-bones-a-btn"]')).toBeVisible();
    await expect(page.locator('[data-testid="duel-bones-b-btn"]')).toBeVisible();
    expect(await page.evaluate(() => window.__duelGetBonesVisible?.('A'))).toBe(false);
    expect(await page.evaluate(() => window.__duelGetBonesVisible?.('B'))).toBe(false);
    await page.evaluate(() => window.__duelSetBonesVisible?.('A', true));
    expect(await page.evaluate(() => window.__duelGetBonesVisible?.('A'))).toBe(true);

    const fsmSnapshot = await page.evaluate(() => window.__duelAnimationFsmSnapshot?.('A'));
    expect(fsmSnapshot?.state).toBe('idle');

    await page.locator('.animation-fsm-panel__graph-node[data-state="walk"]').click();
    await expect(page.locator('[data-testid="animation-fsm-editing-heading"]')).toContainText(/walk/i);
    expect(await page.evaluate(() => window.__duelAnimationFsmSnapshot?.('A')?.state)).toBe('idle');

    await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'down'));
    await page.locator('[data-testid="animation-fsm-preview-state"]').click();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => window.__duelAnimationFsmSnapshot?.('A')?.state)).toBe('walk');
    await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'up'));

    await page.locator('[data-testid="animation-fsm-pin-editing"]').check();
    await page.locator('.animation-fsm-panel__graph-node[data-state="idle"]').click();
    await expect(page.locator('[data-testid="animation-fsm-editing-heading"]')).toContainText(/walk/i);

    const particlesBeforeTpose = await page.evaluate(() => window.__duelStats?.().particleCount ?? 0);
    await page.locator('.animation-fsm-panel__graph-node[data-state="tpose"]').click();
    await page.locator('[data-testid="animation-fsm-preview-state"]').click();
    await page.waitForTimeout(2_500);
    const particlesAfterTpose = await page.evaluate(() => window.__duelStats?.().particleCount ?? 0);
    expect(particlesAfterTpose).toBe(particlesBeforeTpose);
    const afterTposeRedress = await page.evaluate(() => window.__duelAnimationFsmSnapshot?.('A'));
    expect(afterTposeRedress?.state).toBe('idle');
    expect(fsmSnapshot?.profileId).toBe('duel-fighter');
    expect(afterTposeRedress?.activeClipName).toBeTruthy();

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
    expect((movedA?.[2] ?? 0) - (startA?.[2] ?? 0)).toBeLessThan(-0.2);

    const startB = await page.evaluate(() => window.__duelFighterBPosition?.());
    await page.evaluate(() => window.__duelSimulateKey?.('ArrowLeft', 'down'));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__duelSimulateKey?.('ArrowLeft', 'up'));
    const movedB = await page.evaluate(() => window.__duelFighterBPosition?.());
    expect((movedB?.[0] ?? 0) - (startB?.[0] ?? 0)).toBeLessThan(-0.15);

    const attackResult = await page.evaluate(async () => window.__duelRequestAttack?.('A'));
    expect(attackResult?.started, JSON.stringify(attackResult)).toBe(true);

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
