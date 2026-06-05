import * as THREE from 'three';
import { createTShirtAssembly, type AssemblyVertex, type ClothAssembly } from '../cloth/patternAssembly.ts';
import { resolveTShirtAssemblyOptions } from '../garments/garmentGenerator.ts';
import {
  DEFAULT_TSHIRT_PARAMS,
  normalizeGarmentParams,
  type TShirtGarmentParams,
} from '../garments/garmentSchema.ts';
import type { AnimatedCharacterSceneRig, CharacterAnchors } from './AnimatedCharacter.ts';
import { forwardYawToXZDirection } from './rigForwardMeasure.ts';

export const SHIRT_SDF_CLEARANCE = 0.008;

export interface BoneSdfCapsuleSample {
  readonly start: readonly [number, number, number];
  readonly end: readonly [number, number, number];
  readonly radius: number;
  readonly name?: string;
}

export interface ShirtSdfClearanceReport {
  readonly vertexCount: number;
  readonly sdfCount: number;
  readonly requiredClearance: number;
  readonly penetrationCount: number;
  readonly minSignedDistance: number;
  readonly maxPenetrationDepth: number;
  readonly averageClearance: number;
  readonly worstVertexIndex: number;
}

export interface PerCapsuleClearanceReport {
  readonly vertexCount: number;
  readonly capsuleCount: number;
  readonly totalChecks: number;
  readonly failureCount: number;
  readonly minSignedDistance: number;
  readonly worstCapsuleName: string | null;
  readonly worstVertexIndex: number;
}

export interface BodyArmDrapeReport {
  readonly bodyVertexCount: number;
  readonly floatingOverArmCount: number;
  readonly maxFloatHeight: number;
}

export interface EdgeCapsuleClearanceReport {
  readonly edgeCount: number;
  readonly capsuleCount: number;
  readonly totalChecks: number;
  readonly failureCount: number;
  readonly minSignedDistance: number;
  readonly worstEdgeId: number;
  readonly worstCapsuleName: string | null;
}

export interface TriangleCapsuleClearanceReport {
  readonly triangleCount: number;
  readonly capsuleCount: number;
  readonly totalChecks: number;
  readonly failureCount: number;
  readonly minSignedDistance: number;
  readonly worstFaceId: number;
  readonly worstCapsuleName: string | null;
}

export interface AssemblyStrainReport {
  readonly edgeCount: number;
  readonly maxStrain: number;
  readonly averageStrain: number;
  readonly overLimitCount: number;
  readonly worstEdgeId: number;
  readonly worstSourceId: string | null;
}

export interface TriangleQualityReport {
  readonly triangleCount: number;
  readonly degenerateCount: number;
  readonly minArea: number;
  readonly averageArea: number;
}

interface CharacterSdfCapsuleTarget extends BoneSdfCapsuleSample {
  readonly startVec: THREE.Vector3;
  readonly endVec: THREE.Vector3;
  readonly key: string;
}

interface SleeveDressingTarget {
  readonly path: readonly THREE.Vector3[];
  readonly capsules: readonly CharacterSdfCapsuleTarget[];
  readonly frontAxis: THREE.Vector3;
  readonly fallbackSideAxis: THREE.Vector3;
  readonly pathLength: number;
}

interface DressFrame {
  readonly xAxis: THREE.Vector3;
  readonly yAxis: THREE.Vector3;
  readonly zAxis: THREE.Vector3;
  readonly targetCenter: THREE.Vector3;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly halfDepth: number;
}

export type CharacterTShirtGenerationOptions = TShirtGarmentParams;

export const DEFAULT_CHARACTER_T_SHIRT_OPTIONS: TShirtGarmentParams = DEFAULT_TSHIRT_PARAMS;

export interface CharacterDressAxes {
  readonly xAxis: THREE.Vector3;
  readonly yAxis: THREE.Vector3;
  readonly zAxis: THREE.Vector3;
  readonly origin: THREE.Vector3;
}

/**
 * Dress frame axes. When `forwardYawRad` is set (from `rig.measureForwardYaw()`), forward
 * matches bone facing — required in duel where fighters yaw ~90° and shoulder-cross alone
 * picks the lateral axis.
 */
export function resolveCharacterDressAxes(
  anchors: CharacterAnchors,
  forwardYawRad: number | null = null,
): CharacterDressAxes {
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.75, 0);
  const chest = anchors.chest ?? new THREE.Vector3(0, 1.1, 0);
  const neck = anchors.neck ?? chest;
  const leftShoulder = anchors.leftShoulder;
  const rightShoulder = anchors.rightShoulder;
  const yAxis = new THREE.Vector3(0, 1, 0);

  let zAxis: THREE.Vector3;
  if (forwardYawRad !== null && Number.isFinite(forwardYawRad)) {
    const dir = forwardYawToXZDirection(forwardYawRad);
    zAxis = new THREE.Vector3(dir.x, 0, dir.z);
    if (zAxis.lengthSq() < 1e-6) {
      zAxis.set(0, 0, -1);
    } else {
      zAxis.normalize();
    }
  } else {
    const torsoUp = neck.clone().sub(hips);
    if (torsoUp.lengthSq() < 0.0001) {
      torsoUp.copy(chest.clone().sub(hips));
    }
    if (torsoUp.lengthSq() < 0.0001) {
      torsoUp.copy(yAxis);
    }
    torsoUp.normalize();
    const shoulderLine = leftShoulder && rightShoulder
      ? rightShoulder.clone().sub(leftShoulder)
      : new THREE.Vector3(1, 0, 0);
    shoulderLine.y = 0;
    if (shoulderLine.lengthSq() < 0.0001) {
      shoulderLine.set(1, 0, 0);
    }
    shoulderLine.normalize();
    zAxis = torsoUp.clone().cross(shoulderLine);
    zAxis.y = 0;
    if (zAxis.lengthSq() < 0.0001) {
      zAxis.copy(yAxis.clone().cross(shoulderLine));
    }
    zAxis.normalize();
  }

  let xAxis: THREE.Vector3;
  if (leftShoulder && rightShoulder) {
    xAxis = rightShoulder.clone().sub(leftShoulder);
    xAxis.y = 0;
    xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis));
    if (xAxis.lengthSq() < 0.0001) {
      xAxis.copy(yAxis.clone().cross(zAxis));
    }
    xAxis.y = 0;
    xAxis.normalize();
  } else {
    xAxis = yAxis.clone().cross(zAxis);
    xAxis.y = 0;
    if (xAxis.lengthSq() < 0.0001) {
      xAxis.set(1, 0, 0);
    }
    xAxis.normalize();
  }

  return {
    xAxis,
    yAxis,
    zAxis,
    origin: chest,
  };
}

