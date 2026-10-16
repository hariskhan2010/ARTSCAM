import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Relief and CAM tests build full-size grids; on a busy machine they can pass 5 s.
    testTimeout: 30_000,
  },
});
