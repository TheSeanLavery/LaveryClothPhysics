import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: /random-tear-geometry\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 35_000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5197',
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
    command: 'npx vite --host localhost --port 5197 --strictPort',
    url: 'http://localhost:5197',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
