import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium, type Page } from 'playwright';

interface ModeBenchmark {
  readonly mode: 'flag' | 'tube' | 'character';
  readonly url: string;
  readonly loadMs: number;
  readonly rafFramesPerSecond: number;
  readonly simFramesPerSecond: number | null;
  readonly startFrame: number | null;
  readonly endFrame: number | null;
  readonly particleCount: number | null;
  readonly readbackStats?: unknown;
}

interface BenchmarkRun {
  readonly label: string;
  readonly baseUrl: string;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly modes: readonly ModeBenchmark[];
}

const label = process.argv[2] ?? 'current';
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:5173';
const outputPath = process.argv[4] ?? `test-results/readback-baseline-${label}.json`;
const durationMs = Number(process.argv[5] ?? 2000);

const modes = [
  { mode: 'flag' as const, path: '/', statusText: 'running' },
  { mode: 'tube' as const, path: '/?mode=tube', statusText: 'running (flag solver tube)' },
  { mode: 'character' as const, path: '/?mode=character', statusText: 'running (animated character cloth)' },
];

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const results: ModeBenchmark[] = [];

for (const mode of modes) {
  const url = new URL(mode.path, baseUrl).toString();
  const startedAt = performance.now();
  await page.goto(url);
  await page.locator('[data-testid="sim-status"]').waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="sim-status"]')?.textContent?.includes(expected),
    mode.statusText,
    { timeout: 45_000 },
  );
  const loadMs = performance.now() - startedAt;
  await waitForSettledMode(page, mode.mode);
  const startFrame = await readModeFrame(page, mode.mode);
  const rafFrames = await countAnimationFrames(page, durationMs);
  const endFrame = await readModeFrame(page, mode.mode);
  const stats = await readModeStats(page, mode.mode);
  results.push({
    mode: mode.mode,
    url,
    loadMs,
    rafFramesPerSecond: rafFrames / (durationMs / 1000),
    simFramesPerSecond:
      startFrame !== null && endFrame !== null
        ? (endFrame - startFrame) / (durationMs / 1000)
        : null,
    startFrame,
    endFrame,
    particleCount: typeof stats?.particleCount === 'number' ? stats.particleCount : null,
    readbackStats: await readModeReadbackStats(page, mode.mode),
  });
}

await browser.close();

const payload: BenchmarkRun = {
  label,
  baseUrl,
  capturedAt: new Date().toISOString(),
  durationMs,
  modes: results,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload, null, 2));

async function waitForSettledMode(page: Page, mode: ModeBenchmark['mode']): Promise<void> {
  if (mode === 'character') {
    await page.waitForFunction(() => (window.__characterStats?.().frameCount ?? 0) > 30, undefined, {
      timeout: 45_000,
    });
    return;
  }
  await countAnimationFrames(page, 30);
}

async function countAnimationFrames(page: Page, ms: number): Promise<number> {
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
    ms,
  );
}

async function readModeFrame(page: Page, mode: ModeBenchmark['mode']): Promise<number | null> {
  return page.evaluate((kind) => {
    if (kind === 'flag') return window.__flagSim?.frameCount ?? null;
    if (kind === 'tube') return window.__zeroGravityTubeStats?.().frameCount ?? null;
    return window.__characterStats?.().frameCount ?? null;
  }, mode);
}

async function readModeStats(page: Page, mode: ModeBenchmark['mode']): Promise<{ particleCount?: number } | null> {
  return page.evaluate((kind) => {
    if (kind === 'flag') return window.__flagSim ?? null;
    if (kind === 'tube') return window.__zeroGravityTubeStats?.() ?? null;
    return window.__characterClothStats?.() ?? null;
  }, mode);
}

async function readModeReadbackStats(page: Page, mode: ModeBenchmark['mode']): Promise<unknown> {
  return page.evaluate((kind) => {
    if (kind === 'flag') return window.__flagSimReadbackStats?.() ?? null;
    if (kind === 'tube') return window.__zeroGravityTubeReadbackStats?.() ?? null;
    return window.__characterClothReadbackStats?.() ?? null;
  }, mode);
}
