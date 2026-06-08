import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';
import {
  assertWebGpuBackend,
  findSample,
  ratioOrInfinity,
  settleMultiMaterial,
  summarizePerformance,
  type ClothPerformanceReport,
  waitForMultiMaterialReady,
} from './helpers/clothPerformanceProbe';

const MEASURE_MS = Number(process.env.PERF_MEASURE_MS ?? 2_000);
const SETTLE_SECONDS = Number(process.env.PERF_SETTLE_SECONDS ?? 3);
const REPORT_PATH =
  process.env.PERF_REPORT_PATH ?? 'test-results/multi-material-grab-performance.json';

const MATERIAL_SCENARIOS = [
  { label: 'idle-orbit', grabMode: false },
  { label: 'grab-mode-idle', grabMode: true },
  { label: 'grab-banner-a', patchKey: 'banner-a' },
  { label: 'grab-banner-b', patchKey: 'banner-b' },
  { label: 'grab-banner-c', patchKey: 'banner-c' },
  { label: 'grab-dangle-soft', patchKey: 'dangle-soft' },
  { label: 'grab-dangle-stiff', patchKey: 'dangle-stiff' },
] as const;

test.describe('Multi-material grab performance (WebGPU, headed)', () => {
  test('measures RAF and sim FPS idle vs grabbing each material patch', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleCapture = attachConsoleCapture(page);
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );

    const backend = await assertWebGpuBackend(page);
    await waitForMultiMaterialReady(page);
    await settleMultiMaterial(page, SETTLE_SECONDS);

    const patchTargets = await page.evaluate(() => window.__multiMaterialPatchGrabTargets?.() ?? {});
    expect(Object.keys(patchTargets).length).toBeGreaterThanOrEqual(5);

    const samples = await page.evaluate(
      async ({ scenarios, measureMs }) => {
        const measure = window.__multiMaterialMeasurePerformance;
        if (!measure) {
          throw new Error('Missing __multiMaterialMeasurePerformance hook');
        }
        const targets = window.__multiMaterialPatchGrabTargets?.() ?? {};
        const results = [];

        for (const scenario of scenarios) {
          if ('patchKey' in scenario) {
            const target = targets[scenario.patchKey];
            if (!target) {
              throw new Error(`Missing grab target for ${scenario.patchKey}`);
            }
            results.push(
              await measure({
                label: scenario.label,
                durationMs: measureMs,
                grabMode: true,
                grab: {
                  ndcX: target.ndcX,
                  ndcY: target.ndcY,
                  dragNdcPerFrame: { x: 0.0018, y: -0.0012 },
                },
              }),
            );
            continue;
          }

          results.push(
            await measure({
              label: scenario.label,
              durationMs: measureMs,
              grabMode: scenario.grabMode,
            }),
          );
        }

        return results;
      },
      { scenarios: MATERIAL_SCENARIOS, measureMs: MEASURE_MS },
    );

    const report: ClothPerformanceReport = {
      mode: 'multi-material',
      backend,
      capturedAt: new Date().toISOString(),
      durationMs: MEASURE_MS,
      samples,
    };

    mkdirSync('test-results', { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const idle = findSample(report, 'idle-orbit');
    const grabModeIdle = findSample(report, 'grab-mode-idle');
    const grabSoft = findSample(report, 'grab-dangle-soft');
    const grabStiff = findSample(report, 'grab-dangle-stiff');

    expect(idle.rafFps, summarizePerformance(report)).toBeGreaterThan(25);
    expect(idle.simFps, summarizePerformance(report)).toBeGreaterThan(25);
    expect(grabModeIdle.simFps, summarizePerformance(report)).toBeGreaterThan(22);

    for (const sample of samples) {
      expect(sample.readbackDelta.healthStarted, `${sample.label} health readback`).toBe(0);
      expect(sample.readbackDelta.topologyStarted, `${sample.label} topology readback`).toBe(0);
      expect(sample.readbackDelta.bbVisualStarted, `${sample.label} bb visual readback`).toBe(0);
    }

    const grabActiveSamples = samples.filter((sample) => sample.grabActive);
    for (const sample of grabActiveSamples) {
      expect(sample.simFps, `${sample.label} sim stalled`).toBeGreaterThan(20);
    }

    const grabToIdleRafRatio = ratioOrInfinity(grabSoft.rafFps, idle.rafFps);
    const stiffToSoftRafRatio = ratioOrInfinity(grabStiff.rafFps, grabSoft.rafFps);

    expect(
      grabToIdleRafRatio,
      `grab-dangle-soft RAF (${grabSoft.rafFps.toFixed(1)}) vs idle (${idle.rafFps.toFixed(1)}) = ${(grabToIdleRafRatio * 100).toFixed(0)}%`,
    ).toBeGreaterThan(0.85);

    expect(
      stiffToSoftRafRatio,
      `grab-dangle-stiff RAF (${grabStiff.rafFps.toFixed(1)}) vs soft (${grabSoft.rafFps.toFixed(1)}) = ${(stiffToSoftRafRatio * 100).toFixed(0)}%`,
    ).toBeGreaterThan(0.6);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
