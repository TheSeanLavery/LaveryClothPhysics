import * as THREE from 'three';
import {
  closestCapsuleSignedDistance,
  type BoneSdfCapsuleSample,
} from '../character/shirtDressing.ts';
import type { ClothGraphEdge } from './clothComponents.ts';

export const DUEL_SHIRT_TEAR_HEALTH_STEP = 0.014;
/** Max distance past the dress clearance shell that still counts as "on body". */
export const DUEL_SHIRT_ATTACH_BAND = 0.35;

export interface DuelShirtHealthDisplayConfig {
  /**
   * Displayed health hits 0 when combined remaining cloth/structure falls to or below
   * this fraction of the dress-time baseline (0–1). Tunable via “zero at % broken”:
   * 0% broken → 1.0 (any loss zeros HP), 100% broken → 0.0 (only fully gone zeros HP).
   */
  readonly zeroBelowRemainingRatio: number;
  /** Cap subtracted tear penalty applied after remaining-cloth mapping. */
  readonly maxTearPenalty: number;
}

export const DEFAULT_DUEL_SHIRT_HEALTH_DISPLAY_CONFIG: DuelShirtHealthDisplayConfig = {
  zeroBelowRemainingRatio: 0.88,
  maxTearPenalty: 0.12,
};

export interface DuelShirtHealthMetrics {
  readonly remainingA: number;
  readonly remainingB: number;
  readonly brokenFractionA: number;
  readonly brokenFractionB: number;
  readonly attachRemainingA: number;
  readonly attachRemainingB: number;
  readonly structuralRemainingA: number;
  readonly structuralRemainingB: number;
}

export interface DuelShirtHealthPartition {
  readonly fighterAVertexCount: number;
  readonly renderVertexToParticle: readonly number[];
}

export interface DuelShirtHealthBaseline {
  readonly structuralEdgesA: number;
  readonly structuralEdgesB: number;
  readonly particlesA: number;
  readonly particlesB: number;
}

export interface DuelShirtHealthSnapshot {
  readonly fighterA: number;
  readonly fighterB: number;
}

export interface DuelBrokenStructuralCounts {
  readonly fighterA: number;
  readonly fighterB: number;
}

export interface DuelShirtAttachmentBaseline {
  readonly attachedA: number;
  readonly totalA: number;
  readonly attachedB: number;
  readonly totalB: number;
}

export function isShirtVertexAttachedToBody(
  position: readonly [number, number, number],
  capsules: readonly BoneSdfCapsuleSample[],
  clearance: number,
  maxBand = DUEL_SHIRT_ATTACH_BAND,
): boolean {
  if (capsules.length === 0) {
    return false;
  }
  const point = new THREE.Vector3(position[0], position[1], position[2]);
  const sample = closestCapsuleSignedDistance(point, capsules);
  // Worn = on or slightly outside the body shell; far away = fallen off.
  return sample.distance <= clearance + maxBand;
}

export function measureDuelFighterShirtAttachment(
  vertices: readonly { readonly position: readonly [number, number, number] }[],
  fighterAVertexCount: number,
  capsulesA: readonly BoneSdfCapsuleSample[],
  capsulesB: readonly BoneSdfCapsuleSample[],
  clearance: number,
  maxBand = DUEL_SHIRT_ATTACH_BAND,
): DuelShirtAttachmentBaseline {
  let attachedA = 0;
  let totalA = 0;
  let attachedB = 0;
  let totalB = 0;

  for (let vertexId = 0; vertexId < vertices.length; vertexId += 1) {
    const isFighterA = vertexId < fighterAVertexCount;
    const capsules = isFighterA ? capsulesA : capsulesB;
    if (capsules.length === 0) {
      continue;
    }
    if (isFighterA) {
      totalA += 1;
    } else {
      totalB += 1;
    }
    if (isShirtVertexAttachedToBody(vertices[vertexId]!.position, capsules, clearance, maxBand)) {
      if (isFighterA) {
        attachedA += 1;
      } else {
        attachedB += 1;
      }
    }
  }

  return { attachedA, totalA, attachedB, totalB };
}

