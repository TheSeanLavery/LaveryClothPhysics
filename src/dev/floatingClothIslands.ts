export interface FloatingIslandOptions {
  /** RGB distance from sampled background color to treat a pixel as empty. */
  backgroundThreshold?: number;
  /** Ignore connected components smaller than this. */
  minIslandPixels?: number;
  /** Components above this absolute size are never classified as floating debris. */
  debrisMaxPixels?: number;
  /** Components above this fraction of the largest island are never floating debris. */
  debrisMaxRatioOfLargest?: number;
}

export type ClothIslandClassification = 'anchor' | 'attached' | 'floating' | 'noise';

export interface ClothIslandSummary {
  readonly id: number;
  readonly pixelCount: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly classification: ClothIslandClassification;
  readonly touchesLargest: boolean;
}

export interface FloatingIslandResult {
  readonly width: number;
  readonly height: number;
  readonly backgroundRgb: readonly [number, number, number];
  readonly anchorIslandCount: number;
  readonly islands: readonly ClothIslandSummary[];
  readonly floatingIslands: readonly ClothIslandSummary[];
  readonly floatingPixelCount: number;
  readonly pass: boolean;
}

const DEFAULT_OPTIONS: Required<FloatingIslandOptions> = {
  backgroundThreshold: 42,
  minIslandPixels: 72,
  debrisMaxPixels: 3_500,
  debrisMaxRatioOfLargest: 0.012,
};

function colorDistance(
  r: number,
  g: number,
  b: number,
  background: readonly [number, number, number],
): number {
  const dr = r - background[0];
  const dg = g - background[1];
  const db = b - background[2];
  return Math.hypot(dr, dg, db);
}

function sampleBackgroundRgb(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const samplePatch = (startX: number, startY: number): [number, number, number] => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = startY; y < startY + 5; y += 1) {
      for (let x = startX; x < startX + 5; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        const index = (y * width + x) * 4;
        r += pixels[index] ?? 0;
        g += pixels[index + 1] ?? 0;
        b += pixels[index + 2] ?? 0;
        count += 1;
      }
    }
    return [r / count, g / count, b / count];
  };

  const patches = [
    samplePatch(0, 0),
    samplePatch(Math.max(0, width - 5), 0),
    samplePatch(0, Math.max(0, height - 5)),
    samplePatch(Math.max(0, width - 5), Math.max(0, height - 5)),
  ];
  return [
    patches.reduce((sum, patch) => sum + patch[0], 0) / patches.length,
    patches.reduce((sum, patch) => sum + patch[1], 0) / patches.length,
    patches.reduce((sum, patch) => sum + patch[2], 0) / patches.length,
  ];
}

function buildClothMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundRgb: readonly [number, number, number],
  backgroundThreshold: number,
): Uint8Array {
  const clothMask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const distance = colorDistance(
        pixels[index] ?? 0,
        pixels[index + 1] ?? 0,
        pixels[index + 2] ?? 0,
        backgroundRgb,
      );
      clothMask[y * width + x] = distance > backgroundThreshold ? 1 : 0;
    }
  }
  return clothMask;
}

function labelClothComponents(
  clothMask: Uint8Array,
  width: number,
  height: number,
): {
  labels: Int32Array;
  summaries: Map<number, {
    pixelCount: number;
    sumX: number;
    sumY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
} {
  const labels = new Int32Array(width * height);
  let nextLabel = 1;
  const summaries = new Map<number, {
    pixelCount: number;
    sumX: number;
    sumY: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * width + x;
      if (clothMask[offset] === 0 || labels[offset] !== 0) {
        continue;
      }

      const label = nextLabel;
      nextLabel += 1;
      const queue: number[] = [offset];
      labels[offset] = label;
      const summary = {
        pixelCount: 0,
        sumX: 0,
        sumY: 0,
        minX: x,
        minY: y,
        maxX: x,
        maxY: y,
      };
      summaries.set(label, summary);

      while (queue.length > 0) {
        const current = queue.pop()!;
        const cx = current % width;
        const cy = Math.floor(current / width);
        summary.pixelCount += 1;
        summary.sumX += cx;
        summary.sumY += cy;
        summary.minX = Math.min(summary.minX, cx);
        summary.minY = Math.min(summary.minY, cy);
        summary.maxX = Math.max(summary.maxX, cx);
        summary.maxY = Math.max(summary.maxY, cy);

        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              continue;
            }
            const neighbor = ny * width + nx;
            if (clothMask[neighbor] === 0 || labels[neighbor] !== 0) {
              continue;
            }
            labels[neighbor] = label;
            queue.push(neighbor);
          }
        }
      }
    }
  }

  return { labels, summaries };
}

