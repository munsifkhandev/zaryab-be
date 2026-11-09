import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

config({ path: fileURLToPath(new URL('.env', import.meta.url)), quiet: true });

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    env: { NODE_ENV:'test', COMMERCE_MAINTENANCE_ENABLED:'false', ASYNC_JOBS_ENABLED:'false', EMAIL_PROVIDER:'disabled', STORAGE_PROVIDER:'disabled' },
    globals: true,
    root: './',
    include: ['test/**/*.integration-spec.ts'],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
