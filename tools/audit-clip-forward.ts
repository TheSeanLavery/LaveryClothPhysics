/**
 * Audits Mixamo-style FBX clips for visual forward (XZ yaw) at t=0 vs reference tpose.
 * Writes data/animationClipCalibration.json and prints a summary.
 *
 * Usage: npm run audit:clips
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import catalogJson from '../src/animations/animationCatalog.json' with { type: 'json' };

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(REPO_ROOT, 'public/assets/characters');
/** Animation-only FBX (loads in Node). Mixamo tpose/idle include skinned mesh + textures. */
const REFERENCE_FILE = 'rokoko-mixamo/FightingIdle_mixamo.fbx';
const REFERENCE_NOTE =
  'Audit reference is FightingIdle (animation-only). Mixamo tpose/idle are mesh-heavy and skipped in Node; use the same delta buckets for rokoko clips.';
const OUTPUT_PATH = join(REPO_ROOT, 'data/animationClipCalibration.json');

const DEG = 180 / Math.PI;

type ClipFamily = 'mixamo-core' | 'rokoko-mixamo' | 'freepack' | 'meshy' | 'other';

interface CatalogEntry {
  readonly name: string;
  readonly file: string;
  readonly loop?: boolean;
  readonly source?: string;
  readonly category?: string;
}

interface ClipAuditResult {
  readonly file: string;
  readonly family: ClipFamily;
  readonly category: string | null;
  readonly name: string | null;
  readonly source: string | null;
  readonly forwardYawRad: number | null;
  readonly deltaYawRad: number | null;
  readonly deltaYawDeg: number | null;
  readonly boneMatchRatio: number;
  readonly trackCount: number;
  readonly status:
    | 'ok'
    | 'no-animation'
    | 'no-bones'
    | 'no-forward'
    | 'missing-file'
    | 'skinned-mesh'
    | 'error';
  readonly error?: string;
}

interface CalibrationOutput {
  readonly version: 1;
  readonly generatedAt: string;
  readonly referenceNote: string;
  readonly reference: {
    readonly file: string;
    readonly forwardYawRad: number;
  };
  readonly buckets: Record<string, {
    readonly count: number;
    readonly medianDeltaYawRad: number;
    readonly spreadDeg: number;
    readonly files: readonly string[];
  }>;
  readonly familyDefaults: Record<ClipFamily, {
    readonly count: number;
    readonly medianDeltaYawRad: number | null;
    readonly spreadDeg: number | null;
  }>;
  readonly clips: Record<string, ClipAuditResult>;
}

const TMP_HIPS = new THREE.Vector3();
const TMP_SPINE = new THREE.Vector3();
const TMP_LEFT = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_RIGHT_AXIS = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_Q = new THREE.Quaternion();
const TMP_POS = new THREE.Vector3();

const fbxLoader = new FBXLoader();
let nodeShimsInstalled = false;

function installNodeShims(): void {
  if (nodeShimsInstalled) return;
  nodeShimsInstalled = true;
  const g = globalThis as typeof globalThis & {
    window?: typeof globalThis;
    Blob?: typeof Blob;
  };
  g.window = g;
  g.Blob = g.Blob ?? (class Blob {
    constructor(_parts?: unknown[], _options?: unknown) {}
  } as typeof Blob);
  g.URL.createObjectURL = () => 'blob:audit-mock';
  g.URL.revokeObjectURL = () => {};
}

function toArrayBuffer(filePath: string): ArrayBuffer {
  const buf = readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function isSkinnedMeshLoadError(message: string): boolean {
  return /document is not defined|addEventListener|Unknown format|window is not defined/i.test(message);
}

function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function inferFamily(file: string): ClipFamily {
  if (file.startsWith('mixamo/')) return 'mixamo-core';
  if (file.startsWith('rokoko-mixamo/')) return 'rokoko-mixamo';
  if (file.startsWith('freepack/')) return 'freepack';
  if (file.startsWith('meshy/')) return 'meshy';
  return 'other';
}

function loadFbxFromDisk(relativeFile: string): THREE.Group {
  const absolute = join(ASSETS_DIR, relativeFile);
  if (!existsSync(absolute)) {
    throw new Error(`Missing file: ${relativeFile}`);
  }
  installNodeShims();
  const buffer = toArrayBuffer(absolute);
  const resourcePath = join(ASSETS_DIR, dirname(relativeFile)) + '/';
  return fbxLoader.parse(buffer, resourcePath) as THREE.Group;
}

function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Bone) {
      bones.push(object);
    }
  });
  return bones;
}

