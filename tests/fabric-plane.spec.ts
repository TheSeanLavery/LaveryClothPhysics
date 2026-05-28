import { expect, test } from '@playwright/test';

async function sampleCanvasPairDiff(page: import('@playwright/test').Page): Promise<number | null> {
  return page.evaluate(async () => {
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

    return await new Promise<number | null>((resolve) => {
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
        const { data, width, height } = ctx.getImageData(0, 0, scratch.width, scratch.height);
        const cy = Math.floor(height * 0.5);
        const leftX = Math.floor(width * 0.25);
        const rightX = Math.floor(width * 0.75);
        const left = (cy * width + leftX) * 4;
        const right = (cy * width + rightX) * 4;
        const diff =
          Math.abs(data[left]! - data[right]!) +
          Math.abs(data[left + 1]! - data[right + 1]!) +
          Math.abs(data[left + 2]! - data[right + 2]!);
        resolve(diff);
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
  });
}

test.describe('Fabric plane preview', () => {
  test('plane mode renders and UV debug shows a color gradient', async ({ page }) => {
    await page.goto('/?mode=plane');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (fabric plane)', {
      timeout: 30_000,
    });

    await page.waitForTimeout(1500);

    const shadedDiff = await sampleCanvasPairDiff(page);
    expect(shadedDiff).not.toBeNull();

    await page.evaluate(() => window.__fabricPlaneSetDebugView?.('uv'));
    await page.waitForTimeout(800);

    const uvDiff = await sampleCanvasPairDiff(page);
    expect(uvDiff, 'UV debug should vary horizontally across the plane').not.toBeNull();
    expect(uvDiff!, `UV debug horizontal diff=${uvDiff}, shaded=${shadedDiff}`).toBeGreaterThan(60);
  });
});
