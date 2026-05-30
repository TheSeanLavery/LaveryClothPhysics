import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKimonoPattern,
  createRectPanel,
  createTubePattern,
  edgeLength,
  validateGarmentPattern,
  withPleats,
  type GarmentPattern,
} from './garmentPatternGeometry.ts';

test('creates a tube as stitched panels around a closed loop', () => {
  const tube = createTubePattern({
    circumference: 2,
    height: 1,
    panelCount: 4,
  });

  assert.equal(tube.panels.length, 4);
  assert.equal(tube.seams.length, 4);
  assert.deepEqual(validateGarmentPattern(tube), []);
  assert.equal(tube.seams[3]!.b.panelId, 'tube-panel-0');
});

test('uses trapezoid panel side lengths when validating flared tube seams', () => {
  const tube = createTubePattern({
    circumference: 2,
    height: 1,
    panelCount: 4,
    flareRatio: 1.6,
  });

  assert.deepEqual(validateGarmentPattern(tube), []);
  assert.ok(edgeLength(tube.panels[0]!.edges.bottom) > edgeLength(tube.panels[0]!.edges.top));
});

test('reports stitched edge length mismatches without enough ease', () => {
  const shortPanel = createRectPanel({ id: 'short', width: 1, height: 1 });
  const tallPanel = createRectPanel({ id: 'tall', width: 1, height: 2 });
  const pattern: GarmentPattern = {
    id: 'bad-seam',
    label: 'Bad seam',
    panels: [shortPanel, tallPanel],
    seams: [
      {
        id: 'side',
        kind: 'stitch',
        a: { panelId: shortPanel.id, edgeId: 'left' },
        b: { panelId: tallPanel.id, edgeId: 'left' },
      },
    ],
    modifiers: [],
  };

  const issues = validateGarmentPattern(pattern);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.seamId, 'side');
});

test('adds pleat modifiers without mutating the original pattern', () => {
  const tube = createTubePattern({ circumference: 2, height: 1, panelCount: 2 });
  const pleated = withPleats(tube, {
    panelId: 'tube-panel-0',
    count: 5,
    depth: 0.03,
    from: [0.1, 0.9],
    to: [0.9, 0.9],
  });

  assert.equal(tube.modifiers.length, 0);
  assert.equal(pleated.modifiers.length, 1);
  assert.equal(pleated.modifiers[0]!.direction, 'box');
});

test('creates kimono pattern from mostly rectangular panels', () => {
  const kimono = createKimonoPattern({
    bodyWidth: 1.2,
    bodyHeight: 1.4,
    sleeveLength: 0.7,
    sleeveWidth: 0.45,
  });

  assert.equal(kimono.panels.length, 5);
  assert.ok(kimono.seams.some((seam) => seam.id === 'kimono-left-sleeve-attach'));
});
