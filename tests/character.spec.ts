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
    await expect(page.locator('[data-testid="blend-tpose-btn"]')).toHaveText('T-Pose');
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
    expect(initial?.xrayVisible).toBe(false);
    expect(initial?.boundsHeight ?? 0).toBeGreaterThan(1.2);

    const initialSdfs = await page.evaluate(() => window.__characterBoneSdfs?.());
    const initialFootSdfs = initialSdfs?.filter((sdf) => /^mixamorig.*Foot$/i.test(sdf.name)) ?? [];
    expect(initialFootSdfs).toHaveLength(2);
    expect(initialFootSdfs.every((sdf) => sdf.length > 0.08 && sdf.length < 0.22)).toBe(true);
    const initialHeadSdf = initialSdfs?.find((sdf) => /^mixamorigHead$/i.test(sdf.name));
    expect(initialHeadSdf?.length ?? 0).toBeGreaterThan(0.08);
    expect(initialHeadSdf?.length ?? 1).toBeLessThan(0.32);
    expect((initialHeadSdf?.end[1] ?? 0) - (initialHeadSdf?.start[1] ?? 1)).toBeGreaterThan(0.05);
    const fitReport = await page.evaluate(() => window.__characterBoneSdfFitReport?.());
    expect(fitReport?.fitted).toBe(true);
    expect(fitReport?.capsuleCount ?? 0).toBeGreaterThanOrEqual(68);
    expect(fitReport?.fittedCapsuleCount ?? 0).toBeGreaterThanOrEqual(34);
    expect(fitReport?.heuristicCapsuleCount).toBe(34);
    expect(fitReport?.fittedVertexCount ?? 0).toBeGreaterThan(500);
    expect(fitReport?.maxCapsulesPerBone ?? 0).toBeGreaterThanOrEqual(2);
    const meshCoverage = await page.evaluate(() => window.__characterBoneSdfMeshCoverageReport?.());
    expect(meshCoverage?.sampledVertexCount ?? 0).toBeGreaterThan(1_000);
    expect(meshCoverage?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.92);
    expect(meshCoverage?.outsideHoleRatio ?? 1).toBeLessThan(0.01);
    expect(meshCoverage?.insideBlobRatio ?? 1).toBeLessThan(0.08);
    expect(Math.abs(meshCoverage?.meanSignedDistance ?? 1)).toBeLessThan(0.012);
    expect(meshCoverage?.meanOutsideMeshDepth ?? 1).toBeLessThan(0.006);
    expect(meshCoverage?.balancedError ?? 1).toBeLessThan(0.03);
    expect(meshCoverage?.regions?.leftBreast?.sampledVertexCount ?? 0).toBeGreaterThan(30);
    expect(meshCoverage?.regions?.leftBreast?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.leftBreast?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.94);
    expect(meshCoverage?.regions?.rightBreast?.sampledVertexCount ?? 0).toBeGreaterThan(30);
    expect(meshCoverage?.regions?.rightBreast?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.rightBreast?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.94);
    expect(meshCoverage?.regions?.buttBack?.sampledVertexCount ?? 0).toBeGreaterThan(20);
    expect(meshCoverage?.regions?.buttBack?.outsideHoleRatio ?? 1).toBeLessThan(0.01);
    expect(meshCoverage?.regions?.buttBack?.meanAbsDistance ?? 1).toBeLessThan(0.025);
    expect(meshCoverage?.regions?.buttLegBack?.sampledVertexCount ?? 0).toBeGreaterThan(20);
    expect(meshCoverage?.regions?.buttLegBack?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.9);
    expect(meshCoverage?.regions?.buttLegBack?.outsideHoleRatio ?? 1).toBeLessThan(0.1);
    expect(meshCoverage?.regions?.leftElbow?.sampledVertexCount ?? 0).toBeGreaterThan(50);
    expect(meshCoverage?.regions?.leftElbow?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.leftElbow?.meanAbsDistance ?? 1).toBeLessThan(0.012);
    expect(meshCoverage?.regions?.rightElbow?.sampledVertexCount ?? 0).toBeGreaterThan(50);
    expect(meshCoverage?.regions?.rightElbow?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.rightElbow?.meanAbsDistance ?? 1).toBeLessThan(0.012);
    expect(meshCoverage?.regions?.leftHand?.sampledVertexCount ?? 0).toBeGreaterThan(50);
    expect(meshCoverage?.regions?.leftHand?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.leftHand?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.95);
    expect(meshCoverage?.regions?.rightHand?.sampledVertexCount ?? 0).toBeGreaterThan(50);
    expect(meshCoverage?.regions?.rightHand?.outsideHoleRatio ?? 1).toBe(0);
    expect(meshCoverage?.regions?.rightHand?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.95);
    expect(meshCoverage?.regions?.leftArm?.meanAbsDistance ?? 1).toBeLessThan(0.013);
    expect(meshCoverage?.regions?.rightArm?.meanAbsDistance ?? 1).toBeLessThan(0.013);
    expect(meshCoverage?.regions?.leftThigh?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.95);
    expect(meshCoverage?.regions?.rightThigh?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.95);
    expect(meshCoverage?.regions?.leftCalf?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.8);
    expect(meshCoverage?.regions?.rightCalf?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.8);
    expect(meshCoverage?.regions?.leftFoot?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.65);
    expect(meshCoverage?.regions?.rightFoot?.nearSurfaceRatio ?? 0).toBeGreaterThan(0.65);
    const sdfClearance = await page.evaluate(() => window.__characterShirtSdfClearanceReport?.());
    expect(sdfClearance?.vertexCount).toBeGreaterThan(500);
    expect(sdfClearance?.sdfCount ?? 0).toBeGreaterThan(15);
    expect(sdfClearance?.requiredClearance).toBe(0.008);

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
    expect(settledSurface?.vertex.minSignedDistance ?? 0).toBeGreaterThan(0.018);
    expect(settledSurface?.edge.failureCount).toBe(0);
    expect(settledSurface?.edge.minSignedDistance ?? 0).toBeGreaterThan(0.008);
    expect(settledSurface?.triangle.failureCount).toBe(0);
    expect(settledSurface?.triangle.minSignedDistance ?? 0).toBeGreaterThan(0.008);
    expect(settledSurface?.quality.degenerateCount).toBe(0);
    expect(settledSurface?.quality.minArea ?? 0).toBeGreaterThan(1e-7);
    expect(settledSurface?.strain.averageStrain ?? 1).toBeLessThan(0.18);

    await page.evaluate(() => window.__characterSetTearThreshold?.(1.05));
    await page.evaluate(() => window.__characterReloadShirtForTest?.());
    const protectedTearing = await page.evaluate(() => window.__characterTearProtectionReport?.());
    expect(protectedTearing?.active).toBe(true);
    expect(protectedTearing?.restoreThreshold).toBe(1.05);
    expect(protectedTearing?.currentThreshold ?? 0).toBeGreaterThan(999_000);
    await page.waitForTimeout(1_150);
    const restoredTearing = await page.evaluate(() => window.__characterTearProtectionReport?.());
    expect(restoredTearing?.active).toBe(false);
    expect(restoredTearing?.currentThreshold).toBe(1.05);
    await page.evaluate(() => window.__characterSetTearThreshold?.(999));

    await page.locator('[data-testid="blend-dance-btn"]').click();
    await page.waitForTimeout(1_000);
    const animated = await page.evaluate(() => window.__characterStats?.());
    expect(animated?.frameCount ?? 0).toBeGreaterThan(initial?.frameCount ?? 0);
    expect(animated?.mixerTime ?? 0).toBeGreaterThan(initial?.mixerTime ?? 0);
    expect(animated?.activeClipName?.toLowerCase()).toContain('twerk');

    const sdfs = await page.evaluate(() => window.__characterBoneSdfs?.());
    expect(sdfs?.length).toBe(initial?.sdfCapsuleCount);
    expect(sdfs?.some((sdf) => /arm|forearm/i.test(sdf.name))).toBe(true);
    expect(sdfs?.filter((sdf) => /upleg/i.test(sdf.name)).every((sdf) => sdf.length > 0.3)).toBe(true);
    expect(sdfs?.filter((sdf) => /soft-chest-.*-jiggle/i.test(sdf.name))).toHaveLength(2);
    expect(sdfs?.filter((sdf) => /soft-chest-.*-lower/i.test(sdf.name))).toHaveLength(2);
    expect(sdfs?.filter((sdf) => /soft-chest-.*-outer/i.test(sdf.name))).toHaveLength(2);
    expect(sdfs?.filter((sdf) => /soft-chest-.*-tip/i.test(sdf.name))).toHaveLength(2);
    expect(sdfs?.filter((sdf) => /soft-chest-/i.test(sdf.name))).toHaveLength(8);
    expect(sdfs?.filter((sdf) => /soft-butt-/i.test(sdf.name))).toHaveLength(4);
    expect(sdfs?.filter((sdf) => /soft-hand-/i.test(sdf.name))).toHaveLength(6);
    expect(sdfs?.filter((sdf) => /soft-(thigh|calf|foot)-/i.test(sdf.name))).toHaveLength(16);
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

    await page.locator('[data-testid="blend-tpose-btn"]').click();
    await page.waitForTimeout(500);
    const tpose = await page.evaluate(() => window.__characterStats?.());
    expect(tpose?.activeClipName?.toLowerCase()).toContain('t-pose');

    await page.locator('[data-testid="bones-toggle-btn"]').click();
    const bonesShown = await page.evaluate(() => window.__characterStats?.());
    expect(bonesShown?.xrayVisible).toBe(true);
    await page.waitForTimeout(500);

    const shirt = await page.evaluate(() => window.__characterShirtAnchorReport?.());
    expect(shirt?.visible).toBe(true);
    expect(shirt?.hasRequiredAnchors).toBe(true);
    expect(shirt?.anchorNames).toEqual(expect.arrayContaining(['hips', 'chest', 'neck', 'leftArm', 'rightArm']));
    expect(shirt?.vertexCount).toBeGreaterThan(4_000);
    expect(shirt?.faceCount).toBeGreaterThan(8_000);
    expect(shirt?.stitchEdgeCount).toBeGreaterThan(200);
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
