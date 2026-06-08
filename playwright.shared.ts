/** Must match `server.port` in vite.config.ts */
export const PLAYWRIGHT_DEV_PORT = 5173;

export const PLAYWRIGHT_DEV_URL = `http://localhost:${PLAYWRIGHT_DEV_PORT}`;

export const playwrightDevWebServer = {
  command: `npx vite --host localhost --port ${PLAYWRIGHT_DEV_PORT} --strictPort`,
  url: PLAYWRIGHT_DEV_URL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
} as const;
