import type { AnimatedCharacterSceneRig } from '../character/AnimatedCharacter.ts';
import {
  SHIRT_DRESS_POSE_SETTLE_SEC,
  waitForRigsAnimationSettle,
  type RigAnimationDriver,
} from '../character/characterGarmentDress.ts';
import type { CharacterAnimationPlayer } from './CharacterAnimationPlayer.ts';
import type { CharacterAnimationProfile } from './characterAnimationProfile.ts';
import { resolveClipFadeDuration, type FsmStateId } from './characterAnimationProfile.ts';

export interface RigDressSequenceOptions {
  /** Load the profile T-pose clip before entering pose (default true). */
  readonly preloadTpose?: boolean;
  /** Crossfade into T-pose; 0 = instant (default from profile or 0). */
  readonly poseFadeSec?: number;
  /** Mixer steps after T-pose before garment work (default from profile). */
  readonly poseSettleSec?: number;
  /** Pause the active clip at frame 0 after settle (default true). */
  readonly holdPose?: boolean;
  /** Called each settle frame (e.g. duel boot: advance cloth sim + render). */
  readonly onFrame?: () => void;
}

export interface RigDressSequenceResult {
  readonly passed: boolean;
  readonly state: FsmStateId;
  readonly activeClipName: string | null;
  readonly poseFadeSec: number;
  readonly poseSettleSec: number;
  readonly settleSteps: number;
  readonly failures: readonly string[];
}

export interface RigDressSequenceHost {
  readonly rig: AnimatedCharacterSceneRig;
  readonly player: CharacterAnimationPlayer;
  getProfile(): CharacterAnimationProfile;
  getState(): FsmStateId;
  getActiveClipName(): string | null;
  preloadTposeClip(): Promise<void>;
  enterDressTpose(poseFadeSec: number): Promise<void>;
}

export function resolveRigDressTiming(
  profile: CharacterAnimationProfile,
  options: RigDressSequenceOptions = {},
): { readonly poseFadeSec: number; readonly poseSettleSec: number; readonly settleSteps: number } {
  const binding = profile.states.tpose.clips[0]!;
  const poseFadeSec = options.poseFadeSec
    ?? profile.parameters.dressPoseFadeSec
    ?? 0;
  const poseSettleSec = options.poseSettleSec
    ?? profile.parameters.dressPoseSettleSec
    ?? SHIRT_DRESS_POSE_SETTLE_SEC;
  const fadeFromProfile = resolveClipFadeDuration(profile, 'tpose', binding);
  const settleSteps = Math.max(
    1,
    Math.ceil((poseSettleSec + (poseFadeSec > 0 ? fadeFromProfile : 0)) / (1 / 60)),
  );
  return { poseFadeSec, poseSettleSec, settleSteps };
}

/** Advance mixer + bone matrices until the dress T-pose is stable. */
export async function advanceRigDressSettle(
  driver: RigAnimationDriver,
  durationSec: number,
  onFrame?: () => void,
): Promise<void> {
  await waitForRigsAnimationSettle([driver], durationSec, onFrame);
}

/**
 * FSM-integrated rig dress sequence: preload T-pose → snap to pose → settle → hold.
 * Keeps the character in a known pose for shirt placement and SDF sampling.
 */
export async function runRigDressSequence(
  host: RigDressSequenceHost,
  options: RigDressSequenceOptions = {},
): Promise<RigDressSequenceResult> {
  const failures: string[] = [];
  const profile = host.getProfile();
  const { poseFadeSec, poseSettleSec, settleSteps } = resolveRigDressTiming(profile, options);
  const holdPose = options.holdPose ?? true;

  try {
    if (options.preloadTpose ?? true) {
      await host.preloadTposeClip();
    }
    await host.enterDressTpose(poseFadeSec);
    await advanceRigDressSettle(
      { rig: host.rig, player: host.player },
      poseSettleSec + (poseFadeSec > 0 ? resolveClipFadeDuration(profile, 'tpose', profile.states.tpose.clips[0]!) : 0),
      options.onFrame,
    );
    if (holdPose) {
      host.player.holdDressPoseAtFrame(0);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  const state = host.getState();
  if (state !== 'tpose') {
    failures.push(`expected FSM state tpose after dress sequence, got ${state}`);
  }

  return {
    passed: failures.length === 0,
    state,
    activeClipName: host.getActiveClipName(),
    poseFadeSec,
    poseSettleSec,
    settleSteps,
    failures,
  };
}
