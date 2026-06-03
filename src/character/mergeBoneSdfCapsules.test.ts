import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeBoneSdfCapsules, type BoneSdfCapsuleSummary } from './mergeBoneSdfCapsules.ts';

function capsule(name: string, index: number): BoneSdfCapsuleSummary {
  return {
    id: index,
    name,
    parentName: 'root',
    radius: 0.05,
    length: 0.2,
    start: [0, 0, 0],
    end: [0, 0.2, 0],
  };
}

test('mergeBoneSdfCapsules concatenates groups and reindexes ids', () => {
  const merged = mergeBoneSdfCapsules([
    [capsule('mixamorigHips', 0), capsule('soft-chest-left-jiggle', 1)],
    [capsule('mixamorigSpine', 2)],
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((entry) => entry.id), [0, 1, 2]);
});

test('mergeBoneSdfCapsules prioritizes body capsules when over the limit', () => {
  const filler = Array.from({ length: 100 }, (_, index) => capsule(`soft-foot-rail-${index}`, index));
  const body = [
    capsule('mixamorigLeftArm', 1_000),
    capsule('mixamorigRightUpLeg', 1_001),
    capsule('soft-chest-left-jiggle', 1_002),
  ];
  const merged = mergeBoneSdfCapsules([filler, body], 96);
  assert.equal(merged.length, 96);
  assert.ok(merged.some((entry) => entry.name === 'mixamorigLeftArm'));
  assert.ok(merged.some((entry) => entry.name === 'mixamorigRightUpLeg'));
  assert.ok(merged.some((entry) => entry.name === 'soft-chest-left-jiggle'));
});
