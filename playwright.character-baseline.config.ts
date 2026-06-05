import { defineConfig, devices } from '@playwright/test';

/** Character cloth settled-vertex golden — headed, off-screen window. */
export default defineConfig({
  testDir: './tests',
  testMatch: 'character-cloth-physics-baseline.spec.ts',
  fullyParallel: false,
  workers: 1,
  maxFailures: 1,
  timeout: 130_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5175',
    ...devices['Desktop Chrome'],
    headless: false,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=WebGPU',
        '--window-position=3500,200',
        '--window-size=1280,720',
      ],
    },
  },
  webServer: {
    command: 'npx vite --host localhost --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
