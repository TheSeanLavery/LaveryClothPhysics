import type { ClothPatternId } from './types.ts';

export interface YarnFieldParams {
  cellsU: number;
  cellsV: number;
  seed: number;
  /** Half-width of yarn in cell units (0.35–0.48). */
  threadCover: number;
  /** Axial fiber striation strength (0–1). */
  fiberStrength: number;
}

export interface HeightSampleContext extends YarnFieldParams {
  u: number;
  v: number;
  pattern: ClothPatternId;
}

export interface HeightSampleResult {
  height: number;
  /** -1 weft dominant, +1 warp dominant. */
  warpDominant: number;
  /** 0 on yarn crowns, 1 in gaps/grooves. */
  groove: number;
  warpExposure: number;
  weftExposure: number;
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function yarnCrossSection(normalizedDist: number, flatten = 1): number {
  if (normalizedDist >= 1) {
    return 0;
  }
  const cyl = Math.sqrt(1 - normalizedDist * normalizedDist);
  return Math.pow(cyl, flatten);
}

/** High-frequency noise along yarn length, low across width. */
function axialFiber(tAlong: number, threadId: number, seed: number, strength: number): number {
  if (strength <= 0) {
    return 1;
  }
  const a = tAlong * 96 + threadId * 19.7 + seed * 41.3;
  const f1 = Math.sin(a * Math.PI * 2 * 1.31);
  const f2 = Math.sin(a * Math.PI * 2 * 3.17 + 0.8);
  const f3 = (hash2(Math.floor(a * 12), threadId, seed + 3) - 0.5) * 2;
  return 1 + strength * (f1 * 0.045 + f2 * 0.028 + f3 * 0.018);
}

function plainOver(uCell: number, vCell: number): boolean {
  return (uCell + vCell) % 2 === 0;
}

function twillOver(uCell: number, vCell: number, repeat = 4): boolean {
  return ((uCell - vCell) % repeat + repeat) % repeat < repeat / 2;
}

function herringboneOver(uCell: number, vCell: number, band = 4): boolean {
  const bandIndex = Math.floor(vCell / band);
  const flipped = bandIndex % 2 === 1;
  const u = flipped ? uCell : vCell;
  const v = flipped ? vCell : uCell;
  return ((u - v) % 4 + 4) % 4 < 2;
}

function satinOver(uCell: number, vCell: number, step = 5): boolean {
  return (uCell * step + vCell) % step === 0;
}

function basketOver(uCell: number, vCell: number): boolean {
  const blockU = Math.floor(uCell / 2);
  const blockV = Math.floor(vCell / 2);
  return (blockU + blockV) % 2 === 0;
}

function denimOver(uCell: number, vCell: number, seed: number): boolean {
  const twill = twillOver(uCell, vCell, 3);
  return hash2(uCell, vCell, seed) > 0.92 ? !twill : twill;
}

function resolveWarpOver(pattern: ClothPatternId, uCell: number, vCell: number, seed: number): boolean {
  switch (pattern) {
    case 'plain':
    case 'canvas':
      return plainOver(uCell, vCell);
    case 'twill':
      return twillOver(uCell, vCell, 4);
    case 'herringbone':
      return herringboneOver(uCell, vCell, 4);
    case 'satin':
      return satinOver(uCell, vCell, 5);
    case 'basket':
      return basketOver(uCell, vCell);
    case 'denim':
      return denimOver(uCell, vCell, seed);
    case 'rib':
      return uCell % 2 === 0;
  }
}

function patternScales(pattern: ClothPatternId): {
  threadCoverMul: number;
  underCompress: number;
  underDrop: number;
  warpMul: number;
  weftMul: number;
} {
  switch (pattern) {
    case 'canvas':
      return { threadCoverMul: 1.18, underCompress: 1.35, underDrop: 0.1, warpMul: 1, weftMul: 1 };
    case 'satin':
      return { threadCoverMul: 0.92, underCompress: 1.55, underDrop: 0.14, warpMul: 1, weftMul: 1 };
    case 'rib':
      return { threadCoverMul: 1.05, underCompress: 1.25, underDrop: 0.08, warpMul: 1.35, weftMul: 0.55 };
    case 'denim':
      return { threadCoverMul: 0.95, underCompress: 1.2, underDrop: 0.07, warpMul: 1, weftMul: 1 };
    default:
      return { threadCoverMul: 1, underCompress: 1.25, underDrop: 0.09, warpMul: 1, weftMul: 1 };
  }
}

function sampleWarpYarn(
  u: number,
  v: number,
  uCell: number,
  vCell: number,
  fu: number,
  fv: number,
  params: YarnFieldParams,
  scales: ReturnType<typeof patternScales>,
): number {
  const slip = (hash2(uCell, vCell, params.seed) - 0.5) * 0.055;
  const dist = Math.abs(fv - 0.5 + slip);
  const widthJitter = 1 + (hash2(vCell, 0, params.seed + 5) - 0.5) * 0.1;
  const radius = params.threadCover * scales.threadCoverMul * widthJitter * scales.warpMul;
  const cross = yarnCrossSection(dist / Math.max(radius, 0.05));
  const fiber = axialFiber(u * params.cellsU, vCell, params.seed, params.fiberStrength);
  return cross * fiber;
}

function sampleWeftYarn(
  u: number,
  v: number,
  uCell: number,
  vCell: number,
  fu: number,
  fv: number,
  params: YarnFieldParams,
  scales: ReturnType<typeof patternScales>,
): number {
  const slip = (hash2(vCell, uCell, params.seed + 11) - 0.5) * 0.055;
  const dist = Math.abs(fu - 0.5 + slip);
  const widthJitter = 1 + (hash2(uCell, 0, params.seed + 9) - 0.5) * 0.1;
  const radius = params.threadCover * scales.threadCoverMul * widthJitter * scales.weftMul;
  const cross = yarnCrossSection(dist / Math.max(radius, 0.05));
  const fiber = axialFiber(v * params.cellsV, uCell, params.seed + 17, params.fiberStrength);
  return cross * fiber;
}

function sampleHeight(ctx: HeightSampleContext): HeightSampleResult {
  const { u, v, cellsU, cellsV, seed, threadCover, fiberStrength, pattern } = ctx;
  const threadU = u * cellsU;
  const threadV = v * cellsV;
  const uCell = Math.floor(threadU);
  const vCell = Math.floor(threadV);
  const fu = threadU - uCell;
  const fv = threadV - vCell;

  const params: YarnFieldParams = { cellsU, cellsV, seed, threadCover, fiberStrength };
  const scales = patternScales(pattern);
  const warpOver = resolveWarpOver(pattern, uCell, vCell, seed);

  let warp = sampleWarpYarn(u, v, uCell, vCell, fu, fv, params, scales);
  let weft = sampleWeftYarn(u, v, uCell, vCell, fu, fv, params, scales);

  const underDrop = scales.underDrop;

  if (warpOver) {
    weft = Math.max(0, Math.pow(weft, scales.underCompress) * 0.5 - underDrop);
  } else {
    warp = Math.max(0, Math.pow(warp, scales.underCompress) * 0.5 - underDrop);
  }

  const crown = Math.max(warp, weft);
  const gap = Math.max(0, 1 - crown * 1.05);
  const height = crown - 0.5 + (hash2(uCell, vCell, seed + 23) - 0.5) * 0.012;

  const warpDominant =
    pattern === 'rib'
      ? clamp01(warp / Math.max(warp + weft, 1e-4)) * 2 - 1
      : warpOver
        ? 1
        : -1;

  const warpExposure = warp;
  const weftExposure = weft;
  const groove = clamp01(gap * 1.15 + (1 - Math.max(warpExposure, weftExposure)) * 0.35);

  return { height, warpDominant, groove, warpExposure, weftExposure };
}

export function createHeightSampler(
  pattern: ClothPatternId,
  options: Omit<HeightSampleContext, 'u' | 'v' | 'pattern'>,
) {
  return (u: number, v: number) => sampleHeight({ ...options, pattern, u, v });
}

export function sampleHeightField(
  pattern: ClothPatternId,
  u: number,
  v: number,
  cellsU: number,
  cellsV: number,
  seed: number,
  threadCover = 0.4,
  fiberStrength = 0.85,
): HeightSampleResult {
  return sampleHeight({ pattern, u, v, cellsU, cellsV, seed, threadCover, fiberStrength });
}

/** Back-compat helper used by the runtime flag normal map. */
export function plainWeaveHeight(u: number, v: number, cellsU: number, cellsV: number): number {
  return sampleHeight({
    pattern: 'plain',
    u,
    v,
    cellsU,
    cellsV,
    seed: 0,
    threadCover: 0.4,
    fiberStrength: 0.85,
  }).height;
}
