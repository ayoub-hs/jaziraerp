// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRequestKey } from './useRequestKey.js';

describe('useRequestKey', () => {
  it('reuses a key for the same payload signature and rotates it when the payload changes', () => {
    const { result } = renderHook(() => useRequestKey());

    const first = result.current.keyFor('amount=10');
    const same = result.current.keyFor('amount=10');
    const changed = result.current.keyFor('amount=11');

    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });

  it('rotates the key after the pending request is cleared', () => {
    const { result } = renderHook(() => useRequestKey());
    const first = result.current.keyFor('amount=10');
    result.current.clear();
    const afterClear = result.current.keyFor('amount=10');
    expect(afterClear).not.toBe(first);
  });
});
