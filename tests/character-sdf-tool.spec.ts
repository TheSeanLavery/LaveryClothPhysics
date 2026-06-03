import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Character SDF authoring tool', () => {
  test('loads character SDFs and rebuilds them from tuning controls', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character-sdf');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (character SDF tool)', {
      timeout: 20_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('Character SDF Tool');
    await expect(page.locator('[data-testid="character-sdf-controls"]')).toBeVisible();

    const stats = await page.evaluate(() => window.__characterSdfToolStats?.());
    expect(stats?.loaded).toBe(true);
    expect(stats?.assetUrl).toBe('/assets/characters/meshy/blue-haired-anime-girl.fbx');
    expect(stats?.meshCount ?? 0).toBeGreaterThan(0);
    expect(stats?.skinnedMeshCount ?? 0).toBeGreaterThan(0);
    expect(stats?.boneCount ?? 0).toBeGreaterThan(20);
    expect(stats?.capsuleCount ?? 0).toBeGreaterThan(30);

    const capsules = await page.evaluate(() => window.__characterSdfToolCapsules?.());
    expect(capsules?.some((capsule) => /spine|hips/i.test(capsule.name))).toBe(true);
    expect(capsules?.every((capsule) => capsule.radius > 0 && capsule.length > 0)).toBe(true);

    const initialReport = await page.evaluate(() => window.__characterSdfToolReport?.());
    expect(initialReport?.sampledVertexCount ?? 0).toBeGreaterThan(1_000);
    expect(initialReport?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.75);
    expect(Number.isFinite(initialReport?.meanAbsDistance)).toBe(true);

    const tunedReport = await page.evaluate(() => window.__characterSdfToolSetGlobalRadiusScale?.(1.08));
    const preset = await page.evaluate(() => window.__characterSdfToolPreset?.());
    expect(preset?.globalRadiusScale).toBe(1.08);
    expect(tunedReport?.sampledVertexCount).toBe(initialReport?.sampledVertexCount);
    expect(tunedReport?.meanSignedDistance).not.toBe(initialReport?.meanSignedDistance);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
