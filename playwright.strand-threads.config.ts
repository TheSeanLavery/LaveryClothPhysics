import { defineConfig, devices } from '@playwright/test';

/** Headed strand-thread coverage tests on an isolated dev port. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'strand-threads.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
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
  webServer: {
    command: 'npx vite --host localhost --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
