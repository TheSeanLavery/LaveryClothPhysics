import { defineConfig, devices } from '@playwright/test';

/** Fast fail-fast smoke tests — headed but parked off-screen. */
export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 25_000,
  expect: { timeout: 8_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5175',
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
    command: 'npx vite --host localhost --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