function findBone(bones: readonly THREE.Bone[], keys: readonly string[]): THREE.Bone | null {
  for (const key of keys) {
    const normalizedKey = normalizeBoneName(key);
    const exact = bones.find((bone) => normalizeBoneName(bone.name).endsWith(normalizedKey));
    if (exact) return exact;
    const partial = bones.find((bone) => normalizeBoneName(bone.name).includes(normalizedKey));
    if (partial) return partial;
  }
  return null;
}

function sampleQuaternionTrack(track: THREE.KeyframeTrack, time: number, target: THREE.Quaternion): void {
  const valueSize = 4;
  const times = track.times;
  if (times.length === 0) {
    target.set(0, 0, 0, 1);
    return;
  }
  if (time <= times[0]!) {
    target.fromArray(track.values, 0);
    return;
  }
  const lastIndex = times.length - 1;
  if (time >= times[lastIndex]!) {
    target.fromArray(track.values, lastIndex * valueSize);
    return;
  }
  let index = 0;
  while (index < lastIndex && times[index + 1]! < time) {
    index += 1;
  }
  const t0 = times[index]!;
  const t1 = times[index + 1]!;
  const alpha = (time - t0) / Math.max(t1 - t0, 1e-8);
  const qa = new THREE.Quaternion().fromArray(track.values, index * valueSize);
  const qb = new THREE.Quaternion().fromArray(track.values, (index + 1) * valueSize);
  target.copy(qa).slerp(qb, alpha);
}

function applyClipPoseAtTime(root: THREE.Object3D, clip: THREE.AnimationClip, time: number): number {
  const bones = collectBones(root);
  const boneByKey = new Map<string, THREE.Bone>();
  for (const bone of bones) {
    boneByKey.set(normalizeBoneName(bone.name), bone);
  }

  let matched = 0;
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion') || track.getValueSize() !== 4) {
      continue;
    }
    const boneKey = normalizeBoneName(track.name.slice(0, -'.quaternion'.length));
    const bone = boneByKey.get(boneKey);
    if (!bone) {
      continue;
    }
    sampleQuaternionTrack(track, time, TMP_Q);
    bone.quaternion.copy(TMP_Q);
    matched += 1;
  }

  root.updateMatrixWorld(true);
  return matched;
}

function measureForwardYaw(root: THREE.Object3D): number | null {
  const bones = collectBones(root);
  const hips = findBone(bones, ['hips']);
  const spine = findBone(bones, ['spine2', 'spine1', 'spine']);
  const leftShoulder = findBone(bones, ['leftshoulder', 'leftarm']);
  const rightShoulder = findBone(bones, ['rightshoulder', 'rightarm']);

  if (hips && spine && leftShoulder && rightShoulder) {
    hips.getWorldPosition(TMP_HIPS);
    spine.getWorldPosition(TMP_SPINE);
    leftShoulder.getWorldPosition(TMP_LEFT);
    rightShoulder.getWorldPosition(TMP_RIGHT);
    TMP_UP.copy(TMP_SPINE).sub(TMP_HIPS).normalize();
    TMP_RIGHT_AXIS.copy(TMP_RIGHT).sub(TMP_LEFT).normalize();
    TMP_FORWARD.crossVectors(TMP_UP, TMP_RIGHT_AXIS).normalize();
    TMP_FORWARD.y = 0;
    if (TMP_FORWARD.lengthSq() > 1e-6) {
      TMP_FORWARD.normalize();
      return Math.atan2(TMP_FORWARD.x, TMP_FORWARD.z);
    }
  }

  if (hips) {
    hips.getWorldQuaternion(TMP_Q);
    TMP_FORWARD.set(0, 0, -1).applyQuaternion(TMP_Q);
    TMP_FORWARD.y = 0;
    if (TMP_FORWARD.lengthSq() > 1e-6) {
      TMP_FORWARD.normalize();
      return Math.atan2(TMP_FORWARD.x, TMP_FORWARD.z);
    }
  }

  return null;
}

function wrapAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function spreadDeg(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const med = median(values);
  const deviations = values.map((v) => Math.abs(wrapAngleRad(v - med)) * DEG);
  return Math.max(...deviations);
}

