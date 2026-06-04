import { defineConfig, devices } from '@playwright/test';

/** GPU cloth cube render validation — headed but parked off-screen. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'cloth-render-cube.spec.ts',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 35_000,
  expect: { timeout: 10_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5176',
    ...devices['Desktop Chrome'],
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        '--window-position=3300,200',
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
