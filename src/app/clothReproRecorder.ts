export type ClothReproEvent =
  | ClothReproPointerEvent
  | ClothReproActionEvent
  | ClothReproNoteEvent;

export interface ClothReproPointerEvent {
  readonly type: 'pointer';
  readonly phase: 'move' | 'down' | 'up' | 'cancel' | 'leave';
  readonly t: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface ClothReproActionEvent {
  readonly type: 'action';
  readonly name: string;
  readonly t: number;
  readonly details?: Record<string, unknown>;
}

export interface ClothReproNoteEvent {
  readonly type: 'note';
  readonly t: number;
  readonly message: string;
}

export interface ClothReproRecording {
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
  readonly startState: Record<string, unknown>;
  readonly finalState: Record<string, unknown>;
  readonly events: readonly ClothReproEvent[];
}

export interface ClothReproSaveResult {
  readonly ok: boolean;
  readonly downloaded: boolean;
  readonly latestPath?: string;
  readonly savedPath?: string;
  readonly error?: string;
}

export interface ClothReproRecorder {
  readonly isRecording: () => boolean;
  readonly start: () => Promise<void>;
  readonly stopAndSave: () => Promise<ClothReproSaveResult>;
  readonly recordPointer: (phase: ClothReproPointerEvent['phase'], event: PointerEvent) => void;
  readonly recordAction: (name: string, details?: Record<string, unknown>) => void;
  readonly recordNote: (message: string) => void;
}

export interface ClothReproRecorderOptions {
  readonly canvas: HTMLCanvasElement;
  readonly kind: string;
  readonly saveEndpoint: string;
  readonly downloadFilenamePrefix: string;
  readonly captureState: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function createClothReproRecorder(options: ClothReproRecorderOptions): ClothReproRecorder {
  let recording = false;
  let startTime = 0;
  let startState: Record<string, unknown> = {};
  let events: ClothReproEvent[] = [];

  const relativeTime = (): number => Math.round((performance.now() - startTime) * 1000) / 1000;

  const buildRecording = async (): Promise<ClothReproRecording> => ({
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
    startState,
    finalState: await options.captureState(),
    events,
  });

  const downloadRecording = (recordingData: ClothReproRecording): void => {
    const blob = new Blob([`${JSON.stringify(recordingData, null, 2)}\n`], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${options.downloadFilenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const saveRecording = async (recordingData: ClothReproRecording): Promise<ClothReproSaveResult> => {
    try {
      const response = await fetch(options.saveEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(recordingData),
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
      downloadRecording(recordingData);
      return {
        ok: false,
        downloaded: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    isRecording: () => recording,
    start: async () => {
      recording = true;
      startTime = performance.now();
      startState = await options.captureState();
      events = [{
        type: 'action',
        name: 'record-start',
        t: 0,
      }];
    },
    stopAndSave: async () => {
      if (!recording) {
        return { ok: false, downloaded: false, error: 'Recorder is not active' };
      }
      events.push({
        type: 'action',
        name: 'record-stop',
        t: relativeTime(),
      });
      const recordingData = await buildRecording();
      recording = false;
      return saveRecording(recordingData);
    },
    recordPointer: (phase, event) => {
      if (!recording) {
        return;
      }
      const rect = options.canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;
      events.push({
        type: 'pointer',
        phase,
        t: relativeTime(),
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        canvasX,
        canvasY,
        ndcX: rect.width > 0 ? (canvasX / rect.width) * 2 - 1 : 0,
        ndcY: rect.height > 0 ? -(canvasY / rect.height) * 2 + 1 : 0,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      });
    },
    recordAction: (name, details) => {
      if (!recording) {
        return;
      }
      events.push({
        type: 'action',
        name,
        t: relativeTime(),
        details,
      });
    },
    recordNote: (message) => {
      if (!recording) {
        return;
      }
      events.push({
        type: 'note',
        t: relativeTime(),
        message,
      });
    },
  };
}