function bucketDelta(deltaRad: number): string {
  const deg = wrapAngleRad(deltaRad) * DEG;
  const rounded = Math.round(deg / 45) * 45;
  const wrapped = ((rounded % 360) + 360) % 360;
  if (wrapped === 0) return '0°';
  if (wrapped === 180) return '180°';
  return `${wrapped}°`;
}

function listAllFbxFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.toLowerCase().endsWith('.fbx')) {
        files.push(relative(ASSETS_DIR, full).replaceAll('\\', '/'));
      }
    }
  }
  walk(ASSETS_DIR);
  return files.sort();
}

function collectCatalogEntries(): CatalogEntry[] {
  const catalog = catalogJson as {
    categories: Record<string, Array<{ name: string; file: string; source?: string }>>;
  };
  const entries: CatalogEntry[] = [];
  for (const [category, items] of Object.entries(catalog.categories)) {
    for (const item of items) {
      entries.push({ ...item, category });
    }
  }
  return entries;
}

function auditClip(
  file: string,
  meta: { name: string | null; category: string | null; source: string | null },
  referenceYaw: number,
): ClipAuditResult {
  const family = inferFamily(file);
  const base: ClipAuditResult = {
    file,
    family,
    category: meta.category,
    name: meta.name,
    source: meta.source,
    forwardYawRad: null,
    deltaYawRad: null,
    deltaYawDeg: null,
    boneMatchRatio: 0,
    trackCount: 0,
    status: 'ok',
  };

  try {
    const root = loadFbxFromDisk(file);
    const bones = collectBones(root);
    if (bones.length === 0) {
      return { ...base, status: 'no-bones' };
    }
    const clip = root.animations?.[0];
    if (!clip) {
      return { ...base, status: 'no-animation' };
    }

    const matched = applyClipPoseAtTime(root, clip, 0);
    const quatTracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion')).length;
    const boneMatchRatio = quatTracks > 0 ? matched / quatTracks : 0;
    const forwardYaw = measureForwardYaw(root);
    if (forwardYaw === null) {
      return {
        ...base,
        boneMatchRatio,
        trackCount: quatTracks,
        status: 'no-forward',
      };
    }

    const deltaYaw = wrapAngleRad(forwardYaw - referenceYaw);
    return {
      ...base,
      forwardYawRad: forwardYaw,
      deltaYawRad: deltaYaw,
      deltaYawDeg: deltaYaw * DEG,
      boneMatchRatio,
      trackCount: quatTracks,
      status: 'ok',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Missing file')) {
      return { ...base, status: 'missing-file', error: message };
    }
    if (isSkinnedMeshLoadError(message)) {
      return { ...base, status: 'skinned-mesh', error: message };
    }
    return { ...base, status: 'error', error: message };
  }
}

