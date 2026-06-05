import {
  MIXAMO_DANCING_TWERK_URL,
  MIXAMO_IDLE_URL,
  MIXAMO_TPOSE_URL,
  VISIBLE_CHARACTER_MODEL_URL,
} from '../../character/AnimatedCharacter.ts';
import { DEFAULT_CHARACTER_T_SHIRT_OPTIONS } from '../../character/shirtDressing.ts';
import type { CharacterAnimationProfile } from '../../animations/characterAnimationProfile.ts';

export type DuelControlMode = 'pvp' | 'ai-ai';

export function applyDuelCombatProfile(profile: CharacterAnimationProfile): CharacterAnimationProfile {
  const combat = CHARACTER_DUEL_CONFIG.combat;
  return {
    ...profile,
    parameters: {
      ...profile.parameters,
      attackRange: combat.attackRange,
      attackEngageFactor: combat.attackEngageFactor,
      attackMinSeparation: combat.attackMinSeparation,
      attackStrikeDistance: combat.attackStrikeDistance,
      attackStepMeters: combat.attackStepMeters,
      attackLungeSpeed: combat.attackLungeSpeed,
    },
  };
}

/** Framed on fighters (torso height); applied before first boot render. */
export const DUEL_CAMERA = {
  position: [0, 1.05, 5.2] as const,
  target: [0, 0.95, 0] as const,
};

export const CHARACTER_DUEL_CONFIG = {
  assetUrl: VISIBLE_CHARACTER_MODEL_URL,
  tposeAnimationUrl: MIXAMO_TPOSE_URL,
  idleAnimationUrl: MIXAMO_IDLE_URL,
  danceAnimationUrl: MIXAMO_DANCING_TWERK_URL,
  spawnSeparation: 2.4,
  arenaRadius: 4.5,
  /**
   * AI melee tuning (applied over animation profile params in duel).
   * attackRange is root-to-root “close enough to strike” for in-place Mixamo attacks (~0.7 m).
   */
  combat: {
    attackRange: 0.78,
    attackEngageFactor: 1.0,
    /** Ideal root spacing when trading hits (stop lunge / step here). */
    attackStrikeDistance: 0.58,
    attackMinSeparation: 0.5,
    attackStepMeters: 0.1,
    attackLungeSpeed: 1.1,
  },
  shirtOptions: { ...DEFAULT_CHARACTER_T_SHIRT_OPTIONS },
  healthDisplay: {
    /** Display 0 when less than this fraction of dress-time cloth remains (12% broken). */
    zeroBelowRemainingRatio: 0.88,
    maxTearPenalty: 0.12,
    autoRematch: true,
    /** Seconds a fighter must stay at 0 HP before auto reset. */
    roundEndHoldSec: 0.6,
  },
  cloth: {
    gravity: 0.000025,
    clothThickness: 0.003,
    selfCollision: true,
    mannequinCollision: false,
    tearStretchThreshold: 4,
  },
} as const;
