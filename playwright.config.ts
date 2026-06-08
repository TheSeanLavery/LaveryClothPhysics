import { defineConfig, devices } from '@playwright/test';
import { PLAYWRIGHT_DEV_URL, playwrightDevWebServer } from './playwright.shared.ts';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: PLAYWRIGHT_DEV_URL,
    ...devices['Desktop Chrome'],
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        // Keep the headed browser off the primary workspace.
        '--window-position=3200,200',
        '--window-size=1280,720',
      ],
    },
  },
  webServer: playwrightDevWebServer,
});
