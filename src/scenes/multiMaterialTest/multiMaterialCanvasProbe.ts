import * as THREE from 'three';

/** GPU segment colors use the same linear RGB encoding as {@link THREE.Color}. */
export function linearRgbFromHex(hex: string): readonly [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

export interface CanvasRgbSample {
  readonly ndcX: number;
  readonly ndcY: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly width: number;
  readonly height: number;
  readonly rgb: readonly [number, number, number];
}

function ndcToPixel(ndcX: number, ndcY: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((ndcX * 0.5 + 0.5) * width))),
    y: Math.max(0, Math.min(height - 1, Math.floor((-ndcY * 0.5 + 0.5) * height))),
  };
}

export async function sampleCanvasRgbAtNdc(ndcX: number, ndcY: number): Promise<CanvasRgbSample | null> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sim-canvas"]');
  if (!canvas || typeof canvas.toDataURL !== 'function') {
    return null;
  }

  const dataUrl = canvas.toDataURL('image/png');
  if (!dataUrl.startsWith('data:image/png')) {
    return null;
  }

  return await new Promise<CanvasRgbSample | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scratch = document.createElement('canvas');
      scratch.width = image.width;
      scratch.height = image.height;
      const ctx = scratch.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(image, 0, 0);
      const { width, height } = scratch;
      const pixel = ndcToPixel(ndcX, ndcY, width, height);
      const index = (pixel.y * width + pixel.x) * 4;
      const data = ctx.getImageData(0, 0, width, height).data;
      resolve({
        ndcX,
        ndcY,
        pixelX: pixel.x,
        pixelY: pixel.y,
        width,
        height,
        rgb: [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0],
      });
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

export function rgbDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export async function sampleCanvasRgbPatch(
  ndcX: number,
  ndcY: number,
  radiusNdc = 0.04,
): Promise<CanvasRgbSample | null> {
  const offsets = [
    [0, 0],
    [radiusNdc, 0],
    [-radiusNdc, 0],
    [0, radiusNdc],
    [0, -radiusNdc],
  ] as const;

  let best: CanvasRgbSample | null = null;
  let bestLuma = -1;
  for (const [dx, dy] of offsets) {
    const sample = await sampleCanvasRgbAtNdc(ndcX + dx, ndcY + dy);
    if (!sample) {
      continue;
    }
    const luma = sample.rgb[0] * 0.299 + sample.rgb[1] * 0.587 + sample.rgb[2] * 0.114;
    if (luma > bestLuma) {
      bestLuma = luma;
      best = sample;
    }
  }
  return best;
}

export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed)) {
    return [255, 255, 255];
  }
  return [
    (parsed >> 16) & 255,
    (parsed >> 8) & 255,
    parsed & 255,
  ];
}
