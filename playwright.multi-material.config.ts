import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:5177',
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
  webServer: {
    command: 'npx vite --host localhost --port 5177 --strictPort',
    url: 'http://localhost:5177',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
