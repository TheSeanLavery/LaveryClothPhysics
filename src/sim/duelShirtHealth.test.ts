import assert from 'node:assert/strict';
import test from 'node:test';
import { recomputeVertexComponents, type ClothGraphEdge } from './clothComponents.ts';
import {
  applyDuelTearPenalties,
  brokenPercentForZeroHealth,
  buildParticleFighterMask,
  captureDuelShirtHealthBaseline,
  computeDuelShirtHealth,
  computeDuelShirtHealthFromAttachment,
  DEFAULT_DUEL_SHIRT_HEALTH_DISPLAY_CONFIG,
  isShirtVertexAttachedToBody,
  mapDuelShirtDisplayHealth,
  measureDuelFighterShirtAttachment,
  zeroBelowRemainingFromBrokenPercent,
} from './duelShirtHealth.ts';

test('buildParticleFighterMask maps assembly vertices to fighters', () => {
  const mask = buildParticleFighterMask(
    { fighterAVertexCount: 2, renderVertexToParticle: [10, 11, 20, 21] },
    30,
  );
  assert.equal(mask[10], 0);
  assert.equal(mask[11], 0);
  assert.equal(mask[20], 1);
  assert.equal(mask[21], 1);
});

test('computeDuelShirtHealth is full when all structural edges are intact', () => {
  const structuralEdges: ClothGraphEdge[] = [
    { id: 0, v0: 0, v1: 1 },
    { id: 1, v0: 1, v1: 2 },
    { id: 2, v0: 2, v1: 3 },
    { id: 3, v0: 4, v1: 5 },
    { id: 4, v0: 5, v1: 6 },
  ];
  const particleMask = buildParticleFighterMask(
    { fighterAVertexCount: 4, renderVertexToParticle: [0, 1, 2, 3, 4, 5, 6] },
    7,
  );
  const baseline = captureDuelShirtHealthBaseline(structuralEdges, particleMask);
  const edgeActive = new Uint32Array([1, 1, 1, 1, 1]);
  const components = recomputeVertexComponents(7, structuralEdges, edgeActive);
  const health = computeDuelShirtHealth(
    edgeActive,
    structuralEdges,
    particleMask,
    components,
    baseline,
    0,
    0,
  );
  assert.equal(health.fighterA, 1);
  assert.equal(health.fighterB, 1);
});

test('computeDuelShirtHealth drops when structural edges break', () => {
  const structuralEdges: ClothGraphEdge[] = [
    { id: 0, v0: 0, v1: 1 },
    { id: 1, v0: 0, v1: 2 },
    { id: 2, v0: 2, v1: 3 },
  ];
  const particleMask = buildParticleFighterMask(
    { fighterAVertexCount: 3, renderVertexToParticle: [0, 1, 2, 3] },
    4,
  );
  const baseline = captureDuelShirtHealthBaseline(structuralEdges, particleMask);
  const edgeActive = new Uint32Array([0, 1, 1]);
  const components = new Uint32Array([0, 1, 0, 2]);

  const health = computeDuelShirtHealth(
    edgeActive,
    structuralEdges,
    particleMask,
    components,
    baseline,
    0,
    0,
  );
  assert.ok(health.fighterA < 1);
  assert.equal(health.fighterB, 1);
});

test('measureDuelFighterShirtAttachment counts vertices near fighter capsules', () => {
  const clearance = 0.008;
  const capsulesA = [
    {
      start: [0, 1, 0] as [number, number, number],
      end: [0, 1.4, 0] as [number, number, number],
      radius: 0.12,
      name: 'chest',
    },
  ];
  const vertices = [
    { position: [0, 1.05, 0.1] as [number, number, number] },
    { position: [0, 1.06, -0.05] as [number, number, number] },
    { position: [5, 5, 5] as [number, number, number] },
  ];
  assert.equal(isShirtVertexAttachedToBody(vertices[0]!.position, capsulesA, clearance), true);
  assert.equal(isShirtVertexAttachedToBody([0, 1.02, 0] as [number, number, number], capsulesA, clearance), true);
  assert.equal(isShirtVertexAttachedToBody(vertices[2]!.position, capsulesA, clearance), false);
  const report = measureDuelFighterShirtAttachment(vertices, 2, capsulesA, [], clearance);
  assert.equal(report.attachedA, 2);
  assert.equal(report.totalA, 2);
});

const emptyBroken = { fighterA: 0, fighterB: 0 };

test('computeDuelShirtHealthFromAttachment is full at dress baseline', () => {
  const dress = { attachedA: 80, totalA: 100, attachedB: 70, totalB: 90 };
  const health = computeDuelShirtHealthFromAttachment(dress, dress, emptyBroken, null, 0, 0);
  assert.equal(health.fighterA, 1);
  assert.equal(health.fighterB, 1);
});

test('computeDuelShirtHealthFromAttachment drops when fewer vertices stay on body', () => {
  const dress = { attachedA: 80, totalA: 100, attachedB: 70, totalB: 90 };
  const current = { attachedA: 40, totalA: 100, attachedB: 70, totalB: 90 };
  const lenientConfig = { zeroBelowRemainingRatio: 0.15, maxTearPenalty: 0.12 };
  const health = computeDuelShirtHealthFromAttachment(
    current,
    dress,
    emptyBroken,
    null,
    0,
    0,
    lenientConfig,
  );
  assert.ok(health.fighterA > 0.2);
  assert.ok(health.fighterA < 0.75);
  assert.equal(health.fighterB, 1);
});

test('mapDuelShirtDisplayHealth hits zero below tunable remaining threshold', () => {
  const config = { zeroBelowRemainingRatio: zeroBelowRemainingFromBrokenPercent(85), maxTearPenalty: 0.12 };
  assert.equal(mapDuelShirtDisplayHealth(0.14, 0, config), 0);
  assert.ok(mapDuelShirtDisplayHealth(0.5, 0, config) > 0.35);
});

test('default display config zeros health at 12% broken', () => {
  assert.equal(brokenPercentForZeroHealth(DEFAULT_DUEL_SHIRT_HEALTH_DISPLAY_CONFIG), 12);
});

test('zeroBelowRemainingFromBrokenPercent spans full 0–100 broken range', () => {
  assert.equal(zeroBelowRemainingFromBrokenPercent(0), 1);
  assert.equal(zeroBelowRemainingFromBrokenPercent(1), 0.99);
  assert.equal(zeroBelowRemainingFromBrokenPercent(100), 0);
});

test('computeDuelShirtHealthFromAttachment uses broken structural edges', () => {
  const dress = { attachedA: 100, totalA: 100, attachedB: 100, totalB: 100 };
  const current = { attachedA: 100, totalA: 100, attachedB: 100, totalB: 100 };
  const structuralBaseline = { structuralEdgesA: 10, structuralEdgesB: 10, particlesA: 4, particlesB: 4 };
  const health = computeDuelShirtHealthFromAttachment(
    current,
    dress,
    { fighterA: 9, fighterB: 0 },
    structuralBaseline,
    0,
    0,
    { zeroBelowRemainingRatio: 0.1, maxTearPenalty: 0.12 },
  );
  assert.equal(health.fighterA, 0);
  assert.equal(health.fighterB, 1);
});

test('applyDuelTearPenalties stacks health loss per new broken edge', () => {
  const next = applyDuelTearPenalties(
    { fighterA: 3, fighterB: 0 },
    { fighterA: 1, fighterB: 0 },
    0,
    0,
    0.02,
  );
  assert.equal(next.penaltyA, 0.04);
});
