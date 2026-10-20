import { useRef } from 'react';
import { newRequestId } from '../services/idempotency.js';

/**
 * Keeps one idempotency key per payload signature while a request is being
 * retried. Changing the form/payload produces a new signature and therefore a
 * new key; retrying the same payload reuses the key.
 */
export function useRequestKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);

  const keyFor = (signature: string): string => {
    if (current.current?.signature === signature) {
      return current.current.key;
    }
    const key = newRequestId();
    current.current = { signature, key };
    return key;
  };

  const clear = () => {
    current.current = null;
  };

  return { keyFor, clear };
}
