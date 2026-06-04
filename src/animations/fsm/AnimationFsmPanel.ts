import './animationFsmPanel.css';
import type { CharacterController } from '../../character/CharacterController.ts';
import { getAllAnimations } from '../animationLoader.ts';
import { bindingFromSubclip, listSubclips, refreshSubclipLibraryFromServer } from '../animationSubclip.ts';
import type { AnimationClipEditorOpenOptions } from '../clipEditor/AnimationClipEditorPopup.ts';
import type { AnimationClipEditorTarget } from '../clipEditor/AnimationClipEditorPanel.ts';
import type { CharacterAnimationStateMachine } from '../CharacterAnimationStateMachine.ts';
import {
  clearProfileOverrides,
  getProfile,
  listProfileSummaries,
  saveProfileOverrides,
  resolveClipFadeDuration,
  updateStatePrimaryClip,
  type CharacterAnimationProfile,
  type FsmStateId,
  type FsmTriggerId,
  type StateClipBinding,
} from '../characterAnimationProfile.ts';

export interface AnimationFsmTarget {
  readonly label: string;
  readonly controller: CharacterController;
}

export interface AnimationFsmPanelOptions {
  readonly targets: readonly AnimationFsmTarget[];
  readonly initialTargetIndex?: number;
  readonly testId?: string;
  readonly collapsed?: boolean;
  readonly onTargetChange?: () => void;
  /** When set, FSM profile edits persist here instead of localStorage. */
  readonly onDuelSetupPersist?: () => void | Promise<void>;
  readonly openClipEditor?: (options: AnimationClipEditorOpenOptions) => void;
}

export interface AnimationFsmPanel {
  readonly element: HTMLElement;
  getActiveClipEditorTarget(): AnimationClipEditorTarget;
  getActiveTargetIndex(): number;
  refresh(): void;
  setCollapsed(collapsed: boolean): void;
  dispose(): void;
}

const STATE_ORDER: readonly FsmStateId[] = ['tpose', 'idle', 'walk', 'attack'];

