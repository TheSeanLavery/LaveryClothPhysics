import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('GPU cloth tube scene', () => {
  test('boots a tube-shaped cloth scene with grab and shoot controls', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });
    await expect(page.locator('#overlay h1')).toHaveText('GPU Cloth Tube');
    await expect(page.locator('[data-testid="tube-controls"]')).toBeVisible();
    await expect(page.locator('[data-testid="sim-particles"]')).toContainText('tube particles:');

    const initialStats = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(initialStats?.particleCount).toBeGreaterThan(500);
    expect(initialStats?.triangleCount).toBeGreaterThan(1000);
    expect(initialStats?.grabMode).toBe(true);
    expect(initialStats?.grabRadius).toBeGreaterThan(0.04);

    await page.evaluate(() => window.__zeroGravityTubeSetShoot?.(true));
    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);

    await page.waitForTimeout(60);
    const afterShot = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterShot?.shootMode).toBe(true);

    await page.evaluate(() => window.__zeroGravityTubeReset?.());
    const afterReset = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterReset?.projectileCount).toBe(0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('tube stays stable under zero force without solver wiggle', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    const before = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(before?.gravity).toBe(0);
    expect(before?.pressure).toBe(0);
    expect(before?.hasNaN).toBe(false);

    await page.waitForTimeout(2_000);

    const after = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(after?.hasNaN).toBe(false);
    expect(Math.abs((after?.centerY ?? 0) - (before?.centerY ?? 0))).toBeLessThan(0.01);
    expect(Math.abs((after?.minY ?? 0) - (before?.minY ?? 0))).toBeLessThan(0.005);
    expect(Math.abs((after?.maxY ?? 0) - (before?.maxY ?? 0))).toBeLessThan(0.005);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('GPU cloth tube scene maintains interactive frame cadence', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.waitForTimeout(500);
    const frameCount = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const startedAt = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - startedAt >= 2_000) {
              resolve(frames);
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

    expect(frameCount).toBeGreaterThan(50);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('small perturbation stays bounded with self-collision enabled', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(() => {
      window.__zeroGravityTubeSetGravity?.(0);
      window.__zeroGravityTubeReset?.();
      window.__zeroGravityTubeSetShoot?.(true);
    });
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => window.__zeroGravityTubeStats?.());

    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);
    await page.waitForTimeout(2_000);

    const afterShot = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterShot?.hasNaN).toBe(false);
    expect(afterShot?.triangleCount).toBeGreaterThan(1000);
    expect(Math.abs((afterShot?.centerY ?? 0) - (before?.centerY ?? 0))).toBeLessThan(0.25);
    expect((afterShot?.minY ?? 0)).toBeGreaterThan((before?.minY ?? 0) - 0.25);
    expect((afterShot?.maxY ?? 0)).toBeLessThan((before?.maxY ?? 0) + 0.25);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('spawns stitched assembly cloth simulations', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    for (const kind of ['box', 'octagonalTube', 'pyramid'] as const) {
      const faceCount = await page.evaluate((shape) => window.__zeroGravityTubeSpawnShape?.(shape), kind);
      const stats = await page.evaluate(() => window.__zeroGravityTubeShapeStats?.());
      const beforePhysics = await page.evaluate(() => window.__zeroGravityTubeStats?.());
      expect(faceCount).toBeGreaterThan(0);
      expect(stats?.activeShape).toBe(kind);
      expect(stats?.vertexCount).toBeGreaterThan(kind === 'pyramid' ? 0 : 100);
      expect(stats?.faceCount).toBeGreaterThan(0);
      expect(stats?.stitchEdgeCount).toBeGreaterThan(0);
      expect(stats?.simulated).toBe(true);
      expect(beforePhysics?.gravity).toBe(0);
      await page.waitForTimeout(500);
      const afterPhysics = await page.evaluate(() => window.__zeroGravityTubeStats?.());
      expect(afterPhysics?.hasNaN).toBe(false);
      expect(Math.abs((afterPhysics?.centerY ?? 0) - (beforePhysics?.centerY ?? 0))).toBeLessThan(0.01);
      expect(Math.abs((afterPhysics?.minY ?? 0) - (beforePhysics?.minY ?? 0))).toBeLessThan(0.01);
      expect(Math.abs((afterPhysics?.maxY ?? 0) - (beforePhysics?.maxY ?? 0))).toBeLessThan(0.01);
    }

    await page.evaluate(() => window.__zeroGravityTubeClearSpawnedShapes?.());
    const cleared = await page.evaluate(() => window.__zeroGravityTubeShapeStats?.());
    expect(cleared?.activeShape).toBe(null);
    expect(cleared?.simulated).toBe(false);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('spawned assembly cloth uses shared grab and BB interaction paths', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(() => window.__zeroGravityTubeSpawnShape?.('box'));
    await page.evaluate(() => {
      window.__zeroGravityTubeSetGrab?.(true);
      window.__zeroGravityTubeSetShoot?.(true);
    });
    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);

    await page.waitForTimeout(1_000);
    const afterShot = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterShot?.hasNaN).toBe(false);
    expect(afterShot?.gravity).toBe(0);

    await page.evaluate(() => {
      window.__zeroGravityTubeSetShoot?.(false);
      window.__zeroGravityTubeSetGrab?.(true);
    });
    const canvas = page.locator('[data-testid="sim-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.48, { steps: 8 });
    await page.mouse.up();

    const afterGrab = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterGrab?.hasNaN).toBe(false);
    expect(afterGrab?.grabMode).toBe(true);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('spawned assembly cloth visibly tears at low stretch threshold', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(() => window.__zeroGravityTubeSpawnShape?.('box'));
    const before = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    await page.evaluate(() => {
      window.__zeroGravityTubeSetTearThreshold?.(1);
      window.__zeroGravityTubeSetShoot?.(true);
    });

    const fired = await page.evaluate(() => window.__zeroGravityTubeFire?.(0, 0));
    expect(fired).toBe(true);
    await page.waitForTimeout(1_500);

    const after = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(after?.hasNaN).toBe(false);
    expect(after?.triangleCount ?? 0).toBeLessThan(before?.triangleCount ?? 0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('spawns a realistic stitched T-shirt with a startup-only inflation pulse', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(() => window.__zeroGravityTubeSetTearThreshold?.(1.37));
    const faceCount = await page.evaluate(() => window.__zeroGravityTubeSpawnShape?.('tshirt'));
    const stats = await page.evaluate(() => window.__zeroGravityTubeShapeStats?.());
    const beforePhysics = await page.evaluate(() => window.__zeroGravityTubeStats?.());

    expect(faceCount).toBeGreaterThan(500);
    expect(stats?.activeShape).toBe('tshirt');
    expect(stats?.vertexCount).toBeGreaterThan(500);
    expect(stats?.stitchEdgeCount).toBeGreaterThan(80);
    expect(stats?.simulated).toBe(true);
    expect(stats?.sleeveStats?.crossSectionHeight).toBeGreaterThan(0.25);
    expect(stats?.sleeveStats?.crossSectionDepth).toBeGreaterThan(0.12);
    expect(stats?.sleeveStats?.cuffDrop).toBeGreaterThan(0.04);
    expect(stats?.sleeveStats?.vertexCount).toBeGreaterThan(600);
    expect(beforePhysics?.pressure).toBeGreaterThan(0);
    expect(beforePhysics?.tearStretchThreshold).toBeGreaterThan(1000);
    expect(beforePhysics?.mannequinCollision).toBe(true);
    await page.waitForTimeout(1_000);

    const afterPhysics = await page.evaluate(() => window.__zeroGravityTubeStats?.());
    expect(afterPhysics?.hasNaN).toBe(false);
    expect(afterPhysics?.pressure).toBe(0);
    expect(afterPhysics?.tearStretchThreshold).toBeCloseTo(1.37, 2);
    expect(afterPhysics?.mannequinCollision).toBe(true);
    expect(afterPhysics?.centerY ?? 0).toBeGreaterThan(0.15);
    expect(afterPhysics?.centerY ?? 0).toBeLessThan(0.75);
    expect(afterPhysics?.minY ?? 0).toBeGreaterThan(-0.1);
    expect(afterPhysics?.maxY ?? 0).toBeLessThan(1.15);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });

  test('presets save and load while preserving the active T-shirt assembly', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);
    const presetName = `Tube T-shirt preset ${Date.now()}`;

    await page.goto('/?mode=tube');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (flag solver tube)', {
      timeout: 20_000,
    });

    await page.evaluate(async (name) => {
      const presets = await window.__zeroGravityTubeListSettingsPresets?.();
      for (const preset of presets ?? []) {
        if (preset.name === name) {
          await window.__zeroGravityTubeDeleteSettingsPreset?.(preset.id);
        }
      }
    }, presetName);

    await page.evaluate(() => window.__zeroGravityTubeSpawnShape?.('tshirt'));
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      await window.__zeroGravityTubeApplySettings?.({
        windStrength: 4.75,
        tearStretchThreshold: 1.62,
        bbSpeed: 33,
        shapePressure: 0,
      });
    });

    const saved = await page.evaluate((name) => window.__zeroGravityTubeSaveSettingsPreset?.(name), presetName);
    expect(saved?.id).toBeTruthy();

    await page.evaluate(async () => {
      await window.__zeroGravityTubeApplySettings?.({
        windStrength: 0.5,
        tearStretchThreshold: 1.05,
        bbSpeed: 9,
        shapePressure: 0,
      });
    });

    const loaded = await page.evaluate((id) => window.__zeroGravityTubeLoadSettingsPreset?.(id!), saved!.id);
    const settings = await page.evaluate(() => window.__zeroGravityTubeGetSettings?.());
    const shapeStats = await page.evaluate(() => window.__zeroGravityTubeShapeStats?.());
    const simStats = await page.evaluate(() => window.__zeroGravityTubeStats?.());

    expect(loaded?.name).toBe(presetName);
    expect(settings?.windStrength).toBeCloseTo(4.75, 2);
    expect(settings?.tearStretchThreshold).toBeCloseTo(1.62, 2);
    expect(settings?.bbSpeed).toBeCloseTo(33, 2);
    expect(settings?.shapePressure).toBe(0);
    expect(shapeStats?.activeShape).toBe('tshirt');
    expect(shapeStats?.simulated).toBe(true);
    expect(simStats?.hasNaN).toBe(false);

    await page.evaluate((id) => window.__zeroGravityTubeDeleteSettingsPreset?.(id!), saved!.id);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
