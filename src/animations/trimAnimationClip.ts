import * as THREE from 'three';

export interface TrimAnimationClipOptions {
  readonly name: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly fps?: number;
}

function cloneTrackInRange(track: THREE.KeyframeTrack, startSec: number, endSec: number): THREE.KeyframeTrack | null {
  const valueSize = track.getValueSize();
  const times: number[] = [];
  const values: number[] = [];

  for (let index = 0; index < track.times.length; index += 1) {
    const time = track.times[index]!;
    if (time < startSec || time > endSec) {
      continue;
    }
    times.push(time - startSec);
    const offset = index * valueSize;
    for (let component = 0; component < valueSize; component += 1) {
      values.push(track.values[offset + component]!);
    }
  }

  if (times.length === 0) {
    return null;
  }

  const TrackCtor = track.constructor as new (
    name: string,
    times: number[],
    values: number[],
  ) => THREE.KeyframeTrack;
  return new TrackCtor(track.name, times, values);
}

export function trimAnimationClip(
  source: THREE.AnimationClip,
  options: TrimAnimationClipOptions,
): THREE.AnimationClip {
  const startSec = Math.max(0, options.startSec);
  const endSec = Math.max(startSec + 1 / (options.fps ?? 30), options.endSec);
  const trimmedTracks = source.tracks
    .map((track) => cloneTrackInRange(track, startSec, endSec))
    .filter((track): track is THREE.KeyframeTrack => track !== null);

  if (trimmedTracks.length === 0) {
    return THREE.AnimationUtils.subclip(
      source,
      options.name,
      Math.floor(startSec * (options.fps ?? 30)),
      Math.ceil(endSec * (options.fps ?? 30)),
      options.fps ?? 30,
    );
  }

  return new THREE.AnimationClip(options.name, endSec - startSec, trimmedTracks);
}

export function subclipCacheKey(subclipId: string): string {
  return `subclip:${subclipId}`;
}
