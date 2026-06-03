import profilesJson from './characterAnimationProfiles.json' with { type: 'json' };

const ANIMATION_BASE_PATH = '/assets/characters';

export type FsmStateId = 'tpose' | 'idle' | 'walk' | 'attack';

export type FsmTriggerId = 'start' | 'moveStart' | 'moveStop' | 'attack' | 'attackDone' | 'force';

export interface StateClipBinding {
  readonly name: string;
  readonly file?: string;
  readonly subclipId?: string;
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
    /** Radians added to atan2(dx, dz) for walk / movement (mesh bind vs world −Z). */
    readonly meshBindYaw: number;
    /** Extra radians while idle / look-at only (combat stance vs locomotion read). */
    readonly stanceYawOffset: number;
    /** @deprecated Use meshBindYaw — kept for saved duel JSON / localStorage. */
    readonly rootYawOffset?: number;
    readonly walkSpeed: number;
    readonly turnSpeed: number;
    readonly attackRange: number;
    readonly attackCooldownSeconds: number;
    readonly moveThreshold: number;
    /** Crossfade seconds when entering each FSM state (clip binding may override). */
    readonly clipFadeTpose?: number;
    readonly clipFadeIdle?: number;
    readonly clipFadeWalk?: number;
    readonly clipFadeAttack?: number;
  };
  readonly states: Record<FsmStateId, StateDefinition>;
  readonly transitions: readonly FsmTransitionDefinition[];
}

export interface CharacterAnimationProfileLibrary {
  readonly defaultProfileId: string;
  readonly profiles: Record<string, CharacterAnimationProfile>;
}

const STORAGE_PREFIX = 'character-animation-profile:';

/** meshy + Mixamo duel rig default (see npm run audit:mesh-bind). */
export const DEFAULT_MESH_BIND_YAW = -Math.PI / 2;

/** @deprecated Use DEFAULT_MESH_BIND_YAW */
export const DEFAULT_ROOT_YAW_OFFSET = DEFAULT_MESH_BIND_YAW;

export function resolveProfileFacingParameters(
  parameters: CharacterAnimationProfile['parameters'],
  base?: CharacterAnimationProfile['parameters'],
): CharacterAnimationProfile['parameters'] {
  const legacy = parameters.rootYawOffset ?? base?.rootYawOffset;
  const meshBindYaw =
    parameters.meshBindYaw
    ?? base?.meshBindYaw
    ?? legacy
    ?? DEFAULT_MESH_BIND_YAW;
  const stanceYawOffset = parameters.stanceYawOffset ?? base?.stanceYawOffset ?? 0;
  return { ...parameters, meshBindYaw, stanceYawOffset };
}

export function normalizeCharacterAnimationProfile(
  profile: CharacterAnimationProfile,
): CharacterAnimationProfile {
  const library = loadProfileLibrary();
  const base = library.profiles[profile.id] ?? library.profiles[library.defaultProfileId];
  return {
    ...profile,
    parameters: resolveProfileFacingParameters(
      { ...base?.parameters, ...profile.parameters },
      base?.parameters,
    ),
  };
}

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
  const merged = stored ? mergeProfile(base, stored) : cloneProfile(base);
  return normalizeCharacterAnimationProfile(merged);
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
  if (binding.subclipId) {
    return `subclip:${binding.subclipId}`;
  }
  if (!binding.file) {
    throw new Error('Clip binding requires file or subclipId');
  }
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

const DEFAULT_CLIP_FADE: Record<FsmStateId, number> = {
  tpose: 0.4,
  idle: 0.55,
  walk: 0.5,
  attack: 0.32,
};

export function resolveClipFadeDuration(
  profile: CharacterAnimationProfile,
  stateId: FsmStateId,
  binding: StateClipBinding,
): number {
  if (binding.fadeIn !== undefined) {
    return binding.fadeIn;
  }
  const params = profile.parameters;
  const fromProfile = stateId === 'tpose'
    ? params.clipFadeTpose
    : stateId === 'idle'
      ? params.clipFadeIdle
      : stateId === 'walk'
        ? params.clipFadeWalk
        : params.clipFadeAttack;
  return fromProfile ?? DEFAULT_CLIP_FADE[stateId];
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