export interface TShirtDressAlignmentOptions {
  readonly forwardYawRad?: number | null;
  /** World XZ direction the character should face (e.g. toward duel opponent). */
  readonly intentForward?: readonly [number, number, number] | null;
}

export interface TShirtDressAlignmentReport {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly torsoCenter: readonly [number, number, number];
  readonly chestDistance: number;
  readonly forwardAlignment: number;
  readonly backAlignment: number;
  readonly shirtForwardYawErrorDeg: number;
  readonly leftSleeveMeanArmDistance: number;
  readonly rightSleeveMeanArmDistance: number;
  readonly leftSleeveSideProjection: number;
  readonly rightSleeveSideProjection: number;
  readonly leftSleeveAxisErrorDeg: number;
  readonly rightSleeveAxisErrorDeg: number;
  readonly intentForwardAlignment: number | null;
}

export function auditTShirtDressAlignment(
  assembly: ClothAssembly,
  anchors: CharacterAnchors,
  sdfs: readonly BoneSdfCapsuleSample[],
  options: TShirtDressAlignmentOptions = {},
): TShirtDressAlignmentReport {
  const failures: string[] = [];
  const axes = resolveCharacterDressAxes(anchors, options.forwardYawRad ?? null);
  const chest = anchors.chest ?? axes.origin;
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.75, 0);

  const bodyVertices = assembly.vertices.filter((vertex) => isBodyPanelVertex(vertex));
  const frontVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('front') && !vertex.patchId.includes('neck'));
  const backVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('back') && !vertex.patchId.includes('neck'));
  const leftSleeveVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('left-sleeve'));
  const rightSleeveVertices = assembly.vertices.filter((vertex) => vertex.patchId.includes('right-sleeve'));

  const torsoCenter = averageVertexPosition(bodyVertices.length > 0 ? bodyVertices : assembly.vertices);
  const chestDistance = torsoCenter.distanceTo(chest);
  if (chestDistance > 0.55) {
    failures.push(`torso center ${chestDistance.toFixed(3)}m from chest (max 0.55)`);
  }

  const forwardAlignment = averageProjection(frontVertices, chest, axes.zAxis);
  const backAlignment = averageProjection(backVertices, chest, axes.zAxis);
  if (forwardAlignment < 0.02) {
    failures.push(`front panel behind chest (forwardAlignment=${forwardAlignment.toFixed(3)})`);
  }
  if (backAlignment > -0.02) {
    failures.push(`back panel in front of chest (backAlignment=${backAlignment.toFixed(3)})`);
  }

  const frontCenter = averageVertexPosition(frontVertices);
  const backCenter = averageVertexPosition(backVertices);
  const shirtForward = frontCenter.clone().sub(backCenter);
  shirtForward.y = 0;
  const shirtForwardYaw = shirtForward.lengthSq() > 1e-6
    ? Math.atan2(shirtForward.x, shirtForward.z)
    : 0;
  const characterForwardYaw = Math.atan2(axes.zAxis.x, axes.zAxis.z);
  const shirtForwardYawErrorDeg = Math.abs(
    Math.atan2(
      Math.sin(shirtForwardYaw - characterForwardYaw),
      Math.cos(shirtForwardYaw - characterForwardYaw),
    ),
  ) * (180 / Math.PI);
  if (shirtForwardYawErrorDeg > 35) {
    failures.push(`shirt forward yaw error ${shirtForwardYawErrorDeg.toFixed(1)}° (max 35°)`);
  }

  let intentForwardAlignment: number | null = null;
  if (options.intentForward) {
    const intent = new THREE.Vector3(...options.intentForward);
    intent.y = 0;
    if (intent.lengthSq() > 1e-6) {
      intent.normalize();
      intentForwardAlignment = averageProjection(frontVertices, chest, intent);
      if (intentForwardAlignment < 0.02) {
        failures.push(`front panel not facing intent (intentAlignment=${intentForwardAlignment.toFixed(3)})`);
      }
      const intentYaw = Math.atan2(intent.x, intent.z);
      const intentYawErrorDeg = Math.abs(
        Math.atan2(
          Math.sin(shirtForwardYaw - intentYaw),
          Math.cos(shirtForwardYaw - intentYaw),
        ),
      ) * (180 / Math.PI);
      if (intentYawErrorDeg > 35) {
        failures.push(`shirt forward vs intent yaw error ${intentYawErrorDeg.toFixed(1)}° (max 35°)`);
      }
    }
  }

  const leftSleeveCenter = averageVertexPosition(leftSleeveVertices);
  const rightSleeveCenter = averageVertexPosition(rightSleeveVertices);
  const leftSleeveSideProjection = leftSleeveCenter.clone().sub(hips).dot(axes.xAxis);
  const rightSleeveSideProjection = rightSleeveCenter.clone().sub(hips).dot(axes.xAxis);
  if (leftSleeveSideProjection > -0.04) {
    failures.push(`left sleeve on wrong side (projection=${leftSleeveSideProjection.toFixed(3)})`);
  }
  if (rightSleeveSideProjection < 0.04) {
    failures.push(`right sleeve on wrong side (projection=${rightSleeveSideProjection.toFixed(3)})`);
  }

  const leftArmTarget = anchors.leftArm ?? anchors.leftShoulder;
  const rightArmTarget = anchors.rightArm ?? anchors.rightShoulder;
  const leftSleeveMeanArmDistance = leftArmTarget
    ? meanDistanceToPoint(leftSleeveVertices, leftArmTarget)
    : Number.POSITIVE_INFINITY;
  const rightSleeveMeanArmDistance = rightArmTarget
    ? meanDistanceToPoint(rightSleeveVertices, rightArmTarget)
    : Number.POSITIVE_INFINITY;
  if (leftSleeveMeanArmDistance > 0.42) {
    failures.push(`left sleeve too far from arm (${leftSleeveMeanArmDistance.toFixed(3)}m)`);
  }
  if (rightSleeveMeanArmDistance > 0.42) {
    failures.push(`right sleeve too far from arm (${rightSleeveMeanArmDistance.toFixed(3)}m)`);
  }

  const leftSleeveAxisErrorDeg = measureSleeveAxisErrorDeg(
    leftSleeveVertices,
    anchors.leftShoulder,
    leftArmTarget,
    axes,
    'left',
    sdfs,
  );
  const rightSleeveAxisErrorDeg = measureSleeveAxisErrorDeg(
    rightSleeveVertices,
    anchors.rightShoulder,
    rightArmTarget,
    axes,
    'right',
    sdfs,
  );
  if (leftSleeveAxisErrorDeg > 72) {
    failures.push(`left sleeve axis misaligned ${leftSleeveAxisErrorDeg.toFixed(1)}° (max 72°)`);
  }
  if (rightSleeveAxisErrorDeg > 72) {
    failures.push(`right sleeve axis misaligned ${rightSleeveAxisErrorDeg.toFixed(1)}° (max 72°)`);
  }

  return {
    passed: failures.length === 0,
    failures,
    torsoCenter: [torsoCenter.x, torsoCenter.y, torsoCenter.z],
    chestDistance,
    forwardAlignment,
    backAlignment,
    shirtForwardYawErrorDeg,
    leftSleeveMeanArmDistance,
    rightSleeveMeanArmDistance,
    leftSleeveSideProjection,
    rightSleeveSideProjection,
    leftSleeveAxisErrorDeg,
    rightSleeveAxisErrorDeg,
    intentForwardAlignment,
  };
}

