import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('BB projectile motion', () => {
  test('GPU BB motion is smooth and mesh tracks physics each frame', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 120, undefined, {
      timeout: 12_000,
    });

    const report = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 0,
        bbSpeed: 22,
        bbVisualRadius: 0.022,
        bbHitRadius: 0.07,
        bbForceStrength: 1.2,
        bbFabricSoftness: 0.58,
      });
      window.__flagSimResetFlag?.();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return window.__flagSimMeasureBbMotion?.({
        ndcX: 0.12,
        ndcY: -0.04,
        sampleCount: 28,
      });
    });

    expect(report, 'measureBbMotionSmoothness should return a report').toBeDefined();
    expect(report!.slot, `issues: ${report!.issues.join('; ')}`).toBeGreaterThanOrEqual(0);
    expect(report!.aliveSamples, `issues: ${report!.issues.join('; ')}`).toBeGreaterThanOrEqual(8);
    expect(report!.stuckFrames, `issues: ${report!.issues.join('; ')}`).toBe(0);
    expect(report!.maxGpuMeshError, `issues: ${report!.issues.join('; ')}`).toBeLessThan(1e-4);
    expect(report!.maxJumpRatio, `issues: ${report!.issues.join('; ')}`).toBeLessThanOrEqual(6);
    expect(report!.medianStep, `issues: ${report!.issues.join('; ')}`).toBeGreaterThan(0.008);
    expect(report!.smooth, `issues: ${report!.issues.join('; ')}`).toBe(true);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('BB is blocked by cloth with soft fabric push instead of phasing through', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 120, undefined, {
      timeout: 12_000,
    });

    const report = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 0,
        bbSpeed: 30,
        bbVisualRadius: 0.022,
        bbHitRadius: 0.07,
        bbForceStrength: 1.2,
        bbFabricSoftness: 0.58,
        bbRestitution: 0.38,
      });
      window.__flagSimResetFlag?.();
      for (let i = 0; i < 4; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return window.__flagSimMeasureBbClothBlocking?.({
        ndcX: 0,
        ndcY: 0,
        sampleCount: 55,
      });
    });

    expect(report, 'measureBbClothBlocking should return a report').toBeDefined();
    expect(report!.minSurfaceGap, `issues: ${report!.issues.join('; ')}`).toBeLessThan(0.14);
    expect(report!.phasedThrough, `issues: ${report!.issues.join('; ')}`).toBe(false);
    expect(report!.blocked, `issues: ${report!.issues.join('; ')}`).toBe(true);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('fired BB stays alive and moves forward for several frames', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 120, undefined, {
      timeout: 12_000,
    });

    const motion = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({ windStrength: 0, bbSpeed: 24 });
      window.__flagSimResetFlag?.();

      const slot = window.__flagSimFireBb?.(0.15, -0.05);
      if (slot === null || slot === undefined) {
        return { ok: false, reason: 'fire-failed' as const };
      }

      const samples: Array<{ alive: boolean; z: number }> = [];
      for (let i = 0; i < 16; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const frame = await window.__flagSimReadBbSamples?.();
        const bb = frame?.find((entry) => entry.slot === slot);
        if (!bb) {
          return { ok: false, reason: 'missing-slot' as const };
        }
        samples.push({ alive: bb.alive, z: bb.position.z });
        if (!bb.alive && samples.length > 3) {
          break;
        }
      }

      const aliveSamples = samples.filter((sample) => sample.alive);
      if (aliveSamples.length < 8) {
        return { ok: false, reason: 'died-too-soon' as const, aliveSamples: aliveSamples.length };
      }

      const startZ = aliveSamples[0]!.z;
      const endZ = aliveSamples[aliveSamples.length - 1]!.z;
      const traveled = endZ - startZ;

      return {
        ok: traveled < -0.08,
        reason: traveled < -0.08 ? ('ok' as const) : ('no-forward-motion' as const),
        traveled,
        aliveSamples: aliveSamples.length,
      };
    });

    expect(
      motion.ok,
      `expected BB to travel toward flag (reason=${motion.reason}, traveled=${'traveled' in motion ? motion.traveled : 'n/a'})`,
    ).toBe(true);
  });
});
