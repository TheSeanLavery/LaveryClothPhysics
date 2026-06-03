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

export class CharacterAnimationStateMachine {
  private profile: CharacterAnimationProfile;
  private state: FsmStateId = 'tpose';
  private previousState: FsmStateId | null = null;
  private lastTrigger: FsmTriggerId | null = null;
  private lastTransitionLabel: string | null = null;
  private activeClipName: string | null = null;
  private activeClipFile: string | null = null;
  private transitionPulse = 0;
  private readonly listeners = new Set<(snapshot: FsmSnapshot) => void>();

  constructor(
    profile: CharacterAnimationProfile,
    private readonly options: CharacterAnimationStateMachineOptions,
  ) {
    this.profile = normalizeCharacterAnimationProfile(profile);
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

  async trigger(trigger: FsmTriggerId): Promise<boolean> {
    const transition = this.findTransition(this.state, trigger);
    if (!transition) {
      return false;
    }
    return this.enterState(transition.to, trigger, false, transition);
  }

  async forceState(stateId: FsmStateId): Promise<void> {
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
    await this.options.player.playBinding(clip, {
      loop: clip.loop,
      fadeDuration: resolveClipFadeDuration(this.profile, next, clip),
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
