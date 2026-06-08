import { expect, test } from '@playwright/test';
import { attachConsoleCapture, formatCapturedConsole } from './helpers/consoleCapture';

const proofs = [
  'torso',
  'torsoTube',
  'leftArm',
  'rightArm',
  'torsoAndArms',
  'torsoAndArmsLoose',
] as const;

async function waitForAnimationFrames(page: import('@playwright/test').Page, count: number): Promise<void> {
  await page.evaluate((frames) => new Promise<void>((resolve) => {
    let remaining = frames;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), count);
}

test.describe('Wrapped garment SDF proofs', () => {
  for (const proof of proofs) {
    test(`loads wrapped ${proof} on character with SDF clearance`, async ({ page }) => {
      const consoleCapture = attachConsoleCapture(page);

      await page.goto('/?mode=character');
      await expect(page.locator('[data-testid="sim-status"]')).toHaveText('running (animated character cloth)', {
        timeout: 45_000,
      });

      await page.evaluate(() => window.__characterForceTposeForTest?.());

      const report = await page.evaluate(
        (kind) => window.__characterLoadWrappedGarmentProof?.(kind),
        proof,
      );
      expect(report, `__characterLoadWrappedGarmentProof missing for ${proof}`).toBeTruthy();
      expect(
        report!.passed,
        `${proof} proof failed:\n${report!.failures.join('\n')}\n`
          + `verts=${report!.vertexCount} stitches=${report!.stitchEdgeCount} `
          + `patches=${report!.patchIds.join(', ')} penetrations=${report!.penetrationCount}`,
      ).toBe(true);

      const minVerts = proof === 'torsoTube' ? 60 : proof === 'torso' ? 80 : 40;
      expect(report!.vertexCount).toBeGreaterThan(minVerts);
      expect(report!.validationIssueCount).toBe(0);
      expect(report!.penetrationCount).toBe(0);

      if (proof === 'torsoAndArms' || proof === 'torsoAndArmsLoose') {
        expect(report!.stitchEdgeCount).toBeGreaterThanOrEqual(20);
      }

      await waitForAnimationFrames(page, 24);

      const clearance = await page.evaluate(() => window.__characterShirtSdfClearanceReport?.());
      expect(clearance?.penetrationCount ?? 1).toBe(0);

      const clothStats = await page.evaluate(() => window.__characterClothStats?.());
      expect(clothStats?.particleCount ?? 0).toBeGreaterThan(40);
      expect(clothStats?.hasNaN).toBe(false);

      expect(consoleCapture.errors, formatCapturedConsole(consoleCapture)).toEqual([]);
    });
  }
});