export function closestCapsuleSignedDistance(
  point: THREE.Vector3,
  capsules: readonly BoneSdfCapsuleSample[],
): { distance: number; normal: THREE.Vector3; name: string; radius: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestName = '';
  let bestRadius = 0;
  const bestNormal = new THREE.Vector3(0, 1, 0);

  for (const capsule of capsules) {
    const sample = sampleCapsule(point, capsule);
    if (sample.signedDistance < bestDistance) {
      bestDistance = sample.signedDistance;
      bestName = capsule.name ?? '';
      bestRadius = capsule.radius;
      bestNormal.copy(sample.normal);
    }
  }

  return { distance: bestDistance, normal: bestNormal.clone(), name: bestName, radius: bestRadius };
}

export function signedDistanceToCapsule(
  point: THREE.Vector3,
  capsule: BoneSdfCapsuleSample,
): number {
  return sampleCapsule(point, capsule).signedDistance;
}

export function projectToExteriorShell(
  point: THREE.Vector3,
  capsules: readonly BoneSdfCapsuleSample[],
  clearance: number,
): THREE.Vector3 {
  if (capsules.length === 0) {
    return point.clone();
  }

  let result = point.clone();
  const shellDistance = clearance + 0.0005;

  for (let iter = 0; iter < 512; iter++) {
    let worstDeficit = 0;
    let worstShell: THREE.Vector3 | null = null;

    for (const capsule of capsules) {
      const sample = sampleCapsule(result, capsule);
      const deficit = shellDistance - sample.signedDistance;
      if (deficit > worstDeficit) {
        worstDeficit = deficit;
        worstShell = sample.closest.clone().addScaledVector(sample.normal, capsule.radius + shellDistance);
      }
    }

    if (worstDeficit <= 0.000001) {
      break;
    }

    if (worstShell) {
      result.copy(worstShell);
    }
  }

  for (let pass = 0; pass < 128; pass++) {
    let moved = false;
    for (const capsule of capsules) {
      const sample = sampleCapsule(result, capsule);
      if (sample.signedDistance >= shellDistance - 0.000001) {
        continue;
      }
      moved = true;
      result.copy(sample.closest.addScaledVector(sample.normal, capsule.radius + shellDistance));
    }
    if (!moved) {
      break;
    }
  }

  return result;
}

export function auditShirtSdfClearance(
  vertices: readonly { readonly position: readonly [number, number, number] }[],
  capsules: readonly BoneSdfCapsuleSample[],
  requiredClearance = SHIRT_SDF_CLEARANCE,
): ShirtSdfClearanceReport {
  let penetrationCount = 0;
  let minSignedDistance = Number.POSITIVE_INFINITY;
  let maxPenetrationDepth = 0;
  let totalClearance = 0;
  let worstVertexIndex = -1;

  for (let index = 0; index < vertices.length; index++) {
    const point = new THREE.Vector3(...vertices[index]!.position);
    const sample = closestCapsuleSignedDistance(point, capsules);
    minSignedDistance = Math.min(minSignedDistance, sample.distance);
    totalClearance += sample.distance;
    if (sample.distance < requiredClearance) {
      penetrationCount += 1;
      const depth = requiredClearance - sample.distance;
      if (depth > maxPenetrationDepth) {
        maxPenetrationDepth = depth;
        worstVertexIndex = index;
      }
    }
  }

  return {
    vertexCount: vertices.length,
    sdfCount: capsules.length,
    requiredClearance,
    penetrationCount,
    minSignedDistance: vertices.length > 0 ? minSignedDistance : Number.POSITIVE_INFINITY,
    maxPenetrationDepth,
    averageClearance: vertices.length > 0 ? totalClearance / vertices.length : 0,
    worstVertexIndex,
  };
}

