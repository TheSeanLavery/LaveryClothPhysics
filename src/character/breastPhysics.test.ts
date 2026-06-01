import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BreastPhysicsSimulator } from './breastPhysics.ts';

const DT = 1 / 60;

describe('breast physics simulator', () => {
  it('starts at rest with zero offsets', () => {
    const sim = new BreastPhysicsSimulator();
    assert.equal(sim.left.offsetY, 0);
    assert.equal(sim.right.offsetX, 0);
    assert.ok(!sim.isMoving());
  });

  it('produces vertical jiggle when chest moves up', () => {
    const sim = new BreastPhysicsSimulator();
    // First frame establishes baseline
    sim.step(0, 1.0, 0, 0);
    // Chest jumps upward
    sim.step(0, 1.05, 0, DT);
    assert.ok(sim.isMoving(), 'should be moving after vertical impulse');
    // Breasts lag behind (negative offset = downward relative to chest)
    assert.ok(sim.left.offsetY < 0, `left offsetY should be negative, got ${sim.left.offsetY}`);
    assert.ok(sim.right.offsetY < 0, `right offsetY should be negative, got ${sim.right.offsetY}`);
  });

  it('produces vertical jiggle when chest drops down', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.step(0, 0.95, 0, DT);
    // Breasts lag upward when chest drops
    assert.ok(sim.left.offsetY > 0, `left offsetY should be positive on drop, got ${sim.left.offsetY}`);
    assert.ok(sim.right.offsetY > 0, `right offsetY should be positive on drop, got ${sim.right.offsetY}`);
  });

  it('produces lateral sway when chest moves sideways', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    // Chest moves right (+X)
    sim.step(0.04, 1.0, 0, DT);
    // Both breasts lag to the left (negative X offset)
    assert.ok(sim.left.offsetX < 0, `left offsetX should be negative, got ${sim.left.offsetX}`);
    assert.ok(sim.right.offsetX < 0, `right offsetX should be negative, got ${sim.right.offsetX}`);
  });

  it('produces forward bounce when chest lurches forward', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    // Chest lunges forward (+Z)
    sim.step(0, 1.0, 0.04, DT);
    // Breasts lag backward (negative Z)
    assert.ok(sim.left.offsetZ < 0, `left offsetZ should be negative, got ${sim.left.offsetZ}`);
    assert.ok(sim.right.offsetZ < 0, `right offsetZ should be negative, got ${sim.right.offsetZ}`);
  });

  it('oscillates and settles back to rest over time', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    // Simulate a bounce: chest goes up then stops (direction change = acceleration)
    sim.step(0, 1.04, 0, DT);
    sim.step(0, 1.08, 0, DT);
    sim.step(0, 1.08, 0, DT); // sudden stop = deceleration spike
    // Use applyImpulse to guarantee meaningful displacement for settle test
    sim.applyImpulse('both', 0, 0.5, 0);
    for (let i = 0; i < 5; i++) {
      sim.step(0, 1.08, 0, DT);
    }
    const peakOffset = Math.abs(sim.left.offsetY);
    assert.ok(peakOffset > 0.001, `should have meaningful displacement, got ${peakOffset.toFixed(6)}`);

    // Run for 2 seconds at rest position — spring should settle
    for (let i = 0; i < 120; i++) {
      sim.step(0, 1.08, 0, DT);
    }
    assert.ok(
      Math.abs(sim.left.offsetY) < peakOffset * 0.05,
      `should settle: peak=${peakOffset.toFixed(4)} final=${Math.abs(sim.left.offsetY).toFixed(4)}`,
    );
  });

  it('respects maximum offset clamps', () => {
    const sim = new BreastPhysicsSimulator({ maxOffsetY: 0.02, maxOffsetX: 0.01 });
    sim.step(0, 0, 0, 0);
    // Massive impulse
    sim.step(0, 5.0, 0, DT);
    assert.ok(Math.abs(sim.left.offsetY) <= 0.02 + 1e-9, 'Y offset should be clamped');
    sim.step(5.0, 5.0, 0, DT);
    assert.ok(Math.abs(sim.left.offsetX) <= 0.01 + 1e-9, 'X offset should be clamped');
  });

  it('left and right breasts move together on vertical impulse', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.step(0, 1.05, 0, DT);
    assert.equal(sim.left.offsetY, sim.right.offsetY);
    assert.equal(sim.left.offsetX, sim.right.offsetX);
  });

  it('reset clears all state', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.step(0, 1.1, 0, DT);
    assert.ok(sim.isMoving());
    sim.reset();
    assert.ok(!sim.isMoving());
    assert.equal(sim.left.offsetY, 0);
    assert.equal(sim.right.velocityX, 0);
  });

  it('snapshot returns an independent copy', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.step(0, 1.05, 0, DT);
    const snap = sim.snapshot();
    const savedY = snap.left.offsetY;
    sim.step(0, 1.05, 0, DT);
    assert.equal(snap.left.offsetY, savedY, 'snapshot should not mutate');
  });

  it('multi-axis impulse produces displacement on all three axes', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    // Diagonal impulse: up + right + forward
    sim.step(0.03, 1.04, 0.02, DT);
    assert.ok(Math.abs(sim.left.offsetY) > 0.0001, 'Y should respond');
    assert.ok(Math.abs(sim.left.offsetX) > 0.0001, 'X should respond');
    assert.ok(Math.abs(sim.left.offsetZ) > 0.0001, 'Z should respond');
  });

  it('applyImpulse kicks a single breast', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.applyImpulse('left', 0, 0.5, 0);
    // Left should have velocity, right should not
    assert.ok(sim.left.velocityY > 0.4, 'left velocityY should be kicked');
    assert.equal(sim.right.velocityY, 0, 'right should be untouched');
    // Step forward — left should now have offset
    sim.step(0, 1.0, 0, DT);
    assert.ok(sim.left.offsetY > 0, 'left should displace after impulse');
    assert.equal(sim.right.offsetY, 0, 'right should stay at rest');
  });

  it('applyImpulse both kicks both breasts', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.applyImpulse('both', 0.3, 0, 0);
    assert.ok(sim.left.velocityX > 0.2, 'left X velocity');
    assert.ok(sim.right.velocityX > 0.2, 'right X velocity');
  });

  it('produces visible oscillation pattern over multiple frames', () => {
    const sim = new BreastPhysicsSimulator();
    sim.step(0, 1.0, 0, 0);
    sim.step(0, 1.06, 0, DT);

    // Collect Y offsets over ~1.5 seconds to capture full oscillation
    const offsets: number[] = [];
    for (let i = 0; i < 90; i++) {
      sim.step(0, 1.06, 0, DT);
      offsets.push(sim.left.offsetY);
    }

    // Verify sign changes (oscillation) — should cross zero at least once
    let signChanges = 0;
    for (let i = 1; i < offsets.length; i++) {
      if (Math.sign(offsets[i]!) !== Math.sign(offsets[i - 1]!) && offsets[i] !== 0) {
        signChanges++;
      }
    }
    assert.ok(signChanges >= 1, `expected oscillation (sign changes), got ${signChanges}`);
  });
});
