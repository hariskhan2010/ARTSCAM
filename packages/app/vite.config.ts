import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './src/sw-plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
/** Short commit of this build (CI sets GITHUB_SHA); "local" outside git. */
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  // Shown in Help › About and sent with bug reports (src/about.ts).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(buildId()),
  },
  // Served from a sub-path on GitHub Pages (NAQSH_BASE=/ARTSCAM/); '/' locally.
  base: process.env.NAQSH_BASE ?? '/',
  plugins: [react(), serviceWorker()],
  server: { port: 5173 },
  // HarfBuzz finds its .wasm next to its own module; pre-bundling would move it.
  optimizeDeps: { exclude: ['harfbuzzjs'] },
  // The CAM worker is a module worker (type: 'module'); build it as ES so
  // modules with top-level await (HarfBuzz) can be bundled into it.
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
