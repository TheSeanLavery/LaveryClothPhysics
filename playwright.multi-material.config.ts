import { defineConfig, devices } from '@playwright/test';
import { PLAYWRIGHT_DEV_URL, playwrightDevWebServer } from './playwright.shared.ts';

/** Multi-material cloth assembly + material library — headed, off-screen window. */
export default defineConfig({
  testDir: './tests',
  testMatch: /multi-material.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  reporter: 'line',
  use: {
    baseURL: PLAYWRIGHT_DEV_URL,
    ...devices['Desktop Chrome'],
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        '--window-position=3400,200',
        '--window-size=1280,720',
      ],
    },
  },
  webServer: playwrightDevWebServer,
});
