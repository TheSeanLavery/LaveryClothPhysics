import { wrapAngleRad } from './rigForwardMeasure.ts';
import { auditFacingTurn, type FacingSample, type FacingTurnAuditOptions } from './facingTurnAudit.ts';

export interface FacingAlignmentSample extends FacingSample {
  readonly meshForwardYawRad: number | null;
  readonly meshAlignErrorDeg: number | null;
}

export interface MeshAlignmentAuditOptions {
  /** Max |intent − meshForward| in degrees (default 28). */
  readonly maxAlignErrorDeg?: number;
  /** Fraction of tail samples that must pass (default 0.75). */
  readonly tailPassFraction?: number;
  readonly tailSampleCount?: number;
}

export interface MeshAlignmentVerdict {
  readonly sampleCount: number;
  readonly tailSampleCount: number;
  readonly maxErrorDeg: number;
  readonly medianTailErrorDeg: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export interface FacingSuiteVerdict {
  readonly idleAlign: MeshAlignmentVerdict | null;
  readonly walkTurn: import('./facingTurnAudit.ts').FacingTurnVerdict;
  readonly walkAlign: MeshAlignmentVerdict;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export function auditMeshAlignment(
  samples: readonly FacingAlignmentSample[],
  options: MeshAlignmentAuditOptions = {},
): MeshAlignmentVerdict {
  const maxAlignErrorDeg = options.maxAlignErrorDeg ?? 28;
  const tailPassFraction = options.tailPassFraction ?? 0.75;
  const tailN = options.tailSampleCount ?? 8;

  const failures: string[] = [];
  const measured = samples.filter((s) => s.meshForwardYawRad !== null && s.meshAlignErrorDeg !== null);
  if (measured.length === 0) {
    return {
      sampleCount: 0,
      tailSampleCount: 0,
      maxErrorDeg: 999,
      medianTailErrorDeg: 999,
      passed: false,
      failures: ['no samples with mesh forward measurement'],
    };
  }

  const tail = measured.slice(-Math.min(tailN, measured.length));
  const tailErrors = tail.map((s) => Math.abs(s.meshAlignErrorDeg!));
  const maxErrorDeg = Math.max(...measured.map((s) => Math.abs(s.meshAlignErrorDeg!)));
  const sorted = [...tailErrors].sort((a, b) => a - b);
  const medianTailErrorDeg = sorted[Math.floor(sorted.length / 2)] ?? 999;
  const passCount = tailErrors.filter((e) => e <= maxAlignErrorDeg).length;
  const needPass = Math.ceil(tail.length * tailPassFraction);

  if (passCount < needPass) {
    failures.push(
      `only ${passCount}/${tail.length} tail samples within ${maxAlignErrorDeg}° (need ${needPass})`,
    );
  }
  if (medianTailErrorDeg > maxAlignErrorDeg) {
    failures.push(`median tail error ${medianTailErrorDeg.toFixed(1)}° > ${maxAlignErrorDeg}°`);
  }

  return {
    sampleCount: measured.length,
    tailSampleCount: tail.length,
    maxErrorDeg,
    medianTailErrorDeg,
    passed: failures.length === 0,
    failures,
  };
}

export function auditFacingSuite(options: {
  readonly idleSamples: readonly FacingAlignmentSample[];
  readonly walkSamples: readonly FacingAlignmentSample[];
  readonly expectedWalkIntentMeshYawRad: number;
  readonly idleMaxAlignErrorDeg?: number;
  readonly walkMaxAlignErrorDeg?: number;
  readonly turnOptions?: FacingTurnAuditOptions;
  /** Turn path checked on early walk samples only (default 750 ms). */
  readonly walkTurnWindowMs?: number;
  /** Mesh align checked on late walk samples only (default 700 ms). */
  readonly walkAlignAfterMs?: number;
}): FacingSuiteVerdict {
  const failures: string[] = [];
  const turnWindowMs = options.walkTurnWindowMs ?? 750;
  const alignAfterMs = options.walkAlignAfterMs ?? 700;

  let idleAlign: MeshAlignmentVerdict | null = null;
  if (options.idleSamples.length > 0) {
    idleAlign = auditMeshAlignment(options.idleSamples, {
      maxAlignErrorDeg: options.idleMaxAlignErrorDeg ?? 22,
      tailPassFraction: 0.8,
    });
    if (!idleAlign.passed) {
      failures.push(`idle: ${idleAlign.failures.join('; ')}`);
    }
  }

  const walkAll = options.walkSamples.filter((s) => s.mode === 'walk');
  const walkTurnSamples = walkAll.filter((s) => s.tMs <= turnWindowMs);
  const walkAlignSamples = walkAll.filter((s) => s.tMs >= alignAfterMs);

  const walkTurn = auditFacingTurn(
    walkTurnSamples.length >= 2 ? walkTurnSamples : walkAll,
    options.expectedWalkIntentMeshYawRad,
    options.turnOptions,
  );
  if (!walkTurn.passed) {
    failures.push(`walk turn: ${walkTurn.failures.join('; ')}`);
  }

  const walkAlign = auditMeshAlignment(
    walkAlignSamples.length >= 2 ? walkAlignSamples : walkAll,
    { maxAlignErrorDeg: options.walkMaxAlignErrorDeg ?? 28, tailPassFraction: 0.7 },
  );
  if (!walkAlign.passed) {
    failures.push(`walk mesh align: ${walkAlign.failures.join('; ')}`);
  }

  return {
    idleAlign,
    walkTurn,
    walkAlign,
    passed: failures.length === 0,
    failures,
  };
}

/** Degrees between intent direction (green) and measured mesh forward (orange). */
export function meshAlignErrorDeg(intentMeshYawRad: number, meshForwardYawRad: number | null): number | null {
  if (meshForwardYawRad === null) {
    return null;
  }
  return (wrapAngleRad(intentMeshYawRad - meshForwardYawRad) * 180) / Math.PI;
}
