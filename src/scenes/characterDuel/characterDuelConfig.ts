import {
  MIXAMO_DANCING_TWERK_URL,
  MIXAMO_IDLE_URL,
  MIXAMO_TPOSE_URL,
  VISIBLE_CHARACTER_MODEL_URL,
} from '../../character/AnimatedCharacter.ts';
import { DEFAULT_CHARACTER_T_SHIRT_OPTIONS } from '../../character/shirtDressing.ts';

export type DuelControlMode = 'pvp' | 'ai-ai';

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
  shirtOptions: { ...DEFAULT_CHARACTER_T_SHIRT_OPTIONS },
  cloth: {
    gravity: 0.000025,
    clothThickness: 0.003,
    selfCollision: true,
    mannequinCollision: false,
    tearStretchThreshold: 999,
  },
} as const;
