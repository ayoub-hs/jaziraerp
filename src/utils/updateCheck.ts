/** Pure helpers for the server/app update banner. */

export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export interface UpdateInfo {
  kind: 'app' | 'web';
  label: string;
  buildId: string;
}

/**
 * Native APK: assets are bundled, so only a higher server version matters
 * (user must reinstall the APK). Web/PWA: any build_id mismatch matters.
 */
export function evaluateUpdate(
  server: { version?: string; build_id?: string },
  client: { version: string; buildId: string },
  isNative: boolean
): UpdateInfo | null {
  const buildId = server.build_id || '';
  if (isNative) {
    if (server.version && compareVersions(server.version, client.version) > 0) {
      return { kind: 'app', label: server.version, buildId: buildId || server.version };
    }
    return null;
  }
  if (buildId && buildId !== client.buildId) {
    return { kind: 'web', label: server.version || buildId, buildId };
  }
  return null;
}

const KEY_PREFIX = 'update-dismissed:';

export function isDismissed(buildId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + buildId) === '1';
  } catch {
    return false;
  }
}

export function markDismissed(buildId: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + buildId, '1');
  } catch {
    /* storage unavailable */
  }
}