export function createAnimationFsmPanel(options: AnimationFsmPanelOptions): AnimationFsmPanel {
  const panel = document.createElement('aside');
  panel.className = 'animation-fsm-panel';
  panel.dataset.testid = options.testId ?? 'animation-fsm-panel';
  panel.dataset.collapsed = String(options.collapsed ?? false);

  let activeTargetIndex = options.initialTargetIndex ?? 0;
  /** Panel focus for clip editing — only changes on graph click (not runtime). */
  let editingState: FsmStateId = 'idle';
  let editingPinned = false;
  let editorSourceFile: string | null = null;
  const catalogByFile = new Map(getAllAnimations().map((entry) => [entry.file, entry]));

  const header = document.createElement('div');
  header.className = 'animation-fsm-panel__header';

  const title = document.createElement('div');
  title.className = 'animation-fsm-panel__title';
  title.textContent = 'Animation FSM';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'animation-fsm-panel__collapse';
  collapseBtn.textContent = '−';
  collapseBtn.setAttribute('aria-label', 'Collapse animation FSM panel');

  header.append(title, collapseBtn);

  const body = document.createElement('div');
  body.className = 'animation-fsm-panel__body';

  const targetTabs = document.createElement('div');
  targetTabs.className = 'animation-fsm-panel__row';
  targetTabs.style.flexWrap = 'wrap';

  const profileRow = document.createElement('div');
  profileRow.className = 'animation-fsm-panel__row';
  const profileLabel = document.createElement('label');
  profileLabel.textContent = 'Profile';
  const profileSelect = document.createElement('select');
  profileSelect.dataset.testid = 'animation-fsm-profile-select';
  for (const summary of listProfileSummaries()) {
    const option = document.createElement('option');
    option.value = summary.id;
    option.textContent = summary.label;
    profileSelect.append(option);
  }
  profileRow.append(profileLabel, profileSelect);

  const graphSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graphSvg.setAttribute('class', 'animation-fsm-panel__graph');
  graphSvg.setAttribute('viewBox', '0 0 360 200');
  graphSvg.dataset.testid = 'animation-fsm-graph';

  const detail = document.createElement('div');
  detail.className = 'animation-fsm-panel__detail';

  const pulse = document.createElement('div');
  pulse.className = 'animation-fsm-panel__pulse';
  const pulseBar = document.createElement('span');
  pulse.append(pulseBar);

  body.append(targetTabs, profileRow, graphSvg, detail, pulse);
  panel.append(header, body);
  document.body.append(panel);

  const unsubscribes: (() => void)[] = [];
  let fsmUnsub: (() => void) | null = null;

  const getTarget = (): AnimationFsmTarget => options.targets[activeTargetIndex]!;
  const getFsm = (): CharacterAnimationStateMachine => getTarget().controller.fsm;

  function bindFsmListener(): void {
    fsmUnsub?.();
    fsmUnsub = getFsm().onChange(() => render());
  }

  function rebuildTargetTabs(): void {
    targetTabs.replaceChildren();
    options.targets.forEach((target, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'animation-fsm-panel__tab';
      tab.textContent = target.label;
      tab.setAttribute('aria-selected', String(index === activeTargetIndex));
      tab.addEventListener('click', () => {
        activeTargetIndex = index;
        rebuildTargetTabs();
        syncProfileSelect();
        render();
        bindFsmListener();
        options.onTargetChange?.();
        render();
      });
      targetTabs.append(tab);
    });
  }

  function syncProfileSelect(): void {
    profileSelect.value = getFsm().getProfile().id;
  }

  async function persistDuelSetupIfNeeded(): Promise<void> {
    await options.onDuelSetupPersist?.();
  }

  function applyProfileToTarget(profile: CharacterAnimationProfile): void {
    getTarget().controller.applyProfile(profile);
    void getFsm().preload();
    render();
    void persistDuelSetupIfNeeded();
  }

  function syncEditorSourceForState(stateId: FsmStateId): void {
    const clip = getFsm().getProfile().states[stateId].clips[0];
    editorSourceFile = clip?.subclipId
      ? bindingFromSubclip(clip.subclipId).file ?? clip.file ?? null
      : clip?.file ?? null;
  }

  function selectEditingState(stateId: FsmStateId): void {
    editingState = stateId;
    syncEditorSourceForState(stateId);
  }

  function renderGraph(profile: CharacterAnimationProfile, snapshot: ReturnType<CharacterAnimationStateMachine['getSnapshot']>): void {
    graphSvg.replaceChildren();
    const width = 360;
    const height = 200;

    for (const transition of profile.transitions) {
      if (transition.from === '*') {
        continue;
      }
      const from = profile.states[transition.from];
      const to = profile.states[transition.to];
      if (!from.graph || !to.graph) {
        continue;
      }
      const x1 = from.graph.x * width;
      const y1 = from.graph.y * height;
      const x2 = to.graph.x * width;
      const y2 = to.graph.y * height;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = (x1 + x2) * 0.5;
      const my = (y1 + y2) * 0.5 - 18;
      path.setAttribute('d', `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`);
      path.setAttribute('class', 'animation-fsm-panel__graph-edge');
      const active =
        snapshot.previousState === transition.from
        && snapshot.state === transition.to
        && snapshot.lastTrigger === transition.trigger;
      if (active) {
        path.classList.add('is-active');
      }
      path.dataset.testid = `fsm-edge-${transition.from}-${transition.to}`;
      graphSvg.append(path);
    }

    for (const stateId of STATE_ORDER) {
      const state = profile.states[stateId];
      if (!state.graph) {
        continue;
      }
      const cx = state.graph.x * width;
      const cy = state.graph.y * height;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'animation-fsm-panel__graph-node');
      group.setAttribute('data-state', stateId);
      if (snapshot.state === stateId) {
        group.classList.add('is-active');
      }
      if (editingState === stateId) {
        group.classList.add('is-editing');
      }
      group.addEventListener('click', () => {
        if (!editingPinned) {
          selectEditingState(stateId);
        }
        const snapshotNow = getFsm().getSnapshot();
        renderGraph(profile, snapshotNow);
        renderDetail(profile, snapshotNow);
      });

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', '26');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('class', 'animation-fsm-panel__node-label');
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(cy - 4));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('fill', '#eef4fc');
      label.textContent = state.label;

      const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sub.setAttribute('class', 'animation-fsm-panel__node-sublabel');
      sub.setAttribute('x', String(cx));
      sub.setAttribute('y', String(cy + 10));
      sub.setAttribute('text-anchor', 'middle');
      sub.setAttribute('dominant-baseline', 'middle');
      sub.setAttribute('fill', '#9aadc4');
      sub.textContent = stateId;

      group.append(circle, label, sub);
      graphSvg.append(group);
    }
  }

  function renderDetail(profile: CharacterAnimationProfile, snapshot: ReturnType<CharacterAnimationStateMachine['getSnapshot']>): void {
    const state = profile.states[editingState];
    const primary = state.clips[0];
    detail.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = `Editing: ${state.label} · ${editingState}`;
    heading.dataset.testid = 'animation-fsm-editing-heading';

    const toolbar = document.createElement('div');
    toolbar.className = 'animation-fsm-panel__detail-toolbar';

    const pinLabel = document.createElement('label');
    const pinInput = document.createElement('input');
    pinInput.type = 'checkbox';
    pinInput.checked = editingPinned;
    pinInput.dataset.testid = 'animation-fsm-pin-editing';
    pinLabel.append(pinInput, document.createTextNode(' Pin'));

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'primary';
    previewBtn.textContent = 'Preview state';
    previewBtn.dataset.testid = 'animation-fsm-preview-state';
    previewBtn.title = `Play ${editingState} on ${getTarget().label} (runtime)`;
    previewBtn.addEventListener('click', () => {
      void getFsm().forceState(editingState);
    });

    pinInput.addEventListener('change', () => {
      editingPinned = pinInput.checked;
    });

    toolbar.append(pinLabel, previewBtn);

    const meta = document.createElement('div');
    meta.className = 'animation-fsm-panel__meta';
    meta.dataset.testid = 'animation-fsm-meta';
    const metaLines = [
      `Runtime: <strong>${snapshot.state}</strong> · ${snapshot.activeClipName ?? '—'}`,
      `Editing: <strong>${editingState}</strong>${editingPinned ? ' (pinned)' : ''}`,
      snapshot.lastTransitionLabel ? `Last transition: ${snapshot.lastTransitionLabel}` : '',
      primary ? `Binding: ${primary.name}` : '',
    ];
    meta.innerHTML = metaLines.filter(Boolean).join('<br>');

    const clipRow = document.createElement('div');
    clipRow.className = 'animation-fsm-panel__row';
    const clipLabel = document.createElement('label');
    clipLabel.textContent = 'Clip';
    const clipSelect = document.createElement('select');
    clipSelect.dataset.testid = 'animation-fsm-clip-select';

    const catalogGroup = document.createElement('optgroup');
    catalogGroup.label = 'Catalog';
    for (const entry of getAllAnimations()) {
      const option = document.createElement('option');
      option.value = `file:${entry.file}`;
      option.textContent = entry.name;
      if (primary?.subclipId === undefined && primary?.file === entry.file) {
        option.selected = true;
      }
      catalogGroup.append(option);
    }
    clipSelect.append(catalogGroup);

    const subclipGroup = document.createElement('optgroup');
    subclipGroup.label = 'Sub-clips';
    for (const { id, definition } of listSubclips()) {
      const option = document.createElement('option');
      option.value = `subclip:${id}`;
      option.textContent = definition.label;
      if (primary?.subclipId === id) {
        option.selected = true;
      }
      subclipGroup.append(option);
    }
    clipSelect.append(subclipGroup);

    if (primary?.subclipId) {
      editorSourceFile = bindingFromSubclip(primary.subclipId).file ?? editorSourceFile;
    } else if (primary?.file) {
      editorSourceFile = primary.file;
    }

    clipSelect.addEventListener('change', () => {
      const value = clipSelect.value;
      let binding: StateClipBinding;
      if (value.startsWith('subclip:')) {
        const subclipId = value.slice('subclip:'.length);
        binding = bindingFromSubclip(subclipId);
        editorSourceFile = binding.file ?? null;
      } else {
        const file = value.slice('file:'.length);
        const entry = catalogByFile.get(file);
        if (!entry) {
          return;
        }
        binding = {
          name: entry.name,
          file: entry.file,
          loop: entry.loop,
          fadeIn: resolveClipFadeDuration(getFsm().getProfile(), editingState, {
            name: entry.name,
            file: entry.file,
            loop: entry.loop,
          }),
        };
        editorSourceFile = file;
      }
      const next = updateStatePrimaryClip(getFsm().getProfile(), editingState, binding);
      applyProfileToTarget(next);
      if (!options.onDuelSetupPersist) {
        saveProfileOverrides(next);
      }
    });

    clipRow.append(clipLabel, clipSelect);

    const editClipBtn = document.createElement('button');
    editClipBtn.type = 'button';
    editClipBtn.textContent = 'Edit clip…';
    editClipBtn.dataset.testid = 'animation-fsm-edit-clip';
    editClipBtn.addEventListener('click', () => {
      if (!options.openClipEditor) {
        return;
      }
      options.openClipEditor({
        target: getActiveClipEditorTarget(),
        initialSubclipId: primary?.subclipId,
        lockSubclipId: Boolean(primary?.subclipId),
      });
    });

    const triggerLabel = document.createElement('div');
    triggerLabel.className = 'animation-fsm-panel__trigger-label';
    triggerLabel.textContent = 'Runtime triggers';

    const actions = document.createElement('div');
    actions.className = 'animation-fsm-panel__actions';

    const triggers: { trigger: FsmTriggerId; label: string }[] = [
      { trigger: 'start', label: 'Start' },
      { trigger: 'moveStart', label: 'Walk' },
      { trigger: 'moveStop', label: 'Idle' },
      { trigger: 'attack', label: 'Attack' },
      { trigger: 'attackDone', label: 'Done' },
    ];

    for (const { trigger, label: btnLabel } of triggers) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = btnLabel;
      btn.addEventListener('click', () => {
        if (trigger === 'attack' && options.targets.length >= 2) {
          const otherIndex = (activeTargetIndex + 1) % options.targets.length;
          const opponentPos = options.targets[otherIndex]!.controller.getWorldPosition();
          void getTarget().controller.playAttackToward(opponentPos);
          return;
        }
        void getFsm().trigger(trigger);
      });
      actions.append(btn);
    }

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset profile';
    resetBtn.addEventListener('click', () => {
      editingPinned = false;
      if (options.onDuelSetupPersist) {
        applyProfileToTarget(getProfile(profile.id));
      } else {
        clearProfileOverrides(profile.id);
        applyProfileToTarget(getProfile(profile.id));
      }
      syncProfileSelect();
      selectEditingState('idle');
    });
    actions.append(resetBtn);

    if (options.onDuelSetupPersist) {
      const saveDuelBtn = document.createElement('button');
      saveDuelBtn.type = 'button';
      saveDuelBtn.className = 'primary';
      saveDuelBtn.textContent = 'Save duel setup';
      saveDuelBtn.dataset.testid = 'animation-fsm-save-duel';
      saveDuelBtn.addEventListener('click', () => {
        void persistDuelSetupIfNeeded().then(() => {
          setDuelSaveStatus('Saved → data/characterDuelAnimation.json', 'ok');
        }).catch((error) => {
          setDuelSaveStatus(error instanceof Error ? error.message : String(error), 'err');
        });
      });
      actions.append(saveDuelBtn);
    }

    detail.append(heading, toolbar, meta, clipRow, editClipBtn, triggerLabel, actions);

    let duelSaveStatusEl: HTMLElement | null = null;
    function setDuelSaveStatus(message: string, kind: 'ok' | 'err'): void {
      if (!options.onDuelSetupPersist) {
        return;
      }
      if (!duelSaveStatusEl) {
        duelSaveStatusEl = document.createElement('div');
        duelSaveStatusEl.className = 'animation-fsm-panel__meta';
        duelSaveStatusEl.dataset.testid = 'animation-fsm-duel-save-status';
        detail.append(duelSaveStatusEl);
      }
      duelSaveStatusEl.textContent = message;
      duelSaveStatusEl.dataset.kind = kind;
    }
    pulseBar.style.transform = `scaleX(${snapshot.transitionPulse})`;
  }

  function render(): void {
    const snapshot = getFsm().getSnapshot();
    const profile = getFsm().getProfile();
    renderGraph(profile, snapshot);
    renderDetail(profile, snapshot);
  }

  profileSelect.addEventListener('change', () => {
    applyProfileToTarget(getProfile(profileSelect.value));
  });

  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.dataset.collapsed === 'true';
    panel.dataset.collapsed = String(!collapsed);
    collapseBtn.textContent = collapsed ? '−' : '+';
  });

  rebuildTargetTabs();
  syncProfileSelect();
  bindFsmListener();
  selectEditingState('idle');
  render();

  const getActiveClipEditorTarget = (): AnimationClipEditorTarget => ({
    label: getTarget().label,
    getMixer: () => getTarget().controller.rig.getMixer(),
    getLoadedRoot: () => getTarget().controller.rig.getLoadedRoot(),
    getBones: () => getTarget().controller.rig.getBones(),
    getAnimationRoot: () => getTarget().controller.rig.getAnimationRoot(),
    getAnimationBones: () => getTarget().controller.rig.getAnimationBones(),
    getSourceFile: () => editorSourceFile,
    setSourceFile: (file: string) => {
      editorSourceFile = file;
    },
  });

  return {
    element: panel,
    getActiveClipEditorTarget,
    getActiveTargetIndex: () => activeTargetIndex,
    refresh: render,
    setCollapsed(collapsed: boolean) {
      panel.dataset.collapsed = String(collapsed);
      collapseBtn.textContent = collapsed ? '+' : '−';
    },
    dispose() {
      fsmUnsub?.();
      unsubscribes.forEach((unsub) => unsub());
      panel.remove();
    },
  };
}
