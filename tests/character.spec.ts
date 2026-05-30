import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('Animated Mixamo character preview', () => {
  test('loads the bundled FBX and renders an animated Mixamo rig', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 20_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('Animated Mixamo Character');
    await expect(page.locator('[data-testid="character-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="grab-toggle-btn"]')).toHaveText('Grab');
    await expect(page.locator('[data-testid="shoot-toggle-btn"]')).toHaveText('Shoot');
    await expect(page.locator('[data-testid="bones-toggle-btn"]')).toHaveText('Bones');

    const initial = await page.evaluate(() => window.__characterStats?.());
    expect(initial?.loaded).toBe(true);
    expect(initial?.assetUrl).toBe('/assets/characters/meshy/blue-haired-anime-girl.fbx');
    expect(initial?.animationUrl).toBe('/assets/characters/mixamo/dancing-twerk.fbx');
    expect(initial?.meshCount).toBeGreaterThan(0);
    expect(initial?.skinnedMeshCount).toBeGreaterThan(0);
    expect(initial?.boneCount).toBeGreaterThan(20);
    expect(initial?.animationClipCount).toBeGreaterThan(0);
    expect(initial?.retargetedTrackCount).toBeGreaterThan(10);
    expect(initial?.sdfCapsuleCount).toBeGreaterThan(15);
    expect(initial?.renderProxyCount).toBeGreaterThan(15);
    expect(initial?.xrayVisible).toBe(true);
    expect(initial?.boundsHeight ?? 0).toBeGreaterThan(1.2);

    const initialSdfs = await page.evaluate(() => window.__characterBoneSdfs?.());
    await page.waitForTimeout(500);
    const animated = await page.evaluate(() => window.__characterStats?.());
    expect(animated?.frameCount ?? 0).toBeGreaterThan(initial?.frameCount ?? 0);
    expect(animated?.mixerTime ?? 0).toBeGreaterThan(initial?.mixerTime ?? 0);

    const sdfs = await page.evaluate(() => window.__characterBoneSdfs?.());
    expect(sdfs?.length).toBe(initial?.sdfCapsuleCount);
    expect(sdfs?.some((sdf) => /arm|forearm/i.test(sdf.name))).toBe(true);
    expect(sdfs?.filter((sdf) => /soft-chest-.*-jiggle/i.test(sdf.name))).toHaveLength(2);
    expect(sdfs?.every((sdf) => sdf.radius > 0 && sdf.length > 0)).toBe(true);
    const armMotion = Math.max(
      ...(sdfs ?? [])
        .filter((sdf) => /arm|forearm/i.test(sdf.name))
        .map((sdf) => {
          const before = initialSdfs?.find((initialSdf) => initialSdf.name === sdf.name);
          if (!before) {
            return 0;
          }
          const startMotion = Math.hypot(
            sdf.start[0] - before.start[0],
            sdf.start[1] - before.start[1],
            sdf.start[2] - before.start[2],
          );
          const endMotion = Math.hypot(
            sdf.end[0] - before.end[0],
            sdf.end[1] - before.end[1],
            sdf.end[2] - before.end[2],
          );
          return Math.max(startMotion, endMotion);
        }),
    );
    expect(armMotion).toBeGreaterThan(0.005);
    await page.locator('[data-testid="bones-toggle-btn"]').click();
    const bonesHidden = await page.evaluate(() => window.__characterStats?.());
    expect(bonesHidden?.xrayVisible).toBe(false);

    const shirt = await page.evaluate(() => window.__characterShirtAnchorReport?.());
    expect(shirt?.visible).toBe(true);
    expect(shirt?.hasRequiredAnchors).toBe(true);
    expect(shirt?.anchorNames).toEqual(expect.arrayContaining(['hips', 'chest', 'neck', 'leftArm', 'rightArm']));
    expect(shirt?.vertexCount).toBeGreaterThan(500);
    expect(shirt?.faceCount).toBeGreaterThan(900);
    expect(shirt?.stitchEdgeCount).toBeGreaterThan(80);
    expect(shirt?.bodyWidth ?? 0).toBeGreaterThan(0.6);
    expect(shirt?.torsoHeight ?? 0).toBeGreaterThan(0.7);
    expect(shirt?.neckGap ?? 1).toBeLessThan(0.35);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.warnings, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
