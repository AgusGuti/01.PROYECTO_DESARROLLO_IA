import { defineConfig } from 'vitest/config';

// Two projects: fast unit/API tests, and integration tests that start a real MongoDB.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.int.spec.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.int.spec.ts'],
          testTimeout: 30_000,
          // The first run downloads the MongoDB binary into node_modules/.cache.
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
