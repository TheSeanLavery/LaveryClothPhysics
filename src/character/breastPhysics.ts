/**
 * Multi-axis spring-damper breast physics simulator.
 *
 * Each breast is an independent 3-axis (vertical, lateral, forward) spring
 * that reacts to the chest bone's acceleration. The lateral axis adds
 * per-side sway (left breast swings right when torso moves left, etc.)
 * and the forward axis adds bounce depth.
 *
 * Inspired by DOA-style secondary motion — the capsule SDF offsets
 * produced here feed directly into AnimatedCharacter's soft-chest capsules.
 */

export interface BreastSpringState {
  /** Offset from rest along each local axis (vertical, lateral, forward). */
  offsetY: number;
  offsetX: number;
  offsetZ: number;
  /** Velocity along each axis. */
  velocityY: number;
  velocityX: number;
  velocityZ: number;
}

export interface BreastPhysicsConfig {
  /** Spring stiffness per axis. Higher = snappier return to rest. */
  stiffnessY: number;
  stiffnessX: number;
  stiffnessZ: number;
  /** Damping per axis. Higher = less oscillation. */
  dampingY: number;
  dampingX: number;
  dampingZ: number;
  /** How strongly chest motion maps to breast drive per axis. */
  responseY: number;
  responseX: number;
  responseZ: number;
  /** Maximum displacement clamp per axis. */
  maxOffsetY: number;
  maxOffsetX: number;
  maxOffsetZ: number;
}

export interface BreastPhysicsSnapshot {
  readonly left: Readonly<BreastSpringState>;
  readonly right: Readonly<BreastSpringState>;
}

export const DEFAULT_BREAST_PHYSICS_CONFIG: Readonly<BreastPhysicsConfig> = {
  stiffnessY: 65,
  stiffnessX: 60,
  stiffnessZ: 55,
  dampingY: 5.5,
  dampingX: 5.0,
  dampingZ: 5.0,
  responseY: 0.08,
  responseX: 0.08,
  responseZ: 0.05,
  maxOffsetY: 0.07,
  maxOffsetX: 0.07,
  maxOffsetZ: 0.04,
};

