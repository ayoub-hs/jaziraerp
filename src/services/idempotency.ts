/**
 * Client-generated idempotency keys for financial write requests.
 * The same key is reused for a retry of the same payload, including the
 * online→offline fallback path.
 */
export function newRequestId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for a very old WebView; still unique enough for this single-user app.
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
