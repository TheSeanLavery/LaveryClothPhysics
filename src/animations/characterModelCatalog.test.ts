import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getCharacterModel,
  getDefaultCharacterModelId,
  listCharacterModels,
  makeCharacterModelOptions,
  normalizeCharacterModelId,
  resolveCharacterModelUrl,
} from './characterModelCatalog.ts';

describe('characterModelCatalog', () => {
  it('lists meshy-rigged models from the catalog', () => {
    const models = listCharacterModels();
    assert.ok(models.length >= 7);
    assert.ok(models.some((model) => model.id === 'crimson-aegis'));
    assert.ok(models.some((model) => model.id === 'astra-vanguard'));
  });

  it('resolves catalog ids to public asset URLs', () => {
    assert.equal(
      resolveCharacterModelUrl('crimson-aegis'),
      '/assets/characters/meshy-rigged/crimson-aegis.fbx',
    );
    assert.equal(
      resolveCharacterModelUrl(getDefaultCharacterModelId()),
      '/assets/characters/meshy/blue-haired-anime-girl.fbx',
    );
  });

  it('returns null for unknown model ids', () => {
    assert.equal(getCharacterModel('missing-model'), null);
  });

  it('stores catalog ids in lil-gui option values', () => {
    const options = makeCharacterModelOptions();
    assert.equal(options['Crimson Aegis'], 'crimson-aegis');
    assert.equal(options['Astra Vanguard'], 'astra-vanguard');
  });

  it('normalizes human labels back to catalog ids', () => {
    assert.equal(normalizeCharacterModelId('Crimson Aegis'), 'crimson-aegis');
    assert.equal(normalizeCharacterModelId('crimson-aegis'), 'crimson-aegis');
  });
});
