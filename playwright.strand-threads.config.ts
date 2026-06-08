import { defineConfig, devices } from '@playwright/test';
import { PLAYWRIGHT_DEV_URL, playwrightDevWebServer } from './playwright.shared.ts';

/** Headed strand-thread coverage tests — reuses the Vite dev server on 5173. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'strand-threads.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: PLAYWRIGHT_DEV_URL,
    ...devices['Desktop Chrome'],
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        '--window-position=3200,200',
        '--window-size=1280,720',
      ],
    },
  },
  webServer: playwrightDevWebServer,
});
