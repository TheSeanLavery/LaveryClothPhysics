import * as THREE from 'three';
import type { AssemblyVec2, AssemblyVec3, ClothPatchDefinition } from './patternAssembly.ts';

export interface ArcLengthKnotOptions {
  readonly gridSpacing: number;
  readonly minSegments?: number;
  readonly maxSegments?: number;
  readonly probeSteps?: number;
  readonly segmentCount?: number;
}

export interface QuadGridFromKnotsOptions {
  readonly id: string;
  readonly label?: string;
  readonly uKnots: readonly number[];
  readonly vKnots: readonly number[];
  readonly sample: (u: number, v: number) => AssemblyVec3;
  readonly boundaries?: Record<string, (uCount: number, vCount: number, index: (u: number, v: number) => number) => number[]>;
}

export interface MeshSpacingAudit {
  readonly maxEdgeLength: number;
  readonly minEdgeLength: number;
  readonly meanEdgeLength: number;
  readonly percentile95EdgeLength: number;
  readonly maxAspectRatio: number;
  readonly longEdgeCount: number;
  readonly shortEdgeCount: number;
}

export function segmentsForChordLength(
  length: number,
  gridSpacing: number,
  min: number,
  max: number,
): number {
  return Math.round(
    Math.min(max, Math.max(min, Math.ceil(length / Math.max(0.001, gridSpacing)))),
  );
}

/**
 * Place parameter knots so consecutive samples along a 3D curve are ~gridSpacing apart
 * (chord-length spacing — standard approach for cloth pattern grids on curved bodies).
 */
export function buildArcLengthKnots(
  sample: (t: number) => THREE.Vector3,
  options: ArcLengthKnotOptions,
): readonly number[] {
  const probeSteps = options.probeSteps ?? 128;
  const minSegments = options.minSegments ?? 1;
  const maxSegments = options.maxSegments ?? 128;
  const probes: { t: number; s: number }[] = [{ t: 0, s: 0 }];
  let previous = sample(0);
  let totalLength = 0;

  for (let step = 1; step <= probeSteps; step++) {
    const t = step / probeSteps;
    const next = sample(t);
    totalLength += previous.distanceTo(next);
    probes.push({ t, s: totalLength });
    previous = next;
  }

  if (totalLength <= 1e-6) {
    return [0, 1];
  }

  const segmentCount = options.segmentCount ?? segmentsForChordLength(
    totalLength,
    options.gridSpacing,
    minSegments,
    maxSegments,
  );
  const knots: number[] = [0];
  for (let segment = 1; segment < segmentCount; segment++) {
    const target = (segment / segmentCount) * totalLength;
    knots.push(interpolateParameterAtArcLength(probes, target));
  }
  knots.push(1);
  return knots;
}

export function measureCurveLength(
  sample: (t: number) => THREE.Vector3,
  probeSteps = 128,
): number {
  let previous = sample(0);
  let totalLength = 0;
  for (let step = 1; step <= probeSteps; step++) {
    const next = sample(step / probeSteps);
    totalLength += previous.distanceTo(next);
    previous = next;
  }
  return totalLength;
}

/** Pick enough segments so every boundary curve in the set stays near gridSpacing. */
export function resolveUniformSegmentCount(
  samples: readonly ((t: number) => THREE.Vector3)[],
  options: ArcLengthKnotOptions,
): number {
  let segmentCount = options.minSegments ?? 1;
  for (const sample of samples) {
    const length = measureCurveLength(sample, options.probeSteps);
    segmentCount = Math.max(
      segmentCount,
      segmentsForChordLength(length, options.gridSpacing, options.minSegments ?? 1, options.maxSegments ?? 128),
    );
  }
  if (options.segmentCount !== undefined) {
    return options.segmentCount;
  }
  return segmentCount;
}

export function buildMatchedArcLengthKnots(
  samples: readonly ((t: number) => THREE.Vector3)[],
  options: ArcLengthKnotOptions,
): readonly number[] {
  if (samples.length === 0) {
    return [0, 1];
  }
  const segmentCount = resolveUniformSegmentCount(samples, options);
  let longestSample = samples[0]!;
  let longestLength = measureCurveLength(longestSample, options.probeSteps);
  for (let index = 1; index < samples.length; index++) {
    const sample = samples[index]!;
    const length = measureCurveLength(sample, options.probeSteps);
    if (length > longestLength) {
      longestLength = length;
      longestSample = sample;
    }
  }
  return buildArcLengthKnots(longestSample, { ...options, segmentCount });
}

