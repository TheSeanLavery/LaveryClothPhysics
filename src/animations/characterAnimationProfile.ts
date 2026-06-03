import profilesJson from './characterAnimationProfiles.json' with { type: 'json' };

const ANIMATION_BASE_PATH = '/assets/characters';

export type FsmStateId = 'tpose' | 'idle' | 'walk' | 'attack';

export type FsmTriggerId = 'start' | 'moveStart' | 'moveStop' | 'attack' | 'attackDone' | 'force';

export interface StateClipBinding {
  readonly name: string;
  readonly file: string;
  readonly loop: boolean;
  readonly fadeIn?: number;
}

export interface StateDefinition {
  readonly label: string;
  readonly clips: readonly StateClipBinding[];
  readonly pick?: 'first' | 'random';
  readonly graph?: { readonly x: number; readonly y: number };
}

export interface FsmTransitionDefinition {
  readonly from: FsmStateId | '*';
  readonly to: FsmStateId;
  readonly trigger: FsmTriggerId;
  readonly label?: string;
}

export interface CharacterAnimationProfile {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly parameters: {
    readonly walkSpeed: number;
    readonly turnSpeed: number;
    readonly attackRange: number;
    readonly attackCooldownSeconds: number;
    readonly moveThreshold: number;
  };
  readonly states: Record<FsmStateId, StateDefinition>;
  readonly transitions: readonly FsmTransitionDefinition[];
}

export interface CharacterAnimationProfileLibrary {
  readonly defaultProfileId: string;
  readonly profiles: Record<string, CharacterAnimationProfile>;
}

const STORAGE_PREFIX = 'character-animation-profile:';

export function loadProfileLibrary(): CharacterAnimationProfileLibrary {
  return profilesJson as CharacterAnimationProfileLibrary;
}

export function getProfile(profileId: string): CharacterAnimationProfile {
  const library = loadProfileLibrary();
  const stored = readStoredProfileOverrides(profileId);
  const base = library.profiles[profileId];
  if (!base) {
    throw new Error(`Unknown character animation profile: ${profileId}`);
  }
  return stored ? mergeProfile(base, stored) : cloneProfile(base);
}

export function listProfileSummaries(): { readonly id: string; readonly label: string }[] {
  const library = loadProfileLibrary();
  return Object.values(library.profiles).map((profile) => ({
    id: profile.id,
    label: profile.label,
  }));
}

export function getDefaultProfileId(): string {
  return loadProfileLibrary().defaultProfileId;
}

export function resolveClipUrl(binding: StateClipBinding): string {
  return `${ANIMATION_BASE_PATH}/${binding.file}`;
}

export function saveProfileOverrides(profile: CharacterAnimationProfile): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(`${STORAGE_PREFIX}${profile.id}`, JSON.stringify(profile));
}

export function clearProfileOverrides(profileId: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.removeItem(`${STORAGE_PREFIX}${profileId}`);
}

function readStoredProfileOverrides(profileId: string): CharacterAnimationProfile | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${profileId}`);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as CharacterAnimationProfile;
  } catch {
    return null;
  }
}

function cloneProfile(profile: CharacterAnimationProfile): CharacterAnimationProfile {
  return structuredClone(profile);
}

function mergeProfile(
  base: CharacterAnimationProfile,
  overrides: CharacterAnimationProfile,
): CharacterAnimationProfile {
  return {
    ...base,
    ...overrides,
    parameters: { ...base.parameters, ...overrides.parameters },
    states: { ...base.states, ...overrides.states },
    transitions: overrides.transitions.length > 0 ? overrides.transitions : base.transitions,
  };
}

export function updateStatePrimaryClip(
  profile: CharacterAnimationProfile,
  stateId: FsmStateId,
  binding: StateClipBinding,
): CharacterAnimationProfile {
  const state = profile.states[stateId];
  const nextClips = [...state.clips];
  if (nextClips.length === 0) {
    nextClips.push(binding);
  } else {
    nextClips[0] = binding;
  }
  return {
    ...profile,
    states: {
      ...profile.states,
      [stateId]: { ...state, clips: nextClips },
    },
  };
}
