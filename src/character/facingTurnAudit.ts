import { shortestAngleDelta, wrapAngleRad } from './rigForwardMeasure.ts';

export interface FacingSample {
  readonly tMs: number;
  readonly yawRad: number;
  readonly desiredYawRad: number;
  readonly intentMeshYawRad: number;
  readonly mode: string;
}

export interface FacingTurnAuditOptions {
  /** Max |totalTurn - expectedShortestTurn| (rad). Default 0.4 (~23°). */
  readonly maxTurnErrorRad?: number;
  /** Fail if |totalTurn| exceeds this (default π + 0.05). */
  readonly maxTotalTurnRad?: number;
  /** Allowed opposite-sign steps with |Δ| > minSignificantStepRad. Default 0. */
  readonly maxSignFlips?: number;
  readonly minSignificantStepRad?: number;
  readonly intentMeshYawToleranceRad?: number;
}

export interface FacingTurnVerdict {
  readonly sampleCount: number;
  readonly startYawRad: number;
  readonly endYawRad: number;
  readonly targetYawRad: number;
  readonly expectedShortestTurnRad: number;
  readonly totalTurnRad: number;
  readonly signFlipCount: number;
  readonly usedLongArc: boolean;
  readonly intentOk: boolean;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export function auditFacingTurn(
  samples: readonly FacingSample[],
  expectedIntentMeshYawRad: number,
  options: FacingTurnAuditOptions = {},
): FacingTurnVerdict {
  const maxTurnErrorRad = options.maxTurnErrorRad ?? 0.4;
  const maxTotalTurnRad = options.maxTotalTurnRad ?? Math.PI + 0.05;
  const maxSignFlips = options.maxSignFlips ?? 0;
  const minSignificantStepRad = options.minSignificantStepRad ?? 0.03;
  const intentTol = options.intentMeshYawToleranceRad ?? 0.15;

  const failures: string[] = [];
  const walkSamples = samples.filter((s) => s.mode === 'walk');
  const use = walkSamples.length >= 2 ? walkSamples : samples;

  if (use.length < 2) {
    return {
      sampleCount: use.length,
      startYawRad: use[0]?.yawRad ?? 0,
      endYawRad: use[use.length - 1]?.yawRad ?? 0,
      targetYawRad: use[use.length - 1]?.desiredYawRad ?? 0,
      expectedShortestTurnRad: 0,
      totalTurnRad: 0,
      signFlipCount: 0,
      usedLongArc: false,
      intentOk: false,
      passed: false,
      failures: ['need at least 2 facing samples while moving'],
    };
  }

  const startYawRad = use[0]!.yawRad;
  const endYawRad = use[use.length - 1]!.yawRad;
  const targetYawRad = use[use.length - 1]!.desiredYawRad;
  const expectedShortestTurnRad = shortestAngleDelta(startYawRad, targetYawRad);

  let totalTurnRad = 0;
  let signFlipCount = 0;
  for (let i = 1; i < use.length; i++) {
    const step = shortestAngleDelta(use[i - 1]!.yawRad, use[i]!.yawRad);
    totalTurnRad += step;
    if (i >= 2) {
      const prev = shortestAngleDelta(use[i - 2]!.yawRad, use[i - 1]!.yawRad);
      if (
        Math.abs(prev) > minSignificantStepRad
        && Math.abs(step) > minSignificantStepRad
        && Math.sign(prev) !== Math.sign(step)
      ) {
        signFlipCount += 1;
      }
    }
  }

  const intentOk = use.every(
    (s) => Math.abs(wrapAngleRad(s.intentMeshYawRad - expectedIntentMeshYawRad)) <= intentTol,
  );

  const turnError = Math.abs(totalTurnRad - expectedShortestTurnRad);
  /** Wrong-way spin: path length ≫ shortest path, not merely a large legitimate shortest turn. */
  const usedLongArc = Math.abs(totalTurnRad) > maxTotalTurnRad
    || (
      Math.abs(expectedShortestTurnRad) > 0.2
      && Math.abs(totalTurnRad) > Math.abs(expectedShortestTurnRad) + 0.85
    );

  if (!intentOk) {
    failures.push(`intent mesh yaw should stay near ${expectedIntentMeshYawRad.toFixed(3)} rad`);
  }
  if (turnError > maxTurnErrorRad) {
    failures.push(
      `total turn ${totalTurnRad.toFixed(3)} rad ≠ shortest ${expectedShortestTurnRad.toFixed(3)} rad (Δ ${turnError.toFixed(3)})`,
    );
  }
  if (usedLongArc) {
    failures.push(`used long arc (|total| ${Math.abs(totalTurnRad).toFixed(3)} rad)`);
  }
  if (signFlipCount > maxSignFlips) {
    failures.push(`yaw sign flipped ${signFlipCount} times (wobble)`);
  }
  if (
    Math.abs(expectedShortestTurnRad) > 0.05
    && Math.sign(totalTurnRad) !== Math.sign(expectedShortestTurnRad)
    && Math.abs(totalTurnRad) > 0.05
  ) {
    failures.push('turned opposite direction from target');
  }

  return {
    sampleCount: use.length,
    startYawRad,
    endYawRad,
    targetYawRad,
    expectedShortestTurnRad,
    totalTurnRad,
    signFlipCount,
    usedLongArc,
    intentOk,
    passed: failures.length === 0,
    failures,
  };
}