export function createQuadGridPatch(options: QuadGridFromKnotsOptions): ClothPatchDefinition {
  const segmentsU = options.uKnots.length - 1;
  const segmentsV = options.vKnots.length - 1;
  const vertices: AssemblyVec3[] = [];
  const uvs: AssemblyVec2[] = [];
  const faces: [number, number, number][] = [];
  const index = (u: number, v: number) => u * (segmentsV + 1) + v;

  for (let u = 0; u <= segmentsU; u++) {
    const uParam = options.uKnots[u]!;
    for (let v = 0; v <= segmentsV; v++) {
      const vParam = options.vKnots[v]!;
      vertices.push(options.sample(uParam, vParam));
      uvs.push([uParam, vParam]);
    }
  }

  for (let u = 0; u < segmentsU; u++) {
    for (let v = 0; v < segmentsV; v++) {
      const i00 = index(u, v);
      const i10 = index(u + 1, v);
      const i01 = index(u, v + 1);
      const i11 = index(u + 1, v + 1);
      faces.push([i00, i10, i01], [i10, i11, i01]);
    }
  }

  const boundaries: Record<string, number[]> = {
    bottom: range(0, segmentsU).map((u) => index(u, 0)),
    top: range(0, segmentsU).map((u) => index(u, segmentsV)),
    left: range(0, segmentsV).map((v) => index(0, v)),
    right: range(0, segmentsV).map((v) => index(segmentsU, v)),
  };

  if (options.boundaries) {
    for (const [name, builder] of Object.entries(options.boundaries)) {
      boundaries[name] = builder(segmentsU + 1, segmentsV + 1, index);
    }
  }

  return {
    id: options.id,
    label: options.label ?? options.id,
    vertices,
    uvs,
    faces,
    boundaries,
  };
}

export function auditMeshEdgeSpacing(
  positions: readonly AssemblyVec3[],
  edges: readonly { readonly a: number; readonly b: number }[],
  gridSpacing: number,
  toleranceRatio = 0.5,
): MeshSpacingAudit {
  const lengths: number[] = [];
  const maxAllowed = gridSpacing * (1 + toleranceRatio);
  const minAllowed = gridSpacing * (1 - toleranceRatio);
  let longEdgeCount = 0;
  let shortEdgeCount = 0;

  for (const edge of edges) {
    const a = positions[edge.a]!;
    const b = positions[edge.b]!;
    const length = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    lengths.push(length);
    if (length > maxAllowed) {
      longEdgeCount += 1;
    }
    if (length < minAllowed) {
      shortEdgeCount += 1;
    }
  }

  if (lengths.length === 0) {
    return {
      maxEdgeLength: 0,
      minEdgeLength: 0,
      meanEdgeLength: 0,
      maxAspectRatio: 1,
      longEdgeCount: 0,
      shortEdgeCount: 0,
    };
  }

  const sorted = [...lengths].sort((a, b) => a - b);
  const maxEdgeLength = sorted[sorted.length - 1]!;
  const minEdgeLength = sorted[0]!;
  const meanEdgeLength = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const percentile95EdgeLength = sorted[Math.floor(sorted.length * 0.95)] ?? maxEdgeLength;

  return {
    maxEdgeLength,
    minEdgeLength,
    meanEdgeLength,
    percentile95EdgeLength,
    maxAspectRatio: minEdgeLength > 1e-6 ? maxEdgeLength / minEdgeLength : 1,
    longEdgeCount,
    shortEdgeCount,
  };
}

function interpolateParameterAtArcLength(
  probes: readonly { t: number; s: number }[],
  targetLength: number,
): number {
  for (let index = 1; index < probes.length; index++) {
    const current = probes[index]!;
    const previous = probes[index - 1]!;
    if (current.s < targetLength) {
      continue;
    }
    const span = current.s - previous.s;
    const alpha = span > 1e-8 ? (targetLength - previous.s) / span : 0;
    return THREE.MathUtils.lerp(previous.t, current.t, alpha);
  }
  return 1;
}

function range(start: number, endInclusive: number): number[] {
  return Array.from({ length: endInclusive - start + 1 }, (_, index) => start + index);
}
