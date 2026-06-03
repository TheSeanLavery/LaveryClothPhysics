import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

test.describe('developer dashboard', () => {
  test('reveals route links on hover and pins open from the top edge', async ({ page }) => {
    const consoleCapture = attachConsoleCapture(page);

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', {
      timeout: 30_000,
    });

    const dashboard = page.locator('[data-testid="dev-dashboard"]');
    const toggle = page.locator('[data-testid="dev-dashboard-toggle"]');
    const links = page.locator('[data-testid="dev-dashboard-links"] a');

    await expect(dashboard).toBeAttached();
    await expect(toggle).toHaveText('Open');
    await expect(links).toHaveCount(7);

    await expect
      .poll(() =>
        dashboard.evaluate((element) => {
          const surface = element.querySelector<HTMLElement>('.dev-dashboard__surface');
          return surface ? Number(getComputedStyle(surface).opacity) : -1;
        }),
      )
      .toBe(0);

    await page.mouse.move(page.viewportSize()!.width / 2, 2);
    await expect
      .poll(() =>
        dashboard.evaluate((element) => {
          const surface = element.querySelector<HTMLElement>('.dev-dashboard__surface');
          return surface ? Number(getComputedStyle(surface).opacity) : -1;
        }),
      )
      .toBeGreaterThan(0.8);

    await toggle.click();
    await expect(toggle).toHaveText('Close');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(links.filter({ hasText: 'Flag' })).toHaveAttribute('aria-current', 'page');

    const hrefs = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href')),
    );
    expect(hrefs).toEqual([
      '/',
      '/?mode=plane',
      '/?mode=tube',
      '/?mode=character',
      '/?mode=character-sdf',
      '/?mode=garment',
      '/?mode=animations',
    ]);

    expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    expect(consoleCapture.threeMessages, consoleCapture.threeMessages.join('\n')).toEqual([]);
  });
});
