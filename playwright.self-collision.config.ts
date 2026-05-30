import { defineConfig, devices } from '@playwright/test';

/** Self-collision regression — headed but parked off-screen. */
export default defineConfig({
  testDir: './tests/smoke',
  testMatch: 'self-collision.spec.ts',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5176',
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
    command: 'npx vite --host localhost --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
