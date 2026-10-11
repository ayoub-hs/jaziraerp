// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShopSettingsPanel } from './ShopSettingsPanel';
import { authService } from '../../services/authService';

describe('ShopSettingsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/settings/shop')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            shop_name: 'Société Al Jazira SHSP',
            shop_subtitle: 'Détergents & Hygiène',
            shop_address: 'El May, Djerba',
            shop_phone: '+216 75 000 000',
            tax_id: '1234567/A/M/000',
            default_retail_markup_percent: '30',
            default_wholesale_markup_percent: '20'
          })
        });
      }
      if (url.includes('/api/auth/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            configured: false,
            locked: false,
            shop_name: 'Société Al Jazira SHSP'
          })
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('renders shop settings form and loads values from API', async () => {
    render(<ShopSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Société Al Jazira SHSP')).toBeTruthy();
      expect(screen.getByDisplayValue('Détergents & Hygiène')).toBeTruthy();
      expect(screen.getByDisplayValue('El May, Djerba')).toBeTruthy();
    });
  });

  it('renders the Sécurité section with unconfigured state and triggers modal on click', async () => {
    vi.spyOn(authService, 'isConfigured').mockReturnValue(false);
    vi.spyOn(authService, 'syncStatus').mockResolvedValue({
      configured: false,
      locked: false,
      shop_name: 'Société Al Jazira SHSP'
    });

    render(<ShopSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Sécurité non configurée')).toBeTruthy();
      expect(screen.getByText('Configurer le code PIN')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Configurer le code PIN'));

    await waitFor(() => {
      expect(screen.getByText(/Configuration de Sécurité/i)).toBeTruthy();
    });
  });

  it('renders the Sécurité section with configured state when auth is configured', async () => {
    vi.spyOn(authService, 'isConfigured').mockReturnValue(true);
    vi.spyOn(authService, 'syncStatus').mockResolvedValue({
      configured: true,
      locked: false,
      shop_name: 'Société Al Jazira SHSP'
    });

    render(<ShopSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('Sécurité configurée')).toBeTruthy();
      expect(screen.getByText('Modifier le code PIN / MDP')).toBeTruthy();
    });
  });
});
