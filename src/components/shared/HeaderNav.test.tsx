// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Header } from './Header.js';

function renderHeader(currentView: 'DESKTOP_POS' | 'MOBILE_REGISTER' | 'BACKOFFICE', onSelectView = vi.fn()) {
  const noop = vi.fn();
  render(
    <Header
      {...({
        currentView,
        onSelectView,
        activeSession: null,
        openSessions: [],
        syncState: 'ONLINE_SYNCED',
        pendingSyncCount: 0,
        onManualSync: noop,
        onOpenSessionModal: noop,
        onCloseSessionModal: noop,
        onOpenCashMovement: noop,
        onLockSession: noop,
        onSelectSession: noop
      } as any)}
    />
  );
  return onSelectView;
}

describe('Header phone navigation', () => {
  it('shows a "Retour à la caisse" button in BACKOFFICE that returns to the register', () => {
    const onSelect = renderHeader('BACKOFFICE');
    fireEvent.click(screen.getByLabelText('Retour à la caisse'));
    expect(onSelect).toHaveBeenCalledWith('MOBILE_REGISTER');
  });
  it('does not show the back button outside BACKOFFICE', () => {
    renderHeader('MOBILE_REGISTER');
    expect(screen.queryByLabelText('Retour à la caisse')).toBeNull();
  });
  it('menu has an "Aller à" section with Caisse / Comptoir / Backoffice', () => {
    const onSelect = renderHeader('BACKOFFICE');
    fireEvent.click(screen.getByLabelText('Menu'));
    expect(screen.getByText('Aller à')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Caisse').find(el => el.closest('button')?.className.includes('min-h-[44px] rounded-xl hover'))!);
    expect(onSelect).toHaveBeenCalledWith('MOBILE_REGISTER');
  });
});
