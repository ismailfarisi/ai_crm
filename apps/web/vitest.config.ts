import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // React's CJS build only ships `React.act` in development mode, which
    // @testing-library/react relies on. Force it here, not via NODE_ENV, so the
    // rest of the toolchain still sees the real environment.
    env: {
      NODE_ENV: 'development',
    },
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
