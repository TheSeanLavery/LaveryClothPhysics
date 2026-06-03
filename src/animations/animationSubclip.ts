import bundledLibrary from '../../data/animationSubclips.json' with { type: 'json' };
import type { StateClipBinding } from './characterAnimationProfile.ts';

export interface AnimationSubclipDefinition {
  readonly label: string;
  readonly sourceFile: string;
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
  readonly fps: number;
  /** Crossfade last N seconds of the trim toward the start pose (smoother loop seam). */
  readonly loopBlendSec?: number;
}

export interface AnimationSubclipLibrary {
  readonly version: number;
  readonly subclips: Record<string, AnimationSubclipDefinition>;
}

let activeLibrary: AnimationSubclipLibrary = bundledLibrary as AnimationSubclipLibrary;

export function getSubclipLibrary(): AnimationSubclipLibrary {
  return activeLibrary;
}

export function getSubclip(subclipId: string): AnimationSubclipDefinition {
  const subclip = activeLibrary.subclips[subclipId];
  if (!subclip) {
    throw new Error(`Unknown animation subclip: ${subclipId}`);
  }
  return subclip;
}

export function listSubclips(): { readonly id: string; readonly definition: AnimationSubclipDefinition }[] {
  return Object.entries(activeLibrary.subclips).map(([id, definition]) => ({ id, definition }));
}

export function listSubclipsForSource(sourceFile: string): { readonly id: string; readonly definition: AnimationSubclipDefinition }[] {
  return listSubclips().filter((entry) => entry.definition.sourceFile === sourceFile);
}

export function bindingFromSubclip(subclipId: string): StateClipBinding {
  const subclip = getSubclip(subclipId);
  return {
    name: subclip.label,
    subclipId,
    file: subclip.sourceFile,
    loop: subclip.loop,
    fadeIn: subclip.loop ? 0.5 : 0.32,
  };
}

export function resolveBindingCacheKey(binding: StateClipBinding): string {
  if (binding.subclipId) {
    return `subclip:${binding.subclipId}`;
  }
  if (!binding.file) {
    throw new Error('Clip binding requires file or subclipId');
  }
  return `/assets/characters/${binding.file}`;
}

export function normalizeSubclipId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'subclip';
}

export async function refreshSubclipLibraryFromServer(): Promise<AnimationSubclipLibrary> {
  try {
    const response = await fetch('/__animations/subclips');
    if (!response.ok) {
      return activeLibrary;
    }
    activeLibrary = (await response.json()) as AnimationSubclipLibrary;
    return activeLibrary;
  } catch {
    return activeLibrary;
  }
}

export async function saveSubclipLibraryToServer(library: AnimationSubclipLibrary): Promise<void> {
  const response = await fetch('/__animations/subclips', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(library),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Failed to save subclips (${response.status})`);
  }
  activeLibrary = library;
}

export async function upsertSubclip(
  subclipId: string,
  definition: AnimationSubclipDefinition,
): Promise<AnimationSubclipLibrary> {
  const library: AnimationSubclipLibrary = {
    version: 1,
    subclips: {
      ...activeLibrary.subclips,
      [subclipId]: definition,
    },
  };
  await saveSubclipLibraryToServer(library);
  return library;
}

export async function deleteSubclip(subclipId: string): Promise<AnimationSubclipLibrary> {
  const next = { ...activeLibrary.subclips };
  delete next[subclipId];
  const library: AnimationSubclipLibrary = { version: 1, subclips: next };
  await saveSubclipLibraryToServer(library);
  return library;
}

export function setSubclipLibraryForTests(library: AnimationSubclipLibrary): void {
  activeLibrary = library;
}
