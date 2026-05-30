import { expect, test } from '@playwright/test';

test.describe('self-collision', () => {
  test('GPU self-collision reduces cloth fold-through vs disabled', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running', { timeout: 15_000 });

    const result = await page.evaluate(async () => {
      window.__flagSimSetWind?.(18);
      window.__flagSimSetSelfCollision?.(true);
      window.__flagSimResetFlag?.();

      const waitFrames = async (count: number) => {
        const start = window.__flagSim?.frameCount ?? 0;
        await new Promise<void>((resolve) => {
          const tick = () => {
            if ((window.__flagSim?.frameCount ?? 0) >= start + count) {
              resolve();
              return;
            }
            requestAnimationFrame(tick);
          };
          tick();
        });
      };

      await waitFrames(120);
      const probeMaxDelta = (await window.__flagSimProbeSelfCollision?.(32)) ?? 0;

      await waitFrames(300);
      const withSelfCollision = (await window.__flagSimSelfCollisionReport?.()) ?? null;

      window.__flagSimSetSelfCollision?.(false);
      await waitFrames(180);

      const withoutSelfCollision = (await window.__flagSimSelfCollisionReport?.()) ?? null;

      window.__flagSimSetSelfCollision?.(true);

      return { withSelfCollision, withoutSelfCollision, probeMaxDelta };
    });

    expect(consoleErrors, consoleErrors.join(' | ')).toEqual([]);
    expect(result.withSelfCollision).not.toBeNull();
    expect(result.withoutSelfCollision).not.toBeNull();

    const on = result.withSelfCollision!;
    const off = result.withoutSelfCollision!;

    expect(on.pairsChecked).toBeGreaterThan(10_000);
    expect(result.probeMaxDelta, 'self-collision kernel must displace vertices').toBeGreaterThan(0.0001);

    expect(
      on.maxPenetration,
      `ON maxPen=${on.maxPenetration.toFixed(4)} OFF maxPen=${off.maxPenetration.toFixed(4)} after disabling`,
    ).toBeLessThan(off.maxPenetration);
  });
});
