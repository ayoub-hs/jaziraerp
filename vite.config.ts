/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'os';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['server/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    env: {
      DATABASE_PATH: path.join(os.tmpdir(), 'erp-test.sqlite')
    }
  }
});