export function auditPerCapsuleClearance(
  vertices: readonly { readonly position: readonly [number, number, number] }[],
  capsules: readonly BoneSdfCapsuleSample[],
  requiredClearance = SHIRT_SDF_CLEARANCE,
): PerCapsuleClearanceReport {
  let failureCount = 0;
  let minSignedDistance = Number.POSITIVE_INFINITY;
  let worstCapsuleName: string | null = null;
  let worstVertexIndex = -1;

  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex++) {
    const point = new THREE.Vector3(...vertices[vertexIndex]!.position);
    for (const capsule of capsules) {
      const signedDistance = signedDistanceToCapsule(point, capsule);
      minSignedDistance = Math.min(minSignedDistance, signedDistance);
      if (signedDistance < requiredClearance) {
        failureCount += 1;
        if (signedDistance < requiredClearance) {
          worstCapsuleName = capsule.name ?? worstCapsuleName;
          worstVertexIndex = vertexIndex;
        }
      }
    }
  }

  return {
    vertexCount: vertices.length,
    capsuleCount: capsules.length,
    totalChecks: vertices.length * capsules.length,
    failureCount,
    minSignedDistance: vertices.length > 0 && capsules.length > 0 ? minSignedDistance : Number.POSITIVE_INFINITY,
    worstCapsuleName,
    worstVertexIndex,
  };
}

export function auditBodyNotFloatingOverArms(
  vertices: readonly AssemblyVertex[],
  armCapsules: readonly BoneSdfCapsuleSample[],
  clearance = SHIRT_SDF_CLEARANCE,
): BodyArmDrapeReport {
  let floatingOverArmCount = 0;
  let maxFloatHeight = 0;
  let bodyVertexCount = 0;

  for (const vertex of vertices) {
    if (!isBodyPanelVertex(vertex)) {
      continue;
    }
    bodyVertexCount += 1;
    const point = new THREE.Vector3(...vertex.position);
    const [u, v] = vertex.uv;
    if (v < 0.68) {
      continue;
    }

    const side = u < 0.5 ? 'left' : 'right';
    const relevantArms = armCapsules.filter((capsule) => {
      const key = (capsule.name ?? '').toLowerCase();
      return side === 'left'
        ? /left(shoulder|arm|forearm)/.test(key) && !/right/.test(key)
        : /right(shoulder|arm|forearm)/.test(key) && !/left/.test(key);
    });

    for (const capsule of relevantArms) {
      const start = new THREE.Vector3(...capsule.start);
      const end = new THREE.Vector3(...capsule.end);
      const minX = Math.min(start.x, end.x) - capsule.radius;
      const maxX = Math.max(start.x, end.x) + capsule.radius;
      const minZ = Math.min(start.z, end.z) - capsule.radius;
      const maxZ = Math.max(start.z, end.z) + capsule.radius;
      const armTopY = Math.max(start.y, end.y) + capsule.radius + clearance;

      const withinArmSpan =
        point.x >= minX - 0.02 && point.x <= maxX + 0.02 &&
        point.z >= minZ - 0.02 && point.z <= maxZ + 0.02;
      if (!withinArmSpan) {
        continue;
      }

      const floatHeight = point.y - armTopY;
      if (floatHeight > 0.015) {
        floatingOverArmCount += 1;
        maxFloatHeight = Math.max(maxFloatHeight, floatHeight);
      }
    }
  }

  return { bodyVertexCount, floatingOverArmCount, maxFloatHeight };
}

export function auditEdgeCapsuleClearance(
  assembly: ClothAssembly,
  capsules: readonly BoneSdfCapsuleSample[],
  requiredClearance = SHIRT_SDF_CLEARANCE,
): EdgeCapsuleClearanceReport {
  let failureCount = 0;
  let minSignedDistance = Number.POSITIVE_INFINITY;
  let worstEdgeId = -1;
  let worstCapsuleName: string | null = null;

  const surfaceEdges = assembly.edges.filter((edge) => edge.kind === 'structural');
  for (const edge of surfaceEdges) {
    const a = new THREE.Vector3(...assembly.vertices[edge.a]!.position);
    const b = new THREE.Vector3(...assembly.vertices[edge.b]!.position);
    for (const capsule of capsules) {
      const start = new THREE.Vector3(...capsule.start);
      const end = new THREE.Vector3(...capsule.end);
      const signedDistance = segmentSegmentDistance(a, b, start, end) - capsule.radius;
      if (signedDistance < minSignedDistance) {
        minSignedDistance = signedDistance;
        worstEdgeId = edge.id;
        worstCapsuleName = capsule.name ?? null;
      }
      if (signedDistance < requiredClearance) {
        failureCount += 1;
      }
    }
  }

  return {
    edgeCount: surfaceEdges.length,
    capsuleCount: capsules.length,
    totalChecks: surfaceEdges.length * capsules.length,
    failureCount,
    minSignedDistance: surfaceEdges.length > 0 && capsules.length > 0 ? minSignedDistance : Number.POSITIVE_INFINITY,
    worstEdgeId,
    worstCapsuleName,
  };
}

