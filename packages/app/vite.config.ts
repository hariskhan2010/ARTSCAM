import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
