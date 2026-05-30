import type { InextensibleFlagSettings } from '../sim/InextensibleFlagSettings';

const DB_NAME = 'lavery-cloth-physics';
const DB_VERSION = 1;
const STORE_NAME = 'settings-presets';

export interface StoredFlagSettingsPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: InextensibleFlagSettings;
}

export interface FlagSettingsPresetSummary {
  id: string;
  name: string;
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('byName', 'name', { unique: false });
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open settings database'));
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

        request.onerror = () => {
          reject(request.error ?? new Error('Settings database request failed'));
        };

        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };

        tx.onerror = () => {
          reject(tx.error ?? new Error('Settings database transaction failed'));
        };

        tx.onabort = () => {
          reject(tx.error ?? new Error('Settings database transaction aborted'));
        };
      }),
  );
}

export async function listFlagSettingsPresets(): Promise<FlagSettingsPresetSummary[]> {
  const presets = await runTransaction<StoredFlagSettingsPreset[]>('readonly', (store) => store.getAll());
  return presets
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      updatedAt: preset.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getFlagSettingsPreset(id: string): Promise<StoredFlagSettingsPreset | null> {
  const preset = await runTransaction<StoredFlagSettingsPreset | undefined>('readonly', (store) =>
    store.get(id),
  );
  return preset ?? null;
}

export async function saveFlagSettingsPreset(
  name: string,
  settings: InextensibleFlagSettings,
  existingId?: string,
): Promise<StoredFlagSettingsPreset> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Preset name is required');
  }

  const now = Date.now();
  const existing = existingId ? await getFlagSettingsPreset(existingId) : null;
  if (existingId && !existing) {
    throw new Error('Preset not found');
  }

  const preset: StoredFlagSettingsPreset = existing
    ? {
        ...existing,
        name: trimmedName,
        updatedAt: now,
        settings: structuredClone(settings),
      }
    : {
        id: crypto.randomUUID(),
        name: trimmedName,
        createdAt: now,
        updatedAt: now,
        settings: structuredClone(settings),
      };

  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(preset));
  return preset;
}

export async function deleteFlagSettingsPreset(id: string): Promise<void> {
  if (!id) {
    return;
  }
  await runTransaction<undefined>('readwrite', (store) => store.delete(id));
}
