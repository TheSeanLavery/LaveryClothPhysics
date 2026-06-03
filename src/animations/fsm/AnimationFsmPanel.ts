import './animationFsmPanel.css';
import type { CharacterController } from '../../character/CharacterController.ts';
import { getAllAnimations } from '../animationLoader.ts';
import { bindingFromSubclip, listSubclips, refreshSubclipLibraryFromServer } from '../animationSubclip.ts';
import type { AnimationClipEditorTarget } from '../clipEditor/AnimationClipEditorPanel.ts';
import type { CharacterAnimationStateMachine } from '../CharacterAnimationStateMachine.ts';
import {
  clearProfileOverrides,
  getProfile,
  listProfileSummaries,
  saveProfileOverrides,
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
}

export interface AnimationFsmPanel {
  readonly element: HTMLElement;
  getActiveClipEditorTarget(): AnimationClipEditorTarget;
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
  let selectedState: FsmStateId = 'idle';
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

  function applyProfileToTarget(profile: CharacterAnimationProfile): void {
    getTarget().controller.applyProfile(profile);
    void getFsm().preload();
    render();
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
      group.addEventListener('click', () => {
        selectedState = stateId;
        const clip = getFsm().getProfile().states[stateId].clips[0];
        editorSourceFile = clip?.subclipId
          ? bindingFromSubclip(clip.subclipId).file ?? clip.file ?? null
          : clip?.file ?? null;
        void getFsm().forceState(stateId);
        render();
      });

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', '26');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(cy + 4));
      label.textContent = state.label;

      const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sub.setAttribute('class', 'sub');
      sub.setAttribute('x', String(cx));
      sub.setAttribute('y', String(cy + 16));
      sub.textContent = stateId;

      group.append(circle, label, sub);
      graphSvg.append(group);
    }
  }

  function renderDetail(profile: CharacterAnimationProfile, snapshot: ReturnType<CharacterAnimationStateMachine['getSnapshot']>): void {
    const state = profile.states[selectedState];
    const primary = state.clips[0];
    detail.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = `${state.label} · ${selectedState}`;

    const meta = document.createElement('div');
    meta.className = 'animation-fsm-panel__meta';
    meta.innerHTML = [
      `Active: <strong>${snapshot.activeClipName ?? '—'}</strong>`,
      snapshot.lastTransitionLabel ? `Last: ${snapshot.lastTransitionLabel}` : '',
      primary ? `Clip: ${primary.name}` : '',
    ].filter(Boolean).join('<br>');

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
          fadeIn: selectedState === 'attack' ? 0.12 : 0.25,
        };
        editorSourceFile = file;
      }
      const next = updateStatePrimaryClip(getFsm().getProfile(), selectedState, binding);
      applyProfileToTarget(next);
      saveProfileOverrides(next);
    });

    clipRow.append(clipLabel, clipSelect);

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
        void getFsm().trigger(trigger);
      });
      actions.append(btn);
    }

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset profile';
    resetBtn.addEventListener('click', () => {
      clearProfileOverrides(profile.id);
      applyProfileToTarget(getProfile(profile.id));
      syncProfileSelect();
    });
    actions.append(resetBtn);

    detail.append(heading, meta, clipRow, actions);
    pulseBar.style.transform = `scaleX(${snapshot.transitionPulse})`;
  }

  function render(): void {
    const snapshot = getFsm().getSnapshot();
    const profile = getFsm().getProfile();
    selectedState = snapshot.state;
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
  render();

  const getActiveClipEditorTarget = (): AnimationClipEditorTarget => ({
    label: getTarget().label,
    getMixer: () => getTarget().controller.rig.getMixer(),
    getLoadedRoot: () => getTarget().controller.rig.getLoadedRoot(),
    getBones: () => getTarget().controller.rig.getBones(),
    getSourceFile: () => editorSourceFile,
    setSourceFile: (file: string) => {
      editorSourceFile = file;
    },
  });

  return {
    element: panel,
    getActiveClipEditorTarget,
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
