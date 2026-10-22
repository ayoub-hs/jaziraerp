/**
 * Client-Side Authentication & Offline PIN Unlock Service
 * Supports online verification with backend and offline fallback via Web Crypto SHA-256 hash caching.
 */

export async function computeSha256(text: string): Promise<string> {
  const clean = text.trim();
  const subtle = (typeof window !== 'undefined' ? window.crypto?.subtle : undefined) ||
                 (typeof globalThis !== 'undefined' ? (globalThis as any).crypto?.subtle : undefined);

  if (subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(clean);
    const hashBuffer = await subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for environments where subtle is not accessible
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

export function generateSalt(): string {
  const cryptoObj = (typeof window !== 'undefined' ? window.crypto : undefined) ||
                    (typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined);
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback
  let salt = '';
  for (let i = 0; i < 32; i++) {
    salt += Math.floor(Math.random() * 16).toString(16);
  }
  return salt;
}

export async function computePbkdf2(
  text: string,
  saltHex: string,
  iterations = 100000
): Promise<string> {
  const clean = text.trim();
  const subtle = (typeof window !== 'undefined' ? window.crypto?.subtle : undefined) ||
                 (typeof globalThis !== 'undefined' ? (globalThis as any).crypto?.subtle : undefined);

  if (subtle) {
    const encoder = new TextEncoder();
    const keyMaterial = await subtle.importKey(
      'raw',
      encoder.encode(clean),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const saltBytes = new Uint8Array(
      saltHex.match(/.{1,2}/g)?.map(b => parseInt(b, 16)) || []
    );

    const derivedBits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for non-secure contexts (e.g. plain HTTP tailnet IP without crypto.subtle)
  let hash = 0;
  const combined = `${clean}:${saltHex}`;
  for (let round = 0; round < 1000; round++) {
    for (let i = 0; i < combined.length; i++) {
      hash = (hash << 5) - hash + combined.charCodeAt(i) + round;
      hash |= 0;
    }
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

const STORAGE_KEYS = {
  PIN_HASH: 'aljazira_pin_hash',
  MASTER_HASH: 'aljazira_master_hash',
  PIN_SALT: 'aljazira_pin_salt',
  MASTER_SALT: 'aljazira_master_salt',
  FAILED_ATTEMPTS: 'aljazira_failed_attempts',
  LOCKOUT_UNTIL: 'aljazira_lockout_until',
  IS_LOCKED: 'aljazira_is_locked',
  IS_CONFIGURED: 'aljazira_is_configured',
  SHOP_NAME: 'aljazira_shop_name'
};

export class AuthService {
  private locked: boolean = false;
  private listeners: Array<(locked: boolean) => void> = [];

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEYS.IS_LOCKED);
      this.locked = stored === 'true';
    }
  }

  public isLocked(): boolean {
    return this.locked;
  }

  public isConfigured(): boolean {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.IS_CONFIGURED) === 'true' || Boolean(localStorage.getItem(STORAGE_KEYS.PIN_HASH));
    }
    return false;
  }

  public getShopName(): string {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(STORAGE_KEYS.SHOP_NAME) || 'Société Al Jazira SHSP';
    }
    return 'Société Al Jazira SHSP';
  }

  public setShopName(name: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.SHOP_NAME, name);
    }
  }

  public getLockoutRemainingSeconds(): number {
    if (typeof localStorage === 'undefined') return 0;
    const untilStr = localStorage.getItem(STORAGE_KEYS.LOCKOUT_UNTIL);
    if (!untilStr) return 0;
    const until = parseInt(untilStr, 10);
    const now = Date.now();
    if (isNaN(until) || now >= until) {
      return 0;
    }
    return Math.max(1, Math.ceil((until - now) / 1000));
  }

  public getFailedAttempts(): number {
    if (typeof localStorage === 'undefined') return 0;
    return parseInt(localStorage.getItem(STORAGE_KEYS.FAILED_ATTEMPTS) || '0', 10) || 0;
  }

  public recordFailedAttempt(): number {
    if (typeof localStorage === 'undefined') return 0;
    const current = (parseInt(localStorage.getItem(STORAGE_KEYS.FAILED_ATTEMPTS) || '0', 10) || 0) + 1;
    localStorage.setItem(STORAGE_KEYS.FAILED_ATTEMPTS, String(current));

    let lockoutSec = 0;
    if (current >= 5) {
      lockoutSec = 30;
    } else if (current >= 3) {
      lockoutSec = 5;
    }

    if (lockoutSec > 0) {
      const until = Date.now() + lockoutSec * 1000;
      localStorage.setItem(STORAGE_KEYS.LOCKOUT_UNTIL, String(until));
    }
    return lockoutSec;
  }

  public recordSuccessfulAttempt(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(STORAGE_KEYS.FAILED_ATTEMPTS);
    localStorage.removeItem(STORAGE_KEYS.LOCKOUT_UNTIL);
  }

  public subscribeLockState(fn: (locked: boolean) => void): () => void {
    this.listeners.push(fn);
    fn(this.locked);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private setLockedState(locked: boolean): void {
    this.locked = locked;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.IS_LOCKED, locked ? 'true' : 'false');
    }
    for (const listener of this.listeners) {
      try {
        listener(locked);
      } catch (err) {
        console.warn('[AuthService] Listener error:', err);
      }
    }
  }

  /**
   * Caches credential hashes locally in browser storage for offline access using salted PBKDF2.
   */
  public async cacheCredentials(pin: string, masterPassword?: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    localStorage.setItem(STORAGE_KEYS.IS_CONFIGURED, 'true');
    if (pin) {
      const pinSalt = localStorage.getItem(STORAGE_KEYS.PIN_SALT) || generateSalt();
      localStorage.setItem(STORAGE_KEYS.PIN_SALT, pinSalt);
      const pinHash = await computePbkdf2(pin, pinSalt);
      localStorage.setItem(STORAGE_KEYS.PIN_HASH, pinHash);
    }
    if (masterPassword) {
      const masterSalt = localStorage.getItem(STORAGE_KEYS.MASTER_SALT) || generateSalt();
      localStorage.setItem(STORAGE_KEYS.MASTER_SALT, masterSalt);
      const masterHash = await computePbkdf2(masterPassword, masterSalt);
      localStorage.setItem(STORAGE_KEYS.MASTER_HASH, masterHash);
    }
  }

  /**
   * Syncs lock and configuration status from server.
   */
  public async syncStatus(): Promise<{ configured: boolean; locked: boolean; shop_name?: string }> {
    try {
      const res = await fetch('/api/auth/status');
      if (res.ok) {
        const data = await res.json();
        if (data.locked && !this.locked) {
          this.setLockedState(true);
        }
        if (typeof localStorage !== 'undefined') {
          if (data.configured) {
            localStorage.setItem(STORAGE_KEYS.IS_CONFIGURED, 'true');
          } else {
            localStorage.removeItem(STORAGE_KEYS.IS_CONFIGURED);
          }
          if (data.shop_name) {
            localStorage.setItem(STORAGE_KEYS.SHOP_NAME, data.shop_name);
          }
        }
        return data;
      }
    } catch {
      // Offline fallback
    }

    return {
      configured: this.isConfigured(),
      locked: this.locked,
      shop_name: typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.SHOP_NAME) || undefined : undefined
    };
  }

  /**
   * Unlocks session using 4-digit PIN or master password.
   * Works online via /api/auth/unlock and offline via cached salted PBKDF2 hash with attempt delay.
   */
  public async unlock(secret: string, isMasterPassword = false): Promise<boolean> {
    const clean = secret.trim();
    if (!clean) return false;

    // Reject immediately if in attempt delay lockout
    if (this.getLockoutRemainingSeconds() > 0) {
      return false;
    }

    // 1. Try online verification if network is available
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const payload = isMasterPassword ? { password: clean } : { pin: clean };
        const res = await fetch('/api/auth/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          // Cache salted PBKDF2 locally so offline unlock works
          if (typeof localStorage !== 'undefined') {
            if (isMasterPassword) {
              const masterSalt = localStorage.getItem(STORAGE_KEYS.MASTER_SALT) || generateSalt();
              localStorage.setItem(STORAGE_KEYS.MASTER_SALT, masterSalt);
              const masterHash = await computePbkdf2(clean, masterSalt);
              localStorage.setItem(STORAGE_KEYS.MASTER_HASH, masterHash);
            } else {
              const pinSalt = localStorage.getItem(STORAGE_KEYS.PIN_SALT) || generateSalt();
              localStorage.setItem(STORAGE_KEYS.PIN_SALT, pinSalt);
              const pinHash = await computePbkdf2(clean, pinSalt);
              localStorage.setItem(STORAGE_KEYS.PIN_HASH, pinHash);
            }
            if (data.shop_name) {
              localStorage.setItem(STORAGE_KEYS.SHOP_NAME, data.shop_name);
            }
          }
          this.recordSuccessfulAttempt();
          this.setLockedState(false);
          return true;
        } else if (res.status === 401 || res.status === 429) {
          if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            const retrySec = Number(data.retry_after_seconds) || 30;
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem(STORAGE_KEYS.LOCKOUT_UNTIL, String(Date.now() + retrySec * 1000));
            }
          } else {
            this.recordFailedAttempt();
          }
          return false;
        }
      } catch (err) {
        console.warn('[AuthService] Online unlock failed, trying offline validation:', err);
      }
    }

    // 2. Offline fallback using cached salted PBKDF2 hash (or legacy unsalted SHA-256 fallback)
    const saltKey = isMasterPassword ? STORAGE_KEYS.MASTER_SALT : STORAGE_KEYS.PIN_SALT;
    const hashKey = isMasterPassword ? STORAGE_KEYS.MASTER_HASH : STORAGE_KEYS.PIN_HASH;

    let cachedSalt: string | null = null;
    let cachedHash: string | null = null;

    if (typeof localStorage !== 'undefined') {
      cachedSalt = localStorage.getItem(saltKey);
      cachedHash = localStorage.getItem(hashKey);
    }

    // If no credential hash is cached yet, offline unlock cannot proceed without prior setup
    if (!cachedHash) {
      return false;
    }

    let isValid = false;
    if (cachedSalt) {
      const inputHash = await computePbkdf2(clean, cachedSalt);
      isValid = (inputHash === cachedHash);
    } else {
      // Legacy unsalted SHA-256 fallback
      const inputHash = await computeSha256(clean);
      isValid = (inputHash === cachedHash);
      if (isValid && typeof localStorage !== 'undefined') {
        const newSalt = generateSalt();
        const newHash = await computePbkdf2(clean, newSalt);
        localStorage.setItem(saltKey, newSalt);
        localStorage.setItem(hashKey, newHash);
      }
    }

    if (isValid) {
      this.recordSuccessfulAttempt();
      this.setLockedState(false);
      return true;
    }

    this.recordFailedAttempt();
    return false;
  }

  /**
   * Locks the session immediately.
   */
  public async lock(): Promise<void> {
    this.setLockedState(true);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        await fetch('/api/auth/lock', { method: 'POST' });
      } catch {
        // Handled locally
      }
    }
  }
}

export const authService = new AuthService();
