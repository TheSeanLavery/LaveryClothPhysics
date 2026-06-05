import type { CharacterAnimationProfile } from '../animations/characterAnimationProfile.ts';
import { shortestAngleDelta } from './rigForwardMeasure.ts';

export interface MovementSmoothingParams {
  readonly moveAccel: number;
  readonly moveDecel: number;
  readonly inputSmoothTau: number;
  readonly moveStopSpeed: number;
  readonly turnAccel: number;
  readonly turnDecel: number;
  readonly maxTurnSpeed: number;
  readonly walkDirectionSmoothTau: number;
  readonly attackStepRampSec: number;
  /** 0 = instant snap; otherwise max turn rate (rad/s) when aligning for attacks. */
  readonly attackFacingTurnSpeed: number;
}

const DEFAULTS: Omit<MovementSmoothingParams, 'maxTurnSpeed'> = {
  moveAccel: 8,
  moveDecel: 2.5,
  inputSmoothTau: 0.1,
  moveStopSpeed: 0.04,
  turnAccel: 10,
  turnDecel: 6,
  walkDirectionSmoothTau: 0.12,
  attackStepRampSec: 0.15,
  attackFacingTurnSpeed: 14,
};

export function resolveMovementSmoothingParams(
  parameters: CharacterAnimationProfile['parameters'],
): MovementSmoothingParams {
  return {
    moveAccel: parameters.moveAccel ?? DEFAULTS.moveAccel,
    moveDecel: parameters.moveDecel ?? DEFAULTS.moveDecel,
    inputSmoothTau: parameters.inputSmoothTau ?? DEFAULTS.inputSmoothTau,
    moveStopSpeed: parameters.moveStopSpeed ?? DEFAULTS.moveStopSpeed,
    turnAccel: parameters.turnAccel ?? DEFAULTS.turnAccel,
    turnDecel: parameters.turnDecel ?? DEFAULTS.turnDecel,
    maxTurnSpeed: parameters.turnSpeed,
    walkDirectionSmoothTau: parameters.walkDirectionSmoothTau ?? DEFAULTS.walkDirectionSmoothTau,
    attackStepRampSec: parameters.attackStepRampSec ?? DEFAULTS.attackStepRampSec,
    attackFacingTurnSpeed: parameters.attackFacingTurnSpeed ?? DEFAULTS.attackFacingTurnSpeed,
  };
}

export function expSmoothScalar(
  current: number,
  target: number,
  delta: number,
  tau: number,
): number {
  if (tau <= 0 || delta <= 0) {
    return target;
  }
  const alpha = 1 - Math.exp(-delta / tau);
  return current + (target - current) * alpha;
}

export function smoothInput2D(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  delta: number,
  tau: number,
): { x: number; z: number } {
  return {
    x: expSmoothScalar(currentX, targetX, delta, tau),
    z: expSmoothScalar(currentZ, targetZ, delta, tau),
  };
}

export function smoothVelocity2D(
  currentX: number,
  currentZ: number,
  desiredX: number,
  desiredZ: number,
  delta: number,
  accel: number,
  decel: number,
): { x: number; z: number } {
  const errX = desiredX - currentX;
  const errZ = desiredZ - currentZ;
  const errLen = Math.hypot(errX, errZ);
  if (errLen < 1e-9) {
    const speed = Math.hypot(currentX, currentZ);
    if (speed < 1e-9) {
      return { x: 0, z: 0 };
    }
    const decelStep = decel * delta;
    const nextSpeed = Math.max(0, speed - decelStep);
    const scale = nextSpeed / speed;
    return { x: currentX * scale, z: currentZ * scale };
  }
  const desiredSpeed = Math.hypot(desiredX, desiredZ);
  const currentSpeed = Math.hypot(currentX, currentZ);
  const isBraking = desiredSpeed < currentSpeed - 1e-6;
  const rate = isBraking ? decel : accel;
  const step = Math.min(errLen, rate * delta);
  return {
    x: currentX + (errX / errLen) * step,
    z: currentZ + (errZ / errLen) * step,
  };
}

export function stepAngularVelocity(
  angularVelocity: number,
  currentYaw: number,
  targetYaw: number,
  delta: number,
  params: Pick<MovementSmoothingParams, 'turnAccel' | 'turnDecel' | 'maxTurnSpeed'>,
): { yaw: number; angularVelocity: number } {
  if (delta <= 0) {
    return { yaw: currentYaw, angularVelocity };
  }
  const deltaYaw = shortestAngleDelta(currentYaw, targetYaw);
  const desiredAngularVelocity = Math.max(
    -params.maxTurnSpeed,
    Math.min(params.maxTurnSpeed, deltaYaw / delta),
  );
  const velocityError = desiredAngularVelocity - angularVelocity;
  const accelerating = Math.abs(desiredAngularVelocity) > Math.abs(angularVelocity) + 1e-6
    && Math.sign(velocityError) === Math.sign(desiredAngularVelocity);
  const rate = accelerating ? params.turnAccel : params.turnDecel;
  const velocityStep = Math.max(-rate * delta, Math.min(rate * delta, velocityError));
  let nextAngularVelocity = angularVelocity + velocityStep;
  nextAngularVelocity = Math.max(
    -params.maxTurnSpeed,
    Math.min(params.maxTurnSpeed, nextAngularVelocity),
  );
  const yawStep = Math.max(-Math.abs(deltaYaw), Math.min(Math.abs(deltaYaw), nextAngularVelocity * delta));
  return {
    yaw: currentYaw + yawStep,
    angularVelocity: Math.abs(yawStep) < Math.abs(nextAngularVelocity * delta) ? yawStep / delta : nextAngularVelocity,
  };
}
