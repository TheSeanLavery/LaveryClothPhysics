import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ReadbackCounterDelta {
  readonly healthStarted: number;
  readonly topologyStarted: number;
  readonly bbVisualStarted: number;
  readonly healthSkippedRuntime: number;
  readonly topologySkippedDisabled: number;
}

export interface ClothPerformanceSample {
  readonly label: string;
  readonly durationMs: number;
  readonly rafFps: number;
  readonly simFps: number;
  readonly particleCount: number;
  readonly grabMode: boolean;
  readonly grabActive: boolean;
  readonly readbackDelta: ReadbackCounterDelta;
}

export interface ClothPerformanceReport {
  readonly mode: string;
  readonly backend: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly samples: readonly ClothPerformanceSample[];
}

export interface MeasurePerformanceOptions {
  readonly durationMs?: number;
  readonly warmupMs?: number;
}

const DEFAULT_DURATION_MS = 2_000;
const DEFAULT_WARMUP_MS = 400;

export async function assertWebGpuBackend(page: Page, backendTextSelector = '[data-testid="sim-backend"]'): Promise<string> {
  const backendText = await page.locator(backendTextSelector).textContent();
  expect(backendText ?? '').toMatch(/backend:/i);
  expect(backendText!.toLowerCase()).toContain('webgpu');
  return backendText!;
}

export async function countAnimationFrames(page: Page, durationMs: number): Promise<number> {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const startedAt = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - startedAt >= duration) {
            resolve(frames);
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

export async function waitForMultiMaterialReady(page: Page, minParticles = 40): Promise<void> {
  await page.waitForFunction(
    (minCount) => (window.__multiMaterialStats?.().particleCount ?? 0) >= minCount,
    minParticles,
    { timeout: 30_000 },
  );
}

export async function settleMultiMaterial(page: Page, seconds = 3): Promise<void> {
  await page.evaluate((s) => window.__multiMaterialWaitWallClockForTest?.(s), seconds);
}

export function writePerformanceReport(outputPath: string, report: ClothPerformanceReport): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function summarizePerformance(report: ClothPerformanceReport): string {
  return report.samples
    .map(
      (sample) =>
        `${sample.label}: RAF ${sample.rafFps.toFixed(1)} fps · sim ${sample.simFps.toFixed(1)} fps · grabActive=${sample.grabActive}`,
    )
    .join('\n');
}

export function findSample(report: ClothPerformanceReport, label: string): ClothPerformanceSample {
  const sample = report.samples.find((entry) => entry.label === label);
  if (!sample) {
    throw new Error(`Missing performance sample "${label}"`);
  }
  return sample;
}

export function ratioOrInfinity(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return numerator / denominator;
}