export function auditTriangleCapsuleClearance(
  assembly: ClothAssembly,
  capsules: readonly BoneSdfCapsuleSample[],
  requiredClearance = SHIRT_SDF_CLEARANCE,
): TriangleCapsuleClearanceReport {
  let failureCount = 0;
  let minSignedDistance = Number.POSITIVE_INFINITY;
  let worstFaceId = -1;
  let worstCapsuleName: string | null = null;

  const patchFaces = assembly.faces.filter((face) => face.source === 'patch');
  for (const face of patchFaces) {
    const a = new THREE.Vector3(...assembly.vertices[face.vertices[0]]!.position);
    const b = new THREE.Vector3(...assembly.vertices[face.vertices[1]]!.position);
    const c = new THREE.Vector3(...assembly.vertices[face.vertices[2]]!.position);
    for (const capsule of capsules) {
      const start = new THREE.Vector3(...capsule.start);
      const end = new THREE.Vector3(...capsule.end);
      const signedDistance = segmentTriangleDistance(start, end, a, b, c) - capsule.radius;
      if (signedDistance < minSignedDistance) {
        minSignedDistance = signedDistance;
        worstFaceId = face.id;
        worstCapsuleName = capsule.name ?? null;
      }
      if (signedDistance < requiredClearance) {
        failureCount += 1;
      }
    }
  }

  return {
    triangleCount: patchFaces.length,
    capsuleCount: capsules.length,
    totalChecks: patchFaces.length * capsules.length,
    failureCount,
    minSignedDistance: patchFaces.length > 0 && capsules.length > 0 ? minSignedDistance : Number.POSITIVE_INFINITY,
    worstFaceId,
    worstCapsuleName,
  };
}

export function auditAssemblyStrain(
  assembly: ClothAssembly,
  maxAllowedStrain = 0.08,
): AssemblyStrainReport {
  let maxStrain = 0;
  let totalStrain = 0;
  let overLimitCount = 0;
  let worstEdgeId = -1;
  let worstSourceId: string | null = null;

  const structuralEdges = assembly.edges.filter((edge) => edge.kind === 'structural');
  for (const edge of structuralEdges) {
    const a = new THREE.Vector3(...assembly.vertices[edge.a]!.position);
    const b = new THREE.Vector3(...assembly.vertices[edge.b]!.position);
    const length = a.distanceTo(b);
    const rest = Math.max(1e-6, edge.restLength);
    const strain = Math.abs(length - rest) / rest;
    if (strain > maxStrain) {
      maxStrain = strain;
      worstEdgeId = edge.id;
      worstSourceId = edge.sourceId;
    }
    totalStrain += strain;
    if (strain > maxAllowedStrain) {
      overLimitCount += 1;
    }
  }

  return {
    edgeCount: structuralEdges.length,
    maxStrain,
    averageStrain: structuralEdges.length > 0 ? totalStrain / structuralEdges.length : 0,
    overLimitCount,
    worstEdgeId,
    worstSourceId,
  };
}

export function auditTriangleQuality(
  assembly: ClothAssembly,
  minArea = 1e-7,
): TriangleQualityReport {
  let degenerateCount = 0;
  let minSeenArea = Number.POSITIVE_INFINITY;
  let totalArea = 0;

  const patchFaces = assembly.faces.filter((face) => face.source === 'patch');
  for (const face of patchFaces) {
    const a = new THREE.Vector3(...assembly.vertices[face.vertices[0]]!.position);
    const b = new THREE.Vector3(...assembly.vertices[face.vertices[1]]!.position);
    const c = new THREE.Vector3(...assembly.vertices[face.vertices[2]]!.position);
    const area = triangleArea(a, b, c);
    minSeenArea = Math.min(minSeenArea, area);
    totalArea += area;
    if (area < minArea) {
      degenerateCount += 1;
    }
  }

  return {
    triangleCount: patchFaces.length,
    degenerateCount,
    minArea: patchFaces.length > 0 ? minSeenArea : Number.POSITIVE_INFINITY,
    averageArea: patchFaces.length > 0 ? totalArea / patchFaces.length : 0,
  };
}

export function placeCharacterTShirtAssembly(
  rig: AnimatedCharacterSceneRig,
  params: TShirtGarmentParams = DEFAULT_CHARACTER_T_SHIRT_OPTIONS,
  clearance = SHIRT_SDF_CLEARANCE,
): ClothAssembly {
  const normalized = normalizeGarmentParams('tshirt', params);
  const source = createTShirtAssembly(resolveTShirtAssemblyOptions(normalized));

  rig.root.updateMatrixWorld(true);
  const anchors = rig.getCharacterAnchors();
  const sdfs = rig.getBoneSdfSummary();
  const capsuleTargets = sdfs.map(toCapsuleTarget);
  const hips = anchors.hips ?? new THREE.Vector3(0, 0.75, 0);
  const chest = anchors.chest ?? new THREE.Vector3(0, 1.1, 0);
  const neck = anchors.neck ?? new THREE.Vector3(0, 1.38, 0);
  const leftShoulder = anchors.leftShoulder;
  const rightShoulder = anchors.rightShoulder;
  const shoulderCenter = leftShoulder && rightShoulder
    ? leftShoulder.clone().add(rightShoulder).multiplyScalar(0.5)
    : chest;
  const targetCenter = hips.clone().lerp(shoulderCenter, 0.55);
  targetCenter.y = neck.y - normalized.torsoHeight * 0.86;

  const dressAxes = resolveCharacterDressAxes(anchors, rig.measureForwardYaw());
  const frame: DressFrame = {
    xAxis: dressAxes.xAxis,
    yAxis: dressAxes.yAxis,
    zAxis: dressAxes.zAxis,
    targetCenter,
    scaleX: 1,
    scaleY: 1,
    halfDepth: normalized.depth * 0.5,
  };

  const leftArmCapsules = filterSideArmCapsules(capsuleTargets, 'left');
  const rightArmCapsules = filterSideArmCapsules(capsuleTargets, 'right');
  const leftSleeveTarget = leftShoulder
    ? createSleeveDressingTarget(
        leftShoulder,
        leftArmCapsules,
        dressAxes.zAxis,
        dressAxes.xAxis.clone().multiplyScalar(-1),
      )
    : null;
  const rightSleeveTarget = rightShoulder
    ? createSleeveDressingTarget(rightShoulder, rightArmCapsules, dressAxes.zAxis, dressAxes.xAxis)
    : null;

  const dressClearance = clearance + 0.002;

  const dressedVertices = source.vertices.map((vertex) => {
    const fallbackBaseline = transformPatternVertex(vertex.position, frame);
    const fallback = new THREE.Vector3(fallbackBaseline.x, fallbackBaseline.y, fallbackBaseline.z);

    if (vertex.patchId.includes('left-sleeve')) {
      const position = leftSleeveTarget
        ? dressSleeveVertex(vertex, leftSleeveTarget, fallback, dressClearance)
        : fallback;
      return {
        ...vertex,
        position: [position.x, position.y, position.z] as [number, number, number],
      };
    }
    if (vertex.patchId.includes('right-sleeve')) {
      const position = rightSleeveTarget
        ? dressSleeveVertex(vertex, rightSleeveTarget, fallback, dressClearance)
        : fallback;
      return {
        ...vertex,
        position: [position.x, position.y, position.z] as [number, number, number],
      };
    }

    const fitted = applyCoherentFitOffset(vertex, fallback, frame);
    const position = new THREE.Vector3(fitted[0], fitted[1], fitted[2]);
    if (shouldProjectTorsoVertexToShell(vertex)) {
      position.copy(projectToExteriorShell(position, sdfs, dressClearance));
    }
    return {
      ...vertex,
      position: [position.x, position.y, position.z] as [number, number, number],
    };
  });

  return {
    vertices: dressedVertices,
    faces: source.faces,
    edges: withRestLengthsFromVertices(source.edges, dressedVertices),
    stitchEdges: withRestLengthsFromVertices(source.stitchEdges, dressedVertices),
  };
}

