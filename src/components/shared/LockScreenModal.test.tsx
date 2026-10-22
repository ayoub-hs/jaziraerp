// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { LockScreenModal } from './LockScreenModal.js';
import { authService } from '../../services/authService.js';

describe('F14: LockScreenModal UI lockout feedback', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    });
    vi.stubGlobal('navigator', { onLine: false });
    mockStorage['aljazira_is_configured'] = 'true';
    mockStorage['aljazira_pin_hash'] = 'somehash';
  });

  it('displays lockout error and disables keypad when in attempt delay', () => {
    // Mock lockout active for 15 seconds
    vi.spyOn(authService, 'getLockoutRemainingSeconds').mockReturnValue(15);

    render(
      <LockScreenModal
        isLocked={true}
        onUnlocked={() => {}}
        shopName="Al Jazira Test"
      />
    );

    // Shows French warning
    expect(screen.getByText(/Trop de tentatives\. Veuillez patienter 15 secondes\./i)).toBeDefined();

    // Keypad digit buttons are disabled
    const digit1 = screen.getByRole('button', { name: '1' });
    expect(digit1.hasAttribute('disabled')).toBe(true);

    const digit0 = screen.getByRole('button', { name: '0' });
    expect(digit0.hasAttribute('disabled')).toBe(true);

    vi.restoreAllMocks();
  });

  it('allows entering PIN when not locked out', () => {
    vi.spyOn(authService, 'getLockoutRemainingSeconds').mockReturnValue(0);

    render(
      <LockScreenModal
        isLocked={true}
        onUnlocked={() => {}}
        shopName="Al Jazira Test"
      />
    );

    expect(screen.queryByText(/Trop de tentatives/i)).toBeNull();

    const digit1 = screen.getByRole('button', { name: '1' });
    expect(digit1.hasAttribute('disabled')).toBe(false);

    vi.restoreAllMocks();
  });
});
