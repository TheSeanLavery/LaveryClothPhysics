import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

type RecordedPointerEvent = {
  readonly type: 'pointer';
  readonly phase: 'move' | 'down' | 'up' | 'cancel' | 'leave';
  readonly t: number;
  readonly clientX: number;
  readonly clientY: number;
};

type RecordedActionEvent = {
  readonly type: 'action';
  readonly name: string;
  readonly t: number;
  readonly details?: Record<string, unknown>;
};

type RecordedEvent = RecordedPointerEvent | RecordedActionEvent | { readonly type: 'note'; readonly t: number };

type CharacterReproFixture = {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly events: readonly RecordedEvent[];
};

test.describe('Animated Mixamo character preview', () => {
  test('loads the bundled FBX and renders an animated Mixamo rig', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 20_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('Animated Mixamo Character');
    await expect(page.locator('[data-testid="character-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="character-sdf-controls"]')).toBeVisible();
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
    const breastAlignment = await page.evaluate(() => window.__characterBreastVisualAlignmentReport?.());
    expect(breastAlignment?.modelAvailable).toBe(true);
    expect(breastAlignment?.sdfCapsuleCount).toBe(8);
    expect(breastAlignment?.morphTargetsBuilt).toBe(true);
    expect(breastAlignment?.morphMeshCount ?? 0).toBeGreaterThan(0);
    expect(breastAlignment?.maxSdfCenterError ?? 1).toBeLessThan(1e-8);
    expect(breastAlignment?.morphInfluenceError ?? 1).toBeLessThan(1e-8);
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
    expect(shirt?.bodyWidth ?? 0).toBeGreaterThan(0.6);
    expect(shirt?.bodyWidth ?? 0).toBeLessThan(1.2);
    expect(shirt?.torsoHeight ?? 0).toBeGreaterThan(0.6);
    expect(shirt?.torsoHeight ?? 0).toBeLessThan(1.1);
    expect(shirt?.sleeveLength ?? 0).toBeGreaterThan(0.2);
    expect(shirt?.sleeveLength ?? 0).toBeLessThan(0.5);
    expect(shirt?.sleeveOpening ?? 0).toBeGreaterThan(0.2);
    expect(shirt?.sleeveOpening ?? 0).toBeLessThan(0.4);
    expect(shirt?.neckGap ?? 1).toBeLessThan(0.35);
    expect(Math.abs(shirt?.center[0] ?? 1)).toBeLessThan(0.35);
    expect(shirt?.center[1] ?? 0).toBeGreaterThan(0.55);
    expect(shirt?.center[1] ?? 2).toBeLessThan(1.45);

    const buttMorphInfo = await page.evaluate(() => window.__characterButtMorphInfo?.());
    expect(buttMorphInfo?.morphTargetsBuilt).toBe(true);
    expect(buttMorphInfo?.shapeTargetsBuilt).toBe(true);
    expect(buttMorphInfo?.meshCount ?? 0).toBeGreaterThan(0);
    const buttBefore = await page.evaluate(() => window.__characterButtPhysics?.());
    await page.evaluate(() => window.__characterSlapButt?.('left', 2));
    await page.waitForTimeout(120);
    const buttAfter = await page.evaluate(() => window.__characterButtPhysics?.());
    expect(Math.abs((buttAfter?.left.offsetX ?? 0) - (buttBefore?.left.offsetX ?? 0))).toBeGreaterThan(0.001);
    const blinkBefore = await page.evaluate(() => window.__characterBlinkDebug?.());
    expect(blinkBefore?.initialized).toBe(true);
    await page.evaluate(() => window.__characterSetManualClose?.(1));
    await page.waitForTimeout(100);
    const blinkClosed = await page.evaluate(() => window.__characterBlinkDebug?.());
    expect(blinkClosed?.amount).toBe(1);
    await page.evaluate(() => window.__characterSetManualClose?.(0));

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.warnings, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('replays recorded sleeve pull without crossing the arm capsule', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);
    const recording = JSON.parse(
      readFileSync('tests/fixtures/character-repros/latest.json', 'utf8'),
    ) as CharacterReproFixture;

    await page.setViewportSize(recording.viewport);
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 20_000,
    });
    await page.locator('[data-testid="blend-tpose-btn"]').click();
    await page.evaluate(() => window.__characterReloadShirtForTest?.());
    await page.waitForTimeout(700);

    let previousT = 0;
    for (const event of recording.events) {
      const delay = Math.min(40, Math.max(0, event.t - previousT));
      if (delay > 0) {
        await page.waitForTimeout(delay);
      }
      previousT = event.t;

      if (event.type === 'action') {
        if (event.name === 'toggle-grab' && event.details?.enabled === true) {
          const button = page.locator('[data-testid="grab-toggle-btn"]');
          if (!(await button.evaluate((element) => element.classList.contains('active')))) {
            await button.click();
          }
        }
        continue;
      }

      if (event.type !== 'pointer') {
        continue;
      }

      if (event.phase === 'move') {
        await page.mouse.move(event.clientX, event.clientY);
      } else if (event.phase === 'down') {
        await page.mouse.move(event.clientX, event.clientY);
        await page.mouse.down();
      } else if (event.phase === 'up' || event.phase === 'cancel' || event.phase === 'leave') {
        await page.mouse.move(event.clientX, event.clientY);
        await page.mouse.up();
      }
    }

    await page.waitForTimeout(900);
    const settledSurface = await page.evaluate(() => window.__characterSettledShirtSurfaceReport?.());
    expect(settledSurface?.vertex.penetrationCount).toBe(0);
    expect(settledSurface?.edge.failureCount).toBe(0);
    expect(settledSurface?.triangle.failureCount).toBe(0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.warnings, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('dev menu bone SDF tuning scales colliders in real time', async ({ page }) => {
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="character-sdf-controls"]')).toBeVisible();
    await page.waitForFunction(
      () => (window.__characterBoneSdfs?.().length ?? 0) > 15,
      undefined,
      { timeout: 15_000 },
    );

    const beforeRadius = (await page.evaluate(() => window.__characterBoneSdfs?.()))?.[0]?.radius ?? 0;
    await page.evaluate(() => window.__characterPatchSdfGlobalRadiusScale?.(0.82));
    await page.evaluate(() => window.__characterSetSdfRuntimeScale?.(0.9));
    const afterRadius = (await page.evaluate(() => window.__characterBoneSdfs?.()))?.[0]?.radius ?? 0;
    expect(afterRadius).toBeLessThan(beforeRadius);
    expect(await page.evaluate(() => window.__characterSdfPreset?.()?.globalRadiusScale)).toBe(0.82);
  });

  test('universal SDF squash reduces overlapping cloth collision radii', async ({ page }) => {
    await page.goto('/?mode=character');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
      timeout: 20_000,
    });
    await page.waitForFunction(
      () => (window.__characterBoneSdfs?.().length ?? 0) > 15,
      undefined,
      { timeout: 15_000 },
    );

    await page.evaluate(() => window.__characterPatchSdfSquashConfig?.({ enabled: false }));
    const rawRadii = await page.evaluate(() => window.__characterBoneSdfs?.().map((cap) => cap.radius) ?? []);
    const clothRadiiDisabled = await page.evaluate(
      () => window.__characterBoneSdfsForCloth?.().map((cap) => cap.radius) ?? [],
    );
    expect(clothRadiiDisabled).toEqual(rawRadii);

    await page.evaluate(() => window.__characterPatchSdfSquashConfig?.({
      enabled: true,
      sdfGap: 0.015,
      squashGain: 1.4,
      smoothing: 1,
      recovery: 1,
    }));
    await page.waitForTimeout(600);
    const squashReport = await page.evaluate(() => window.__characterSdfSquashReport?.());
    const clothRadii = await page.evaluate(() => window.__characterBoneSdfsForCloth?.().map((cap) => cap.radius) ?? []);
    const maxReduction = rawRadii.reduce((max, radius, index) => {
      const clothRadius = clothRadii[index] ?? radius;
      return Math.max(max, radius - clothRadius);
    }, 0);
    expect(squashReport?.activePairCount ?? 0).toBeGreaterThan(0);
    expect(maxReduction).toBeGreaterThan(0.0005);
  });
});
