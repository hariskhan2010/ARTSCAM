import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Lets production-only tests (offline mode) know they are running on a build.
process.env.NAQSH_PROD = '1';

// Same UI tests against the production build (vite build + preview), so
// bundling problems (workers, WASM, assets) are caught too. With NAQSH_BASE
// (e.g. /ARTSCAM/, as on GitHub Pages) the app is built and served under it.
const path = process.env.NAQSH_BASE ?? '/';
const url = `http://localhost:5175${path}`;

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: url },
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --port 5175 --strictPort',
    url,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
