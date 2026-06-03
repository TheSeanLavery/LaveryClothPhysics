import * as THREE from 'three';
import {
  normalizedBoneKey,
  type CharacterSdfBoneOverride,
  type CharacterSdfManualCapsule,
  type CharacterSdfPresetEnvelope,
} from './characterSdfSchema';

export const BONE_SDF_CLOTH_SKIN = 0.012;

export interface CharacterSdfCapsule {
  readonly id: number;
  readonly name: string;
  readonly parentName: string;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly radius: number;
  readonly length: number;
  readonly fitVertexCount?: number;
  readonly fitted?: boolean;
  readonly manual?: boolean;
}

export interface CharacterSdfCapsuleBlueprint {
  readonly name: string;
  readonly parentName: string;
  readonly startBone: THREE.Bone;
  readonly endBone: THREE.Bone;
  readonly t0: number;
  readonly t1: number;
  readonly radius: number;
  readonly fitVertexCount: number;
}

export interface CharacterSdfBuildOptions {
  readonly preset?: CharacterSdfPresetEnvelope | null;
}

export function buildCharacterSdfBlueprints(
  loadedRoot: THREE.Object3D,
  bones: readonly THREE.Bone[],
  options: CharacterSdfBuildOptions = {},
): CharacterSdfCapsuleBlueprint[] {
  loadedRoot.updateMatrixWorld(true);
  const pointsByBone = new Map<THREE.Bone, THREE.Vector3[]>();
  const vertexRules = options.preset?.vertexRules ?? [];

  loadedRoot.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) {
      return;
    }
    const geometry = object.geometry;
    const positionAttr = geometry.getAttribute('position');
    const skinIndexAttr = geometry.getAttribute('skinIndex');
    const skinWeightAttr = geometry.getAttribute('skinWeight');
    if (!positionAttr || !skinIndexAttr || !skinWeightAttr || !object.skeleton) {
      return;
    }

    const worldVertex = new THREE.Vector3();
    for (let vertexIndex = 0; vertexIndex < positionAttr.count; vertexIndex++) {
      const matchingRule = vertexRules.find((rule) =>
        rule.meshName === object.name && rule.vertexIndex === vertexIndex
      );
      if (matchingRule?.action === 'exclude') {
        continue;
      }

      getSkinnedVertexWorldPosition(object, vertexIndex, worldVertex);
      if (matchingRule?.action === 'pin' && matchingRule.boneName) {
        const pinnedBone = object.skeleton.bones.find((bone) => bone.name === matchingRule.boneName);
        if (pinnedBone) {
          pushPoint(pointsByBone, pinnedBone, worldVertex);
        }
        continue;
      }

      for (let influence = 0; influence < Math.min(4, skinWeightAttr.itemSize); influence++) {
        const weight = skinWeightAttr.getComponent(vertexIndex, influence);
        if (weight < 0.18 && matchingRule?.action !== 'include') {
          continue;
        }
        const boneIndex = Math.round(skinIndexAttr.getComponent(vertexIndex, influence));
        const bone = object.skeleton.bones[boneIndex];
        if (!bone || shouldSkipFittedBone(bone.name)) {
          continue;
        }
        pushPoint(pointsByBone, bone, worldVertex);
      }
    }
  });

  const blueprints: CharacterSdfCapsuleBlueprint[] = [];
  for (const bone of bones) {
    const override = findBoneOverride(options.preset?.boneOverrides ?? [], bone.name);
    if (override?.enabled === false) {
      continue;
    }
    const endBone = primaryCollisionChildBone(bone) ?? (bone.parent instanceof THREE.Bone ? bone.parent : null);
    if (!endBone || shouldSkipFittedBone(bone.name)) {
      continue;
    }
    const points = pointsByBone.get(bone) ?? [];
    blueprints.push(...buildCapsuleBlueprintsForBone(bone, endBone, points, override, options.preset));
  }
  return blueprints;
}

