import { defineConfig } from '@playwright/test';

// UI smoke tests (plan.md T1.4). Uses the installed Chrome by default so no
// browser download is needed; set PW_CHANNEL='' to use Playwright's Chromium.
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1280, height: 800 },
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
