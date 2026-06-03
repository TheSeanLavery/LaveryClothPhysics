import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CALIBRATION_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/animationClipCalibration.json',
);

test('animationClipCalibration.json exists and rokoko clips share one forward bucket', () => {
  assert.ok(
    existsSync(CALIBRATION_PATH),
    'Run npm run audit:clips to generate data/animationClipCalibration.json',
  );
  const data = JSON.parse(readFileSync(CALIBRATION_PATH, 'utf8')) as {
    version: number;
    buckets: Record<string, { count: number; spreadDeg: number }>;
    familyDefaults: Record<string, { count: number; spreadDeg: number | null }>;
    clips: Record<string, { status: string; deltaYawDeg: number | null }>;
  };
  assert.equal(data.version, 1);
  const zeroBucket = data.buckets['0°'];
  assert.ok(zeroBucket && zeroBucket.count >= 130, 'most clips should be in 0° bucket');
  assert.ok(zeroBucket.spreadDeg < 5, 'rokoko family should be tightly aligned at t=0');

  const rokoko = data.familyDefaults['rokoko-mixamo'];
  assert.ok(rokoko && rokoko.count >= 100);
  assert.ok(rokoko.spreadDeg !== null && rokoko.spreadDeg < 3);

  const step = data.clips['rokoko-mixamo/StepForward_mixamo.fbx'];
  const light = data.clips['rokoko-mixamo/Light_mixamo.fbx'];
  assert.equal(step?.status, 'ok');
  assert.equal(light?.status, 'ok');
  assert.ok(Math.abs((step?.deltaYawDeg ?? 99)) < 3);
  assert.ok(Math.abs((light?.deltaYawDeg ?? 99)) < 3);
});
