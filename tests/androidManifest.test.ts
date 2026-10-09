import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Step 6: AndroidManifest.xml Configuration', () => {
  const manifestPath = path.resolve(__dirname, '../android/app/src/main/AndroidManifest.xml');
  const content = fs.readFileSync(manifestPath, 'utf8');

  it('configures windowSoftInputMode="stateAlwaysHidden|adjustResize" on MainActivity', () => {
    expect(content).toContain('android:windowSoftInputMode="stateAlwaysHidden|adjustResize"');
    expect(content).not.toContain('adjustPan');
  });

  it('does NOT declare WAKE_LOCK permission', () => {
    expect(content).not.toContain('WAKE_LOCK');
  });

  it('leaves hardwareAccelerated at default', () => {
    expect(content).not.toContain('android:hardwareAccelerated');
  });
});
