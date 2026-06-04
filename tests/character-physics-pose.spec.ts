import { expect, test } from '@playwright/test';

test.describe('Physics pose rig', () => {
  test('character mode uses dual rig with bounded display lag', async ({ page }) => {
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });

    await page.waitForFunction(() => Boolean(window.__characterPhysicsPoseStats), undefined, {
      timeout: 10_000,
    });

    await page.evaluate(() => {
      const cfg = window.__characterPhysicsPoseConfig?.();
      if (!cfg) {
        return;
      }
      cfg.maxAngularSpeedArm = 3;
      cfg.maxAngularSpeedHand = 3;
      cfg.maxAngularSpeedSpine = 4;
      window.__characterBlendTo?.('dance');
    });

    const samples: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(100);
      const stats = await page.evaluate(() => window.__characterPhysicsPoseStats?.());
      expect(stats?.enabled).toBe(true);
      expect(stats?.pairCount ?? 0).toBeGreaterThan(20);
      samples.push(stats?.maxTargetDisplayAngleDeg ?? 0);
    }

    const maxLag = Math.max(...samples);
    expect(maxLag).toBeGreaterThan(0.01);
    expect(maxLag).toBeLessThan(45);
  });

  test('snap display pulls pose onto animation target', async ({ page }) => {
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 45_000,
    });
    await page.waitForFunction(() => Boolean(window.__characterPhysicsPoseSnapDisplay));

    await page.evaluate(() => window.__characterPhysicsPoseSnapDisplay?.());
    const afterSnap = await page.evaluate(() => window.__characterPhysicsPoseStats?.());
    expect(afterSnap?.maxTargetDisplayAngleDeg ?? 99).toBeLessThan(0.5);
  });
});
