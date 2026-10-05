import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');

describe('PWA offline shell (static contract)', () => {
  it('ships a manifest with standalone display and real icon files', () => {
    const manifestPath = path.join(root, 'public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.display).toBe('standalone');
    expect(typeof manifest.name).toBe('string');
    expect(manifest.name.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(fs.existsSync(path.join(root, 'public', icon.src))).toBe(true);
    }
  });

  it('references the manifest from index.html', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    expect(html).toContain('manifest.webmanifest');
  });

  it('service worker never touches /api/* or non-GET requests', () => {
    const sw = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf-8');
    expect(sw).toContain('/api');
    expect(sw).toMatch(/method !== 'GET'/);
    // No automatic skipWaiting: only allowed inside the user-triggered message handler.
    const skipCalls = sw.match(/skipWaiting\(\)/g) || [];
    expect(skipCalls.length).toBe(1);
    expect(sw).toContain("type === 'SKIP_WAITING'");
  });

  it('serves sw.js and index.html with no-cache headers', () => {
    const index = fs.readFileSync(path.join(root, 'server/index.ts'), 'utf-8');
    expect(index).toContain("'sw.js'");
    expect(index).toContain('no-cache');
  });
});