export function compileCharacterSdfCapsulesFromBlueprints(
  blueprints: readonly CharacterSdfCapsuleBlueprint[],
  options: CharacterSdfBuildOptions = {},
): CharacterSdfCapsule[] {
  const capsules: CharacterSdfCapsule[] = [];
  for (const blueprint of blueprints) {
    const override = findBoneOverride(options.preset?.boneOverrides ?? [], blueprint.parentName);
    const startPosition = blueprint.startBone.getWorldPosition(new THREE.Vector3());
    const endPosition = blueprint.endBone.getWorldPosition(new THREE.Vector3());
    const t0 = override?.t0 ?? blueprint.t0;
    const t1 = override?.t1 ?? blueprint.t1;
    const start = startPosition.clone().lerp(endPosition, Math.min(t0, t1));
    const end = startPosition.clone().lerp(endPosition, Math.max(t0, t1));
    const length = start.distanceTo(end);
    if (length < 0.004) {
      continue;
    }
    capsules.push({
      id: capsules.length,
      name: blueprint.name,
      parentName: blueprint.parentName,
      start,
      end,
      radius: withClothCollisionSkin(blueprint.radius),
      length,
      fitVertexCount: blueprint.fitVertexCount,
      fitted: true,
    });
  }
  appendManualCapsules(capsules, options.preset?.manualCapsules ?? []);
  return capsules;
}

export function compileFallbackCharacterSdfCapsules(
  bones: readonly THREE.Bone[],
  options: CharacterSdfBuildOptions = {},
): CharacterSdfCapsule[] {
  const capsules: CharacterSdfCapsule[] = [];
  for (const bone of bones) {
    const parent = bone.parent;
    const override = findBoneOverride(options.preset?.boneOverrides ?? [], bone.name);
    if (!(parent instanceof THREE.Bone) || override?.enabled === false) {
      continue;
    }
    const start = parent.getWorldPosition(new THREE.Vector3());
    const end = bone.getWorldPosition(new THREE.Vector3());
    const length = start.distanceTo(end);
    if (length < 0.01) {
      continue;
    }
    capsules.push({
      id: capsules.length,
      name: bone.name,
      parentName: parent.name,
      start,
      end,
      radius: withClothCollisionSkin(applyRadiusPreset(radiusForBone(bone.name, length), override, options.preset)),
      length,
    });
  }
  appendManualCapsules(capsules, options.preset?.manualCapsules ?? []);
  return capsules;
}

export function withClothCollisionSkin(radius: number): number {
  return radius + BONE_SDF_CLOTH_SKIN;
}

