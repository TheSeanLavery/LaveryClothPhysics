import type { ClothColor, ClothGeneratorOptions, ClothMapSet } from './types.ts';
import { createHeightSampler } from './heightFields.ts';

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mixColor(a: ClothColor, b: ClothColor, t: number): ClothColor {
  const mix = clampUnit(t);
  return {
    r: a.r * (1 - mix) + b.r * mix,
    g: a.g * (1 - mix) + b.g * mix,
    b: a.b * (1 - mix) + b.b * mix,
  };
}

function writeRgb(buffer: Uint8Array, index: number, color: ClothColor, alpha = 255): void {
  buffer[index] = clampByte(color.r * 255);
  buffer[index + 1] = clampByte(color.g * 255);
  buffer[index + 2] = clampByte(color.b * 255);
  buffer[index + 3] = alpha;
}

export function defaultClothGeneratorOptions(pattern: ClothGeneratorOptions['pattern'] = 'plain'): ClothGeneratorOptions {
  const defaults: Record<ClothGeneratorOptions['pattern'], Partial<ClothGeneratorOptions>> = {
    plain: { cellsU: 8, cellsV: 8, bumpScale: 6.5, threadCover: 0.4, fiberStrength: 0.85 },
    canvas: {
      cellsU: 4,
      cellsV: 4,
      bumpScale: 7.5,
      threadCover: 0.44,
      fiberStrength: 0.65,
      roughnessBase: 0.82,
      roughnessRange: 0.12,
    },
    twill: { cellsU: 10, cellsV: 10, bumpScale: 6, threadCover: 0.38, fiberStrength: 0.8 },
    herringbone: { cellsU: 12, cellsV: 12, bumpScale: 5.8, threadCover: 0.38, fiberStrength: 0.75 },
    satin: {
      cellsU: 12,
      cellsV: 12,
      bumpScale: 4.5,
      threadCover: 0.36,
      fiberStrength: 0.55,
      roughnessBase: 0.62,
      roughnessRange: 0.08,
    },
    basket: { cellsU: 8, cellsV: 8, bumpScale: 6.8, threadCover: 0.41, fiberStrength: 0.8 },
    denim: {
      cellsU: 14,
      cellsV: 14,
      bumpScale: 5.5,
      threadCover: 0.37,
      fiberStrength: 0.9,
      warpColor: { r: 0.12, g: 0.18, b: 0.38 },
      weftColor: { r: 0.18, g: 0.24, b: 0.48 },
      roughnessBase: 0.86,
      roughnessRange: 0.1,
    },
    rib: {
      cellsU: 6,
      cellsV: 24,
      bumpScale: 7,
      threadCover: 0.43,
      fiberStrength: 0.7,
      roughnessBase: 0.74,
      roughnessRange: 0.16,
    },
  };

  return {
    pattern,
    size: 512,
    cellsU: 8,
    cellsV: 8,
    bumpScale: 6.5,
    warpColor: { r: 0.95, g: 0.92, b: 0.88 },
    weftColor: { r: 0.82, g: 0.8, b: 0.78 },
    roughnessBase: 0.78,
    roughnessRange: 0.14,
    colorContrast: 0.85,
    seed: 1,
    threadCover: 0.4,
    fiberStrength: 0.85,
    ...defaults[pattern],
  };
}

export function generateClothMaps(options: ClothGeneratorOptions): ClothMapSet {
  const size = Math.max(16, Math.floor(options.size));
  const pixelCount = size * size;
  const normal = new Uint8Array(pixelCount * 4);
  const albedo = new Uint8Array(pixelCount * 4);
  const roughness = new Uint8Array(pixelCount * 4);
  const heightMap = new Uint8Array(pixelCount * 4);

  const sampleHeight = createHeightSampler(options.pattern, {
    cellsU: options.cellsU,
    cellsV: options.cellsV,
    seed: options.seed,
    threadCover: options.threadCover,
    fiberStrength: options.fiberStrength,
  });

  const uEps = 1 / size;
  const vEps = 1 / size;

  for (let yPx = 0; yPx < size; yPx++) {
    for (let xPx = 0; xPx < size; xPx++) {
      const u = (xPx + 0.5) / size;
      const v = (yPx + 0.5) / size;
      const index = (yPx * size + xPx) * 4;

      const center = sampleHeight(u, v);
      const hUx = sampleHeight(u + uEps, v).height - sampleHeight(u - uEps, v).height;
      const hVy = sampleHeight(u, v + vEps).height - sampleHeight(u, v - vEps).height;

      const nx = -hUx * options.bumpScale;
      const ny = -hVy * options.bumpScale;
      const nz = 1;
      const invLen = 1 / Math.hypot(nx, ny, nz);

      normal[index] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normal[index + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normal[index + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normal[index + 3] = 255;

      const yarnSum = center.warpExposure + center.weftExposure + 1e-4;
      const warpMix = center.warpExposure / yarnSum;
      const macro = mixColor(options.weftColor, options.warpColor, warpMix);
      const grooveTint = 1 - center.groove * 0.28 * options.colorContrast;
      const crown = Math.max(center.warpExposure, center.weftExposure);
      const crownTint = 1 + crown * 0.06 * options.colorContrast;
      const albedoColor = {
        r: macro.r * grooveTint * crownTint,
        g: macro.g * grooveTint * crownTint,
        b: macro.b * grooveTint * crownTint,
      };
      writeRgb(albedo, index, albedoColor);

      const rough =
        options.roughnessBase + center.groove * options.roughnessRange * options.colorContrast;
      const roughByte = clampByte(rough * 255);
      roughness[index] = roughByte;
      roughness[index + 1] = roughByte;
      roughness[index + 2] = roughByte;
      roughness[index + 3] = 255;

      const heightByte = clampByte((center.height + 0.5) * 255);
      heightMap[index] = heightByte;
      heightMap[index + 1] = heightByte;
      heightMap[index + 2] = heightByte;
      heightMap[index + 3] = 255;
    }
  }

  return {
    size,
    pattern: options.pattern,
    normal,
    albedo,
    roughness,
    height: heightMap,
  };
}

export function parseHexColor(hex: string, fallback: ClothColor): ClothColor {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length !== 6) {
    return fallback;
  }

  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((channel) => Number.isNaN(channel))) {
    return fallback;
  }

  return { r: r / 255, g: g / 255, b: b / 255 };
}

export function colorToHex(color: ClothColor): string {
  const channel = (value: number) => clampByte(value * 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}
