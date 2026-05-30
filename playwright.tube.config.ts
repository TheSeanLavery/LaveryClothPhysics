import { defineConfig, devices } from '@playwright/test';

/** Fresh zero-g tube cloth scene smoke test — headed but parked off-screen. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'zero-g-tube.spec.ts',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5178',
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
    command: 'npx vite --host localhost --port 5178 --strictPort',
    url: 'http://localhost:5178',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
