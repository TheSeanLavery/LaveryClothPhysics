import type { CharacterAnimationPlayer } from './CharacterAnimationPlayer.ts';
import type { AnimatedCharacterSceneRig } from '../character/AnimatedCharacter.ts';
import {
  normalizeCharacterAnimationProfile,
  resolveClipFadeDuration,
  type CharacterAnimationProfile,
  type FsmStateId,
  type FsmTriggerId,
  type FsmTransitionDefinition,
  type StateClipBinding,
} from './characterAnimationProfile.ts';
import {
  runRigDressSequence,
  type RigDressSequenceHost,
  type RigDressSequenceOptions,
  type RigDressSequenceResult,
} from './rigDressSequence.ts';

export interface FsmSnapshot {
  readonly state: FsmStateId;
  readonly previousState: FsmStateId | null;
  readonly activeClipName: string | null;
  readonly activeClipFile: string | null;
  readonly lastTrigger: FsmTriggerId | null;
  readonly lastTransitionLabel: string | null;
  readonly transitionPulse: number;
  readonly profileId: string;
}

export interface CharacterAnimationStateMachineOptions {
  readonly rig: AnimatedCharacterSceneRig;
  readonly player: CharacterAnimationPlayer;
  readonly onStateEntered?: (state: FsmStateId) => void | Promise<void>;
  readonly onTransition?: (
    from: FsmStateId,
    to: FsmStateId,
    trigger: FsmTriggerId,
    transition: FsmTransitionDefinition,
  ) => void;
}

export class CharacterAnimationStateMachine implements RigDressSequenceHost {
  private profile: CharacterAnimationProfile;
  private state: FsmStateId = 'tpose';
  private previousState: FsmStateId | null = null;
  private lastTrigger: FsmTriggerId | null = null;
  private lastTransitionLabel: string | null = null;
  private activeClipName: string | null = null;
  private activeClipFile: string | null = null;
  private transitionPulse = 0;
  private rigDressReady = false;
  private dressSequenceActive = false;
  private readonly listeners = new Set<(snapshot: FsmSnapshot) => void>();

  constructor(
    profile: CharacterAnimationProfile,
    private readonly options: CharacterAnimationStateMachineOptions,
  ) {
    this.profile = normalizeCharacterAnimationProfile(profile);
  }

  get rig(): AnimatedCharacterSceneRig {
    return this.options.rig;
  }

  get player(): CharacterAnimationPlayer {
    return this.options.player;
  }

  getProfile(): CharacterAnimationProfile {
    return this.profile;
  }

  setProfile(profile: CharacterAnimationProfile): void {
    this.profile = normalizeCharacterAnimationProfile(profile);
    void this.enterState(this.state, 'force', true);
    this.emit();
  }

  getState(): FsmStateId {
    return this.state;
  }

  getSnapshot(): FsmSnapshot {
    return {
      state: this.state,
      previousState: this.previousState,
      activeClipName: this.activeClipName,
      activeClipFile: this.activeClipFile,
      lastTrigger: this.lastTrigger,
      lastTransitionLabel: this.lastTransitionLabel,
      transitionPulse: this.transitionPulse,
      profileId: this.profile.id,
    };
  }

