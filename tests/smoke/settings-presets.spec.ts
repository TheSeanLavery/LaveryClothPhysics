import { expect, test } from '@playwright/test';
import { attachConsoleCapture } from '../helpers/consoleCapture';

const PRESET_NAME = 'Playwright preset';

test.describe('settings presets', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 15_000 });
    await page.waitForFunction(() => (window.__flagSim?.frameCount ?? 0) > 60, undefined, { timeout: 12_000 });

    await page.evaluate(async (name) => {
      const presets = await window.__flagSimListSettingsPresets?.();
      for (const preset of presets ?? []) {
        if (preset.name === name) {
          await window.__flagSimDeleteSettingsPreset?.(preset.id);
        }
      }
    }, PRESET_NAME);
  });

  test('save and load preset via test API restores settings', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    const saved = await page.evaluate(
      async ({ windStrength, tearStretchThreshold, bbSpeed }) => {
        await window.__flagSimApplySettings?.({ windStrength, tearStretchThreshold, bbSpeed });
        return window.__flagSimSaveSettingsPreset?.('Playwright preset');
      },
      { windStrength: 7.25, tearStretchThreshold: 1.41, bbSpeed: 42 },
    );

    expect(saved?.id).toBeTruthy();
    expect(saved?.name).toBe(PRESET_NAME);

    await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 1.5,
        tearStretchThreshold: 1.05,
        bbSpeed: 10,
      });
    });

    const loaded = await page.evaluate(async (id) => window.__flagSimLoadSettingsPreset?.(id!), saved!.id);
    const settings = await page.evaluate(() => window.__flagSimGetSettings?.());

    expect(loaded?.name).toBe(PRESET_NAME);
    expect(settings?.windStrength).toBeCloseTo(7.25, 2);
    expect(settings?.tearStretchThreshold).toBeCloseTo(1.41, 2);
    expect(settings?.bbSpeed).toBeCloseTo(42, 2);
    expect(consoleCapture.errors, consoleCapture.errors.join('\n')).toEqual([]);
  });

  test('save and load preset via UI controls', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 9.5,
        tearStretchThreshold: 1.55,
        bbSpeed: 36,
      });
    });

    await page.locator('[data-testid="flag-controls"]').click({ force: true });
    await page.locator('[data-testid="preset-name-input"] input').fill(PRESET_NAME);
    await page.locator('[data-testid="preset-save-btn"] button').click();

    await expect
      .poll(async () => page.locator('[data-testid="preset-status"] input').inputValue())
      .toContain('Saved');

    const presetId = await page.evaluate(async (name) => {
      const presets = await window.__flagSimListSettingsPresets?.();
      return presets?.find((preset) => preset.name === name)?.id ?? '';
    }, PRESET_NAME);

    expect(presetId).not.toBe('');

    await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 2,
        tearStretchThreshold: 1.1,
        bbSpeed: 12,
      });
    });

    await page.locator('[data-testid="preset-select"] select').selectOption(presetId);
    await page.locator('[data-testid="preset-load-btn"] button').click();

    await expect
      .poll(async () => page.locator('[data-testid="preset-status"] input').inputValue())
      .toContain('Loaded');

    const settings = await page.evaluate(() => window.__flagSimGetSettings?.());
    expect(settings?.windStrength).toBeCloseTo(9.5, 2);
    expect(settings?.tearStretchThreshold).toBeCloseTo(1.55, 2);
    expect(settings?.bbSpeed).toBeCloseTo(36, 2);
    expect(consoleCapture.errors, consoleCapture.errors.join('\n')).toEqual([]);
  });

  test('updating an existing preset keeps the same id', async ({ page }) => {
    const first = await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({ windStrength: 4.2 });
      return window.__flagSimSaveSettingsPreset?.('Playwright preset');
    });

    await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({ windStrength: 6.6 });
    });

    const updated = await page.evaluate(
      async ({ id, name }) => window.__flagSimSaveSettingsPreset?.(name, id),
      { id: first!.id, name: PRESET_NAME },
    );

    const loaded = await page.evaluate(async (id) => window.__flagSimLoadSettingsPreset?.(id!), first!.id);

    expect(updated?.id).toBe(first?.id);
    expect(loaded?.settings.windStrength).toBeCloseTo(6.6, 2);
  });

  test('exports selected preset as JSON via UI controls', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.evaluate(async () => {
      await window.__flagSimApplySettings?.({
        windStrength: 8.75,
        tearStretchThreshold: 1.72,
        bbSpeed: 28,
      });
    });

    await page.locator('[data-testid="flag-controls"]').click({ force: true });
    await page.locator('[data-testid="preset-name-input"] input').fill(PRESET_NAME);
    await page.locator('[data-testid="preset-save-btn"] button').click();
    await expect
      .poll(async () => page.locator('[data-testid="preset-status"] input').inputValue())
      .toContain('Saved');

    const presetId = await page.evaluate(async (name) => {
      const presets = await window.__flagSimListSettingsPresets?.();
      return presets?.find((preset) => preset.name === name)?.id ?? '';
    }, PRESET_NAME);
    expect(presetId).not.toBe('');

    await page.locator('[data-testid="preset-select"] select').selectOption(presetId);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="preset-export-btn"] button').click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();

    const chunks: Buffer[] = [];
    for await (const chunk of stream!) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(download.suggestedFilename()).toBe('playwright-preset.json');
    expect(exported.type).toBe('lavery-cloth-settings-preset');
    expect(exported.version).toBe(1);
    expect(exported.preset.name).toBe(PRESET_NAME);
    expect(exported.preset.settings.windStrength).toBeCloseTo(8.75, 2);
    expect(exported.preset.settings.tearStretchThreshold).toBeCloseTo(1.72, 2);
    expect(exported.preset.settings.bbSpeed).toBeCloseTo(28, 2);
    expect(consoleCapture.errors, consoleCapture.errors.join('\n')).toEqual([]);
  });
});
