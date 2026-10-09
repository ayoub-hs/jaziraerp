/**
 * Server endpoint resolution.
 *
 * Web (dev / PWA / tailscale): same-origin, relative `/api/...` just works.
 * Capacitor native: the UI is bundled and served from the native container
 * (origin `https://localhost`), so relative URLs resolve nowhere. The shop
 * server URL (e.g. `http://192.168.1.10:3000`) is stored on-device and
 * prepended instead.
 */
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'erp_server_url';
export const DEFAULT_SERVER_URL = 'https://jazicloud.fossa-wrasse.ts.net';

export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getServerUrl(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setServerUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/+$/, ''));
  } catch {
    // storage unavailable: caller falls back to direct entry each launch
  }
}

export function needsServerSetup(): boolean {
  return isNativeApp() && getServerUrl().length === 0;
}

/** Prefix a root-relative API path with the stored server URL when set. */
export function apiUrl(path: string): string {
  const base = getServerUrl();
  if (!base || !path.startsWith('/api')) return path;
  return base + path;
}

/**
 * Startup patch: rewrite root-relative `/api/...` fetches to the stored
 * server URL. No-op on web (no URL stored → relative, unchanged). Reads the
 * URL per call so saving it in the setup gate applies live.
 */
export function installApiUrlPatch(): void {
  if (typeof window === 'undefined' || !isNativeApp()) return;
  if ((window.fetch as any).__erpPatched) return;
  const origFetch = window.fetch.bind(window);
  const patched = ((input: any, init?: RequestInit) => {
    const base = getServerUrl();
    if (base) {
      if (typeof input === 'string' && input.startsWith('/api')) {
        input = base + input;
      } else if (input instanceof Request) {
        const url = input.url;
        // Only rewrite same-origin-relative API requests, never absolute ones.
        if (url.startsWith('/api') || (typeof window !== 'undefined' && url.startsWith(window.location.origin + '/api'))) {
          const path = url.startsWith('/api') ? url : url.slice(window.location.origin.length);
          input = new Request(base + path, input);
        }
      }
    }
    return origFetch(input, init);
  }) as typeof fetch;
  (patched as any).__erpPatched = true;
  window.fetch = patched;
}
