import * as THREE from 'three/webgpu';

const BG_R = 26;
const BG_G = 36;
const BG_B = 56;

export interface FlagMeshRegionAnalysis {
  pixelCount: number;
  meanLuma: number;
  meanRgb: { r: number; g: number; b: number };
  blackPixelCount: number;
  blackRatio: number;
  backgroundLikeRatio: number;
  /** Pixels inside mesh bounds that are not scene background (actual cloth samples). */
  clothPixelCount: number;
  clothMeanLuma: number;
  clothMeanRgb: { r: number; g: number; b: number };
  clothBlackRatio: number;
  /** Pixels with luma < 3 (shader/normal failure), inside eroded cloth bounds. */
  clothPureBlackRatio: number;
}

export interface FlagScreenBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  vertexCount: number;
}

/** Shrink projected bounds to ignore pole edge, ground bleed, and bbox padding. */
export function shrinkFlagScreenBounds(bounds: FlagScreenBounds, factor = 0.55): FlagScreenBounds {
  const padX = (bounds.maxX - bounds.minX) * (1 - factor) * 0.5;
  const padY = (bounds.maxY - bounds.minY) * (1 - factor) * 0.5;

  return {
    minX: Math.max(0, Math.floor(bounds.minX + padX)),
    minY: Math.max(0, Math.floor(bounds.minY + padY)),
    maxX: Math.ceil(bounds.maxX - padX),
    maxY: Math.ceil(bounds.maxY - padY),
    vertexCount: bounds.vertexCount,
  };
}

export interface FlagRenderDiagnostics {
  canvasWidth: number;
  canvasHeight: number;
  screenBounds: FlagScreenBounds | null;
  meshRegion: FlagMeshRegionAnalysis | null;
  backgroundMeanLuma: number;
  frameCount: number;
  fabricTextureSource: string;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isBackgroundLike(r: number, g: number, b: number): boolean {
  return Math.hypot(r - BG_R, g - BG_G, b - BG_B) < 22;
}

export function projectSimVerticesToScreenBounds(
  positions: Float32Array,
  camera: THREE.Camera,
  canvasWidth: number,
  canvasHeight: number,
  vertexStride = 3,
): FlagScreenBounds | null {
  const point = new THREE.Vector3();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vertexCount = 0;

  for (let i = 0; i < positions.length; i += vertexStride) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }

    point.set(x, y, z);
    point.project(camera);

    if (point.z < -1 || point.z > 1) {
      continue;
    }

    const sx = (point.x * 0.5 + 0.5) * canvasWidth;
    const sy = (-point.y * 0.5 + 0.5) * canvasHeight;
    minX = Math.min(minX, sx);
    minY = Math.min(minY, sy);
    maxX = Math.max(maxX, sx);
    maxY = Math.max(maxY, sy);
    vertexCount += 1;
  }

  if (vertexCount < 8 || !Number.isFinite(minX)) {
    return null;
  }

  const padX = Math.max(4, (maxX - minX) * 0.04);
  const padY = Math.max(4, (maxY - minY) * 0.04);

  return {
    minX: Math.max(0, Math.floor(minX - padX)),
    minY: Math.max(0, Math.floor(minY - padY)),
    maxX: Math.min(canvasWidth - 1, Math.ceil(maxX + padX)),
    maxY: Math.min(canvasHeight - 1, Math.ceil(maxY + padY)),
    vertexCount,
  };
}

export function analyzeMeshScreenRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bounds: FlagScreenBounds,
): FlagMeshRegionAnalysis {
  let pixelCount = 0;
  let lumaSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let blackPixelCount = 0;
  let backgroundLikeCount = 0;
  let clothPixelCount = 0;
  let clothLumaSum = 0;
  let clothRSum = 0;
  let clothGSum = 0;
  let clothBSum = 0;
  let clothBlackCount = 0;
  let clothPureBlackCount = 0;

  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const yLuma = luma(r, g, b);

      pixelCount += 1;
      lumaSum += yLuma;
      rSum += r;
      gSum += g;
      bSum += b;

      if (yLuma < 12) {
        blackPixelCount += 1;
      }
      if (isBackgroundLike(r, g, b)) {
        backgroundLikeCount += 1;
        continue;
      }

      clothPixelCount += 1;
      clothLumaSum += yLuma;
      clothRSum += r;
      clothGSum += g;
      clothBSum += b;
      if (yLuma < 12) {
        clothBlackCount += 1;
      }
      if (yLuma < 3) {
        clothPureBlackCount += 1;
      }
    }
  }

  if (pixelCount === 0) {
    return {
      pixelCount: 0,
      meanLuma: 0,
      meanRgb: { r: 0, g: 0, b: 0 },
      blackPixelCount: 0,
      blackRatio: 1,
      backgroundLikeRatio: 1,
      clothPixelCount: 0,
      clothMeanLuma: 0,
      clothMeanRgb: { r: 0, g: 0, b: 0 },
      clothBlackRatio: 1,
      clothPureBlackRatio: 1,
    };
  }

  return {
    pixelCount,
    meanLuma: lumaSum / pixelCount,
    meanRgb: { r: rSum / pixelCount, g: gSum / pixelCount, b: bSum / pixelCount },
    blackPixelCount,
    blackRatio: blackPixelCount / pixelCount,
    backgroundLikeRatio: backgroundLikeCount / pixelCount,
    clothPixelCount,
    clothMeanLuma: clothPixelCount > 0 ? clothLumaSum / clothPixelCount : 0,
    clothMeanRgb:
      clothPixelCount > 0
        ? { r: clothRSum / clothPixelCount, g: clothGSum / clothPixelCount, b: clothBSum / clothPixelCount }
        : { r: 0, g: 0, b: 0 },
    clothBlackRatio: clothPixelCount > 0 ? clothBlackCount / clothPixelCount : 1,
    clothPureBlackRatio: clothPixelCount > 0 ? clothPureBlackCount / clothPixelCount : 1,
  };
}

export function sampleBackgroundMeanLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  const corners = [
    { x: 8, y: 8, w: 48, h: 48 },
    { x: width - 56, y: 8, w: 48, h: 48 },
    { x: 8, y: height - 56, w: 48, h: 48 },
    { x: width - 56, y: height - 56, w: 48, h: 48 },
  ];

  let lumaSum = 0;
  let count = 0;

  for (const corner of corners) {
    for (let y = corner.y; y < corner.y + corner.h; y++) {
      for (let x = corner.x; x < corner.x + corner.w; x++) {
        const i = (y * width + x) * 4;
        lumaSum += luma(data[i]!, data[i + 1]!, data[i + 2]!);
        count += 1;
      }
    }
  }

  return count > 0 ? lumaSum / count : 0;
}

export function analyzeFlagRenderDiagnostics(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  frameCount: number,
  fabricTextureSource: string,
  screenBounds: FlagScreenBounds | null,
): FlagRenderDiagnostics {
  const innerBounds = screenBounds ? shrinkFlagScreenBounds(screenBounds) : null;
  const meshRegion = innerBounds ? analyzeMeshScreenRegion(data, width, height, innerBounds) : null;

  return {
    canvasWidth: width,
    canvasHeight: height,
    screenBounds,
    meshRegion,
    backgroundMeanLuma: sampleBackgroundMeanLuma(data, width, height),
    frameCount,
    fabricTextureSource,
  };
}

/** @deprecated Use mesh-projected sampling via analyzeFlagRenderDiagnostics instead. */
export function analyzeFlagBlackSpots(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { flagPixelCount: number; blackPixelCount: number; blackRatio: number; meanLuma: number } | null {
  return null;
}
