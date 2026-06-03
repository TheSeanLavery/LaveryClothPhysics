import * as THREE from 'three';

export function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

export function splitTrackName(trackName: string): { targetName: string; propertyPath: string } | null {
  const dot = trackName.indexOf('.');
  if (dot <= 0 || dot >= trackName.length - 1) {
    return null;
  }
  return {
    targetName: trackName.slice(0, dot),
    propertyPath: trackName.slice(dot + 1),
  };
}

export function retargetClipTracks(
  sourceClip: THREE.AnimationClip,
  animationRoot: THREE.Object3D,
  targetBones: readonly THREE.Bone[],
  fallbackName = 'Retargeted',
): THREE.AnimationClip {
  const targetBoneNamesByKey = new Map<string, string>();
  for (const bone of targetBones) {
    targetBoneNamesByKey.set(normalizeBoneName(bone.name), bone.name);
  }

  const sourceBoneNamesByKey = new Map<string, string>();
  animationRoot.traverse((object) => {
    if (object instanceof THREE.Bone) {
      sourceBoneNamesByKey.set(normalizeBoneName(object.name), object.name);
    }
  });

  const tracks = sourceClip.tracks.flatMap((track) => {
    const split = splitTrackName(track.name);
    if (!split || split.propertyPath !== 'quaternion') {
      return [];
    }
    const targetName = targetBoneNamesByKey.get(normalizeBoneName(split.targetName));
    if (!targetName) {
      return [];
    }
    const cloned = track.clone();
    cloned.name = `${targetName}.${split.propertyPath}`;
    return [cloned];
  });

  if (tracks.length === 0) {
    console.warn('No direct animation tracks matched target rig');
  }

  return new THREE.AnimationClip(sourceClip.name || fallbackName, sourceClip.duration, tracks);
}
