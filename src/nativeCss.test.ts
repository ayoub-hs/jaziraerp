import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Step 2: Native-Only CSS & Viewport Hardening', () => {
  const root = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const mainTsx = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');

  it('verifies index.html has viewport-fit=cover and no global select-none', () => {
    expect(indexHtml).toContain('viewport-fit=cover');
    expect(indexHtml).not.toContain('select-none');
  });

  it('verifies main.tsx adds native-app class conditionally on Capacitor native platform', () => {
    expect(mainTsx).toContain("Capacitor.isNativePlatform()");
    expect(mainTsx).toContain("classList.add('native-app')");
  });

  it('scopes touch-action and user-select strictly under html.native-app', () => {
    expect(indexCss).toContain('html.native-app {');
    expect(indexCss).toContain('touch-action: manipulation;');
    expect(indexCss).toContain('overscroll-behavior-y: none;');
    expect(indexCss).toContain('safe-area-inset-top');

    // Button and cart row user-select: none
    expect(indexCss).toContain('html.native-app button');
    expect(indexCss).toContain('html.native-app .cart-row');

    // Inputs remain selectable and editable
    expect(indexCss).toContain('html.native-app input');
    expect(indexCss).toContain('user-select: text !important;');
  });
});