export function maxCapsulesPerBone(capsules: readonly CharacterSdfCapsule[]): number {
  const counts = new Map<string, number>();
  for (const capsule of capsules) {
    const key = capsule.name.replace(/-fit-\d+$/, '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

export function radiusForBone(name: string, length: number): number {
  const normalized = normalizedBoneKey(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return THREE.MathUtils.clamp(length * 0.42, 0.055, 0.14);
  }
  if (normalized.includes('upperleg')) {
    return THREE.MathUtils.clamp(length * 0.18, 0.045, 0.09);
  }
  if (normalized.includes('leg') || normalized.includes('foot')) {
    return THREE.MathUtils.clamp(length * 0.14, 0.035, 0.07);
  }
  if (normalized.includes('arm') || normalized.includes('shoulder')) {
    return THREE.MathUtils.clamp(length * 0.2, 0.035, 0.075);
  }
  if (normalized.includes('forearm') || normalized.includes('hand')) {
    return THREE.MathUtils.clamp(length * 0.16, 0.025, 0.055);
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return THREE.MathUtils.clamp(length * 0.35, 0.045, 0.11);
  }
  return THREE.MathUtils.clamp(length * 0.16, 0.012, 0.04);
}

export function shouldSkipFittedBone(name: string): boolean {
  const normalized = normalizedBoneKey(name);
  return (
    normalized.endsWith('end') ||
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('toe')
  );
}

export function primaryCollisionChildBone(bone: THREE.Bone): THREE.Bone | null {
  let best: THREE.Bone | null = null;
  for (const child of bone.children) {
    if (!(child instanceof THREE.Bone)) {
      continue;
    }
    if (shouldSkipFittedBone(child.name) && !isUsefulTerminalEndpoint(bone.name, child.name)) {
      continue;
    }
    if (!best || collisionChildPriority(child.name) > collisionChildPriority(best.name)) {
      best = child;
    }
  }
  return best;
}

export function getSkinnedVertexWorldPosition(
  mesh: THREE.SkinnedMesh,
  vertexIndex: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const positionAttr = mesh.geometry.getAttribute('position');
  const skinIndexAttr = mesh.geometry.getAttribute('skinIndex');
  const skinWeightAttr = mesh.geometry.getAttribute('skinWeight');
  target.fromBufferAttribute(positionAttr, vertexIndex);
  if (!skinIndexAttr || !skinWeightAttr || !mesh.skeleton) {
    return mesh.localToWorld(target);
  }

  const bindPosition = target.clone().applyMatrix4(mesh.bindMatrix);
  const skinned = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();
  for (let influence = 0; influence < Math.min(4, skinWeightAttr.itemSize); influence++) {
    const weight = skinWeightAttr.getComponent(vertexIndex, influence);
    if (weight <= 0) {
      continue;
    }
    const boneIndex = Math.round(skinIndexAttr.getComponent(vertexIndex, influence));
    const bone = mesh.skeleton.bones[boneIndex];
    const inverse = mesh.skeleton.boneInverses[boneIndex];
    if (!bone || !inverse) {
      continue;
    }
    boneMatrix.multiplyMatrices(bone.matrixWorld, inverse);
    skinned.addScaledVector(bindPosition.clone().applyMatrix4(boneMatrix), weight);
  }

  target.copy(skinned.applyMatrix4(mesh.bindMatrixInverse));
  return mesh.localToWorld(target);
}

function buildCapsuleBlueprintsForBone(
  bone: THREE.Bone,
  endBone: THREE.Bone,
  points: readonly THREE.Vector3[],
  override: CharacterSdfBoneOverride | undefined,
  preset: CharacterSdfPresetEnvelope | null | undefined,
): CharacterSdfCapsuleBlueprint[] {
  const startPosition = bone.getWorldPosition(new THREE.Vector3());
  const endPosition = endBone.getWorldPosition(new THREE.Vector3());
  const axis = endPosition.clone().sub(startPosition);
  const length = axis.length();
  if (length < 0.01) {
    return [];
  }
  axis.normalize();

  if (points.length < 6) {
    return [{
      name: bone.name,
      parentName: bone.name,
      startBone: bone,
      endBone,
      t0: override?.t0 ?? 0,
      t1: override?.t1 ?? 1,
      radius: applyRadiusPreset(radiusForBone(bone.name, length), override, preset),
      fitVertexCount: points.length,
    }];
  }

  const samples = points.map((point) => {
    const offset = point.clone().sub(startPosition);
    const t = THREE.MathUtils.clamp(offset.dot(axis) / length, -0.1, 1.1);
    const axisPoint = startPosition.clone().addScaledVector(axis, t * length);
    return { t, radius: point.distanceTo(axisPoint) };
  });
  samples.sort((a, b) => a.t - b.t);

  const segmentCount = override?.segmentCount ?? segmentCountForBone(bone.name);
  const blueprints: CharacterSdfCapsuleBlueprint[] = [];
  const fallbackRadii = samples.map((sample) => sample.radius).sort((a, b) => a - b);
  const limbBone = isLimbBone(bone.name);
  const sampleOverlap = limbBone ? 0.055 : 0.12;
  const endpointPadding = limbBone ? 0.006 : 0.025;
  const radiusPercentile = limbBone ? 0.4 : 0.45;
  for (let segment = 0; segment < segmentCount; segment++) {
    const minT = segment / segmentCount;
    const maxT = (segment + 1) / segmentCount;
    const segmentSamples = samples.filter((sample) =>
      sample.t >= minT - sampleOverlap && sample.t <= maxT + sampleOverlap,
    );
    const radii = (segmentSamples.length >= 4 ? segmentSamples : samples)
      .map((sample) => sample.radius)
      .sort((a, b) => a - b);
    const t0 = THREE.MathUtils.clamp(minT - endpointPadding, 0, 1);
    const t1 = THREE.MathUtils.clamp(maxT + endpointPadding, 0, 1);
    const radius = applyRadiusPreset(
      clampFittedRadius(bone.name, percentile(radii.length > 0 ? radii : fallbackRadii, radiusPercentile)),
      override,
      preset,
    );
    if (t1 - t0 < 0.035 || radius <= 0) {
      continue;
    }
    blueprints.push({
      name: segmentCount > 1 ? `${bone.name}-fit-${segment + 1}` : bone.name,
      parentName: bone.name,
      startBone: bone,
      endBone,
      t0,
      t1,
      radius,
      fitVertexCount: segmentSamples.length,
    });
  }

  if (blueprints.length > 0) {
    return blueprints;
  }

  const radii = samples.map((sample) => sample.radius).sort((a, b) => a - b);
  return [{
    name: bone.name,
    parentName: bone.name,
    startBone: bone,
    endBone,
    t0: override?.t0 ?? 0,
    t1: override?.t1 ?? 1,
    radius: applyRadiusPreset(clampFittedRadius(bone.name, percentile(radii, 0.88)), override, preset),
    fitVertexCount: points.length,
  }];
}

function appendManualCapsules(
  capsules: CharacterSdfCapsule[],
  manualCapsules: readonly CharacterSdfManualCapsule[],
): void {
  for (const capsule of manualCapsules) {
    if (capsule.enabled === false || capsule.radius <= 0) {
      continue;
    }
    const start = new THREE.Vector3(...capsule.start);
    const end = new THREE.Vector3(...capsule.end);
    capsules.push({
      id: capsules.length,
      name: capsule.name,
      parentName: capsule.parentName,
      start,
      end,
      radius: withClothCollisionSkin(capsule.radius),
      length: start.distanceTo(end),
      manual: true,
    });
  }
}

function applyRadiusPreset(
  radius: number,
  override: CharacterSdfBoneOverride | undefined,
  preset: CharacterSdfPresetEnvelope | null | undefined,
): number {
  const scaled = radius * (preset?.globalRadiusScale ?? 1) * (override?.radiusScale ?? 1);
  return Math.max(0, scaled + (preset?.globalRadiusBias ?? 0) + (override?.radiusBias ?? 0));
}

function findBoneOverride(
  overrides: readonly CharacterSdfBoneOverride[],
  boneName: string,
): CharacterSdfBoneOverride | undefined {
  const key = normalizedBoneKey(boneName);
  return overrides.find((override) => normalizedBoneKey(override.boneName) === key);
}

function pushPoint(pointsByBone: Map<THREE.Bone, THREE.Vector3[]>, bone: THREE.Bone, point: THREE.Vector3): void {
  const points = pointsByBone.get(bone);
  if (points) {
    points.push(point.clone());
  } else {
    pointsByBone.set(bone, [point.clone()]);
  }
}

function isUsefulTerminalEndpoint(parentName: string, childName: string): boolean {
  const parent = normalizedBoneKey(parentName);
  const child = normalizedBoneKey(childName);
  if (parent.includes('hand')) {
    return (
      child.includes('thumb') ||
      child.includes('index') ||
      child.includes('middle') ||
      child.includes('ring') ||
      child.includes('pinky')
    );
  }
  if (parent.includes('foot')) {
    return child.includes('toe') || child.endsWith('end');
  }
  if (parent.includes('head')) {
    return child.includes('head') || child.endsWith('end');
  }
  return false;
}

function collisionChildPriority(name: string): number {
  const normalized = normalizedBoneKey(name);
  if (
    normalized.includes('thumb') ||
    normalized.includes('index') ||
    normalized.includes('middle') ||
    normalized.includes('ring') ||
    normalized.includes('pinky')
  ) {
    return 3;
  }
  if (normalized.includes('toe') || normalized.endsWith('end')) {
    return 3;
  }
  if (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('hand') ||
    normalized.includes('upleg') ||
    normalized.includes('leg') ||
    normalized.includes('foot') ||
    normalized.includes('spine') ||
    normalized.includes('neck')
  ) {
    return 2;
  }
  return 1;
}

function segmentCountForBone(name: string): number {
  const normalized = normalizedBoneKey(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return 3;
  }
  if (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('upperleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg'
  ) {
    return 2;
  }
  return 1;
}

function isLimbBone(name: string): boolean {
  const normalized = normalizedBoneKey(name);
  return (
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('upperleg') ||
    normalized.includes('upleg') ||
    normalized === 'leftleg' ||
    normalized === 'rightleg'
  );
}

function clampFittedRadius(name: string, radius: number): number {
  const normalized = normalizedBoneKey(name);
  if (normalized.includes('spine') || normalized.includes('hips')) {
    return THREE.MathUtils.clamp(radius * 0.82, 0.04, 0.12);
  }
  if (normalized.includes('upperleg') || normalized.includes('upleg')) {
    return THREE.MathUtils.clamp(radius * 0.92, 0.035, 0.095);
  }
  if (normalized === 'leftleg' || normalized === 'rightleg') {
    return THREE.MathUtils.clamp(radius * 0.92, 0.025, 0.075);
  }
  if (normalized.includes('arm') || normalized.includes('shoulder')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.022, 0.068);
  }
  if (normalized.includes('forearm') || normalized.includes('hand')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.018, 0.052);
  }
  if (normalized.includes('neck') || normalized.includes('head')) {
    return THREE.MathUtils.clamp(radius * 0.9, 0.035, 0.11);
  }
  return THREE.MathUtils.clamp(radius * 0.9, 0.01, 0.04);
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const index = THREE.MathUtils.clamp((values.length - 1) * p, 0, values.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const t = index - low;
  return THREE.MathUtils.lerp(values[low]!, values[high]!, t);
}
