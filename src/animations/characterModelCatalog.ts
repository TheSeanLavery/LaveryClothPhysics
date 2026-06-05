import catalogJson from './characterModelCatalog.json' with { type: 'json' };

export interface CharacterModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly source: string;
  readonly tags?: readonly string[];
}

export interface CharacterModelCatalog {
  readonly defaultModelId: string;
  readonly basePath: string;
  readonly models: Record<string, CharacterModelDefinition>;
}

const catalog = catalogJson as CharacterModelCatalog;

export function getCharacterModelCatalog(): CharacterModelCatalog {
  return catalog;
}

export function getDefaultCharacterModelId(): string {
  return catalog.defaultModelId;
}

export function listCharacterModels(): readonly CharacterModelDefinition[] {
  return Object.values(catalog.models).sort((left, right) => left.label.localeCompare(right.label));
}

export function getCharacterModel(modelId: string): CharacterModelDefinition | null {
  return catalog.models[modelId] ?? null;
}

/** Accept catalog ids or human labels (lil-gui dropdown stores values, not keys). */
export function normalizeCharacterModelId(modelIdOrLabel: string): string {
  const trimmed = modelIdOrLabel.trim();
  if (!trimmed) {
    throw new Error('Unknown character model id: (empty)');
  }
  if (getCharacterModel(trimmed)) {
    return trimmed;
  }
  const byLabel = listCharacterModels().find((model) => model.label === trimmed);
  if (byLabel) {
    return byLabel.id;
  }
  throw new Error(`Unknown character model id: ${trimmed}`);
}

export function resolveCharacterModelUrl(modelId: string): string {
  const resolvedId = normalizeCharacterModelId(modelId);
  const model = getCharacterModel(resolvedId);
  if (!model) {
    throw new Error(`Unknown character model id: ${modelId}`);
  }
  return `${catalog.basePath}/${model.file}`;
}

export function makeCharacterModelOptions(
  models: readonly CharacterModelDefinition[] = listCharacterModels(),
): Record<string, string> {
  const options: Record<string, string> = {};
  for (const model of models) {
    // lil-gui option dropdown: keys = display labels, values = stored property value.
    options[model.label] = model.id;
  }
  return options;
}