function createSpring(): BreastSpringState {
  return { offsetY: 0, offsetX: 0, offsetZ: 0, velocityY: 0, velocityX: 0, velocityZ: 0 };
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Pure-logic breast physics simulator. No Three.js dependency — takes
 * scalar chest-position deltas and produces per-breast offset vectors.
 */
export class BreastPhysicsSimulator {
  readonly left: BreastSpringState = createSpring();
  readonly right: BreastSpringState = createSpring();
  config: BreastPhysicsConfig;

  private lastChestX: number | null = null;
  private lastChestY: number | null = null;
  private lastChestZ: number | null = null;
  private lastVelX = 0;
  private lastVelY = 0;
  private lastVelZ = 0;

  constructor(config: Partial<BreastPhysicsConfig> = {}) {
    this.config = { ...DEFAULT_BREAST_PHYSICS_CONFIG, ...config };
  }

  /**
   * Step the simulation forward.
   *
   * Computes proper velocity (units/sec) and acceleration (units/sec²)
   * from chest bone world position. Acceleration-dominant drive means
   * direction changes (dance bounces, hip thrusts) produce strong jiggle.
   *
   * @param chestX  Current chest bone X position (lateral, in local frame).
   * @param chestY  Current chest bone Y position (vertical).
   * @param chestZ  Current chest bone Z position (forward/back).
   * @param delta   Frame time in seconds. Pass 0 on first frame.
   */
  step(chestX: number, chestY: number, chestZ: number, delta: number): void {
    if (delta > 0 && this.lastChestY !== null) {
      const invDt = 1.0 / delta;

      // Velocity in units/second (not raw position delta).
      const velX = (chestX - this.lastChestX!) * invDt;
      const velY = (chestY - this.lastChestY!) * invDt;
      const velZ = (chestZ - this.lastChestZ!) * invDt;

      // Acceleration in units/second² — fires hard on direction changes.
      const accelX = (velX - this.lastVelX) * invDt;
      const accelY = (velY - this.lastVelY) * invDt;
      const accelZ = (velZ - this.lastVelZ) * invDt;

      const cfg = this.config;

      // Blend: acceleration dominates (70%) so bounces/reversals drive jiggle,
      // velocity adds sustained-motion response (30%).
      const driveX = -(accelX * 0.7 + velX * 0.3) * cfg.responseX;
      const driveY = -(accelY * 0.7 + velY * 0.3) * cfg.responseY;
      const driveZ = -(accelZ * 0.7 + velZ * 0.3) * cfg.responseZ;

      const targetLagY = clamp(driveY, -cfg.maxOffsetY, cfg.maxOffsetY);
      const targetLagX = clamp(driveX, -cfg.maxOffsetX, cfg.maxOffsetX);
      const targetLagZ = clamp(driveZ, -cfg.maxOffsetZ, cfg.maxOffsetZ);

      stepSpringAxis(this.left, 'Y', targetLagY, cfg.stiffnessY, cfg.dampingY, cfg.maxOffsetY, delta);
      stepSpringAxis(this.left, 'X', targetLagX, cfg.stiffnessX, cfg.dampingX, cfg.maxOffsetX, delta);
      stepSpringAxis(this.left, 'Z', targetLagZ, cfg.stiffnessZ, cfg.dampingZ, cfg.maxOffsetZ, delta);

      stepSpringAxis(this.right, 'Y', targetLagY, cfg.stiffnessY, cfg.dampingY, cfg.maxOffsetY, delta);
      stepSpringAxis(this.right, 'X', targetLagX, cfg.stiffnessX, cfg.dampingX, cfg.maxOffsetX, delta);
      stepSpringAxis(this.right, 'Z', targetLagZ, cfg.stiffnessZ, cfg.dampingZ, cfg.maxOffsetZ, delta);

      this.lastVelX = velX;
      this.lastVelY = velY;
      this.lastVelZ = velZ;
    }

    this.lastChestX = chestX;
    this.lastChestY = chestY;
    this.lastChestZ = chestZ;
  }

  /** Returns a snapshot safe to read after stepping. */
  snapshot(): BreastPhysicsSnapshot {
    return {
      left: { ...this.left },
      right: { ...this.right },
    };
  }

  /** Reset all spring state to rest. */
  reset(): void {
    Object.assign(this.left, createSpring());
    Object.assign(this.right, createSpring());
    this.lastChestX = null;
    this.lastChestY = null;
    this.lastChestZ = null;
    this.lastVelX = 0;
    this.lastVelY = 0;
    this.lastVelZ = 0;
  }

  /**
   * Apply an external impulse (e.g. from a mouse slap).
   *
   * @param side   Which breast to hit ('left' | 'right' | 'both').
   * @param dx     Impulse along the lateral axis.
   * @param dy     Impulse along the vertical axis.
   * @param dz     Impulse along the forward axis.
   */
  applyImpulse(side: 'left' | 'right' | 'both', dx: number, dy: number, dz: number): void {
    const targets = side === 'both'
      ? [this.left, this.right]
      : [side === 'left' ? this.left : this.right];
    for (const spring of targets) {
      spring.velocityX += dx;
      spring.velocityY += dy;
      spring.velocityZ += dz;
    }
  }

  /** True when any axis has non-negligible offset or velocity (useful for tests). */
  isMoving(threshold = 0.0005): boolean {
    return (
      Math.abs(this.left.offsetY) > threshold ||
      Math.abs(this.left.offsetX) > threshold ||
      Math.abs(this.left.offsetZ) > threshold ||
      Math.abs(this.left.velocityY) > threshold ||
      Math.abs(this.left.velocityX) > threshold ||
      Math.abs(this.left.velocityZ) > threshold ||
      Math.abs(this.right.offsetY) > threshold ||
      Math.abs(this.right.offsetX) > threshold ||
      Math.abs(this.right.offsetZ) > threshold ||
      Math.abs(this.right.velocityY) > threshold ||
      Math.abs(this.right.velocityX) > threshold ||
      Math.abs(this.right.velocityZ) > threshold
    );
  }
}

function stepSpringAxis(
  state: BreastSpringState,
  axis: 'X' | 'Y' | 'Z',
  targetLag: number,
  stiffness: number,
  damping: number,
  maxOffset: number,
  delta: number,
): void {
  const offsetKey = `offset${axis}` as keyof BreastSpringState & `offset${string}`;
  const velocityKey = `velocity${axis}` as keyof BreastSpringState & `velocity${string}`;

  let velocity = state[velocityKey] as number;
  let offset = state[offsetKey] as number;

  // Spring-damper: F = stiffness * (target - current) ; damped exponentially.
  velocity += (targetLag - offset) * stiffness * delta;
  velocity *= Math.exp(-damping * delta);
  offset += velocity * delta;
  offset = clamp(offset, -maxOffset, maxOffset);

  (state as Record<string, number>)[offsetKey] = offset;
  (state as Record<string, number>)[velocityKey] = velocity;
}
