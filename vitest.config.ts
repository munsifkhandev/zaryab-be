import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    env: { NODE_ENV:'test', COMMERCE_MAINTENANCE_ENABLED:'false', ASYNC_JOBS_ENABLED:'false', EMAIL_PROVIDER:'disabled', STORAGE_PROVIDER:'disabled' },
    globals: true,
    root: './',
    include: ['**/*.spec.ts', 'prisma/**/*.spec.mjs'],
  },
});