  onChange(listener: (snapshot: FsmSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tick(delta: number): void {
    if (this.transitionPulse > 0) {
      this.transitionPulse = Math.max(0, this.transitionPulse - delta * 2.8);
      this.emit();
    }
  }

  async preload(): Promise<void> {
    const bindings = Object.values(this.profile.states).flatMap((state) => state.clips);
    await Promise.all(bindings.map((binding) => this.options.player.loadBinding(binding)));
  }

  async holdTpose(): Promise<void> {
    await this.enterState('tpose', 'force', true);
  }

  isRigDressReady(): boolean {
    return this.rigDressReady;
  }

  clearRigDressReady(): void {
    this.rigDressReady = false;
  }

  getActiveClipName(): string | null {
    return this.activeClipName;
  }

  async preloadTposeClip(): Promise<void> {
    await this.options.player.loadBinding(this.pickClipForState('tpose'));
  }

  async enterDressTpose(poseFadeSec: number): Promise<void> {
    this.rigDressReady = false;
    await this.enterState('tpose', 'force', true, undefined, poseFadeSec);
  }

  /**
   * Rig dress sequence: T-pose clip → settle bones → hold pose for garment placement.
   */
  async runRigDressSequence(options: RigDressSequenceOptions = {}): Promise<RigDressSequenceResult> {
    if (this.dressSequenceActive) {
      return {
        passed: false,
        state: this.state,
        activeClipName: this.activeClipName,
        poseFadeSec: 0,
        poseSettleSec: 0,
        settleSteps: 0,
        failures: ['rig dress sequence already running'],
      };
    }
    this.dressSequenceActive = true;
    this.rigDressReady = false;
    try {
      const result = await runRigDressSequence(this, options);
      if (result.passed) {
        this.rigDressReady = true;
      }
      return result;
    } finally {
      this.dressSequenceActive = false;
      this.emit();
    }
  }

  async trigger(trigger: FsmTriggerId): Promise<boolean> {
    if (this.dressSequenceActive) {
      return false;
    }
    const transition = this.findTransition(this.state, trigger);
    if (!transition) {
      return false;
    }
    const fromDressHold = this.rigDressReady && this.state === 'tpose' && transition.to === 'idle';
    const fadeOverride = fromDressHold
      ? (this.profile.parameters.dressBlendToIdleSec ?? 0.85)
      : undefined;
    const entered = await this.enterState(transition.to, trigger, false, transition, fadeOverride);
    if (transition.to !== 'tpose') {
      this.rigDressReady = false;
    }
    return entered;
  }

  async forceState(stateId: FsmStateId): Promise<void> {
    if (this.dressSequenceActive && stateId !== 'tpose') {
      return;
    }
    if (stateId !== 'tpose') {
      this.rigDressReady = false;
    }
    await this.enterState(stateId, 'force', true);
  }

  getTransitions(): readonly FsmTransitionDefinition[] {
    return this.profile.transitions;
  }

  pickClipForState(stateId: FsmStateId): StateClipBinding {
    const definition = this.profile.states[stateId];
    if (definition.clips.length === 0) {
      throw new Error(`State ${stateId} has no clips`);
    }
    if (definition.pick === 'random' && definition.clips.length > 1) {
      return definition.clips[Math.floor(Math.random() * definition.clips.length)]!;
    }
    return definition.clips[0]!;
  }

  private findTransition(from: FsmStateId, trigger: FsmTriggerId): FsmTransitionDefinition | null {
    return (
      this.profile.transitions.find((transition) => transition.trigger === trigger && transition.from === from)
      ?? this.profile.transitions.find((transition) => transition.trigger === trigger && transition.from === '*')
      ?? null
    );
  }

  private async enterState(
    next: FsmStateId,
    trigger: FsmTriggerId,
    force: boolean,
    transition?: FsmTransitionDefinition,
    fadeOverrideSec?: number,
  ): Promise<boolean> {
    if (!force && next === this.state && trigger !== 'attack') {
      return false;
    }

    const from = this.state;
    this.previousState = from;
    this.state = next;
    this.lastTrigger = trigger;
    this.lastTransitionLabel = transition?.label ?? trigger;
    this.transitionPulse = 1;

    const clip = this.pickClipForState(next);
    this.options.rig.muteEmbeddedAnimations();
    if (from === 'tpose' && next !== 'tpose') {
      this.options.player.releaseDressPose();
    }
    const fadeDuration = fadeOverrideSec ?? resolveClipFadeDuration(this.profile, next, clip);
    await this.options.player.playBinding(clip, {
      loop: clip.loop,
      fadeDuration,
    });
    this.activeClipName = clip.name;
    this.activeClipFile = clip.subclipId ?? clip.file ?? null;

    if (transition) {
      this.options.onTransition?.(from, next, trigger, transition);
    }
    await this.options.onStateEntered?.(next);
    this.emit();
    return true;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
