import type { FloatingIslandResult } from '../dev/floatingClothIslands.ts';

export interface ClothSnapshotSaveResult {
  readonly ok: boolean;
  readonly downloaded: boolean;
  readonly latestPath?: string;
  readonly savedPath?: string;
  readonly error?: string;
}

export interface ClothVisualSnapshot {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly createdAt: string;
  readonly url: string;
  readonly userAgent: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  readonly canvas: {
    readonly width: number;
    readonly height: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
  };
  readonly state: Record<string, unknown>;
  readonly audits: Record<string, unknown>;
  readonly screenshot: {
    readonly width: number;
    readonly height: number;
    readonly pngBase64: string;
  } | null;
  readonly floatingIslands: FloatingIslandResult | null;
}

export interface ClothSnapshotSaverOptions {
  readonly canvas: HTMLCanvasElement;
  readonly kind: string;
  readonly saveEndpoint: string;
  readonly downloadFilenamePrefix: string;
  readonly captureSnapshot: () => Promise<Omit<ClothVisualSnapshot, 'schemaVersion' | 'kind' | 'createdAt' | 'url' | 'userAgent' | 'viewport' | 'canvas'>>;
}

export async function saveClothSnapshot(
  snapshot: ClothVisualSnapshot,
  options: Pick<ClothSnapshotSaverOptions, 'saveEndpoint' | 'downloadFilenamePrefix'>,
): Promise<ClothSnapshotSaveResult> {
  try {
    const response = await fetch(options.saveEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) {
      throw new Error(`Save failed with HTTP ${response.status}`);
    }
    const result = await response.json() as {
      ok?: boolean;
      latestPath?: string;
      savedPath?: string;
      error?: string;
    };
    if (!result.ok) {
      throw new Error(result.error ?? 'Save endpoint returned ok=false');
    }
    return {
      ok: true,
      downloaded: false,
      latestPath: result.latestPath,
      savedPath: result.savedPath,
    };
  } catch (error) {
    const blob = new Blob([`${JSON.stringify(snapshot, null, 2)}\n`], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${options.downloadFilenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    return {
      ok: false,
      downloaded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createClothSnapshotDocument(
  options: ClothSnapshotSaverOptions,
  payload: Awaited<ReturnType<ClothSnapshotSaverOptions['captureSnapshot']>>,
): ClothVisualSnapshot {
  return {
    schemaVersion: 1,
    kind: options.kind,
    createdAt: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    canvas: {
      width: options.canvas.width,
      height: options.canvas.height,
      clientWidth: options.canvas.clientWidth,
      clientHeight: options.canvas.clientHeight,
    },
    ...payload,
  };
}