function buildOutput(results: readonly ClipAuditResult[], referenceYaw: number): CalibrationOutput {
  const ok = results.filter((r) => r.status === 'ok' && r.deltaYawRad !== null);
  const bucketMap = new Map<string, string[]>();
  const familyMap = new Map<ClipFamily, number[]>();

  for (const row of ok) {
    const key = bucketDelta(row.deltaYawRad!);
    const list = bucketMap.get(key) ?? [];
    list.push(row.file);
    bucketMap.set(key, list);

    const fam = familyMap.get(row.family) ?? [];
    fam.push(row.deltaYawRad!);
    familyMap.set(row.family, fam);
  }

  const buckets: CalibrationOutput['buckets'] = {};
  for (const [key, files] of [...bucketMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const deltas = files
      .map((f) => ok.find((r) => r.file === f)?.deltaYawRad)
      .filter((v): v is number => v !== null && v !== undefined);
    buckets[key] = {
      count: files.length,
      medianDeltaYawRad: median(deltas),
      spreadDeg: spreadDeg(deltas),
      files,
    };
  }

  const families: ClipFamily[] = ['mixamo-core', 'rokoko-mixamo', 'freepack', 'meshy', 'other'];
  const familyDefaults = Object.fromEntries(
    families.map((family) => {
      const deltas = familyMap.get(family) ?? [];
      return [
        family,
        {
          count: deltas.length,
          medianDeltaYawRad: deltas.length > 0 ? median(deltas) : null,
          spreadDeg: deltas.length > 0 ? spreadDeg(deltas) : null,
        },
      ];
    }),
  ) as CalibrationOutput['familyDefaults'];

  const clips: Record<string, ClipAuditResult> = {};
  for (const row of results) {
    clips[row.file] = row;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    referenceNote: REFERENCE_NOTE,
    reference: { file: REFERENCE_FILE, forwardYawRad: referenceYaw },
    buckets,
    familyDefaults,
    clips,
  };
}

function printSummary(output: CalibrationOutput, results: readonly ClipAuditResult[]): void {
  const ok = results.filter((r) => r.status === 'ok');
  const failed = results.filter((r) => r.status !== 'ok');

  console.log('\n=== Animation clip forward audit ===\n');
  console.log(output.referenceNote);
  console.log(`Reference: ${output.reference.file} → forwardYaw ${(output.reference.forwardYawRad * DEG).toFixed(1)}°`);
  console.log(`Clips audited: ${results.length} | ok: ${ok.length} | failed: ${failed.length}\n`);

  console.log('--- Delta yaw buckets (vs reference tpose) ---');
  for (const [bucket, info] of Object.entries(output.buckets)) {
    console.log(
      `  ${bucket.padEnd(6)} count=${String(info.count).padStart(3)}  median=${(info.medianDeltaYawRad * DEG).toFixed(1)}°  spread=${info.spreadDeg.toFixed(1)}°`,
    );
  }

  console.log('\n--- Per family ---');
  for (const [family, info] of Object.entries(output.familyDefaults)) {
    if (info.count === 0) continue;
    const med = info.medianDeltaYawRad !== null ? `${(info.medianDeltaYawRad * DEG).toFixed(1)}°` : 'n/a';
    const spr = info.spreadDeg !== null ? `${info.spreadDeg.toFixed(1)}°` : 'n/a';
    console.log(`  ${family.padEnd(14)} n=${info.count}  medianΔ=${med}  spread=${spr}`);
  }

  const duelClips = [
    'rokoko-mixamo/FightingIdle_mixamo.fbx',
    'rokoko-mixamo/ZombieWalk_01_mixamo.fbx',
    'rokoko-mixamo/StepForward_mixamo.fbx',
    'rokoko-mixamo/Light_mixamo.fbx',
    'rokoko-mixamo/Regular_Medium_mixamo.fbx',
    'mixamo/tpose.fbx',
    'mixamo/idle.fbx',
  ];
  console.log('\n--- Duel / profile hotspots ---');
  for (const file of duelClips) {
    const row = output.clips[file];
    if (!row) {
      console.log(`  ${file}: (not in audit set)`);
      continue;
    }
    const delta = row.deltaYawDeg !== null ? `${row.deltaYawDeg.toFixed(1)}°` : row.status;
    console.log(`  ${file.padEnd(42)} Δ=${delta}  family=${row.family}`);
  }

  if (failed.length > 0) {
    console.log('\n--- Failures (first 15) ---');
    for (const row of failed.slice(0, 15)) {
      console.log(`  ${row.file}: ${row.status}${row.error ? ` — ${row.error}` : ''}`);
    }
    if (failed.length > 15) {
      console.log(`  ... and ${failed.length - 15} more`);
    }
  }

  console.log(`\nWrote ${relative(REPO_ROOT, OUTPUT_PATH)}\n`);
}

// --- main ---
const catalogByFile = new Map<string, CatalogEntry>();
for (const entry of collectCatalogEntries()) {
  catalogByFile.set(entry.file, entry);
}

const allFiles = listAllFbxFiles();
const refRoot = loadFbxFromDisk(REFERENCE_FILE);
const refClip = refRoot.animations?.[0];
if (!refClip) {
  throw new Error(`Reference ${REFERENCE_FILE} has no animation clip`);
}
applyClipPoseAtTime(refRoot, refClip, 0);
const referenceYaw = measureForwardYaw(refRoot);
if (referenceYaw === null) {
  throw new Error(`Could not measure forward on reference ${REFERENCE_FILE}`);
}

console.log(`Auditing ${allFiles.length} FBX files under public/assets/characters ...`);

const results: ClipAuditResult[] = [];
for (const file of allFiles) {
  const meta = catalogByFile.get(file);
  results.push(
    auditClip(file, {
      name: meta?.name ?? null,
      category: meta?.category ?? null,
      source: meta?.source ?? null,
    }, referenceYaw),
  );
}

const output = buildOutput(results, referenceYaw);
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
printSummary(output, results);
