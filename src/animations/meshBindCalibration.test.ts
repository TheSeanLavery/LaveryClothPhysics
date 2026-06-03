import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CALIBRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/meshBindCalibration.json',
);

test('meshBindCalibration.json exists after audit:mesh-bind', () => {
  assert.ok(
    existsSync(CALIBRATION_PATH),
    'Run npm run audit:mesh-bind (dev server on :5174) to generate data/meshBindCalibration.json',
  );
  const data = JSON.parse(readFileSync(CALIBRATION_PATH, 'utf8')) as {
    version: number;
    recommendations: {
      meshBindYawFromBones: number;
      stanceYawOffset: number;
      empiricalMeshBindYawForWalk: number;
    };
    idle: { forwardYawRad: number | null } | null;
  };
  assert.equal(data.version, 1);
  assert.ok(Number.isFinite(data.recommendations.meshBindYawFromBones));
  assert.ok(Number.isFinite(data.recommendations.stanceYawOffset));
  assert.ok(Math.abs(data.recommendations.empiricalMeshBindYawForWalk + Math.PI / 2) < 0.01);
  assert.ok(data.idle?.forwardYawRad !== null && data.idle?.forwardYawRad !== undefined);
});