function transformPatternVertex(position: readonly [number, number, number], frame: DressFrame): THREE.Vector3 {
  const scaled = new THREE.Vector3(
    position[0] * frame.scaleX,
    position[1] * frame.scaleY,
    position[2],
  );
  const rotation = new THREE.Matrix4().makeBasis(frame.xAxis, frame.yAxis, frame.zAxis);
  return scaled.applyMatrix4(rotation).add(frame.targetCenter);
}

function computePanelNormal(vertex: ClothAssembly['vertices'][number], frame: DressFrame): THREE.Vector3 {
  const frontSign = vertex.patchId.includes('back') ? -1 : 1;
  return frame.zAxis.clone().multiplyScalar(frontSign);
}

function applyCoherentFitOffset(
  vertex: ClothAssembly['vertices'][number],
  position: THREE.Vector3,
  frame: DressFrame,
): [number, number, number] {
  const fitted = position.clone();

  if (vertex.patchId.includes('left-sleeve')) {
    fitted.addScaledVector(frame.xAxis, -0.045);
    fitted.addScaledVector(frame.yAxis, -0.02);
  } else if (vertex.patchId.includes('right-sleeve')) {
    fitted.addScaledVector(frame.xAxis, 0.045);
    fitted.addScaledVector(frame.yAxis, -0.02);
  } else if (vertex.patchId.includes('front')) {
    fitted.addScaledVector(frame.zAxis, 0.06);
  } else if (vertex.patchId.includes('back')) {
    fitted.addScaledVector(frame.zAxis, -0.06);
  }

  return [fitted.x, fitted.y, fitted.z];
}

function isBodyPanelVertex(vertex: AssemblyVertex): boolean {
  return vertex.patchId.includes('front') || vertex.patchId.includes('back') || vertex.patchId.includes('neck-binding');
}

/** Shell projection is for armpit/side clearance only — not neckline or neck binding. */
function shouldProjectTorsoVertexToShell(vertex: AssemblyVertex): boolean {
  if (vertex.patchId.includes('neck-binding')) {
    return false;
  }
  if (!vertex.patchId.includes('front') && !vertex.patchId.includes('back')) {
    return false;
  }
  if (vertex.uv[1] < 0.68) {
    return false;
  }
  return Math.abs(vertex.uv[0] - 0.5) > 0.34;
}

function pushoutAssemblySurface(
  assembly: ClothAssembly,
  capsules: readonly BoneSdfCapsuleSample[],
  clearance: number,
): ClothAssembly {
  const positions = assembly.vertices.map((vertex) => new THREE.Vector3(...vertex.position));
  const shellDistance = clearance + 0.0005;

  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < positions.length; i++) {
      positions[i]!.copy(projectToExteriorShell(positions[i]!, capsules, clearance));
    }

  }

  return {
    vertices: assembly.vertices.map((vertex, index) => {
      const position = positions[index]!;
      return {
        ...vertex,
        position: [position.x, position.y, position.z] as [number, number, number],
      };
    }),
    faces: assembly.faces,
    edges: assembly.edges,
    stitchEdges: assembly.stitchEdges,
  };
}

function withRestLengthsFromVertices(
  edges: readonly ClothAssembly['edges'][number][],
  vertices: readonly AssemblyVertex[],
): ClothAssembly['edges'] {
  return edges.map((edge) => {
    const a = new THREE.Vector3(...vertices[edge.a]!.position);
    const b = new THREE.Vector3(...vertices[edge.b]!.position);
    return { ...edge, restLength: a.distanceTo(b) };
  });
}

function sampleCapsule(
  point: THREE.Vector3,
  capsule: BoneSdfCapsuleSample,
): {
  readonly closest: THREE.Vector3;
  readonly normal: THREE.Vector3;
  readonly signedDistance: number;
} {
  const start = new THREE.Vector3(...capsule.start);
  const end = new THREE.Vector3(...capsule.end);
  const closest = closestPointOnSegment(point, start, end);
  const offset = point.clone().sub(closest);
  const distanceToAxis = offset.length();
  const normal = distanceToAxis > 0.000001
    ? offset.multiplyScalar(1 / distanceToAxis)
    : fallbackNormalForCapsule(capsule);
  return {
    closest,
    normal,
    signedDistance: distanceToAxis - capsule.radius,
  };
}

