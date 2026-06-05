import { expect } from '@playwright/test';

export interface ClothVertexBaselineFixture {
  readonly version: number;
  readonly presetSource: string;
  readonly particleCount: number;
  readonly renderVertexCount: number;
  readonly positions: readonly (readonly [number, number, number])[];
}

export const CHARACTER_CLOTH_BASELINE_PATH = 'tests/fixtures/character-cloth-baseline/settled-tpose.json';

/**
 * Per-vertex L2 drift budget (~4 cm). Live character loop + GPU readback vary slightly
 * between runs; still catches large physics regressions (shirt collapse, wrong preset).
 */
const POSITION_TOLERANCE_L2 = 5e-2;

export function assertClothVertexBaseline(
  actual: ClothVertexBaselineFixture,
  expected: ClothVertexBaselineFixture,
  options: { positionToleranceL2?: number } = {},
): void {
  const tolerance = options.positionToleranceL2 ?? POSITION_TOLERANCE_L2;
  expect(actual.presetSource).toBe(expected.presetSource);
  expect(actual.particleCount).toBe(expected.particleCount);
  expect(actual.renderVertexCount).toBe(expected.renderVertexCount);
  expect(actual.positions.length).toBe(expected.positions.length);

  let maxDrift = 0;
  let maxDriftIndex = -1;
  for (let i = 0; i < expected.positions.length; i += 1) {
    const a = actual.positions[i]!;
    const e = expected.positions[i]!;
    const drift = Math.hypot(a[0] - e[0], a[1] - e[1], a[2] - e[2]);
    if (drift > maxDrift) {
      maxDrift = drift;
      maxDriftIndex = i;
    }
  }

  expect(
    maxDrift,
    `max vertex drift ${maxDrift.toFixed(6)} at index ${maxDriftIndex}`,
  ).toBeLessThanOrEqual(tolerance);
}
