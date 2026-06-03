import './animationClipEditor.css';
import * as THREE from 'three';
import { CharacterAnimationPlayer } from '../CharacterAnimationPlayer.ts';
import { findBestLoopEnd } from '../loopMatch.ts';
import {
  bindingFromSubclip,
  deleteSubclip,
  getSubclip,
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

export type AnimationClipEditorTargetProvider =
  | AnimationClipEditorTarget
  | (() => AnimationClipEditorTarget);

export interface AnimationClipEditorPanelOptions {
  readonly target: AnimationClipEditorTargetProvider;
  readonly container?: HTMLElement;
  readonly testId?: string;
  readonly onLibraryChanged?: () => void;
}

export interface AnimationClipEditorPanel {
  readonly element: HTMLElement;
  refresh(): void;
  loadFromSubclip(subclipId: string): void;
  setSubclipIdLocked(locked: boolean): void;
  dispose(): void;
}

function createSection(title: string, help: string): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement('div');
  section.className = 'animation-clip-editor__section';
  const titleEl = document.createElement('div');
  titleEl.className = 'animation-clip-editor__section-title';
  titleEl.textContent = title;
  const helpEl = document.createElement('p');
  helpEl.className = 'animation-clip-editor__help';
  helpEl.textContent = help;
  const body = document.createElement('div');
  section.append(titleEl, helpEl, body);
  return { section, body };
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

  const trimSection = createSection(
    '1. Trim range',
    'Choose where the clip starts (In) and ends (Out). The highlighted bar is what will be saved.',
  );
  const timeline = document.createElement('div');
  timeline.className = 'animation-clip-editor__timeline';
  const selectionEl = document.createElement('div');
  selectionEl.className = 'animation-clip-editor__selection';
  const loopEndHint = document.createElement('div');
  loopEndHint.className = 'animation-clip-editor__loop-end-hint';
  loopEndHint.style.display = 'none';
  timeline.append(selectionEl, loopEndHint);

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
  startRow.innerHTML = '<label>In (sec)</label>';
  const startInput = document.createElement('input');
  startInput.type = 'number';
  startInput.step = '0.01';
  startInput.min = '0';
  startRow.append(startInput);

  const endRow = document.createElement('div');
  endRow.className = 'animation-clip-editor__row';
  endRow.innerHTML = '<label>Out (sec)</label>';
  const endInput = document.createElement('input');
  endInput.type = 'number';
  endInput.step = '0.01';
  endInput.min = '0';
  endRow.append(endInput);

  const trimActions = document.createElement('div');
  trimActions.className = 'animation-clip-editor__actions';
  const previewTrimBtn = document.createElement('button');
  previewTrimBtn.type = 'button';
  previewTrimBtn.textContent = 'Preview trim';
  const previewFullBtn = document.createElement('button');
  previewFullBtn.type = 'button';
  previewFullBtn.textContent = 'Play full source';
  trimActions.append(previewTrimBtn, previewFullBtn);

  trimSection.body.append(timeline, rangeIn, rangeOut, startRow, endRow, trimActions);

  const loopSection = createSection(
    '2. Seamless loop',
    'For looping clips, Out should match In in both pose and turning speed. We search the tail of your range and score each frame (lower = smoother loop). Optional blend eases the last frames into the start pose.',
  );
  const searchRow = document.createElement('div');
  searchRow.className = 'animation-clip-editor__row';
  searchRow.innerHTML = '<label>Search window</label>';
  const searchWindowInput = document.createElement('input');
  searchWindowInput.type = 'number';
  searchWindowInput.step = '0.1';
  searchWindowInput.min = '0.3';
  searchWindowInput.value = '2';
  searchRow.append(searchWindowInput);

  const loopScore = document.createElement('div');
  loopScore.className = 'animation-clip-editor__score';
  loopScore.dataset.testid = 'clip-editor-loop-score';
  loopScore.textContent = 'Run “Find loop end” after setting In.';

  const loopActions = document.createElement('div');
  loopActions.className = 'animation-clip-editor__actions';
  const findLoopBtn = document.createElement('button');
  findLoopBtn.type = 'button';
  findLoopBtn.textContent = 'Find loop end';
  findLoopBtn.dataset.testid = 'clip-editor-find-loop';
  const previewLoopBtn = document.createElement('button');
  previewLoopBtn.type = 'button';
  previewLoopBtn.textContent = 'Preview loop';
  loopActions.append(findLoopBtn, previewLoopBtn);

  const blendRow = document.createElement('div');
  blendRow.className = 'animation-clip-editor__row';
  const blendEnable = document.createElement('input');
  blendEnable.type = 'checkbox';
  blendEnable.checked = true;
  const blendLabel = document.createElement('label');
  blendLabel.textContent = 'Blend end → start';
  blendLabel.style.minWidth = 'auto';
  blendLabel.style.flex = '1';
  const blendSecInput = document.createElement('input');
  blendSecInput.type = 'number';
  blendSecInput.step = '0.05';
  blendSecInput.min = '0';
  blendSecInput.value = '0.15';
  blendSecInput.style.maxWidth = '72px';
  blendSecInput.title = 'Seconds at the end to ease into the start pose';
  blendRow.append(blendEnable, blendLabel, blendSecInput);

  loopSection.body.append(searchRow, loopScore, loopActions, blendRow);

  const saveSection = createSection(
    '3. Save sub-clip',
    'Writes to data/animationSubclips.json on the dev server so you can commit it in Git. Enable Loop for walk/idle cycles.',
  );
  const idRow = document.createElement('div');
  idRow.className = 'animation-clip-editor__row';
  idRow.innerHTML = '<label>Id</label>';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.dataset.testid = 'clip-editor-id';
  idRow.append(idInput);

  const labelRow = document.createElement('div');
  labelRow.className = 'animation-clip-editor__row';
  labelRow.innerHTML = '<label>Display name</label>';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.dataset.testid = 'clip-editor-label';
  labelRow.append(labelInput);

  const loopSaveRow = document.createElement('div');
  loopSaveRow.className = 'animation-clip-editor__row';
  const loopCheckbox = document.createElement('input');
  loopCheckbox.type = 'checkbox';
  const loopCheckboxLabel = document.createElement('label');
  loopCheckboxLabel.textContent = 'Looping clip';
  loopCheckboxLabel.style.minWidth = 'auto';
  loopSaveRow.append(loopCheckbox, loopCheckboxLabel);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = 'Save to server';
  saveBtn.dataset.testid = 'clip-editor-save';

  const subclipList = document.createElement('div');
  subclipList.className = 'animation-clip-editor__list';
  subclipList.dataset.testid = 'clip-editor-subclip-list';

  saveSection.body.append(idRow, labelRow, loopSaveRow, saveBtn, subclipList);

  const status = document.createElement('div');
  status.className = 'animation-clip-editor__status';
  status.dataset.testid = 'clip-editor-status';

  body.append(sourceMeta, trimSection.section, loopSection.section, saveSection.section, status);
  root.append(header, body);
  (options.container ?? document.body).append(root);

  let player: CharacterAnimationPlayer | null = null;
  let sourceDuration = 0;
  let startSec = 0;
  let endSec = 1;

  function resolveTarget(): AnimationClipEditorTarget {
    return typeof options.target === 'function' ? options.target() : options.target;
  }

  function ensurePlayer(): CharacterAnimationPlayer | null {
    const target = resolveTarget();
    const mixer = target.getMixer();
    const loadedRoot = target.getLoadedRoot();
    const bones = target.getBones();
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

  function updateLoopEndHint(): void {
    if (sourceDuration <= 0) {
      loopEndHint.style.display = 'none';
      return;
    }
    const pct = (endSec / sourceDuration) * 100;
    loopEndHint.style.display = 'block';
    loopEndHint.style.left = `${pct}%`;
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
    updateLoopEndHint();
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
    const file = resolveTarget().getSourceFile();
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
        loopCheckbox.checked = entry.definition.loop;
        blendSecInput.value = String(entry.definition.loopBlendSec ?? 0.15);
        blendEnable.checked = (entry.definition.loopBlendSec ?? 0) > 0;
        idInput.value = entry.id;
        labelInput.value = entry.definition.label;
        syncInputsFromRange();
        void ensurePlayer()?.playBinding(bindingFromSubclip(entry.id), { loop: entry.definition.loop });
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = ' ✕';
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

  function loadFromSubclip(subclipId: string): void {
    const subclip = getSubclip(subclipId);
    resolveTarget().setSourceFile?.(subclip.sourceFile);
    idInput.value = subclipId;
    labelInput.value = subclip.label;
    startSec = subclip.start;
    endSec = subclip.end;
    loopCheckbox.checked = subclip.loop;
    blendEnable.checked = (subclip.loopBlendSec ?? 0) > 0;
    blendSecInput.value = String(subclip.loopBlendSec ?? 0.15);
    syncInputsFromRange();
    void loadSourceDuration(subclip.sourceFile);
  }

  function setSubclipIdLocked(locked: boolean): void {
    idInput.readOnly = locked;
    idInput.style.opacity = locked ? '0.75' : '';
  }

  function refresh(): void {
    player = null;
    const target = resolveTarget();
    const file = target.getSourceFile();
    const label = target.label ?? 'Character';
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

  findLoopBtn.addEventListener('click', async () => {
    const file = resolveTarget().getSourceFile();
    const p = ensurePlayer();
    if (!file || !p) {
      setStatus('Load a character and source first.', 'err');
      return;
    }
    const url = `/assets/characters/${file}`;
    await p.loadClip(url);
    const clip = p.getCachedClip(url);
    if (!clip) {
      setStatus('Could not read source clip.', 'err');
      return;
    }
    const searchWindow = Math.max(0.3, Number(searchWindowInput.value) || 2);
    const searchStart = Math.max(startSec + 0.35, endSec - searchWindow);
    const result = findBestLoopEnd(clip, {
      startSec,
      searchStartSec: searchStart,
      searchEndSec: Math.min(sourceDuration, endSec),
      fps: 30,
    });
    endSec = result.endSec;
    loopCheckbox.checked = true;
    syncInputsFromRange();
    loopScore.textContent = `Match score ${result.score.toFixed(4)} (pose ${result.poseScore.toFixed(4)}, velocity ${result.velocityScore.toFixed(4)}) · ${result.samples} samples`;
    setStatus(`Loop end set to ${endSec.toFixed(2)}s`, 'ok');
  });

  previewTrimBtn.addEventListener('click', async () => {
    const file = resolveTarget().getSourceFile();
    const p = ensurePlayer();
    if (!file || !p) {
      setStatus('Load a character and source clip first.', 'err');
      return;
    }
    try {
      const blend = blendEnable.checked ? Number(blendSecInput.value) : 0;
      await p.playTrimPreview(file, startSec, endSec, loopCheckbox.checked, 30, blend);
      setStatus(`Preview ${startSec.toFixed(2)}–${endSec.toFixed(2)}s`, 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'err');
    }
  });

  previewLoopBtn.addEventListener('click', async () => {
    loopCheckbox.checked = true;
    previewTrimBtn.click();
  });

  previewFullBtn.addEventListener('click', async () => {
    const file = resolveTarget().getSourceFile();
    const p = ensurePlayer();
    if (!file || !p) {
      return;
    }
    try {
      await p.playTrimPreview(file, 0, sourceDuration || 999, loopCheckbox.checked);
      setStatus('Playing full source', 'ok');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), 'err');
    }
  });

  saveBtn.addEventListener('click', async () => {
    const file = resolveTarget().getSourceFile();
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
      loop: loopCheckbox.checked,
      fps: 30,
      loopBlendSec: loopCheckbox.checked && blendEnable.checked
        ? Math.max(0, Number(blendSecInput.value) || 0)
        : undefined,
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
    loadFromSubclip,
    setSubclipIdLocked,
    dispose() {
      player = null;
      root.remove();
    },
  };
}
