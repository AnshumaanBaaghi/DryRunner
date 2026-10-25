/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Babel standalone is CommonJS and only imported from a worker, so Vite would discover it late.
    include: ['@babel/standalone'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 20000,
  },
});
