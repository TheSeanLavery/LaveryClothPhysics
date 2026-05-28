import { expect, test } from '@playwright/test';

const failurePattern = /(error|exception|invalid|wgsl|typeerror|failed to compile)/i;

function attachConsoleCollector(page: import('@playwright/test').Page): string[] {
  const consoleProblems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || (msg.type() === 'warning' && failurePattern.test(text))) {
      consoleProblems.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleProblems.push(`[pageerror] ${error.message}`);
  });
  return consoleProblems;
}

test.describe('GPU flag simulation', () => {
  test('WebGPU renderer initializes and flag simulates on GPU', async ({ page }) => {
    const consoleProblems = attachConsoleCollector(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await expect(page.locator('[data-testid="sim-backend"]')).toContainText('backend:', {
      timeout: 5_000,
    });

    const canvas = page.locator('[data-testid="sim-canvas"]');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);

    const particleText = await page.locator('[data-testid="sim-particles"]').textContent();
    expect(particleText).toMatch(/particles: [1-9]/);

    const frameA = await page.evaluate(() => window.__flagSim?.frameCount ?? 0);

    await page.waitForFunction(
      (start) => (window.__flagSim?.frameCount ?? 0) >= start + 30,
      frameA,
      { timeout: 15_000 },
    );

    const frameB = await page.evaluate(() => window.__flagSim?.frameCount ?? 0);
    const backend = await page.evaluate(() => window.__flagSim?.backend ?? '');

    expect(frameB).toBeGreaterThanOrEqual(frameA + 30);
    expect(backend.toLowerCase()).toContain('webgpu');

    expect(consoleProblems).toEqual([]);
  });

  test('flag mesh stays healthy, in bounds, and renders fabric pixels', async ({ page }) => {
    const consoleProblems = attachConsoleCollector(page);

    await page.goto('/');

    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    await page.waitForFunction(async () => {
      await window.__flagSimRefreshHealth?.();
      const sim = window.__flagSim;
      return sim?.isHealthy === true && sim.frameCount > 60;
    }, undefined, { timeout: 20_000 });

    const stats = await page.evaluate(async () => {
      await window.__flagSimRefreshHealth?.();
      return window.__flagSim;
    });
    expect(stats).toBeDefined();
    expect(stats!.hasNaN).toBe(false);
    expect(stats!.isHealthy).toBe(true);
    expect(stats!.spanX).toBeGreaterThan(0.8);
    expect(stats!.spanX).toBeLessThan(3.5);
    expect(stats!.spanY).toBeGreaterThan(0.4);
    expect(stats!.spanY).toBeLessThan(2);
    expect(stats!.maxStretch).toBeLessThan(1.35);

    const checksumA = stats!.checksum;
    await page.waitForTimeout(1500);
    const checksumB = await page.evaluate(() => window.__flagSim?.checksum ?? 0);
    expect(Math.abs(checksumB - checksumA)).toBeGreaterThan(0.001);

    const canvasSample = await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="sim-canvas"]');
      if (!canvas || typeof canvas.toDataURL !== 'function') {
        return { ok: false, reason: 'no-canvas' as const, fabricRatio: 0 };
      }

      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png')) {
        return { ok: false, reason: 'no-dataurl' as const, fabricRatio: 0 };
      }

      return await new Promise<{ ok: boolean; reason: string; fabricRatio: number }>((resolve) => {
        const image = new Image();
        image.onload = () => {
          const scratch = document.createElement('canvas');
          scratch.width = image.width;
          scratch.height = image.height;
          const ctx = scratch.getContext('2d');
          if (!ctx) {
            resolve({ ok: false, reason: 'no-2d', fabricRatio: 0 });
            return;
          }

          ctx.drawImage(image, 0, 0);
          const { data, width, height } = ctx.getImageData(0, 0, scratch.width, scratch.height);

          let fabricish = 0;
          let sampled = 0;
          const step = 4 * 8;
          for (let i = 0; i < data.length; i += step) {
            const r = data[i]!;
            const g = data[i + 1]!;
            const b = data[i + 2]!;
            sampled += 1;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const bgDistance = Math.hypot(r - 26, g - 36, b - 56);
            if (luma > 24 && bgDistance > 18) {
              fabricish += 1;
            }
          }

          const fabricRatio = sampled > 0 ? fabricish / sampled : 0;
          resolve({
            ok: fabricRatio > 0.002,
            reason: fabricRatio > 0.002 ? 'ok' : 'no-fabric-pixels',
            fabricRatio,
          });
        };
        image.onerror = () => resolve({ ok: false, reason: 'image-error', fabricRatio: 0 });
        image.src = dataUrl;
      });
    });

    expect(
      canvasSample.ok,
      `expected flag pixels on canvas (${canvasSample.reason}, fabricRatio=${canvasSample.fabricRatio.toFixed(4)})`,
    ).toBe(true);

    expect(consoleProblems).toEqual([]);
  });
});
