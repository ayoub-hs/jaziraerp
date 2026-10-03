import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService, computeSha256 } from './authService.js';

describe('Step 15: Client Offline Auth & PIN Unlock Service', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });

    // Mock navigator.onLine as false to force offline verification path
    vi.stubGlobal('navigator', {
      onLine: false
    });
  });

  it('computes SHA-256 hash correctly', async () => {
    const hash1 = await computeSha256('1234');
    const hash2 = await computeSha256('1234');
    const hash3 = await computeSha256('5678');

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it('locks session and notifies subscriber callbacks', async () => {
    const auth = new AuthService();
    const listener = vi.fn();
    const unsub = auth.subscribeLockState(listener);

    expect(listener).toHaveBeenCalledWith(false);

    await auth.lock();
    expect(auth.isLocked()).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);

    unsub();
  });

  it('unlocks offline using cached PIN hash', async () => {
    const auth = new AuthService();
    const pin = '9876';
    const pinHash = await computeSha256(pin);
    mockStorage['aljazira_pin_hash'] = pinHash;
    mockStorage['aljazira_is_locked'] = 'true';

    await auth.lock();
    expect(auth.isLocked()).toBe(true);

    // Try wrong PIN
    const wrongSuccess = await auth.unlock('0000');
    expect(wrongSuccess).toBe(false);
    expect(auth.isLocked()).toBe(true);

    // Try correct PIN
    const correctSuccess = await auth.unlock('9876');
    expect(correctSuccess).toBe(true);
    expect(auth.isLocked()).toBe(false);
  });

  it('unlocks offline using master password fallback', async () => {
    const auth = new AuthService();
    const masterPassword = 'MyOfflineMasterPassword';
    const masterHash = await computeSha256(masterPassword);
    mockStorage['aljazira_master_hash'] = masterHash;

    await auth.lock();
    expect(auth.isLocked()).toBe(true);

    const success = await auth.unlock(masterPassword, true);
    expect(success).toBe(true);
    expect(auth.isLocked()).toBe(false);
  });

  it('online unlock caches client SHA-256 so subsequent offline unlock succeeds', async () => {
    const auth = new AuthService();
    const pin = '2468';
    const clientExpectedHash = await computeSha256(pin);

    // 1. Simulate ONLINE unlock with mock fetch
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        unlocked: true,
        locked: false,
        message: 'Unlocked successfully'
      })
    }));

    const onlineUnlocked = await auth.unlock(pin);
    expect(onlineUnlocked).toBe(true);

    // Verify localStorage now contains client-computed SHA-256
    expect(mockStorage['aljazira_pin_hash']).toBe(clientExpectedHash);

    // 2. Lock again and switch to OFFLINE mode
    await auth.lock();
    expect(auth.isLocked()).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });

    // 3. Unlock offline with the same PIN
    const offlineUnlocked = await auth.unlock(pin);
    expect(offlineUnlocked).toBe(true);
    expect(auth.isLocked()).toBe(false);
  });
});
