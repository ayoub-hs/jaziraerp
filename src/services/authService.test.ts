import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService, computeSha256, computePbkdf2 } from './authService.js';

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

    // Verify localStorage now contains client-computed PBKDF2 with salt
    const pinSalt = mockStorage['aljazira_pin_salt'];
    expect(pinSalt).toBeDefined();
    const clientExpectedHash = await computePbkdf2(pin, pinSalt);
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

  it('tracks isConfigured correctly before and after setting credentials', async () => {
    const auth = new AuthService();
    expect(auth.isConfigured()).toBe(false);

    await auth.cacheCredentials('1234', 'masterSecret');
    expect(auth.isConfigured()).toBe(true);
  });

  describe('F14: Salted PBKDF2 & Attempt Delay (Lockout)', () => {
    it('caches PIN and master password with unique salt and PBKDF2', async () => {
      const auth = new AuthService();
      const pin = '4321';
      const master = 'MasterSecret99';

      await auth.cacheCredentials(pin, master);

      // Unique salt must be created and stored
      const pinSalt = mockStorage['aljazira_pin_salt'];
      const masterSalt = mockStorage['aljazira_master_salt'];
      expect(pinSalt).toBeDefined();
      expect(pinSalt).toHaveLength(32); // 16 bytes hex
      expect(masterSalt).toBeDefined();
      expect(masterSalt).toHaveLength(32);

      // Stored hash must be PBKDF2, NOT plain SHA-256
      const plainPinHash = await computeSha256(pin);
      const storedPinHash = mockStorage['aljazira_pin_hash'];
      expect(storedPinHash).toBeDefined();
      expect(storedPinHash).not.toBe(plainPinHash);

      // Unlock offline with PBKDF2 succeeds
      await auth.lock();
      expect(auth.isLocked()).toBe(true);
      const ok = await auth.unlock(pin);
      expect(ok).toBe(true);
      expect(auth.isLocked()).toBe(false);

      // Unlock with master password succeeds
      await auth.lock();
      const masterOk = await auth.unlock(master, true);
      expect(masterOk).toBe(true);
      expect(auth.isLocked()).toBe(false);
    });

    it('enforces attempt delay (lockout) after 3 and 5 failed offline attempts', async () => {
      const auth = new AuthService();
      await auth.cacheCredentials('1234');
      await auth.lock();

      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Attempt 1: wrong PIN
      const res1 = await auth.unlock('0001');
      expect(res1).toBe(false);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Attempt 2: wrong PIN
      const res2 = await auth.unlock('0002');
      expect(res2).toBe(false);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Attempt 3: wrong PIN -> triggers 5s lockout
      const res3 = await auth.unlock('0003');
      expect(res3).toBe(false);
      const remaining3 = auth.getLockoutRemainingSeconds();
      expect(remaining3).toBeGreaterThan(0);
      expect(remaining3).toBeLessThanOrEqual(5);

      // While locked out, even the correct PIN is rejected
      const lockedAttempt = await auth.unlock('1234');
      expect(lockedAttempt).toBe(false);

      // Advance time past 5s lockout
      const lockoutUntil3 = parseInt(mockStorage['aljazira_lockout_until'], 10);
      vi.spyOn(Date, 'now').mockReturnValue(lockoutUntil3 + 1000);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Attempt 4: wrong PIN -> also 5s lockout (attempts >= 3)
      const res4 = await auth.unlock('0004');
      expect(res4).toBe(false);
      const remaining4 = auth.getLockoutRemainingSeconds();
      expect(remaining4).toBeGreaterThan(0);
      expect(remaining4).toBeLessThanOrEqual(5);

      // Advance time past 2nd 5s lockout
      const lockoutUntil4 = parseInt(mockStorage['aljazira_lockout_until'], 10);
      vi.spyOn(Date, 'now').mockReturnValue(lockoutUntil4 + 1000);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Attempt 5: wrong PIN -> triggers 30s lockout (attempts >= 5)
      const res5 = await auth.unlock('0005');
      expect(res5).toBe(false);
      const remaining5 = auth.getLockoutRemainingSeconds();
      expect(remaining5).toBeGreaterThan(5);
      expect(remaining5).toBeLessThanOrEqual(30);

      // Advance time past 30s lockout
      const lockoutUntil5 = parseInt(mockStorage['aljazira_lockout_until'], 10);
      vi.spyOn(Date, 'now').mockReturnValue(lockoutUntil5 + 1000);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);

      // Correct PIN unlocks and resets failed attempts & lockout
      const success = await auth.unlock('1234');
      expect(success).toBe(true);
      expect(auth.isLocked()).toBe(false);
      expect(auth.getLockoutRemainingSeconds()).toBe(0);
      expect(mockStorage['aljazira_failed_attempts']).toBeUndefined();
      expect(mockStorage['aljazira_lockout_until']).toBeUndefined();

      vi.restoreAllMocks();
    });

    it('refuses cacheCredentials and unlock with clear French error when crypto.subtle is undefined without storing any hash', async () => {
      const originalSubtle = globalThis.crypto?.subtle;
      try {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: undefined,
          configurable: true
        });

        const auth = new AuthService();

        // 1. cacheCredentials must refuse and NOT store any hash
        await expect(auth.cacheCredentials('7890')).rejects.toThrow(
          'Déverrouillage hors ligne indisponible : contexte non sécurisé'
        );
        expect(mockStorage['aljazira_pin_hash']).toBeUndefined();
        expect(mockStorage['aljazira_pin_salt']).toBeUndefined();

        // 2. unlock offline must refuse and NOT unlock
        mockStorage['aljazira_pin_hash'] = 'somehash';
        await auth.lock();
        await expect(auth.unlock('7890')).rejects.toThrow(
          'Déverrouillage hors ligne indisponible : contexte non sécurisé'
        );
        expect(auth.isLocked()).toBe(true);
      } finally {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          configurable: true
        });
      }
    });

    it('refuses salt generation and PIN caching when crypto.getRandomValues is undefined', async () => {
      const originalGetRandomValues = globalThis.crypto?.getRandomValues;
      try {
        Object.defineProperty(globalThis.crypto, 'getRandomValues', {
          value: undefined,
          configurable: true
        });

        const auth = new AuthService();
        await expect(auth.cacheCredentials('1234')).rejects.toThrow(
          'Déverrouillage hors ligne indisponible : contexte non sécurisé'
        );
        expect(mockStorage['aljazira_pin_hash']).toBeUndefined();
        expect(mockStorage['aljazira_pin_salt']).toBeUndefined();
      } finally {
        Object.defineProperty(globalThis.crypto, 'getRandomValues', {
          value: originalGetRandomValues,
          configurable: true
        });
      }
    });

    it('upgrades legacy unsalted SHA-256 entries to PBKDF2 on first successful unlock', async () => {
      const auth = new AuthService();
      const pin = '3344';
      // Compute legacy unsalted SHA-256
      const legacyHash = await computeSha256(pin);
      mockStorage['aljazira_pin_hash'] = legacyHash;
      mockStorage['aljazira_pin_salt'] = undefined as any;
      delete mockStorage['aljazira_pin_salt'];
      await auth.lock();

      const success = await auth.unlock(pin);
      expect(success).toBe(true);
      expect(auth.isLocked()).toBe(false);

      // Verify upgraded to PBKDF2: salt exists and hash changed from legacy SHA-256
      const newSalt = mockStorage['aljazira_pin_salt'];
      expect(newSalt).toBeDefined();
      expect(newSalt).toHaveLength(32);
      const newHash = mockStorage['aljazira_pin_hash'];
      expect(newHash).toBeDefined();
      expect(newHash).not.toBe(legacyHash);
      expect(newHash).toBe(await computePbkdf2(pin, newSalt));

      // Subsequent unlock with PBKDF2 works
      await auth.lock();
      const secondUnlock = await auth.unlock(pin);
      expect(secondUnlock).toBe(true);
    });

    it('keeps legacy entry unchanged when online unlock succeeds but crypto.subtle is unavailable', async () => {
      const originalSubtle = globalThis.crypto?.subtle;
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const auth = new AuthService();
        const pin = '5566';
        mockStorage['aljazira_pin_hash'] = 'legacy-sha256-unupgraded';
        delete mockStorage['aljazira_pin_salt'];

        vi.stubGlobal('navigator', { onLine: true });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true, unlocked: true, shop_name: 'Test Shop' })
        }));

        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: undefined,
          configurable: true
        });

        const ok = await auth.unlock(pin);
        expect(ok).toBe(true);
        expect(auth.isLocked()).toBe(false);

        // Salt was NOT created, old entry remains unchanged
        expect(mockStorage['aljazira_pin_salt']).toBeUndefined();
        expect(mockStorage['aljazira_pin_hash']).toBe('legacy-sha256-unupgraded');
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Déverrouillage hors ligne indisponible')
        );
      } finally {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          configurable: true
        });
        warnSpy.mockRestore();
        vi.stubGlobal('navigator', { onLine: false });
      }
    });
  });
});
