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
    await expect(page.locator('[data-testid="blend-idle-btn"]')).toHaveText('Blend Idle');
    await expect(page.locator('[data-testid="blend-dance-btn"]')).toHaveText('Blend Dance');

    const initial = await page.evaluate(() => window.__characterStats?.());
    expect(initial?.loaded).toBe(true);
    expect(initial?.assetUrl).toBe('/assets/characters/meshy/blue-haired-anime-girl.fbx');
    expect(initial?.tposeAnimationUrl).toBe('/assets/characters/mixamo/tpose.fbx');
    expect(initial?.idleAnimationUrl).toBe('/assets/characters/mixamo/idle.fbx');
    expect(initial?.animationUrl).toBe('/assets/characters/mixamo/dancing-twerk.fbx');
    expect(initial?.activeClipName?.toLowerCase()).toContain('t-pose');
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
    const sdfClearance = await page.evaluate(() => window.__characterShirtSdfClearanceReport?.());
    expect(sdfClearance?.vertexCount).toBeGreaterThan(500);
    expect(sdfClearance?.sdfCount ?? 0).toBeGreaterThan(15);

    const strain = await page.evaluate(() => window.__characterShirtStrainReport?.());
    expect(strain?.edgeCount ?? 0).toBeGreaterThan(500);
    expect(strain?.overLimitCount).toBe(0);
    expect(strain?.averageStrain ?? 1).toBeLessThan(1e-6);

    const triangleQuality = await page.evaluate(() => window.__characterShirtTriangleQualityReport?.());
    expect(triangleQuality?.triangleCount ?? 0).toBeGreaterThan(900);
    expect(triangleQuality?.degenerateCount ?? 999).toBeLessThanOrEqual(8);
    expect(triangleQuality?.minArea ?? 0).toBeGreaterThan(1e-9);

    const edgeClearance = await page.evaluate(() => window.__characterShirtEdgeClearanceReport?.());
    expect(edgeClearance?.totalChecks ?? 0).toBeGreaterThan(20_000);
    const triangleClearance = await page.evaluate(() => window.__characterShirtTriangleClearanceReport?.());
    expect(triangleClearance?.totalChecks ?? 0).toBeGreaterThan(35_000);

    const settledSurface = await page.evaluate(() => window.__characterSettledShirtSurfaceReport?.());
    expect(settledSurface?.vertex.penetrationCount).toBe(0);
    expect(settledSurface?.vertex.minSignedDistance ?? 0).toBeGreaterThan(0.025);
    expect(settledSurface?.quality.degenerateCount).toBe(0);
    expect(settledSurface?.quality.minArea ?? 0).toBeGreaterThan(1e-7);
    expect(settledSurface?.strain.averageStrain ?? 1).toBeLessThan(0.18);

    await page.locator('[data-testid="blend-dance-btn"]').click();
    await page.waitForTimeout(1_000);
    const animated = await page.evaluate(() => window.__characterStats?.());
    expect(animated?.frameCount ?? 0).toBeGreaterThan(initial?.frameCount ?? 0);
    expect(animated?.mixerTime ?? 0).toBeGreaterThan(initial?.mixerTime ?? 0);
    expect(animated?.activeClipName?.toLowerCase()).toContain('twerk');

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
    await page.waitForTimeout(500);

    const shirt = await page.evaluate(() => window.__characterShirtAnchorReport?.());
    expect(shirt?.visible).toBe(true);
    expect(shirt?.hasRequiredAnchors).toBe(true);
    expect(shirt?.anchorNames).toEqual(expect.arrayContaining(['hips', 'chest', 'neck', 'leftArm', 'rightArm']));
    expect(shirt?.vertexCount).toBeGreaterThan(500);
    expect(shirt?.faceCount).toBeGreaterThan(900);
    expect(shirt?.stitchEdgeCount).toBeGreaterThan(80);
    expect(shirt?.bodyWidth).toBe(0.66);
    expect(shirt?.torsoHeight).toBe(0.74);
    expect(shirt?.sleeveLength).toBe(0.24);
    expect(shirt?.sleeveOpening).toBe(0.26);
    expect(shirt?.neckGap ?? 1).toBeLessThan(0.35);
    expect(Math.abs(shirt?.center[0] ?? 1)).toBeLessThan(0.35);
    expect(shirt?.center[1] ?? 0).toBeGreaterThan(0.55);
    expect(shirt?.center[1] ?? 2).toBeLessThan(1.45);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.warnings, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
