import { test, expect } from '@playwright/test';

/**
 * Validates that downloaded animations load correctly on the character rig.
 * Run headed to see the character playing each animation:
 *   npx playwright test tests/animation-validation.spec.ts --config playwright.config.ts --headed
 */

test.describe('animation validation', () => {
  test('animation studio route opens the animation browser instead of the flag page', async ({ page }) => {
    await page.goto('/?mode=animations');

    await expect(page.locator('#overlay h1')).toHaveText('Animation Browser', {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animation browser)');
    await expect(page.locator('#animation-panel')).toBeVisible();
    await expect(page.locator('#animation-panel button').first()).toBeVisible();
  });

  test('existing animations load and play on the character rig', async ({ page }) => {
    await page.goto('/?mode=character');
    await page.waitForFunction(
      () => (window as any).__characterStats?.()?.loaded === true,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);

    const stats = await page.evaluate(() => (window as any).__characterStats?.());
    expect(stats.loaded).toBe(true);
    expect(stats.boneCount).toBe(41);
    console.log(`\nCharacter loaded: ${stats.boneCount} bones, ${stats.skinnedMeshCount} meshes`);

    // Verify existing animations work
    for (const anim of ['tpose', 'idle', 'dance'] as const) {
      await page.evaluate((kind) => (window as any).__characterBlendTo?.(kind), anim);
      await page.waitForTimeout(600);
      const afterStats = await page.evaluate(() => (window as any).__characterStats?.());
      console.log(`  ${anim}: clip=${afterStats.activeClipName}, frame=${afterStats.frameCount}`);
      expect(afterStats.frameCount).toBeGreaterThan(0);
    }
  });

  test('character bone names match expected Mixamo rig', async ({ page }) => {
    await page.goto('/?mode=character');
    await page.waitForFunction(
      () => (window as any).__characterStats?.()?.loaded === true,
      { timeout: 30_000 },
    );

    const stats = await page.evaluate(() => (window as any).__characterStats?.());
    const boneNames: string[] = stats.boneNames;

    // Verify essential Mixamo bones are present
    const required = [
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
      'LeftUpLeg', 'LeftLeg', 'LeftFoot',
      'RightUpLeg', 'RightLeg', 'RightFoot',
    ];

    const normalized = boneNames.map((n: string) =>
      n.replace(/^mixamorig/i, ''),
    );

    console.log('\n=== BONE VERIFICATION ===');
    for (const bone of required) {
      const found = normalized.some((n: string) => n === bone);
      console.log(`  ${found ? 'OK' : 'MISSING'}: ${bone}`);
      expect(found).toBe(true);
    }
  });
});
