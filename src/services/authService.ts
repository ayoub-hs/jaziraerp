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

const STORAGE_KEYS = {
  PIN_HASH: 'aljazira_pin_hash',
  MASTER_HASH: 'aljazira_master_hash',
  IS_LOCKED: 'aljazira_is_locked',
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
   * Caches credential hashes locally in browser storage for offline access.
   */
  public async cacheCredentials(pin: string, masterPassword?: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;

    if (pin) {
      const pinHash = await computeSha256(pin);
      localStorage.setItem(STORAGE_KEYS.PIN_HASH, pinHash);
    }
    if (masterPassword) {
      const masterHash = await computeSha256(masterPassword);
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
        if (data.shop_name && typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.SHOP_NAME, data.shop_name);
        }
        return data;
      }
    } catch {
      // Offline fallback
    }

    return {
      configured: true,
      locked: this.locked,
      shop_name: typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.SHOP_NAME) || undefined : undefined
    };
  }

  /**
   * Unlocks session using 4-digit PIN or master password.
   * Works online via /api/auth/unlock and offline via cached Web Crypto hash.
   */
  public async unlock(secret: string, isMasterPassword = false): Promise<boolean> {
    const clean = secret.trim();
    if (!clean) return false;

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
          // Cache client-computed SHA-256 locally so offline unlock works
          if (typeof localStorage !== 'undefined') {
            if (isMasterPassword) {
              const masterHash = await computeSha256(clean);
              localStorage.setItem(STORAGE_KEYS.MASTER_HASH, masterHash);
            } else {
              const pinHash = await computeSha256(clean);
              localStorage.setItem(STORAGE_KEYS.PIN_HASH, pinHash);
            }
            if (data.shop_name) {
              localStorage.setItem(STORAGE_KEYS.SHOP_NAME, data.shop_name);
            }
          }
          this.setLockedState(false);
          return true;
        } else if (res.status === 401) {
          return false;
        }
      } catch (err) {
        console.warn('[AuthService] Online unlock failed, trying offline validation:', err);
      }
    }

    // 2. Offline fallback using cached hash
    const inputHash = await computeSha256(clean);
    let cachedHash: string | null = null;

    if (typeof localStorage !== 'undefined') {
      cachedHash = localStorage.getItem(
        isMasterPassword ? STORAGE_KEYS.MASTER_HASH : STORAGE_KEYS.PIN_HASH
      );
    }

    // If no credential hash is cached yet, offline unlock cannot proceed without prior setup
    if (!cachedHash) {
      return false;
    }

    if (inputHash === cachedHash) {
      this.setLockedState(false);
      return true;
    }

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
