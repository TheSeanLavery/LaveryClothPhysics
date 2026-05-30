export interface SelfCollisionVertex {
  gridX: number;
  gridY: number;
  isFixed: boolean;
}

export interface SelfCollisionReport {
  minSeparation: number;
  gridSkipRadius: number;
  pairsChecked: number;
  violationCount: number;
  maxPenetration: number;
  meanPenetration: number;
  minFoldPairDistance: number;
}

export interface SelfCollisionCompareResult {
  withSelfCollision: SelfCollisionReport;
  withoutSelfCollision: SelfCollisionReport;
  probeMaxDeltaOn: number;
}

export function analyzeSelfCollisionViolations(
  positions: Float32Array,
  vertices: SelfCollisionVertex[],
  options: { minSeparation?: number; gridSkipRadius?: number } = {},
): SelfCollisionReport {
  const minSeparation = options.minSeparation ?? 0.03;
  const gridSkipRadius = options.gridSkipRadius ?? 2;
  const vertexCount = vertices.length;

  let pairsChecked = 0;
  let violationCount = 0;
  let maxPenetration = 0;
  let penetrationSum = 0;
  let minFoldPairDistance = Infinity;

  for (let i = 0; i < vertexCount; i++) {
    const vi = vertices[i]!;
    if (vi.isFixed) {
      continue;
    }

    const ix = vi.gridX;
    const iy = vi.gridY;
    const i3 = i * 3;
    const px = positions[i3]!;
    const py = positions[i3 + 1]!;
    const pz = positions[i3 + 2]!;

    for (let j = i + 1; j < vertexCount; j++) {
      const vj = vertices[j]!;
      const gridDistance = Math.abs(ix - vj.gridX) + Math.abs(iy - vj.gridY);
      if (gridDistance <= gridSkipRadius) {
        continue;
      }

      pairsChecked += 1;
      const j3 = j * 3;
      const dx = px - positions[j3]!;
      const dy = py - positions[j3 + 1]!;
      const dz = pz - positions[j3 + 2]!;
      const dist = Math.hypot(dx, dy, dz);
      minFoldPairDistance = Math.min(minFoldPairDistance, dist);

      if (dist < minSeparation) {
        const penetration = minSeparation - dist;
        violationCount += 1;
        maxPenetration = Math.max(maxPenetration, penetration);
        penetrationSum += penetration;
      }
    }
  }

  return {
    minSeparation,
    gridSkipRadius,
    pairsChecked,
    violationCount,
    maxPenetration,
    meanPenetration: violationCount > 0 ? penetrationSum / violationCount : 0,
    minFoldPairDistance: Number.isFinite(minFoldPairDistance) ? minFoldPairDistance : minSeparation,
  };
}
