import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import { type ClothReproFixture, replayClothRepro } from './helpers/replayClothRepro';
import {
  formatIslandAnalysis,
  islandNear,
  writeSnapshotDebugArtifacts,
  type ClothVisualSnapshotFixture,
  type SnapshotIslandAnalysis,
} from './helpers/clothSnapshotAnalysis';

const DEFAULT_SNAPSHOT_PATH = 'tests/fixtures/multi-material-snapshots/latest.json';
const USER_BUG_SNAPSHOT_PATH = 'tests/fixtures/multi-material-snapshots/snapshot-2026-06-08T21-10-37-749Z.json';
const REPRO_PATH = existsSync('tests/fixtures/multi-material-repros/repro-2026-06-08T17-55-36-423Z.json')
  ? 'tests/fixtures/multi-material-repros/repro-2026-06-08T17-55-36-423Z.json'
  : 'tests/fixtures/multi-material-repros/latest.json';

async function waitForFrames(
  page: import('@playwright/test').Page,
  count: number,
  timeoutMs = 90_000,
): Promise<void> {
  await page.waitForFunction(
    (target) => (window.__multiMaterialClothStats?.().frameCount ?? 0) >= target,
    count,
    { timeout: timeoutMs },
  );
}

async function analyzeSnapshotScreenshot(
  page: import('@playwright/test').Page,
  snapshot: ClothVisualSnapshotFixture,
): Promise<SnapshotIslandAnalysis> {
  const analysis = await page.evaluate(async (fixture) => {
    const result = await window.__multiMaterialAnalyzeSnapshotFloatingIslands?.({
      screenshot: fixture.screenshot,
    }) ?? null;
    if (!result) {
      return null;
    }
    return {
      pass: result.pass,
      anchorIslandCount: result.anchorIslandCount,
      islandCount: result.islands.length,
      floatingIslandCount: result.floatingIslands.length,
      floatingPixelCount: result.floatingPixelCount,
      islands: result.islands.map((island) => ({
        id: island.id,
        pixelCount: island.pixelCount,
        centroidX: island.centroidX,
        centroidY: island.centroidY,
        classification: island.classification,
        touchesLargest: island.touchesLargest,
        minX: island.minX,
        minY: island.minY,
        maxX: island.maxX,
        maxY: island.maxY,
      })),
      floatingIslands: result.floatingIslands.map((island) => ({
        id: island.id,
        pixelCount: island.pixelCount,
        centroidX: island.centroidX,
        centroidY: island.centroidY,
        classification: island.classification,
        touchesLargest: island.touchesLargest,
        minX: island.minX,
        minY: island.minY,
        maxX: island.maxX,
        maxY: island.maxY,
      })),
    };
  }, snapshot);

  expect(analysis, 'floating island analyzer should be available').not.toBeNull();
  return analysis!;
}

