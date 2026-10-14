import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Same UI tests against the production build (vite build + preview), so
// bundling problems (workers, WASM, assets) are caught too.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5175' },
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