function islandTouchesLabel(
  island: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number; readonly id: number },
  targetLabel: number,
  labels: Int32Array,
  width: number,
  height: number,
): boolean {
  for (let y = island.minY; y <= island.maxY; y += 1) {
    for (let x = island.minX; x <= island.maxX; x += 1) {
      const offset = y * width + x;
      if (labels[offset] !== island.id) {
        continue;
      }
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          if (labels[ny * width + nx] === targetLabel) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

export function detectFloatingClothIslands(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: FloatingIslandOptions = {},
): FloatingIslandResult {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const backgroundRgb = sampleBackgroundRgb(pixels, width, height);
  const clothMask = buildClothMask(pixels, width, height, backgroundRgb, resolved.backgroundThreshold);
  const { labels, summaries } = labelClothComponents(clothMask, width, height);

  const rawIslands: ClothIslandSummary[] = [];
  for (const [label, summary] of summaries) {
    if (summary.pixelCount < resolved.minIslandPixels) {
      continue;
    }
    rawIslands.push({
      id: label,
      pixelCount: summary.pixelCount,
      centroidX: summary.sumX / summary.pixelCount,
      centroidY: summary.sumY / summary.pixelCount,
      minX: summary.minX,
      minY: summary.minY,
      maxX: summary.maxX,
      maxY: summary.maxY,
      classification: 'noise',
      touchesLargest: false,
    });
  }

  const islands = rawIslands.sort((a, b) => b.pixelCount - a.pixelCount);
  const largest = islands[0];
  if (!largest) {
    return {
      width,
      height,
      backgroundRgb,
      anchorIslandCount: 0,
      islands: [],
      floatingIslands: [],
      floatingPixelCount: 0,
      pass: true,
    };
  }

  const ratioCap = Math.max(
    500,
    Math.round(largest.pixelCount * resolved.debrisMaxRatioOfLargest),
  );
  const debrisMaxPixels = Math.min(resolved.debrisMaxPixels, ratioCap);

  const classified = islands.map((island) => {
    const touchesLargest = island.id === largest.id
      ? true
      : islandTouchesLabel(island, largest.id, labels, width, height);
    let classification: ClothIslandClassification = 'attached';
    if (island.id === largest.id) {
      classification = 'anchor';
    } else if (island.pixelCount <= debrisMaxPixels && !touchesLargest) {
      classification = 'floating';
    } else if (!touchesLargest) {
      classification = 'attached';
    }
    return { ...island, touchesLargest, classification };
  });

  const floatingIslands = classified.filter((island) => island.classification === 'floating');
  const anchorIslandCount = classified.filter((island) => island.classification === 'anchor').length;

  return {
    width,
    height,
    backgroundRgb,
    anchorIslandCount,
    islands: classified,
    floatingIslands,
    floatingPixelCount: floatingIslands.reduce((sum, island) => sum + island.pixelCount, 0),
    pass: floatingIslands.length === 0,
  };
}

export function detectFloatingClothIslandsFromImageData(
  imageData: ImageData,
  options?: FloatingIslandOptions,
): FloatingIslandResult {
  return detectFloatingClothIslands(imageData.data, imageData.width, imageData.height, options);
}

export async function loadPngBase64ToImageData(base64: string): Promise<ImageData | null> {
  const image = new Image();
  image.src = `data:image/png;base64,${base64}`;
  try {
    await image.decode();
  } catch {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
}

export async function analyzePngBase64FloatingIslands(
  base64: string,
  options?: FloatingIslandOptions,
): Promise<FloatingIslandResult | null> {
  const imageData = await loadPngBase64ToImageData(base64);
  if (!imageData) {
    return null;
  }
  return detectFloatingClothIslandsFromImageData(imageData, options);
}

export async function captureCanvasPngBase64(
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number; pngBase64: string } | null> {
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const bitmap = await createImageBitmap(canvas);
    const scratch = document.createElement('canvas');
    scratch.width = bitmap.width;
    scratch.height = bitmap.height;
    const context = scratch.getContext('2d');
    if (!context) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const dataUrl = scratch.toDataURL('image/png');
    const pngBase64 = dataUrl.split(',')[1] ?? '';
    if (!pngBase64) {
      return null;
    }
    return {
      width: scratch.width,
      height: scratch.height,
      pngBase64,
    };
  } catch {
    return null;
  }
}

export async function analyzeCanvasFloatingIslands(
  canvas: HTMLCanvasElement,
  options?: FloatingIslandOptions,
): Promise<FloatingIslandResult | null> {
  const capture = await captureCanvasPngBase64(canvas);
  if (!capture) {
    return null;
  }
  return analyzePngBase64FloatingIslands(capture.pngBase64, options);
}
