export interface FlagCanvasCapture {
  width: number;
  height: number;
  flagPixelCount: number;
  meanLuma: number;
  lumaVariance: number;
  /** Mean |luma(x,y) - luma(x+1,y)| + |luma(x,y) - luma(x,y+1)| on flag pixels. */
  neighborDiffMean: number;
}

export interface FlagCanvasCompare {
  meanRgbDiff: number;
  neighborDiffDelta: number;
  lumaVarianceDelta: number;
}

export interface FlagBlackSpotAnalysis {
  flagPixelCount: number;
  blackPixelCount: number;
  blackRatio: number;
  meanLuma: number;
}

export interface FlagRenderDiagnostics {
  canvasWidth: number;
  canvasHeight: number;
  centerMeanLuma: number;
  centerMeanRgb: { r: number; g: number; b: number };
  canvasMeanLuma: number;
  flag: FlagBlackSpotAnalysis | null;
  frameCount: number;
  fabricTextureSource: string;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isFlagPixel(r: number, g: number, b: number): boolean {
  const pixelLuma = luma(r, g, b);
  const bgDistance = Math.hypot(r - 26, g - 36, b - 56);
  return pixelLuma > 24 && bgDistance > 18;
}

export function analyzeFlagCanvasImageData(data: Uint8ClampedArray, width: number, height: number): FlagCanvasCapture | null {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let flagPixelCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (!isFlagPixel(r, g, b)) {
        continue;
      }
      flagPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (flagPixelCount < 100) {
    return null;
  }

  const lumas: number[] = [];
  let neighborDiffSum = 0;
  let neighborDiffCount = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (!isFlagPixel(r, g, b)) {
        continue;
      }

      const yLuma = luma(r, g, b);
      lumas.push(yLuma);

      if (x < maxX) {
        const ni = (y * width + (x + 1)) * 4;
        const nr = data[ni]!;
        const ng = data[ni + 1]!;
        const nb = data[ni + 2]!;
        if (isFlagPixel(nr, ng, nb)) {
          neighborDiffSum += Math.abs(yLuma - luma(nr, ng, nb));
          neighborDiffCount += 1;
        }
      }

      if (y < maxY) {
        const ni = ((y + 1) * width + x) * 4;
        const nr = data[ni]!;
        const ng = data[ni + 1]!;
        const nb = data[ni + 2]!;
        if (isFlagPixel(nr, ng, nb)) {
          neighborDiffSum += Math.abs(yLuma - luma(nr, ng, nb));
          neighborDiffCount += 1;
        }
      }
    }
  }

  const meanLuma = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
  const lumaVariance =
    lumas.reduce((sum, value) => sum + (value - meanLuma) * (value - meanLuma), 0) / lumas.length;

  return {
    width,
    height,
    flagPixelCount,
    meanLuma,
    lumaVariance,
    neighborDiffMean: neighborDiffCount > 0 ? neighborDiffSum / neighborDiffCount : 0,
  };
}

/** Flag pixels with luma below this are treated as lighting black spots. */
const BLACK_SPOT_LUMA = 12;

export function analyzeFlagBlackSpots(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FlagBlackSpotAnalysis | null {
  const capture = analyzeFlagCanvasImageData(data, width, height);
  if (!capture) {
    return null;
  }

  let blackPixelCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (!isFlagPixel(r, g, b)) {
        continue;
      }
      if (luma(r, g, b) < BLACK_SPOT_LUMA) {
        blackPixelCount += 1;
      }
    }
  }

  return {
    flagPixelCount: capture.flagPixelCount,
    blackPixelCount,
    blackRatio: blackPixelCount / capture.flagPixelCount,
    meanLuma: capture.meanLuma,
  };
}

function sampleRegionMeanLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  regionWidth: number,
  regionHeight: number,
): { meanLuma: number; meanRgb: { r: number; g: number; b: number }; sampleCount: number } {
  const x0 = Math.max(0, Math.floor(centerX - regionWidth * 0.5));
  const y0 = Math.max(0, Math.floor(centerY - regionHeight * 0.5));
  const x1 = Math.min(width, Math.ceil(centerX + regionWidth * 0.5));
  const y1 = Math.min(height, Math.ceil(centerY + regionHeight * 0.5));

  let lumaSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let sampleCount = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      lumaSum += luma(r, g, b);
      rSum += r;
      gSum += g;
      bSum += b;
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) {
    return { meanLuma: 0, meanRgb: { r: 0, g: 0, b: 0 }, sampleCount: 0 };
  }

  return {
    meanLuma: lumaSum / sampleCount,
    meanRgb: { r: rSum / sampleCount, g: gSum / sampleCount, b: bSum / sampleCount },
    sampleCount,
  };
}

export function analyzeFlagRenderDiagnostics(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  frameCount: number,
  fabricTextureSource: string,
): FlagRenderDiagnostics {
  const canvasMean = sampleRegionMeanLuma(data, width, height, width * 0.5, height * 0.5, width, height);
  const centerMean = sampleRegionMeanLuma(data, width, height, width * 0.5, height * 0.45, width * 0.35, height * 0.35);

  return {
    canvasWidth: width,
    canvasHeight: height,
    centerMeanLuma: centerMean.meanLuma,
    centerMeanRgb: centerMean.meanRgb,
    canvasMeanLuma: canvasMean.meanLuma,
    flag: analyzeFlagBlackSpots(data, width, height),
    frameCount,
    fabricTextureSource,
  };
}

export async function captureFlagCanvas(canvas: HTMLCanvasElement): Promise<FlagCanvasCapture | null> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  return analyzeFlagCanvasImageData(data, width, height);
}

export function compareFlagCanvasCaptures(
  before: FlagCanvasCapture,
  after: FlagCanvasCapture,
  beforeData: Uint8ClampedArray,
  afterData: Uint8ClampedArray,
  width: number,
  height: number,
): FlagCanvasCompare {
  let rgbDiffSum = 0;
  let rgbDiffCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r0 = beforeData[i]!;
      const g0 = beforeData[i + 1]!;
      const b0 = beforeData[i + 2]!;
      if (!isFlagPixel(r0, g0, b0)) {
        continue;
      }

      const r1 = afterData[i]!;
      const g1 = afterData[i + 1]!;
      const b1 = afterData[i + 2]!;
      rgbDiffSum += (Math.abs(r0 - r1) + Math.abs(g0 - g1) + Math.abs(b0 - b1)) / 3;
      rgbDiffCount += 1;
    }
  }

  return {
    meanRgbDiff: rgbDiffCount > 0 ? rgbDiffSum / rgbDiffCount : 0,
    neighborDiffDelta: after.neighborDiffMean - before.neighborDiffMean,
    lumaVarianceDelta: after.lumaVariance - before.lumaVariance,
  };
}

export async function captureFlagCanvasRaw(canvas: HTMLCanvasElement): Promise<{
  capture: FlagCanvasCapture | null;
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const ctx = scratch.getContext('2d');
  if (!ctx) {
    return { capture: null, data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }

  ctx.drawImage(canvas, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, scratch.width, scratch.height);
  return {
    capture: analyzeFlagCanvasImageData(data, width, height),
    data,
    width,
    height,
  };
}