export function computeFighterRemainingRatios(
  current: DuelShirtAttachmentBaseline,
  dress: DuelShirtAttachmentBaseline,
  broken: DuelBrokenStructuralCounts,
  structuralBaseline: DuelShirtHealthBaseline | null,
): DuelShirtHealthMetrics {
  const attachRemainingA = ratio(current.attachedA, dress.attachedA);
  const attachRemainingB = ratio(current.attachedB, dress.attachedB);
  const structuralRemainingA = structuralBaseline && structuralBaseline.structuralEdgesA > 0
    ? ratio(
      Math.max(0, structuralBaseline.structuralEdgesA - broken.fighterA),
      structuralBaseline.structuralEdgesA,
    )
    : 1;
  const structuralRemainingB = structuralBaseline && structuralBaseline.structuralEdgesB > 0
    ? ratio(
      Math.max(0, structuralBaseline.structuralEdgesB - broken.fighterB),
      structuralBaseline.structuralEdgesB,
    )
    : 1;
  const remainingA = Math.min(attachRemainingA, structuralRemainingA);
  const remainingB = Math.min(attachRemainingB, structuralRemainingB);
  return {
    remainingA,
    remainingB,
    brokenFractionA: clamp01(1 - remainingA),
    brokenFractionB: clamp01(1 - remainingB),
    attachRemainingA,
    attachRemainingB,
    structuralRemainingA,
    structuralRemainingB,
  };
}

export function mapDuelShirtDisplayHealth(
  remainingRatio: number,
  tearPenalty: number,
  config: DuelShirtHealthDisplayConfig,
): number {
  const floor = clamp01(config.zeroBelowRemainingRatio);
  if (remainingRatio <= floor) {
    return 0;
  }
  const span = 1 - floor;
  const scaled = span > 1e-6 ? (remainingRatio - floor) / span : 1;
  return clamp01(scaled - Math.min(tearPenalty, config.maxTearPenalty));
}

export function computeDuelShirtHealthFromAttachment(
  current: DuelShirtAttachmentBaseline,
  dress: DuelShirtAttachmentBaseline,
  broken: DuelBrokenStructuralCounts,
  structuralBaseline: DuelShirtHealthBaseline | null,
  tearPenaltyA: number,
  tearPenaltyB: number,
  config: DuelShirtHealthDisplayConfig = DEFAULT_DUEL_SHIRT_HEALTH_DISPLAY_CONFIG,
): DuelShirtHealthSnapshot {
  const metrics = computeFighterRemainingRatios(current, dress, broken, structuralBaseline);
  return {
    fighterA: mapDuelShirtDisplayHealth(metrics.remainingA, tearPenaltyA, config),
    fighterB: mapDuelShirtDisplayHealth(metrics.remainingB, tearPenaltyB, config),
  };
}

export function patchDuelShirtHealthDisplayConfig(
  config: DuelShirtHealthDisplayConfig,
  patch: Partial<DuelShirtHealthDisplayConfig>,
): DuelShirtHealthDisplayConfig {
  return { ...config, ...patch };
}

/** UI helper: broken % that forces displayed health to 0. */
export function brokenPercentForZeroHealth(config: DuelShirtHealthDisplayConfig): number {
  return Math.round(clamp01(1 - config.zeroBelowRemainingRatio) * 100);
}

export function zeroBelowRemainingFromBrokenPercent(brokenPercent: number): number {
  return clamp01(1 - brokenPercent / 100);
}

export function buildParticleFighterMask(
  partition: DuelShirtHealthPartition,
  particleCount: number,
): Uint8Array {
  const mask = new Uint8Array(particleCount).fill(1);
  const { fighterAVertexCount, renderVertexToParticle } = partition;
  for (let vertexId = 0; vertexId < renderVertexToParticle.length; vertexId += 1) {
    const particleId = renderVertexToParticle[vertexId]!;
    if (particleId < 0 || particleId >= particleCount) {
      continue;
    }
    if (vertexId < fighterAVertexCount) {
      mask[particleId] = 0;
    }
  }
  return mask;
}

