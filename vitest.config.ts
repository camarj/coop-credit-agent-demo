import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration tests share the same Postgres; run files serially to avoid
    // cross-file truncation races.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