function fallbackNormalForCapsule(capsule: BoneSdfCapsuleSample): THREE.Vector3 {
  const start = new THREE.Vector3(...capsule.start);
  const end = new THREE.Vector3(...capsule.end);
  const axis = end.clone().sub(start);
  if (axis.lengthSq() < 0.000001) {
    return new THREE.Vector3(0, 0, 1);
  }
  axis.normalize();
  const fallback = Math.abs(axis.y) < 0.95
    ? new THREE.Vector3(0, 1, 0).cross(axis)
    : new THREE.Vector3(1, 0, 0).cross(axis);
  if (fallback.lengthSq() < 0.000001) {
    fallback.set(0, 0, 1);
  }
  return fallback.normalize();
}

function filterSideArmCapsules(
  capsules: readonly CharacterSdfCapsuleTarget[],
  side: 'left' | 'right',
): CharacterSdfCapsuleTarget[] {
  return capsules.filter((capsule) => {
    const key = (capsule.name ?? '').toLowerCase();
    return side === 'left'
      ? /left(shoulder|arm|forearm)/.test(key) && !/right/.test(key)
      : /right(shoulder|arm|forearm)/.test(key) && !/left/.test(key);
  });
}

function toCapsuleTarget(capsule: ReturnType<AnimatedCharacterSceneRig['getBoneSdfSummary']>[number]): CharacterSdfCapsuleTarget {
  return {
    start: capsule.start,
    end: capsule.end,
    radius: capsule.radius,
    name: capsule.name,
    startVec: new THREE.Vector3(...capsule.start),
    endVec: new THREE.Vector3(...capsule.end),
    key: characterSdfKey(capsule.name),
  };
}

function createSleeveDressingTarget(
  shoulder: THREE.Vector3,
  capsules: readonly CharacterSdfCapsuleTarget[],
  frontAxis: THREE.Vector3,
  fallbackSideAxis: THREE.Vector3,
): SleeveDressingTarget {
  const points = [shoulder.clone()];
  for (const capsule of capsules) {
    appendUniquePoint(points, capsule.startVec);
    appendUniquePoint(points, capsule.endVec);
  }

  points.sort((a, b) => a.distanceToSquared(shoulder) - b.distanceToSquared(shoulder));
  const path = points.length >= 2
    ? points
    : [shoulder.clone(), shoulder.clone().addScaledVector(fallbackSideAxis, 0.42)];
  return {
    path,
    capsules,
    frontAxis: frontAxis.clone().normalize(),
    fallbackSideAxis: fallbackSideAxis.clone().normalize(),
    pathLength: polylineLength(path),
  };
}

function dressSleeveVertex(
  vertex: ClothAssembly['vertices'][number],
  target: SleeveDressingTarget,
  fallbackPoint: THREE.Vector3,
  clearance: number,
): THREE.Vector3 {
  if (target.capsules.length === 0 || target.pathLength <= 0.0001) {
    return fallbackPoint;
  }

  const lengthT = THREE.MathUtils.clamp(vertex.uv[0], 0, 1);
  const ringT = vertex.uv[1] - Math.floor(vertex.uv[1]);
  const centerSample = samplePolyline(target.path, target.pathLength * (0.08 + lengthT * 0.7));
  const aheadSample = samplePolyline(
    target.path,
    target.pathLength * Math.min(1, 0.12 + lengthT * 0.7),
  );
  const tangent = aheadSample.clone().sub(centerSample);
  if (tangent.lengthSq() < 0.000001) {
    tangent.copy(target.fallbackSideAxis);
  }
  tangent.normalize();

  const front = target.frontAxis.clone().addScaledVector(tangent, -target.frontAxis.dot(tangent));
  if (front.lengthSq() < 0.000001) {
    front.copy(target.fallbackSideAxis).addScaledVector(tangent, -target.fallbackSideAxis.dot(tangent));
  }
  if (front.lengthSq() < 0.000001) {
    front.set(0, 0, 1);
  }
  front.normalize();
  const upAroundArm = tangent.clone().cross(front).normalize();
  const angle = -Math.PI * 0.5 + ringT * Math.PI * 2;
  const radial = upAroundArm.multiplyScalar(Math.sin(angle)).addScaledVector(front, Math.cos(angle)).normalize();
  const nearest = nearestCapsuleRadius(centerSample, target.capsules);
  return centerSample.addScaledVector(radial, nearest + clearance + 0.035);
}

function appendUniquePoint(points: THREE.Vector3[], candidate: THREE.Vector3): void {
  if (points.some((point) => point.distanceToSquared(candidate) < 0.0001)) {
    return;
  }
  points.push(candidate.clone());
}

function polylineLength(points: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += points[i - 1]!.distanceTo(points[i]!);
  }
  return length;
}

function samplePolyline(points: readonly THREE.Vector3[], distance: number): THREE.Vector3 {
  if (points.length === 0) {
    return new THREE.Vector3();
  }
  if (points.length === 1) {
    return points[0]!.clone();
  }

  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1]!;
    const end = points[i]!;
    const segmentLength = start.distanceTo(end);
    if (remaining <= segmentLength) {
      const t = segmentLength > 0 ? remaining / segmentLength : 0;
      return start.clone().lerp(end, t);
    }
    remaining -= segmentLength;
  }
  return points[points.length - 1]!.clone();
}

function nearestCapsuleRadius(point: THREE.Vector3, capsules: readonly CharacterSdfCapsuleTarget[]): number {
  let radius = 0.075;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const capsule of capsules) {
    const center = closestPointOnSegment(point, capsule.startVec, capsule.endVec);
    const distanceSq = center.distanceToSquared(point);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      radius = capsule.radius;
    }
  }
  return radius;
}

function closestPointOnSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  if (lengthSq < 0.000001) {
    return start.clone();
  }
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
  return start.clone().addScaledVector(segment, t);
}

function closestSegmentSegmentPoints(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
): { readonly a: THREE.Vector3; readonly b: THREE.Vector3 } {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;

  if (a <= 1e-12 && e <= 1e-12) {
    return { a: p1.clone(), b: p2.clone() };
  }
  if (a <= 1e-12) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (denom !== 0) {
        s = THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1);
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }

  return {
    a: p1.clone().addScaledVector(d1, s),
    b: p2.clone().addScaledVector(d2, t),
  };
}