export function captureDuelShirtHealthBaseline(
  structuralEdges: readonly ClothGraphEdge[],
  particleMask: Uint8Array,
): DuelShirtHealthBaseline {
  let structuralEdgesA = 0;
  let structuralEdgesB = 0;
  const particlesA = new Set<number>();
  const particlesB = new Set<number>();

  for (let particleId = 0; particleId < particleMask.length; particleId += 1) {
    if (particleMask[particleId] === 0) {
      particlesA.add(particleId);
    } else {
      particlesB.add(particleId);
    }
  }

  for (const edge of structuralEdges) {
    const fighter = edgeFighterFromMask(edge, particleMask);
    if (fighter === 0) {
      structuralEdgesA += 1;
    } else if (fighter === 1) {
      structuralEdgesB += 1;
    }
  }

  return {
    structuralEdgesA,
    structuralEdgesB,
    particlesA: particlesA.size,
    particlesB: particlesB.size,
  };
}

export function countBrokenStructuralPerFighter(
  edgeActive: Uint32Array,
  structuralEdges: readonly ClothGraphEdge[],
  particleMask: Uint8Array,
): DuelBrokenStructuralCounts {
  let fighterA = 0;
  let fighterB = 0;
  for (const edge of structuralEdges) {
    if (edgeActive[edge.id] !== 0) {
      continue;
    }
    const edgeFighter = edgeFighterFromMask(edge, particleMask);
    if (edgeFighter === 0) {
      fighterA += 1;
    } else if (edgeFighter === 1) {
      fighterB += 1;
    }
  }
  return { fighterA, fighterB };
}

export function applyDuelTearPenalties(
  broken: DuelBrokenStructuralCounts,
  lastBroken: DuelBrokenStructuralCounts,
  penaltyA: number,
  penaltyB: number,
  step = DUEL_SHIRT_TEAR_HEALTH_STEP,
): { penaltyA: number; penaltyB: number; lastBroken: DuelBrokenStructuralCounts } {
  const deltaA = Math.max(0, broken.fighterA - lastBroken.fighterA);
  const deltaB = Math.max(0, broken.fighterB - lastBroken.fighterB);
  return {
    penaltyA: clamp01(penaltyA + deltaA * step),
    penaltyB: clamp01(penaltyB + deltaB * step),
    lastBroken: broken,
  };
}

export function computeDuelShirtHealth(
  edgeActive: Uint32Array,
  structuralEdges: readonly ClothGraphEdge[],
  particleMask: Uint8Array,
  components: Uint32Array,
  baseline: DuelShirtHealthBaseline,
  tearPenaltyA: number,
  tearPenaltyB: number,
): DuelShirtHealthSnapshot {
  let intactEdgesA = 0;
  let intactEdgesB = 0;

  for (const edge of structuralEdges) {
    const fighter = edgeFighterFromMask(edge, particleMask);
    if (fighter < 0 || edgeActive[edge.id] === 0) {
      continue;
    }
    if (fighter === 0) {
      intactEdgesA += 1;
    } else {
      intactEdgesB += 1;
    }
  }

  const edgeHealthA = ratio(intactEdgesA, baseline.structuralEdgesA);
  const edgeHealthB = ratio(intactEdgesB, baseline.structuralEdgesB);
  const componentHealthA = largestComponentRatio(components, particleMask, 0, baseline.particlesA);
  const componentHealthB = largestComponentRatio(components, particleMask, 1, baseline.particlesB);

  return {
    fighterA: clamp01(Math.min(edgeHealthA, componentHealthA) - tearPenaltyA),
    fighterB: clamp01(Math.min(edgeHealthB, componentHealthB) - tearPenaltyB),
  };
}

export function edgeFighterFromMask(
  edge: ClothGraphEdge,
  particleMask: Uint8Array,
): 0 | 1 | -1 {
  const f0 = particleMask[edge.v0];
  const f1 = particleMask[edge.v1];
  if (f0 === f1) {
    return f0 as 0 | 1;
  }
  return -1;
}

function largestComponentRatio(
  components: Uint32Array,
  particleMask: Uint8Array,
  fighter: 0 | 1,
  baselineParticleCount: number,
): number {
  if (baselineParticleCount <= 0) {
    return 1;
  }

  const sizes = new Map<number, number>();
  for (let particleId = 0; particleId < particleMask.length; particleId += 1) {
    if (particleMask[particleId] !== fighter) {
      continue;
    }
    const root = components[particleId]!;
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }

  let largest = 0;
  for (const size of sizes.values()) {
    largest = Math.max(largest, size);
  }
  return ratio(largest, baselineParticleCount);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 1;
  }
  return clamp01(numerator / denominator);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
