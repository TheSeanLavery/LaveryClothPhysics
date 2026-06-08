import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import { type ClothReproFixture, replayClothRepro } from './helpers/replayClothRepro';

const SECOND_REPRO_PATH =
  'tests/fixtures/multi-material-repros/repro-2026-06-08T17-55-36-423Z.json';
const LATEST_REPRO_PATH = existsSync(SECOND_REPRO_PATH)
  ? SECOND_REPRO_PATH
  : 'tests/fixtures/multi-material-repros/latest.json';

interface StrandAuditSummary {
  frameCount: number;
  brokenEdgeCount: number;
  tornAdjacentCount: number;
  tornAdjacentVisibleCount: number;
  tornAdjacentMissingEdgeIds: number[];
  requiredCount: number;
  renderedCount: number;
  missingEdgeIds: number[];
}

interface ConnectivityAuditSummary {
  frameCount: number;
  brokenEdgeCount: number;
  connectedComponentCount: number;
  hangingDangleSeparatedFromBanner: boolean;
}

async function waitForFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.waitForFunction(
    (target) => (window.__multiMaterialClothStats?.().frameCount ?? 0) >= target,
    count,
    { timeout: 90_000 },
  );
}

test.describe('multi-material recorded repro', () => {
  test('replays latest user recording and audits strand threads', async ({ page }) => {
    test.skip(
      !existsSync(SECOND_REPRO_PATH) && !existsSync('tests/fixtures/multi-material-repros/latest.json'),
      'Record a repro first under tests/fixtures/multi-material-repros/',
    );

    test.setTimeout(300_000);

    const consoleCapture = attachConsoleCapture(page);
    const recording = JSON.parse(readFileSync(LATEST_REPRO_PATH, 'utf8')) as ClothReproFixture & {
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

        if (event.name === 'toggle-shoot' && event.details?.enabled === true) {
          const button = actionPage.locator('[data-testid="shoot-toggle-btn"]');
          if (!(await button.evaluate((element) => element.classList.contains('active')))) {
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
    await waitForFrames(page, startFrame + frameDelta);
    await page.waitForTimeout(1200);

    const audit = await page.evaluate(async () => window.__multiMaterialAuditStrandThreads?.() ?? null) as StrandAuditSummary | null;
    const connectivity = await page.evaluate(
      async () => window.__multiMaterialAuditConnectivity?.() ?? null,
    ) as ConnectivityAuditSummary | null;
    expect(audit, 'strand audit API should be available after repro replay').not.toBeNull();
    expect(connectivity, 'connectivity audit API should be available after repro replay').not.toBeNull();

    console.log('multi-material repro connectivity audit', connectivity);
    console.log('multi-material repro strand audit', {
      brokenEdgeCount: audit!.brokenEdgeCount,
      tornAdjacentCount: audit!.tornAdjacentCount,
      tornAdjacentVisibleCount: audit!.tornAdjacentVisibleCount,
      tornAdjacentMissing: audit!.tornAdjacentMissingEdgeIds.slice(0, 24),
      requiredCount: audit!.requiredCount,
      renderedCount: audit!.renderedCount,
      missingCount: audit!.missingEdgeIds.length,
      missingSample: audit!.missingEdgeIds.slice(0, 24),
    });

    expect(audit!.brokenEdgeCount, 'repro should tear at least one edge').toBeGreaterThan(0);
    expect(connectivity!.brokenEdgeCount, 'physics should break edges after repro tear').toBeGreaterThan(0);
    expect(
      connectivity!.connectedComponentCount,
      'torn assembly should split into multiple sim components',
    ).toBeGreaterThan(1);
    if (connectivity!.hangingDangleSeparatedFromBanner) {
      console.log('hanging dangle fully separated from banner hoist');
    }
    expect(audit!.tornAdjacentMissingEdgeIds, 'torn-rim strands must render').toEqual([]);
    expect(
      audit!.renderedCount,
      'bridge strands should render well beyond torn-rim count alone',
    ).toBeGreaterThan(audit!.tornAdjacentVisibleCount + 40);
    expect(
      audit!.missingEdgeIds.length,
      'only a tiny number of bridge strands may remain after physics sever',
    ).toBeLessThanOrEqual(4);
    console.log('repro recording used', LATEST_REPRO_PATH);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
