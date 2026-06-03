import './animationClipEditor.css';
import * as THREE from 'three';
import { CharacterAnimationPlayer } from '../CharacterAnimationPlayer.ts';
import {
  bindingFromSubclip,
  deleteSubclip,
  listSubclipsForSource,
  normalizeSubclipId,
  refreshSubclipLibraryFromServer,
  upsertSubclip,
  type AnimationSubclipDefinition,
} from '../animationSubclip.ts';

export interface AnimationClipEditorTarget {
  readonly label?: string;
  getMixer(): THREE.AnimationMixer | null;
  getLoadedRoot(): THREE.Object3D | null;
  getBones(): readonly THREE.Bone[];
  getSourceFile(): string | null;
  setSourceFile?(file: string): void;
}

export interface AnimationClipEditorPanelOptions {
  readonly target: AnimationClipEditorTarget;
  readonly testId?: string;
  readonly onLibraryChanged?: () => void;
}

export interface AnimationClipEditorPanel {
  readonly element: HTMLElement;
  refresh(): void;
  dispose(): void;
}

export function createAnimationClipEditorPanel(
  options: AnimationClipEditorPanelOptions,
): AnimationClipEditorPanel {
  const root = document.createElement('section');
  root.className = 'animation-clip-editor';
  root.dataset.testid = options.testId ?? 'animation-clip-editor';

  const header = document.createElement('div');
  header.className = 'animation-clip-editor__header';
  const title = document.createElement('div');
  title.className = 'animation-clip-editor__title';
  title.textContent = 'Clip Editor';
  header.append(title);

  const body = document.createElement('div');
  body.className = 'animation-clip-editor__body';

  const sourceMeta = document.createElement('div');
  sourceMeta.className = 'animation-clip-editor__meta';
  sourceMeta.dataset.testid = 'clip-editor-source';

  const timeline = document.createElement('div');
  timeline.className = 'animation-clip-editor__timeline';
  const selectionEl = document.createElement('div');
  selectionEl.className = 'animation-clip-editor__selection';
  timeline.append(selectionEl);

  const rangeIn = document.createElement('input');
  rangeIn.type = 'range';
  rangeIn.className = 'animation-clip-editor__range';
  rangeIn.dataset.testid = 'clip-editor-in';
  const rangeOut = document.createElement('input');
  rangeOut.type = 'range';
  rangeOut.className = 'animation-clip-editor__range';
  rangeOut.dataset.testid = 'clip-editor-out';

  const startRow = document.createElement('div');
  startRow.className = 'animation-clip-editor__row';
  const startLabel = document.createElement('label');
  startLabel.textContent = 'In';
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.step = '0.01';
  startInput.min = '0';
  startRow.append(startLabel, startInput);

  const endRow = document.createElement('div');
  endRow.className = 'animation-clip-editor__row';
  const endLabel = document.createElement('label');
  endLabel.textContent = 'Out';
  const endInput = document.createElement('input');
  endInput.type = 'number';
  endInput.step = '0.01';
  endInput.min = '0';
  endRow.append(endLabel, endInput);

  const idRow = document.createElement('div');
  idRow.className = 'animation-clip-editor__row';
  const idLabel = document.createElement('label');
  idLabel.textContent = 'Id';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.dataset.testid = 'clip-editor-id';
  idRow.append(idLabel, idInput);

  const labelRow = document.createElement('div');
  labelRow.className = 'animation-clip-editor__row';
  const labelLabel = document.createElement('label');
  labelLabel.textContent = 'Name';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.dataset.testid = 'clip-editor-label';
  labelRow.append(labelLabel, labelInput);

  const loopRow = document.createElement('div');
  loopRow.className = 'animation-clip-editor__row';
  const loopLabel = document.createElement('label');
  loopLabel.textContent = 'Loop';
  const loopInput = document.createElement('input');
  loopInput.type = 'checkbox';
  loopRow.append(loopLabel, loopInput);

  const actions = document.createElement('div');
  actions.className = 'animation-clip-editor__actions';
  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.textContent = 'Preview trim';
  const previewFullBtn = document.createElement('button');
  previewFullBtn.type = 'button';
  previewFullBtn.textContent = 'Play full';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'Save to server';
  saveBtn.dataset.testid = 'clip-editor-save';
  actions.append(previewBtn, previewFullBtn, saveBtn);

  const subclipList = document.createElement('div');
  subclipList.className = 'animation-clip-editor__list';
  subclipList.dataset.testid = 'clip-editor-subclip-list';

  const status = document.createElement('div');
  status.className = 'animation-clip-editor__status';
  status.dataset.testid = 'clip-editor-status';

  body.append(
    sourceMeta,
    timeline,
    rangeIn,
    rangeOut,
    startRow,
    endRow,
    idRow,
    labelRow,
    loopRow,
    actions,
    subclipList,
    status,
  );
  root.append(header, body);
  document.body.append(root);

  let player: CharacterAnimationPlayer | null = null;
  let sourceDuration = 0;
  let startSec = 0;
  let endSec = 1;

  function ensurePlayer(): CharacterAnimationPlayer | null {
    const mixer = options.target.getMixer();
    const loadedRoot = options.target.getLoadedRoot();
    const bones = options.target.getBones();
    if (!mixer || !loadedRoot || bones.length === 0) {
      return null;
    }
    if (!player) {
      player = new CharacterAnimationPlayer(mixer, loadedRoot, bones, { fadeDuration: 0.2 });
    }
    return player;
  }

  function setStatus(message: string, kind: 'ok' | 'err' | '' = ''): void {
    status.textContent = message;
    status.className = `animation-clip-editor__status${kind ? ` ${kind}` : ''}`;
  }

  function updateTimelineVisual(): void {
    if (sourceDuration <= 0) {
      selectionEl.style.left = '0%';
      selectionEl.style.width = '100%';
      return;
    }
    const left = (startSec / sourceDuration) * 100;
    const width = Math.max(1, ((endSec - startSec) / sourceDuration) * 100);
    selectionEl.style.left = `${left}%`;
    selectionEl.style.width = `${width}%`;
    rangeIn.max = String(sourceDuration);
    rangeOut.max = String(sourceDuration);
    rangeIn.value = String(startSec);
    rangeOut.value = String(endSec);
    startInput.max = String(sourceDuration);
    endInput.max = String(sourceDuration);
  }

  function syncInputsFromRange(): void {
    startInput.value = startSec.toFixed(2);
    endInput.value = endSec.toFixed(2);
    updateTimelineVisual();
  }

  async function loadSourceDuration(file: string): Promise<void> {
    const p = ensurePlayer();
    if (!p) {
      sourceDuration = 0;
      return;
    }
    const url = `/assets/characters/${file}`;
    await p.loadClip(url, 'Source');
    sourceDuration = p.getClipDuration(url) ?? 0;
    if (endSec > sourceDuration || endSec <= startSec) {
      endSec = Math.min(sourceDuration, Math.max(startSec + 0.2, sourceDuration * 0.5));
    }
    syncInputsFromRange();
  }

  function renderSubclipList(): void {
    const file = options.target.getSourceFile();
    subclipList.replaceChildren();
    if (!file) {
      subclipList.textContent = 'Select a source animation.';
      return;
    }
    const entries = listSubclipsForSource(file);
    if (entries.length === 0) {
      subclipList.textContent = 'No saved sub-clips for this source.';
      return;
    }
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${entry.id} (${entry.definition.start.toFixed(2)}–${entry.definition.end.toFixed(2)}s)`;
      btn.addEventListener('click', () => {
        startSec = entry.definition.start;
        endSec = entry.definition.end;
        loopInput.checked = entry.definition.loop;
        idInput.value = entry.id;
        labelInput.value = entry.definition.label;
        syncInputsFromRange();
        void ensurePlayer()?.playBinding(bindingFromSubclip(entry.id), { loop: entry.definition.loop });
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = ' ✕';
      del.style.display = 'inline';
      del.addEventListener('click', async (event) => {
        event.stopPropagation();
        await deleteSubclip(entry.id);
        options.onLibraryChanged?.();
        renderSubclipList();
        setStatus(`Deleted ${entry.id}`, 'ok');
      });
      const row = document.createElement('div');
      row.append(btn, del);
      subclipList.append(row);
    }
  }

  function refresh(): void {
    player = null;
    const file = options.target.getSourceFile();
    const label = options.target.label ?? 'Character';
    if (!file) {
      sourceMeta.textContent = `${label} — no source selected`;
      return;
    }
    sourceMeta.textContent = `${label}\n${file}\nDuration: ${sourceDuration > 0 ? `${sourceDuration.toFixed(2)}s` : '…'}`;
    if (!idInput.value) {
      idInput.value = normalizeSubclipId(file.replace(/\.fbx$/i, '').split('/').pop() ?? 'clip');
    }
    if (!labelInput.value) {
      labelInput.value = file.split('/').pop()?.replace(/\.fbx$/i, '').replace(/_/g, ' ') ?? 'Subclip';
    }
    void loadSourceDuration(file).then(() => {
      sourceMeta.textContent = `${label}\n${file}\nDuration: ${sourceDuration.toFixed(2)}s`;
      renderSubclipList();
    });
  }

  rangeIn.addEventListener('input', () => {
    startSec = Number(rangeIn.value);
    if (startSec >= endSec - 0.05) {
      startSec = Math.max(0, endSec - 0.05);
    }
    syncInputsFromRange();
  });
  rangeOut.addEventListener('input', () => {
    endSec = Number(rangeOut.value);
    if (endSec <= startSec + 0.05) {
      endSec = Math.min(sourceDuration, startSec + 0.05);
    }
    syncInputsFromRange();
  });
  startInput.addEventListener('change', () => {
    startSec = THREE.MathUtils.clamp(Number(startInput.value), 0, Math.max(0, endSec - 0.05));
    syncInputsFromRange();
  });
  endInput.addEventListener('change', () => {
    endSec = THREE.MathUtils.clamp(Number(endInput.value), startSec + 0.05, sourceDuration || 999);
    syncInputsFromRange();
  });

  previewBtn.addEventListener('click', async () => {
    const file = options.target.getSourceFile();
    const p = ensurePlayer();
    if (!file || !p) {
      setStatus('Load a character and source clip first.', 'err');
      return;
    }
    try {
      await p.playTrimPreview(file, startSec, endSec, loopInput.checked);
      setStatus(`Preview ${startSec.toFixed(2)}–${endSec.toFixed(2)}s`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'err');
    }
  });

  previewFullBtn.addEventListener('click', async () => {
    const file = options.target.getSourceFile();
    const p = ensurePlayer();
    if (!file || !p) {
      return;
    }
    try {
      await p.playTrimPreview(file, 0, sourceDuration || 999, loopInput.checked);
      setStatus('Playing full source', 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'err');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const file = options.target.getSourceFile();
    if (!file) {
      setStatus('No source file selected.', 'err');
      return;
    }
    const subclipId = normalizeSubclipId(idInput.value);
    if (!subclipId) {
      setStatus('Subclip id is required.', 'err');
      return;
    }
    if (endSec <= startSec) {
      setStatus('Out must be after In.', 'err');
      return;
    }
    const definition: AnimationSubclipDefinition = {
      label: labelInput.value.trim() || subclipId,
      sourceFile: file,
      start: startSec,
      end: endSec,
      loop: loopInput.checked,
      fps: 30,
    };
    try {
      await upsertSubclip(subclipId, definition);
      await refreshSubclipLibraryFromServer();
      options.onLibraryChanged?.();
      renderSubclipList();
      setStatus(`Saved ${subclipId} → data/animationSubclips.json`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'err');
    }
  });

  void refreshSubclipLibraryFromServer().then(() => refresh());

  return {
    element: root,
    refresh,
    dispose() {
      player = null;
      root.remove();
    },
  };
}
