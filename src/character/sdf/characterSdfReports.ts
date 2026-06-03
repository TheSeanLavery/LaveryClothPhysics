import * as THREE from 'three';
import { getSkinnedVertexWorldPosition, type CharacterSdfCapsule } from './characterSdfCore';

const UP = new THREE.Vector3(0, 1, 0);

export interface CharacterSdfVertexSample {
  readonly meshName: string;
  readonly vertexIndex: number;
  readonly position: readonly [number, number, number];
  readonly signedDistance: number;
  readonly absDistance: number;
  readonly nearestCapsuleName: string;
}

export interface CharacterSdfFitQualityReport {
  readonly surfaceVertexCount: number;
  readonly sampledVertexCount: number;
  readonly nearSurfaceRatio: number;
  readonly outsideHoleRatio: number;
  readonly insideBlobRatio: number;
  readonly meanSignedDistance: number;
  readonly meanAbsDistance: number;
  readonly maxOutsideDistance: number;
  readonly maxInsideDepth: number;
  readonly worstOutsideCapsuleName: string | null;
  readonly worstInsideCapsuleName: string | null;
  readonly samples: readonly CharacterSdfVertexSample[];
}

export function closestCharacterSdfCapsuleSignedDistance(
  point: THREE.Vector3,
  capsules: readonly CharacterSdfCapsule[],
): { distance: number; normal: THREE.Vector3; name: string } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestName = '';
  const bestNormal = new THREE.Vector3(0, 1, 0);

  for (const capsule of capsules) {
    const segment = capsule.end.clone().sub(capsule.start);
    const segmentLengthSq = Math.max(segment.lengthSq(), 0.000001);
    const t = THREE.MathUtils.clamp(point.clone().sub(capsule.start).dot(segment) / segmentLengthSq, 0, 1);
    const closest = capsule.start.clone().addScaledVector(segment, t);
    const normal = point.clone().sub(closest);
    const distanceToAxis = normal.length();
    const distance = distanceToAxis - capsule.radius;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = capsule.name;
      bestNormal.copy(distanceToAxis > 0.000001 ? normal.multiplyScalar(1 / distanceToAxis) : UP);
    }
  }

  return { distance: bestDistance, normal: bestNormal.clone(), name: bestName };
}

export function createCharacterSdfFitQualityReport(
  root: THREE.Object3D,
  capsules: readonly CharacterSdfCapsule[],
  surfaceBand = 0.035,
  maxSamplesPerMesh = 2500,
): CharacterSdfFitQualityReport {
  if (capsules.length === 0) {
    return emptyCharacterSdfFitQualityReport();
  }

  root.updateMatrixWorld(true);
  const samples: CharacterSdfVertexSample[] = [];
  let surfaceVertexCount = 0;
  let nearSurfaceCount = 0;
  let outsideHoleCount = 0;
  let insideBlobCount = 0;
  let signedDistanceSum = 0;
  let absDistanceSum = 0;
  let maxOutsideDistance = 0;
  let maxInsideDepth = 0;
  let worstOutsideCapsuleName: string | null = null;
  let worstInsideCapsuleName: string | null = null;

  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) {
      return;
    }
    const positionAttr = object.geometry.getAttribute('position');
    if (!positionAttr) {
      return;
    }
    surfaceVertexCount += positionAttr.count;
    const sampleStride = Math.max(1, Math.floor(positionAttr.count / maxSamplesPerMesh));
    const point = new THREE.Vector3();
    for (let vertexIndex = 0; vertexIndex < positionAttr.count; vertexIndex += sampleStride) {
      getSkinnedVertexWorldPosition(object, vertexIndex, point);
      const sample = closestCharacterSdfCapsuleSignedDistance(point, capsules);
      const absDistance = Math.abs(sample.distance);
      signedDistanceSum += sample.distance;
      absDistanceSum += absDistance;
      if (absDistance <= surfaceBand) {
        nearSurfaceCount += 1;
      } else if (sample.distance > surfaceBand) {
        outsideHoleCount += 1;
        if (sample.distance > maxOutsideDistance) {
          maxOutsideDistance = sample.distance;
          worstOutsideCapsuleName = sample.name;
        }
      } else {
        const depth = -sample.distance;
        insideBlobCount += 1;
        if (depth > maxInsideDepth) {
          maxInsideDepth = depth;
          worstInsideCapsuleName = sample.name;
        }
      }
      samples.push({
        meshName: object.name,
        vertexIndex,
        position: [point.x, point.y, point.z],
        signedDistance: sample.distance,
        absDistance,
        nearestCapsuleName: sample.name,
      });
    }
  });

  const sampledVertexCount = samples.length;
  return {
    surfaceVertexCount,
    sampledVertexCount,
    nearSurfaceRatio: sampledVertexCount > 0 ? nearSurfaceCount / sampledVertexCount : 0,
    outsideHoleRatio: sampledVertexCount > 0 ? outsideHoleCount / sampledVertexCount : 0,
    insideBlobRatio: sampledVertexCount > 0 ? insideBlobCount / sampledVertexCount : 0,
    meanSignedDistance: sampledVertexCount > 0 ? signedDistanceSum / sampledVertexCount : 0,
    meanAbsDistance: sampledVertexCount > 0 ? absDistanceSum / sampledVertexCount : 0,
    maxOutsideDistance,
    maxInsideDepth,
    worstOutsideCapsuleName,
    worstInsideCapsuleName,
    samples,
  };
}

export function emptyCharacterSdfFitQualityReport(): CharacterSdfFitQualityReport {
  return {
    surfaceVertexCount: 0,
    sampledVertexCount: 0,
    nearSurfaceRatio: 0,
    outsideHoleRatio: 1,
    insideBlobRatio: 1,
    meanSignedDistance: Number.POSITIVE_INFINITY,
    meanAbsDistance: Number.POSITIVE_INFINITY,
    maxOutsideDistance: Number.POSITIVE_INFINITY,
    maxInsideDepth: Number.POSITIVE_INFINITY,
    worstOutsideCapsuleName: null,
    worstInsideCapsuleName: null,
    samples: [],
  };
}
