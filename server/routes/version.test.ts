import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, request } from '../../tests/testApp.js';
import { getServerBuildId } from './version.js';
import { CLIENT_BUILD_ID } from '../../src/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../../dist');
const buildFilePath = path.resolve(distDir, 'build-id.txt');

describe('Step 8: Version Check & Build ID Endpoint', () => {
  const origBuildIdEnv = process.env.BUILD_ID;
  let originalFileContent: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(buildFilePath)) {
      originalFileContent = fs.readFileSync(buildFilePath, 'utf8');
    } else {
      originalFileContent = null;
    }
  });

  afterEach(() => {
    if (origBuildIdEnv !== undefined) {
      process.env.BUILD_ID = origBuildIdEnv;
    } else {
      delete process.env.BUILD_ID;
    }

    if (originalFileContent !== null) {
      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(buildFilePath, originalFileContent, 'utf8');
    } else if (fs.existsSync(buildFilePath)) {
      fs.unlinkSync(buildFilePath);
    }
  });

  it('GET /api/version returns version, build_id, and ISO timestamp', async () => {
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('build_id');
    expect(res.body).toHaveProperty('timestamp');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.build_id).toBe('string');
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  it('returns build_id from dist/build-id.txt when present', async () => {
    delete process.env.BUILD_ID;
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(buildFilePath, 'test-deploy-rev123-20261010', 'utf8');

    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.build_id).toBe('test-deploy-rev123-20261010');
    expect(getServerBuildId()).toBe('test-deploy-rev123-20261010');
  });

  it('prefers BUILD_ID environment variable over file when explicitly provided', async () => {
    process.env.BUILD_ID = 'override-env-build-456';
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(buildFilePath, 'file-build-123', 'utf8');

    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.build_id).toBe('override-env-build-456');
    expect(getServerBuildId()).toBe('override-env-build-456');
  });

  it('client CLIENT_BUILD_ID constant is valid and non-empty', () => {
    expect(typeof CLIENT_BUILD_ID).toBe('string');
    expect(CLIENT_BUILD_ID.length).toBeGreaterThan(0);
  });
});
