import {
  createGarmentPresetEnvelope,
  upgradeGarmentPreset,
  type GarmentPresetEnvelope,
  type GarmentType,
  type GarmentGeneratorParamsByType,
} from '../garments/garmentSchema';

const DB_NAME = 'lavery-garment-generator';
const DB_VERSION = 1;
const STORE_NAME = 'garment-presets';

export interface GarmentPresetSummary {
  readonly id: string;
  readonly name: string;
  readonly garmentType: GarmentType;
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
        store.createIndex('byName', 'name', { unique: false });
        store.createIndex('byGarmentType', 'garmentType', { unique: false });
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open garment preset database'));
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
        request.onerror = () => reject(request.error ?? new Error('Garment preset request failed'));
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => reject(tx.error ?? new Error('Garment preset transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('Garment preset transaction aborted'));
      }),
  );
}

export async function listGarmentPresets(): Promise<GarmentPresetSummary[]> {
  const presets = await runTransaction<unknown[]>('readonly', (store) => store.getAll());
  return presets
    .map((raw) => upgradeGarmentPreset(raw))
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      garmentType: preset.garmentType,
      schemaVersion: preset.schemaVersion,
      updatedAt: preset.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGarmentPreset(id: string): Promise<GarmentPresetEnvelope | null> {
  const raw = await runTransaction<unknown | undefined>('readonly', (store) => store.get(id));
  return raw ? upgradeGarmentPreset(raw) : null;
}

export async function saveGarmentPreset<T extends GarmentType>(
  name: string,
  garmentType: T,
  params: Partial<GarmentGeneratorParamsByType[T]>,
  existingId?: string,
): Promise<GarmentPresetEnvelope> {
  const existing = existingId ? await getGarmentPreset(existingId) : null;
  if (existingId && !existing) {
    throw new Error('Garment preset not found');
  }

  const preset = createGarmentPresetEnvelope(name, garmentType, params, existing ?? undefined);
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(preset));
  return preset;
}

export async function importGarmentPreset(raw: unknown): Promise<GarmentPresetEnvelope> {
  const preset = upgradeGarmentPreset(raw);
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(preset));
  return preset;
}

export async function deleteGarmentPreset(id: string): Promise<void> {
  if (!id) {
    return;
  }
  await runTransaction<undefined>('readwrite', (store) => store.delete(id));
}
