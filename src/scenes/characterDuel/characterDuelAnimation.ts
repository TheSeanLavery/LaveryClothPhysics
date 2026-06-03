import bundledSetup from '../../../data/characterDuelAnimation.json' with { type: 'json' };
import {
  getProfile,
  normalizeCharacterAnimationProfile,
  type CharacterAnimationProfile,
} from '../../animations/characterAnimationProfile.ts';
export interface CharacterDuelFighterSetup {
  readonly profile: CharacterAnimationProfile;
}

export interface CharacterDuelAnimationSetup {
  readonly version: number;
  readonly fighterA: CharacterDuelFighterSetup;
  readonly fighterB: CharacterDuelFighterSetup;
}

function normalizeDuelSetup(setup: CharacterDuelAnimationSetup): CharacterDuelAnimationSetup {
  return {
    ...setup,
    fighterA: { profile: normalizeCharacterAnimationProfile(setup.fighterA.profile) },
    fighterB: { profile: normalizeCharacterAnimationProfile(setup.fighterB.profile) },
  };
}

let activeSetup: CharacterDuelAnimationSetup = normalizeDuelSetup(
  bundledSetup as CharacterDuelAnimationSetup,
);

export function getDefaultCharacterDuelAnimationSetup(): CharacterDuelAnimationSetup {
  return {
    version: 1,
    fighterA: { profile: getProfile('duel-fighter') },
    fighterB: { profile: getProfile('duel-brawler') },
  };
}

export function getCharacterDuelAnimationSetup(): CharacterDuelAnimationSetup {
  return activeSetup;
}

export function buildCharacterDuelAnimationSetup(
  fighterA: CharacterAnimationProfile,
  fighterB: CharacterAnimationProfile,
): CharacterDuelAnimationSetup {
  return {
    version: 1,
    fighterA: { profile: structuredClone(fighterA) },
    fighterB: { profile: structuredClone(fighterB) },
  };
}

export async function refreshCharacterDuelAnimationFromServer(): Promise<CharacterDuelAnimationSetup> {
  try {
    const response = await fetch('/__character-duel/animation');
    if (!response.ok) {
      return activeSetup;
    }
    const parsed = (await response.json()) as CharacterDuelAnimationSetup;
    if (parsed?.fighterA?.profile && parsed?.fighterB?.profile) {
      activeSetup = normalizeDuelSetup(parsed);
    }
    return activeSetup;
  } catch {
    return activeSetup;
  }
}

export async function saveCharacterDuelAnimationSetup(
  setup: CharacterDuelAnimationSetup,
): Promise<void> {
  const response = await fetch('/__character-duel/animation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(setup),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Failed to save duel animation setup (${response.status})`);
  }
  activeSetup = setup;
}

export function setCharacterDuelAnimationSetupForTests(setup: CharacterDuelAnimationSetup): void {
  activeSetup = setup;
}
