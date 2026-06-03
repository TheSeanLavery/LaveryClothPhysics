import {
  upgradeCharacterSdfPreset,
  type CharacterSdfPresetEnvelope,
} from './characterSdfSchema';

const DB_NAME = 'lavery-character-sdf';
const DB_VERSION = 1;
const STORE_NAME = 'character-sdf-presets';

export interface CharacterSdfPresetSummary {
  readonly id: string;
  readonly name: string;
  readonly characterId: string;
  readonly assetUrl: string;
  readonly schemaVersion: number;
  readonly updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('byCharacterId', 'characterId', { unique: false });
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open character SDF preset database'));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = run(store);
        let result!: T;
        request.onsuccess = () => {
          result = request.result as T;
        };
        request.onerror = () => reject(request.error ?? new Error('Character SDF preset request failed'));
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => reject(tx.error ?? new Error('Character SDF preset transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Character SDF preset transaction aborted'));
      }),
  );
}

export async function listCharacterSdfPresets(): Promise<CharacterSdfPresetSummary[]> {
  const presets = await runTransaction<unknown[]>('readonly', (store) => store.getAll());
  return presets
    .map((raw) => upgradeCharacterSdfPreset(raw))
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      characterId: preset.characterId,
      assetUrl: preset.assetUrl,
      schemaVersion: preset.schemaVersion,
      updatedAt: preset.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCharacterSdfPreset(id: string): Promise<CharacterSdfPresetEnvelope | null> {
  const raw = await runTransaction<unknown | undefined>('readonly', (store) => store.get(id));
  return raw ? upgradeCharacterSdfPreset(raw) : null;
}

export async function saveCharacterSdfPreset(preset: CharacterSdfPresetEnvelope): Promise<CharacterSdfPresetEnvelope> {
  const upgraded = upgradeCharacterSdfPreset({ ...preset, updatedAt: Date.now() });
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(upgraded));
  return upgraded;
}

export async function importCharacterSdfPreset(raw: unknown): Promise<CharacterSdfPresetEnvelope> {
  const preset = upgradeCharacterSdfPreset(raw);
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(preset));
  return preset;
}

export async function deleteCharacterSdfPreset(id: string): Promise<void> {
  if (!id) {
    return;
  }
  await runTransaction<undefined>('readwrite', (store) => store.delete(id));
}
