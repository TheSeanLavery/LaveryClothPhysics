import {
  defaultInextensibleFlagSettings,
  type InextensibleFlagSettings,
} from './InextensibleFlagSettings';

export function cloneFlagSettings(settings: InextensibleFlagSettings): InextensibleFlagSettings {
  return structuredClone(settings);
}

export function normalizeFlagSettings(
  partial: Partial<InextensibleFlagSettings> | InextensibleFlagSettings,
): InextensibleFlagSettings {
  return {
    ...defaultInextensibleFlagSettings(),
    ...partial,
  };
}

/** Alias used by cloth entry points and scene bootstraps. */
export const normalizeClothSettings = normalizeFlagSettings;
