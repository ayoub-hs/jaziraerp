/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

function resolveBuildId(): string {
  if (process.env.BUILD_ID && process.env.BUILD_ID.trim()) {
    return process.env.BUILD_ID.trim();
  }
  const buildFilePath = path.resolve(__dirname, 'dist/build-id.txt');
  if (fs.existsSync(buildFilePath)) {
    try {
      const existing = fs.readFileSync(buildFilePath, 'utf8').trim();
      if (existing) return existing;
    } catch {}
  }
  let gitShort = '';
  try {
    gitShort = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  const timestamp = Date.now();
  return gitShort ? `${gitShort}-${timestamp}` : `build-${timestamp}`;
}

const currentBuildId = resolveBuildId();
process.env.VITE_BUILD_ID = currentBuildId;

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(currentBuildId)
  },
  plugins: [
    react(),
    {
      name: 'preserve-build-id',
      closeBundle() {
        const distDir = path.resolve(__dirname, 'dist');
        if (!fs.existsSync(distDir)) {
          fs.mkdirSync(distDir, { recursive: true });
        }
        fs.writeFileSync(path.resolve(distDir, 'build-id.txt'), currentBuildId, 'utf8');
      }
    }
  ],
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
