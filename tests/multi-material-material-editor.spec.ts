import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

async function waitForMaterialPanel(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => typeof window.__multiMaterialMaterialPanel === 'function'
      && window.__multiMaterialMaterialPanel?.() !== undefined,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('Multi-material material editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?mode=multi-material');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText(
      'running (multi-material cloth test)',
      { timeout: 45_000 },
    );
    await page.waitForFunction(
      () => (window.__multiMaterialStats?.().particleCount ?? 0) > 40,
      undefined,
      { timeout: 30_000 },
    );
    await waitForMaterialPanel(page);
  });

  test('material dropdown syncs tear strain sliders between dangle materials', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    const softEditor = await page.evaluate(() => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Dangle soft')) {
        throw new Error('Failed to select Dangle soft');
      }
      return panel.getEditorState();
    });
    expect(softEditor.tearStretchThreshold).toBeCloseTo(1.25, 2);
    expect(softEditor.dampening).toBeGreaterThan(0.998);

    const stiffEditor = await page.evaluate(() => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Dangle stiff')) {
        throw new Error('Failed to select Dangle stiff');
      }
      return panel.getEditorState();
    });
    expect(stiffEditor.tearStretchThreshold).toBeCloseTo(6.5, 2);
    expect(stiffEditor.tearStretchThreshold).toBeGreaterThan(softEditor.tearStretchThreshold + 1);
    expect(stiffEditor.dampening).toBeLessThan(softEditor.dampening - 0.005);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('save applies tear strain to live patch scalars', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleCapture = attachConsoleCapture(page);
    const nextTear = 2.75;

    const restoreTear = await page.evaluate(async (tearValue) => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Dangle soft')) {
        throw new Error('Failed to select Dangle soft');
      }
      const before = panel.getEditorState().tearStretchThreshold;
      panel.setEditorField('tearStretchThreshold', tearValue);
      await panel.saveActiveMaterial();
      return before;
    }, nextTear);

    try {
      const audit = await page.evaluate(() => window.__multiMaterialMaterialAudit?.());
      expect(audit?.libraryScales.tearThreshold['dangle-soft'] ?? 0).toBeCloseTo(nextTear, 2);
      expect(audit?.livePatchScalars?.['dangle-soft']?.tearThresholdScale ?? 0).toBeCloseTo(nextTear, 2);
      expect(audit?.livePatchScalars?.['dangle-soft']?.dampeningScale ?? 0).toBeGreaterThan(0.998);
      expect(audit?.livePatchScalars?.['dangle-stiff']?.tearThresholdScale ?? 0).toBeGreaterThan(nextTear + 2);
    } finally {
      await page.evaluate(async (tearValue) => {
        const panel = window.__multiMaterialMaterialPanel?.();
        if (!panel?.selectMaterialByName('Dangle soft')) {
          throw new Error('Failed to select Dangle soft');
        }
        panel.setEditorField('tearStretchThreshold', tearValue);
        await panel.saveActiveMaterial();
      }, restoreTear);
    }

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('color preview and save update runtime material audit maps', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleCapture = attachConsoleCapture(page);
    const nextColor = '#ff00aa';

    const restoreColor = await page.evaluate((bannerColor) => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Banner A')) {
        throw new Error('Failed to select Banner A');
      }
      const beforeColor = panel.getEditorState().color;
      const beforeAudit = window.__multiMaterialMaterialAudit?.();
      panel.setEditorField('color', bannerColor);
      return {
        color: beforeColor,
        bannerB: beforeAudit?.patchColors['banner-b'],
      };
    }, nextColor);

    await page.evaluate(async () => {
      await window.__multiMaterialWaitForPresentation?.();
    });

    const previewAudit = await page.evaluate(() => window.__multiMaterialMaterialAudit?.());
    expect(previewAudit?.patchColors['banner-a']).toBe(nextColor);
    expect(previewAudit?.patchColors['banner-b']).toBe(restoreColor.bannerB);

    const linearMagenta = await page.evaluate(
      (hex) => window.__multiMaterialLinearRgbFromHex?.(hex) ?? [0, 0, 0],
      nextColor,
    );
    const gpuBannerA = previewAudit?.gpuSegmentColors?.['banner-a'];
    expect(gpuBannerA?.[0] ?? 0).toBeCloseTo(linearMagenta[0], 2);
    expect(gpuBannerA?.[1] ?? 1).toBeCloseTo(linearMagenta[1], 2);
    expect(gpuBannerA?.[2] ?? 0).toBeCloseTo(linearMagenta[2], 2);

    const canvasCheck = await page.evaluate(async (hex) => {
      const targets = window.__multiMaterialPatchGrabTargets?.() ?? {};
      const target = targets['banner-a'];
      if (!target) {
        return { ok: false, reason: 'missing banner-a target' };
      }
      await window.__multiMaterialWaitForPresentation?.();
      const sample = await window.__multiMaterialSampleCanvasRgbPatch?.(target.ndcX, target.ndcY);
      if (!sample) {
        return { ok: false, reason: 'missing canvas sample' };
      }
      const distance = window.__multiMaterialCanvasColorDistance?.(sample.rgb, hex) ?? Infinity;
      return { ok: distance < 95, distance, rgb: sample.rgb };
    }, nextColor);
    expect(canvasCheck.ok, JSON.stringify(canvasCheck)).toBe(true);

    await page.evaluate(async (bannerColor) => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Banner A')) {
        throw new Error('Failed to select Banner A');
      }
      panel.setEditorField('color', bannerColor);
      await panel.saveActiveMaterial();
      await window.__multiMaterialWaitForPresentation?.();
    }, nextColor);

    const savedLibrary = await page.evaluate(async () => {
      const response = await fetch('/__cloth/materials');
      const library = await response.json() as {
        materials: Array<{ name: string; color: string }>;
      };
      return library.materials.find((entry) => entry.name === 'Banner A')?.color;
    });
    expect(savedLibrary).toBe(nextColor);

    await page.evaluate(async (bannerColor) => {
      const panel = window.__multiMaterialMaterialPanel?.();
      if (!panel?.selectMaterialByName('Banner A')) {
        throw new Error('Failed to select Banner A');
      }
      panel.setEditorField('color', bannerColor);
      await panel.saveActiveMaterial();
      await window.__multiMaterialWaitForPresentation?.();
    }, restoreColor.color);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });

  test('patch ray samples hit distinct cloth colors at load', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);
    const samples = await page.evaluate(async () => {
      const targets = window.__multiMaterialPatchGrabTargets?.() ?? {};
      const read = async (patchKey: string) => {
        const target = targets[patchKey];
        if (!target) {
          return null;
        }
        return window.__multiMaterialSampleCanvasRgbPatch?.(target.ndcX, target.ndcY) ?? null;
      };
      return {
        bannerA: await read('banner-a'),
        bannerB: await read('banner-b'),
        bannerC: await read('banner-c'),
      };
    });

    const distance = (
      a: readonly [number, number, number],
      b: readonly [number, number, number],
    ) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    expect(samples.bannerA?.rgb).toBeTruthy();
    expect(samples.bannerB?.rgb).toBeTruthy();
    expect(samples.bannerC?.rgb).toBeTruthy();
    expect(distance(samples.bannerA!.rgb, samples.bannerB!.rgb)).toBeGreaterThan(12);
    expect(distance(samples.bannerB!.rgb, samples.bannerC!.rgb)).toBeGreaterThan(12);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
  });
});