function segmentSegmentDistance(
  a0: THREE.Vector3,
  a1: THREE.Vector3,
  b0: THREE.Vector3,
  b1: THREE.Vector3,
): number {
  const closest = closestSegmentSegmentPoints(a0, a1, b0, b1);
  return closest.a.distanceTo(closest.b);
}

function segmentTriangleDistance(
  start: THREE.Vector3,
  end: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): number {
  if (segmentIntersectsTriangle(start, end, a, b, c)) {
    return 0;
  }
  return Math.min(
    pointTriangleDistance(start, a, b, c),
    pointTriangleDistance(end, a, b, c),
    segmentSegmentDistance(start, end, a, b),
    segmentSegmentDistance(start, end, b, c),
    segmentSegmentDistance(start, end, c, a),
  );
}

function segmentIntersectsTriangle(
  start: THREE.Vector3,
  end: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): boolean {
  const direction = end.clone().sub(start);
  const edge1 = b.clone().sub(a);
  const edge2 = c.clone().sub(a);
  const h = direction.clone().cross(edge2);
  const det = edge1.dot(h);
  if (Math.abs(det) < 1e-9) {
    return false;
  }
  const invDet = 1 / det;
  const s = start.clone().sub(a);
  const u = invDet * s.dot(h);
  if (u < 0 || u > 1) {
    return false;
  }
  const q = s.clone().cross(edge1);
  const v = invDet * direction.dot(q);
  if (v < 0 || u + v > 1) {
    return false;
  }
  const t = invDet * edge2.dot(q);
  return t >= 0 && t <= 1;
}

function pointTriangleDistance(
  point: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): number {
  const ab = b.clone().sub(a);
  const ac = c.clone().sub(a);
  const ap = point.clone().sub(a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) {
    return point.distanceTo(a);
  }

  const bp = point.clone().sub(b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) {
    return point.distanceTo(b);
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return point.distanceTo(a.clone().addScaledVector(ab, v));
  }

  const cp = point.clone().sub(c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) {
    return point.distanceTo(c);
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return point.distanceTo(a.clone().addScaledVector(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return point.distanceTo(b.clone().addScaledVector(c.clone().sub(b), w));
  }

  const normal = ab.cross(ac).normalize();
  return Math.abs(point.clone().sub(a).dot(normal));
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
}

function averageVertexPosition(vertices: readonly AssemblyVertex[]): THREE.Vector3 {
  if (vertices.length === 0) {
    return new THREE.Vector3();
  }
  const sum = new THREE.Vector3();
  for (const vertex of vertices) {
    sum.add(new THREE.Vector3(...vertex.position));
  }
  return sum.multiplyScalar(1 / vertices.length);
}

function averageProjection(
  vertices: readonly AssemblyVertex[],
  origin: THREE.Vector3,
  axis: THREE.Vector3,
): number {
  if (vertices.length === 0) {
    return 0;
  }
  let total = 0;
  for (const vertex of vertices) {
    total += new THREE.Vector3(...vertex.position).sub(origin).dot(axis);
  }
  return total / vertices.length;
}

function meanDistanceToPoint(
  vertices: readonly AssemblyVertex[],
  target: THREE.Vector3,
): number {
  if (vertices.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let total = 0;
  for (const vertex of vertices) {
    total += new THREE.Vector3(...vertex.position).distanceTo(target);
  }
  return total / vertices.length;
}

function measureSleeveAxisErrorDeg(
  sleeveVertices: readonly AssemblyVertex[],
  shoulder: THREE.Vector3 | null,
  arm: THREE.Vector3 | null,
  axes: CharacterDressAxes,
  side: 'left' | 'right',
  sdfs: readonly BoneSdfCapsuleSample[],
): number {
  if (sleeveVertices.length === 0) {
    return 180;
  }

  const shoulderEnd = sleeveVertices.filter((vertex) => vertex.uv[0] <= 0.2);
  const cuffEnd = sleeveVertices.filter((vertex) => vertex.uv[0] >= 0.8);
  const shoulderPoint = averageVertexPosition(shoulderEnd.length > 0 ? shoulderEnd : sleeveVertices);
  const cuffPoint = averageVertexPosition(cuffEnd.length > 0 ? cuffEnd : sleeveVertices);
  const sleeveAxis = cuffPoint.clone().sub(shoulderPoint);
  sleeveAxis.y = 0;
  if (sleeveAxis.lengthSq() < 1e-6) {
    return 180;
  }
  sleeveAxis.normalize();

  let expectedAxis: THREE.Vector3 | null = null;
  if (shoulder && arm) {
    expectedAxis = arm.clone().sub(shoulder);
    expectedAxis.y = 0;
    if (expectedAxis.lengthSq() < 1e-6) {
      expectedAxis = null;
    } else {
      expectedAxis.normalize();
    }
  }

  if (!expectedAxis) {
    const armCapsules = sdfs.filter((capsule) => {
      const key = (capsule.name ?? '').toLowerCase();
      return side === 'left'
        ? /left(shoulder|arm|forearm)/.test(key) && !/right/.test(key)
        : /right(shoulder|arm|forearm)/.test(key) && !/left/.test(key);
    });
    if (armCapsules.length > 0) {
      const start = new THREE.Vector3(...armCapsules[0]!.start);
      const end = new THREE.Vector3(...armCapsules[0]!.end);
      expectedAxis = end.clone().sub(start);
      expectedAxis.y = 0;
      if (expectedAxis.lengthSq() > 1e-6) {
        expectedAxis.normalize();
      } else {
        expectedAxis = null;
      }
    }
  }

  if (!expectedAxis) {
    expectedAxis = side === 'left'
      ? axes.xAxis.clone().multiplyScalar(-1)
      : axes.xAxis.clone();
  }

  const dot = THREE.MathUtils.clamp(sleeveAxis.dot(expectedAxis), -1, 1);
  return Math.acos(dot) * (180 / Math.PI);
}

function characterSdfKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
