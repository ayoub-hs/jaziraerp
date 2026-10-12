// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { compareVersions, evaluateUpdate, isDismissed, markDismissed } from './updateCheck.js';

const client = { version: '1.0.0', buildId: 'abc-1' };

describe('updateCheck', () => {
  beforeEach(() => localStorage.clear());

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });
  it('native: equal version with different build id shows nothing', () => {
    expect(evaluateUpdate({ version: '1.0.0', build_id: 'zzz' }, client, true)).toBeNull();
  });
  it('native: newer server version shows app update', () => {
    const r = evaluateUpdate({ version: '1.1.0', build_id: 'zzz' }, client, true);
    expect(r?.kind).toBe('app');
  });
  it('web: build id mismatch shows web update', () => {
    const r = evaluateUpdate({ version: '1.0.0', build_id: 'zzz' }, client, false);
    expect(r?.kind).toBe('web');
  });
  it('web: same build id shows nothing', () => {
    expect(evaluateUpdate({ version: '1.0.0', build_id: 'abc-1' }, client, false)).toBeNull();
  });
  it('dismissal persists per build id and a new build re-shows', () => {
    markDismissed('zzz');
    expect(isDismissed('zzz')).toBe(true);
    expect(isDismissed('new-build')).toBe(false);
  });
});
