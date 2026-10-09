import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  updateRegisterSessionState,
  handleVisibilityChange,
  isSessionActiveState,
  isScreenKeptOnState,
} from './keepScreen.js';

describe('Step 3: Keep Screen Awake via Native FLAG_KEEP_SCREEN_ON', () => {
  const root = path.resolve(__dirname, '../..');
  let mockDoc: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockDoc = {
      hidden: false,
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('document', mockDoc);
    updateRegisterSessionState(false);
  });

  it('updates session active state and turns screen keep-on on and off', async () => {
    updateRegisterSessionState(true);
    expect(isSessionActiveState()).toBe(true);
    expect(isScreenKeptOnState()).toBe(true);

    updateRegisterSessionState(false);
    expect(isSessionActiveState()).toBe(false);
    expect(isScreenKeptOnState()).toBe(false);
  });

  it('releases screen when document is hidden (backgrounded) and restores on foreground if session active', () => {
    updateRegisterSessionState(true);
    expect(isScreenKeptOnState()).toBe(true);

    // App goes to background
    mockDoc.hidden = true;
    handleVisibilityChange();
    expect(isScreenKeptOnState()).toBe(false);

    // App returns to foreground
    mockDoc.hidden = false;
    handleVisibilityChange();
    expect(isScreenKeptOnState()).toBe(true);

    // Now close session, then background/foreground: should stay off
    updateRegisterSessionState(false);
    expect(isScreenKeptOnState()).toBe(false);

    mockDoc.hidden = false;
    handleVisibilityChange();
    expect(isScreenKeptOnState()).toBe(false);
  });

  it('ensures AndroidManifest.xml contains NO WAKE_LOCK permission', () => {
    const manifestPath = path.join(root, 'android/app/src/main/AndroidManifest.xml');
    const content = fs.readFileSync(manifestPath, 'utf8');
    expect(content).not.toContain('WAKE_LOCK');
  });

  it('ensures MainActivity registers KeepScreenPlugin and plugin uses FLAG_KEEP_SCREEN_ON', () => {
    const mainActivityPath = path.join(root, 'android/app/src/main/java/com/jazira/erp/MainActivity.java');
    const mainContent = fs.readFileSync(mainActivityPath, 'utf8');
    expect(mainContent).toContain('registerPlugin(KeepScreenPlugin.class)');

    const pluginPath = path.join(root, 'android/app/src/main/java/com/jazira/erp/KeepScreenPlugin.java');
    const pluginContent = fs.readFileSync(pluginPath, 'utf8');
    expect(pluginContent).toContain('FLAG_KEEP_SCREEN_ON');
    expect(pluginContent).toContain('addFlags');
    expect(pluginContent).toContain('clearFlags');
    expect(pluginContent).not.toContain('WakeLock');
  });
});
