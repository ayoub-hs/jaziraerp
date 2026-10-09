import { describe, it, expect } from 'vitest';
import { app, request } from '../../tests/testApp.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Capacitor CORS and Scheme Hardening', () => {
  it('allows requests with Origin: https://localhost', async () => {
    const res = await request(app)
      .get('/api/auth/status')
      .set('Origin', 'https://localhost');

    expect(res.headers['access-control-allow-origin']).toBe('https://localhost');
  });

  it('rejects CORS for disallowed external origins', async () => {
    const res = await request(app)
      .get('/api/auth/status')
      .set('Origin', 'https://malicious-origin.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('verifies capacitor.config.ts enforces https androidScheme and avoids cleartext', () => {
    const configPath = path.resolve(__dirname, '../../capacitor.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');

    expect(content).toContain("androidScheme: 'https'");
    expect(content).not.toContain('cleartext');
    expect(content).not.toContain('allowMixedContent');
  });
});
