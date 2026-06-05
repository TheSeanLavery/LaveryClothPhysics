import myPresetEnvelope from '../animations/my-preset.json' with { type: 'json' };
import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings.ts';
import { normalizeFlagSettings } from '../sim/settingsPreset.ts';

export const MY_PRESET_JSON_PATH = 'src/animations/my-preset.json';

export interface MyPresetEnvelope {
  readonly type: string;
  readonly version: number;
  readonly preset: {
    readonly name: string;
    readonly settings: Partial<InextensibleFlagSettings>;
  };
}

const envelope = myPresetEnvelope as MyPresetEnvelope;

/** Physics/render settings from {@link MY_PRESET_JSON_PATH}. */
export function getMyPresetSettings(): InextensibleFlagSettings {
  return normalizeFlagSettings(envelope.preset.settings);
}

/**
 * Apply my-preset to character cloth. Grid segment counts from the JSON are not used
 * (garment assembly defines topology); mannequin SDF stays off because the character
 * uses bone SDF collision instead.
 */
export function applyMyPresetToCharacterCloth(
  settings: InextensibleFlagSettings,
): InextensibleFlagSettings {
  const preset = getMyPresetSettings();
  return normalizeFlagSettings({
    ...preset,
    segmentsX: 49,
    segmentsY: 36,
    mannequinCollision: false,
    showMannequin: false,
    poleCollision: false,
    windStrength: 0,
    windTurbulence: 0,
    zoneAStrength: 0,
    zoneBStrength: 0,
    shapePressure: 0,
    mannequinFriction: settings.mannequinFriction,
  });
}

export function getMyPresetDisplayName(): string {
  return envelope.preset.name ?? 'My preset';
}
