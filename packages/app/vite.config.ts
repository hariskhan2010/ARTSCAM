import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './src/sw-plugin';

export default defineConfig({
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
