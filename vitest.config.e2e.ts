import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    env: { NODE_ENV:'test', COMMERCE_MAINTENANCE_ENABLED:'false', ASYNC_JOBS_ENABLED:'false', EMAIL_PROVIDER:'disabled', STORAGE_PROVIDER:'disabled' },
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
