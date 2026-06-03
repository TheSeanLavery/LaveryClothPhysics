/**
 * Browser audit: measures meshy rig visual forward in character duel (idle + tpose).
 * Writes data/meshBindCalibration.json with recommended meshBindYaw / stanceYawOffset.
 *
 * Usage: npm run audit:mesh-bind
 * Requires dev server on port 5174 (starts via Playwright if needed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = join(REPO_ROOT, 'data/meshBindCalibration.json');
const baseUrl = process.env.AUDIT_BASE_URL ?? 'http://localhost:5174';

interface RigMeasure {
  readonly fighter: string;
  readonly fsmState: string;
  readonly rootRotationY: number;
  readonly forwardYawRad: number | null;
  readonly forwardYawDeg: number | null;
  readonly recommendedMeshBindYaw: number | null;
  readonly profileMeshBindYaw: number;
  readonly profileStanceYawOffset: number;
}

interface MeshBindCalibration {
  readonly version: 1;
  readonly generatedAt: string;
  readonly baseUrl: string;
  readonly assetNote: string;
  readonly idle: RigMeasure | null;
  readonly tpose: RigMeasure | null;
  readonly walkMoving: RigMeasure | null;
  readonly recommendations: {
    readonly meshBindYawFromBones: number;
    readonly stanceYawOffset: number;
    readonly empiricalMeshBindYawForWalk: number;
    readonly notes: readonly string[];
  };
}

function wrapAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

async function waitForDuel(page: import('playwright').Page): Promise<void> {
  await page.goto(`${baseUrl}/?mode=character-duel`);
  await page.locator('[data-testid="sim-status"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sim-status"]')?.textContent?.includes('character duel'),
    { timeout: 60_000 },
  );
  await page.waitForFunction(
    () => typeof window.__duelMeasureRigForward === 'function',
    { timeout: 90_000 },
  );
  await page.waitForTimeout(2000);
}

async function measure(page: import('playwright').Page, fighter: 'A' | 'B'): Promise<RigMeasure> {
  return page.evaluate((f) => window.__duelMeasureRigForward?.(f), fighter) as Promise<RigMeasure>;
}

async function forceState(page: import('playwright').Page, state: string, fighter: 'A' | 'B'): Promise<void> {
  await page.evaluate(
    ({ s, f }) => window.__duelAnimationFsmForceState?.(s, f),
    { s: state, f: fighter },
  );
  await page.waitForTimeout(900);
}

const browser = await chromium.launch({
  headless: false,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=WebGPU',
    '--window-position=3200,200',
    '--window-size=1280,720',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await waitForDuel(page);

  const idle = await measure(page, 'A');
  if (!idle?.forwardYawRad && idle?.forwardYawRad !== 0) {
    throw new Error(
      `Idle forward measurement failed — is the duel scene loaded? Got: ${JSON.stringify(idle)}`,
    );
  }
  await forceState(page, 'tpose', 'A');
  const tpose = await measure(page, 'A');

  await forceState(page, 'walk', 'A');
  await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'down'));
  await page.waitForTimeout(1200);
  const walkMoving = await measure(page, 'A');
  await page.evaluate(() => window.__duelSimulateKey?.('KeyW', 'up'));

  const notes: string[] = [];
  const meshBindYawFromBones = idle.recommendedMeshBindYaw ?? -Math.PI / 2;
  let stanceYawOffset = 0;
  const empiricalMeshBindYawForWalk = -Math.PI / 2;

  if (idle.forwardYawRad !== null && idle.recommendedMeshBindYaw !== null) {
    notes.push(
      `Bone forward at idle: ${idle.forwardYawDeg?.toFixed(1)}° → meshBindYaw ${meshBindYawFromBones.toFixed(4)} rad.`,
    );
  } else {
    notes.push('Idle forward measurement failed.');
  }

  if (idle.forwardYawRad !== null && tpose.forwardYawRad !== null) {
    const stanceDelta = wrapAngleRad(idle.forwardYawRad - tpose.forwardYawRad);
    stanceYawOffset = wrapAngleRad(-stanceDelta);
    notes.push(
      `stanceYawOffset ${(stanceYawOffset * 180 / Math.PI).toFixed(1)}° (idle vs tpose bone forward).`,
    );
  }

  if (walkMoving?.forwardYawDeg !== null && walkMoving.forwardYawDeg !== undefined) {
    notes.push(`Walk (W held) bone forward: ${walkMoving.forwardYawDeg.toFixed(1)}° at root.y=${walkMoving.rootRotationY.toFixed(2)}.`);
  }

  notes.push(
    `Keep profile meshBindYaw at ${(empiricalMeshBindYawForWalk * 180 / Math.PI).toFixed(0)}° for correct walk until we add stride-based correction (bone measure ≠ visual stride).`,
  );

  const output: MeshBindCalibration = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl,
    assetNote: 'meshy blue-haired-anime-girl + duel FSM clips',
    idle,
    tpose,
    walkMoving,
    recommendations: {
      meshBindYawFromBones,
      stanceYawOffset,
      empiricalMeshBindYawForWalk,
      notes,
    },
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);

  console.log('\n=== Mesh bind audit (browser) ===\n');
  console.log(`Idle  forward: ${idle.forwardYawDeg?.toFixed(1) ?? 'n/a'}° → bone meshBindYaw ${meshBindYawFromBones.toFixed(4)} rad`);
  console.log(`Tpose forward: ${tpose.forwardYawDeg?.toFixed(1) ?? 'n/a'}°`);
  console.log(`Walk  forward: ${walkMoving?.forwardYawDeg?.toFixed(1) ?? 'n/a'}° (root.y ${walkMoving?.rootRotationY?.toFixed(2) ?? 'n/a'})`);
  console.log(`stanceYawOffset: ${(stanceYawOffset * 180 / Math.PI).toFixed(1)}°`);
  console.log(`Empirical meshBindYaw for walk: ${(empiricalMeshBindYawForWalk * 180 / Math.PI).toFixed(0)}°`);
  for (const note of notes) {
    console.log(`  · ${note}`);
  }
  console.log(`\nWrote ${OUTPUT_PATH}\n`);
} finally {
  await browser.close();
}
