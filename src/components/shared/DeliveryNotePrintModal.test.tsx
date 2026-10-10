// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DeliveryNotePrintModal } from './DeliveryNotePrintModal.js';

describe('DeliveryNotePrintModal (Batch 2 Item B3)', () => {
  const fakeSale = {
    id: 'sale-test-bl',
    receipt_number: 'REC-20261010-0001',
    date: '2026-10-10T10:00:00.000Z',
    customer_id: 'cust-1',
    customer_name: 'Ste Sfax Distribution',
    customer_address: 'Route de Tunis Km 5',
    customer_phone: '74123456',
    subtotal_ht: 84.034,
    tva_rate: 0.19,
    tva_amount: 15.966,
    total_ttc: 100.000,
    total_discount: 0,
    cash_paid: 100.000,
    wallet_paid: 0,
    credit_amount: 0,
    status: 'COMPLETED',
    items: [
      {
        id: 'item-1',
        description: 'Javel 5L',
        quantity: 10,
        unit_price: 10.000,
        pack_multiplier: 1,
        total_line: 100.000
      }
    ],
    delivery_note: {
      id: 'bl-123',
      sale_id: 'sale-test-bl',
      number: 'BL-20261010-0042',
      created_at: '2026-10-10T10:00:00.000Z'
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders BL header, client information, BL reference, and signature blocks', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/api/sales/sale-test-bl')) {
        return {
          ok: true,
          json: async () => fakeSale
        } as Response;
      }
      return { ok: false } as Response;
    });

    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-test-bl"
      />
    );

    // Wait for content to load
    await waitFor(() => {
      expect(screen.getByText('BON DE LIVRAISON')).toBeTruthy();
    });

    expect(screen.getByText('BL-20261010-0042')).toBeTruthy();
    expect(screen.getByText('Ste Sfax Distribution')).toBeTruthy();
    expect(screen.getByText('Javel 5L')).toBeTruthy();

    // Check dual signature blocks
    expect(screen.getByText(/Signature et cachet du transporteur \/ livreur/i)).toBeTruthy();
    expect(screen.getByText(/Signature et cachet du client \/ réceptionnaire/i)).toBeTruthy();
  });

  it('toggles between price mode and quantity-only mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      return {
        ok: true,
        json: async () => fakeSale
      } as Response;
    });

    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-test-bl"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('BON DE LIVRAISON')).toBeTruthy();
    });

    // Initially "Avec prix (TTC)"
    expect(screen.getByText(/Avec prix \(TTC\)/i)).toBeTruthy();
    expect(screen.getByText('TOTAL TTC:')).toBeTruthy();
    expect(screen.getAllByText('100.000 DT').length).toBeGreaterThan(0);

    // Click toggle button to switch to "Sans prix"
    const toggleBtn = screen.getByTitle(/Basculer l'affichage des prix/i);
    fireEvent.click(toggleBtn);

    // Now in "Sans prix (Quantités seules)"
    expect(screen.getByText(/Sans prix \(Quantités seules\)/i)).toBeTruthy();
    expect(screen.queryByText('TOTAL TTC:')).toBeNull();
    expect(screen.queryAllByText('100.000 DT').length).toBe(0);
    // But quantity and item are still visible
    expect(screen.getByText('Javel 5L')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('triggers window.print when print button is clicked', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: true,
        json: async () => fakeSale
      } as Response;
    });

    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-test-bl"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('BON DE LIVRAISON')).toBeTruthy();
    });

    const printBtn = screen.getByRole('button', { name: /Imprimer Bon de Livraison/i });
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches or creates delivery note via POST /api/sales/:id/delivery-note if missing from sale', async () => {
    const saleWithoutBL = {
      ...fakeSale,
      delivery_note: null
    };

    const postSpy = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/sales/sale-test-bl')) {
        return {
          ok: true,
          json: async () => saleWithoutBL
        } as Response;
      }
      if (urlStr.endsWith('/delivery-note') && init?.method === 'POST') {
        postSpy();
        return {
          ok: true,
          json: async () => ({
            id: 'bl-new-1',
            sale_id: 'sale-test-bl',
            number: 'BL-20261010-0099',
            created_at: '2026-10-10T12:00:00.000Z'
          })
        } as Response;
      }
      return { ok: false } as Response;
    });

    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-test-bl"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('BL-20261010-0099')).toBeTruthy();
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('En cours...')).toBeNull();
  });

  it('when POST returns 500 or request rejects, shows no BL number, disables print, and shows server number after retry', async () => {
    const saleWithoutBL = {
      ...fakeSale,
      delivery_note: null
    };

    let postAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/api/sales/sale-test-bl')) {
        return {
          ok: true,
          json: async () => saleWithoutBL
        } as Response;
      }
      if (urlStr.endsWith('/delivery-note')) {
        postAttempts++;
        if (postAttempts === 1) {
          return { ok: false, status: 500 } as Response;
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'bl-recovered-1',
            sale_id: 'sale-test-bl',
            number: 'BL-20261010-0077',
            created_at: '2026-10-10T12:00:00.000Z'
          })
        } as Response;
      }
      return { ok: false } as Response;
    });

    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-test-bl"
      />
    );

    // Initial load failed on POST
    await waitFor(() => {
      expect(screen.getByText(/Serveur indisponible, réessayer/i)).toBeTruthy();
    });

    // Modal shows no BL number
    expect(screen.queryByText(/BL-20261010-0077/)).toBeNull();
    expect(screen.queryByText(/BL-20261010-0001/)).toBeNull();

    // Print button is disabled
    const printBtn = screen.getByRole('button', { name: /Imprimer Bon de Livraison/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);

    // Click Retry button
    const retryBtn = screen.getByRole('button', { name: /réessayer/i });
    fireEvent.click(retryBtn);

    // After retry, shows server number and print button is enabled
    await waitFor(() => {
      expect(screen.getByText('BL-20261010-0077')).toBeTruthy();
    });
    expect((printBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows "Disponible après synchronisation" and disables print when sale is unsynced', async () => {
    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="temp_1791650000000"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Disponible après synchronisation/i)).toBeTruthy();
    });

    const printBtn = screen.getByRole('button', { name: /Imprimer Bon de Livraison/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/BL-2026/)).toBeNull();
  });
});
