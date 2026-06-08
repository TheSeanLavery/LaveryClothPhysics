import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFloatingClothIslands } from './floatingClothIslands.ts';

function createSolidImage(
  width: number,
  height: number,
  background: [number, number, number],
  rects: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    color: [number, number, number];
  }>,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    pixels[offset] = background[0];
    pixels[offset + 1] = background[1];
    pixels[offset + 2] = background[2];
    pixels[offset + 3] = 255;
  }

  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = rect.color[0];
        pixels[offset + 1] = rect.color[1];
        pixels[offset + 2] = rect.color[2];
        pixels[offset + 3] = 255;
      }
    }
  }

  return pixels;
}

test('detectFloatingClothIslands passes when only the main cloth body is present', () => {
  const width = 240;
  const height = 180;
  const background: [number, number, number] = [18, 20, 28];
  const cloth: [number, number, number] = [180, 120, 90];
  const pixels = createSolidImage(width, height, background, [
    { x: 30, y: 20, w: 70, h: 120, color: cloth },
    { x: 130, y: 20, w: 70, h: 120, color: cloth },
  ]);

  const result = detectFloatingClothIslands(pixels, width, height);

  assert.equal(result.pass, true);
  assert.equal(result.floatingIslands.length, 0);
  assert.equal(result.islands.length, 2);
  assert.equal(result.islands[0]?.classification, 'anchor');
  assert.equal(result.islands[1]?.classification, 'attached');
});

test('detectFloatingClothIslands flags detached debris islands that do not touch the main body', () => {
  const width = 240;
  const height = 180;
  const background: [number, number, number] = [18, 20, 28];
  const cloth: [number, number, number] = [180, 120, 90];
  const pixels = createSolidImage(width, height, background, [
    { x: 30, y: 20, w: 70, h: 120, color: cloth },
    { x: 130, y: 20, w: 70, h: 120, color: cloth },
    { x: 105, y: 4, w: 12, h: 10, color: cloth },
  ]);

  const result = detectFloatingClothIslands(pixels, width, height, {
    minIslandPixels: 40,
    debrisMaxPixels: 3_500,
  });

  assert.equal(result.pass, false);
  assert.equal(result.floatingIslands.length, 1);
  assert.equal(result.floatingIslands[0]?.classification, 'floating');
  assert.equal(result.floatingIslands[0]?.touchesLargest, false);
});

test('detectFloatingClothIslands ignores tiny dust below the minimum island size', () => {
  const width = 240;
  const height = 180;
  const background: [number, number, number] = [18, 20, 28];
  const cloth: [number, number, number] = [180, 120, 90];
  const pixels = createSolidImage(width, height, background, [
    { x: 30, y: 20, w: 90, h: 120, color: cloth },
    { x: 120, y: 8, w: 4, h: 4, color: cloth },
  ]);

  const result = detectFloatingClothIslands(pixels, width, height, { minIslandPixels: 72 });

  assert.equal(result.pass, true);
  assert.equal(result.floatingIslands.length, 0);
});

test('detectFloatingClothIslands matches the user snapshot island sizes', () => {
  const width = 320;
  const height = 160;
  const background: [number, number, number] = [14, 27, 53];
  const cloth: [number, number, number] = [170, 110, 80];
  const pixels = createSolidImage(width, height, background, [
    { x: 40, y: 30, w: 90, h: 90, color: cloth },
    { x: 170, y: 30, w: 90, h: 90, color: cloth },
    { x: 136, y: 68, w: 14, h: 12, color: cloth },
    { x: 152, y: 72, w: 14, h: 12, color: cloth },
  ]);

  const result = detectFloatingClothIslands(pixels, width, height, {
    minIslandPixels: 72,
    debrisMaxPixels: 3_500,
    debrisMaxRatioOfLargest: 0.012,
  });

  assert.equal(result.floatingIslands.length, 2);
  assert.equal(result.islands.length, 4);
  assert.equal(result.islands[0]?.classification, 'anchor');
});
