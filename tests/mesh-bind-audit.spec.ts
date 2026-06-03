import { expect, test } from '@playwright/test';

test.describe('mesh bind audit', () => {
  test('duel rig forward measurement API returns bind yaw', async ({ page }) => {
    await page.goto('/?mode=character-duel');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(/character duel/, {
      timeout: 45_000,
    });
    await page.waitForTimeout(1200);

    await page.waitForFunction(() => typeof window.__duelMeasureRigForward === 'function', {
      timeout: 45_000,
    });
    const idle = await page.evaluate(() => window.__duelMeasureRigForward!('A'));
    expect(idle.forwardYawRad).not.toBeNull();
    expect(idle.recommendedMeshBindYaw).not.toBeNull();
    expect(typeof idle.profileMeshBindYaw).toBe('number');
    expect(idle.fsmState).toBe('idle');
  });
});