test.describe('multi-material floating cloth islands', () => {
  test('clean settled scene has no floating debris islands', async ({ page }) => {
    test.setTimeout(90_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    await page.waitForFunction(
      () => (window.__multiMaterialStats?.().particleCount ?? 0) > 40,
      undefined,
      { timeout: 30_000 },
    );
    await waitForFrames(page, 180);
    await page.evaluate((seconds) => window.__multiMaterialWaitWallClockForTest?.(seconds), 5);
    await waitForFrames(page, 300);

    const analysis = await page.evaluate(async () => {
      const result = await window.__multiMaterialAnalyzeFloatingIslands?.() ?? null;
      if (!result) {
        return null;
      }
      return {
        pass: result.pass,
        anchorIslandCount: result.anchorIslandCount,
        islandCount: result.islands.length,
        floatingIslandCount: result.floatingIslands.length,
        floatingPixelCount: result.floatingPixelCount,
        islands: result.islands.map((island) => ({
          id: island.id,
          pixelCount: island.pixelCount,
          centroidX: island.centroidX,
          centroidY: island.centroidY,
          classification: island.classification,
          touchesLargest: island.touchesLargest,
          minX: island.minX,
          minY: island.minY,
          maxX: island.maxX,
          maxY: island.maxY,
        })),
        floatingIslands: result.floatingIslands.map((island) => ({
          id: island.id,
          pixelCount: island.pixelCount,
          centroidX: island.centroidX,
          centroidY: island.centroidY,
          classification: island.classification,
          touchesLargest: island.touchesLargest,
          minX: island.minX,
          minY: island.minY,
          maxX: island.maxX,
          maxY: island.maxY,
        })),
      };
    });

    expect(analysis, 'live floating island analyzer should be available').not.toBeNull();
    console.log('clean settle island analysis\n' + formatIslandAnalysis(analysis!));

    expect(
      analysis!.floatingIslands,
      `clean settle should have no floating debris (${analysis!.floatingPixelCount}px detected)`,
    ).toEqual([]);
    expect(analysis!.islandCount, 'clean settle should still render cloth bodies').toBeGreaterThan(0);
    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('user bug snapshot finds every detached debris island', async ({ page }) => {
    const snapshotPath = process.env.MULTI_MATERIAL_SNAPSHOT_PATH ?? USER_BUG_SNAPSHOT_PATH;
    test.skip(!existsSync(snapshotPath), `Missing bug snapshot at ${snapshotPath}`);

    test.setTimeout(120_000);

    const consoleCapture = attachConsoleCapture(page);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as ClothVisualSnapshotFixture;
    expect(snapshot.screenshot?.pngBase64, 'snapshot must include an embedded canvas screenshot').toBeTruthy();

    await page.setViewportSize(snapshot.viewport);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    const analysis = await analyzeSnapshotScreenshot(page, snapshot);
    const debug = writeSnapshotDebugArtifacts(
      snapshotPath,
      analysis,
      snapshot.screenshot!.pngBase64,
    );

    console.log('user bug snapshot island analysis\n' + formatIslandAnalysis(analysis));
    console.log('debug artifacts', debug);
    console.log('saved snapshot audits', {
      frameCount: snapshot.state?.frameCount,
      connectivity: snapshot.audits?.connectivity,
      strandThreads: snapshot.audits?.strandThreads,
      savedFloatingIslands: snapshot.floatingIslands?.floatingIslandCount,
    });

    expect(analysis.islandCount, 'snapshot should enumerate every significant cloth island').toBe(3);
    expect(analysis.anchorIslandCount).toBe(1);
    expect(analysis.floatingIslandCount, formatIslandAnalysis(analysis)).toBe(2);
    expect(analysis.floatingPixelCount).toBeGreaterThanOrEqual(900);

    const leftFlap = islandNear(analysis.floatingIslands, 1426, 862, 40);
    const rightFlap = islandNear(analysis.floatingIslands, 1852, 863, 40);
    expect(leftFlap, 'left floating flap should be detected').toBeTruthy();
    expect(rightFlap, 'right floating flap should be detected').toBeTruthy();
    expect(leftFlap!.pixelCount).toBeGreaterThan(350);
    expect(rightFlap!.pixelCount).toBeGreaterThan(300);
    expect(leftFlap!.classification).toBe('floating');
    expect(rightFlap!.classification).toBe('floating');
    expect(leftFlap!.touchesLargest).toBe(false);
    expect(rightFlap!.touchesLargest).toBe(false);

    expect(
      snapshot.audits?.connectivity?.brokenEdgeCount ?? 0,
      'physics audit should confirm this is a torn state',
    ).toBeGreaterThan(0);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('repro replay live render has no floating debris after render fix', async ({ page }) => {
    test.skip(!existsSync(REPRO_PATH), `Record a repro first under ${REPRO_PATH}`);

    test.setTimeout(300_000);

    const consoleCapture = attachConsoleCapture(page);
    const recording = JSON.parse(readFileSync(REPRO_PATH, 'utf8')) as ClothReproFixture & {
      readonly startState?: { readonly frameCount?: number };
      readonly finalState?: { readonly frameCount?: number };
    };

    await page.setViewportSize(recording.viewport);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    const startFrame = await page.evaluate(() => window.__multiMaterialClothStats?.().frameCount ?? 0);

    await replayClothRepro(page, recording, {
      onAction: async (actionPage, event) => {
        if (event.name === 'toggle-grab' && event.details?.enabled === true) {
          const button = actionPage.locator('[data-testid="grab-toggle-btn"]');
          if (!(await button.evaluate((element) => element.classList.contains('active')))) {
            await button.click();
          }
          return;
        }

        if (event.name === 'toggle-grab' && event.details?.enabled === false) {
          const button = actionPage.locator('[data-testid="grab-toggle-btn"]');
          if (await button.evaluate((element) => element.classList.contains('active'))) {
            await button.click();
          }
          return;
        }

        if (event.name === 'apply-settings' && event.details?.partial) {
          await actionPage.evaluate((partial) => {
            window.__multiMaterialApplySettings?.(partial as Record<string, unknown>);
          }, event.details.partial);
        }
      },
    });

    const recordedStartFrame = recording.startState?.frameCount ?? 0;
    const recordedFinalFrame = recording.finalState?.frameCount ?? recordedStartFrame + 360;
    const frameDelta = Math.max(360, recordedFinalFrame - recordedStartFrame);
    await waitForFrames(page, startFrame + frameDelta, 180_000);
    await page.waitForTimeout(1200);

    const connectivity = await page.evaluate(async () => window.__multiMaterialAuditConnectivity?.() ?? null);
    expect(connectivity?.brokenEdgeCount ?? 0).toBeGreaterThan(0);

    const analysis = await page.evaluate(async () => {
      const result = await window.__multiMaterialAnalyzeFloatingIslands?.() ?? null;
      if (!result) {
        return null;
      }
      return {
        pass: result.pass,
        anchorIslandCount: result.anchorIslandCount,
        islandCount: result.islands.length,
        floatingIslandCount: result.floatingIslands.length,
        floatingPixelCount: result.floatingPixelCount,
        islands: result.islands.map((island) => ({
          id: island.id,
          pixelCount: island.pixelCount,
          centroidX: island.centroidX,
          centroidY: island.centroidY,
          classification: island.classification,
          touchesLargest: island.touchesLargest,
          minX: island.minX,
          minY: island.minY,
          maxX: island.maxX,
          maxY: island.maxY,
        })),
        floatingIslands: result.floatingIslands.map((island) => ({
          id: island.id,
          pixelCount: island.pixelCount,
          centroidX: island.centroidX,
          centroidY: island.centroidY,
          classification: island.classification,
          touchesLargest: island.touchesLargest,
          minX: island.minX,
          minY: island.minY,
          maxX: island.maxX,
          maxY: island.maxY,
        })),
      };
    });

    expect(analysis, 'live floating island analyzer should be available after repro').not.toBeNull();
    console.log('repro replay live island analysis\n' + formatIslandAnalysis(analysis!));
    console.log('repro replay connectivity', connectivity);

    expect(
      analysis!.floatingIslands,
      `live render still has floating debris (${analysis!.floatingPixelCount}px across ${analysis!.floatingIslandCount} island(s))`,
    ).toEqual([]);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('latest saved snapshot PNG is the frozen bug fixture until re-saved clean', async ({ page }) => {
    const snapshotPath = process.env.MULTI_MATERIAL_SNAPSHOT_PATH ?? DEFAULT_SNAPSHOT_PATH;
    test.skip(!existsSync(snapshotPath), `Save a snapshot first under ${snapshotPath}`);

    test.setTimeout(120_000);

    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as ClothVisualSnapshotFixture;
    expect(snapshot.screenshot?.pngBase64, 'snapshot must include an embedded canvas screenshot').toBeTruthy();

    await page.setViewportSize(snapshot.viewport);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    const analysis = await analyzeSnapshotScreenshot(page, snapshot);
    writeSnapshotDebugArtifacts(snapshotPath, analysis, snapshot.screenshot!.pngBase64);

    if (process.env.EXPECT_CLEAN_SNAPSHOT === '1') {
      expect(
        analysis.floatingIslands,
        `re-saved snapshot should be clean (${analysis.floatingPixelCount}px debris)`,
      ).toEqual([]);
      return;
    }

    // Frozen PNG from before the render fix — documents what the detector must find.
    expect(analysis.floatingIslandCount).toBeGreaterThanOrEqual(2);
  });
});
