import { describe, it, expect, vi } from 'vitest';
import { isFetchNetworkError } from './networkError.js';

describe('isFetchNetworkError', () => {
  it('returns true on explicit OFFLINE_FALLBACK error', () => {
    expect(isFetchNetworkError(new Error('OFFLINE_FALLBACK'))).toBe(true);
  });

  it('returns true when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isFetchNetworkError(new Error('some random error'))).toBe(true);
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('returns true on standard browser fetch network errors', () => {
    expect(isFetchNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isFetchNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isFetchNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isFetchNetworkError(new TypeError('Load failed'))).toBe(true);
    expect(isFetchNetworkError(new Error('Network error'))).toBe(true);
  });

  it('returns false on code bugs like unhandled TypeErrors or ReferenceErrors', () => {
    expect(isFetchNetworkError(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
    expect(isFetchNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(isFetchNetworkError(new ReferenceError("bar is not defined"))).toBe(false);
    expect(isFetchNetworkError(null)).toBe(false);
    expect(isFetchNetworkError(undefined)).toBe(false);
  });
});
