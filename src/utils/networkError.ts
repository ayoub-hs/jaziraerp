/**
 * Determines whether an error represents an offline state or fetch network failure,
 * as opposed to an internal JavaScript runtime / code bug (e.g. unhandled TypeError).
 */
export function isFetchNetworkError(err: any): boolean {
  if (!err) return false;
  if (err.message === 'OFFLINE_FALLBACK') return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;

  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('offline')
  );
}
