// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeliveryZonesSettings } from './DeliveryZonesSettings';
import type { DeliveryZone } from '../../types';

describe('DeliveryZonesSettings (Phase 1a Step 5b)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockZones: DeliveryZone[] = [
    {
      id: 'zone-1',
      name: 'Zone Midoun',
      fee: 5.0,
      min_order_amount: 20.0,
      active: 1,
      created_at: '2026-10-22T10:00:00.000Z',
      updated_at: '2026-10-22T10:00:00.000Z'
    },
    {
      id: 'zone-2',
      name: 'Zone Ajim',
      fee: 8.0,
      min_order_amount: 30.0,
      active: 0,
      created_at: '2026-10-22T11:00:00.000Z',
      updated_at: '2026-10-22T11:00:00.000Z'
    }
  ];

  it('lists delivery zones fetched from GET /api/delivery-zones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockZones
    } as any);

    render(<DeliveryZonesSettings />);

    await waitFor(() => {
      expect(screen.getByText('Zone Midoun')).toBeDefined();
    });

    expect(screen.getByText('Zone Ajim')).toBeDefined();
    expect(screen.getByText(/5,000 DT|5.000 DT/)).toBeDefined();
    expect(screen.getByText(/20,000 DT|20.000 DT/)).toBeDefined();
    expect(screen.getByText('Actif')).toBeDefined();
    expect(screen.getByText('Inactif')).toBeDefined();
  });

  it('adds a new delivery zone via POST /api/delivery-zones', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // initial load
      .mockResolvedValueOnce({
        ok: true,
        json: async () => []
      } as any)
      // POST response
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'zone-new',
          name: 'Zone Houmt Souk',
          fee: 4.0,
          min_order_amount: 15.0,
          active: 1,
          created_at: '2026-10-23T12:00:00.000Z',
          updated_at: '2026-10-23T12:00:00.000Z'
        })
      } as any)
      // reload after save
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 'zone-new',
            name: 'Zone Houmt Souk',
            fee: 4.0,
            min_order_amount: 15.0,
            active: 1,
            created_at: '2026-10-23T12:00:00.000Z',
            updated_at: '2026-10-23T12:00:00.000Z'
          }
        ]
      } as any);

    render(<DeliveryZonesSettings />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /ajouter une zone/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /ajouter une zone/i }));

    fireEvent.change(screen.getByLabelText(/nom de la zone/i), { target: { value: 'Zone Houmt Souk' } });
    fireEvent.change(screen.getByLabelText(/frais de livraison/i), { target: { value: '4.000' } });
    fireEvent.change(screen.getByLabelText(/montant minimum/i), { target: { value: '15.000' } });

    fireEvent.click(screen.getByRole('button', { name: /enregistrer/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/delivery-zones', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Zone Houmt Souk',
          fee: 4,
          min_order_amount: 15,
          active: 1
        })
      }));
    });
  });

  it('deactivates an active zone via PUT /api/delivery-zones/:id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockZones[0]]
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockZones[0], active: 0 })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ ...mockZones[0], active: 0 }]
      } as any);

    render(<DeliveryZonesSettings />);

    await waitFor(() => {
      expect(screen.getByText('Zone Midoun')).toBeDefined();
    });

    const toggleBtn = screen.getByRole('button', { name: /désactiver/i });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/delivery-zones/zone-1', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ active: 0 })
      }));
    });
  });

  it('shows French error message when delete is blocked by server (409)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [mockZones[0]]
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Impossible de supprimer cette zone de livraison car elle est associée à une ou plusieurs commandes.'
        })
      } as any);

    render(<DeliveryZonesSettings />);

    await waitFor(() => {
      expect(screen.getByText('Zone Midoun')).toBeDefined();
    });

    const deleteBtn = screen.getByRole('button', { name: /supprimer/i });
    fireEvent.click(deleteBtn);

    // Confirm dialog or direct delete
    const confirmBtn = screen.queryByRole('button', { name: /confirmer la suppression/i });
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    await waitFor(() => {
      expect(screen.getByText(/Impossible de supprimer cette zone de livraison car elle est associée à une ou plusieurs commandes/i)).toBeDefined();
    });
  });
});
