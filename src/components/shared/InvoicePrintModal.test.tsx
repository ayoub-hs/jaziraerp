// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { InvoicePrintModal } from './InvoicePrintModal.js';
import { clientDb } from '../../db/clientDb.js';

describe('InvoicePrintModal - F16: Offline & Error States', () => {
  const fakeSale = {
    id: 'sale-inv-100',
    receipt_number: 'REC-20261010-0001',
    invoice_number: 'FAC-202610-0042',
    date: '2026-10-10T10:00:00.000Z',
    customer_id: 'cust-1',
    customer_name: 'Quincaillerie Centrale',
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
    ]
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders invoice details and allows printing when fetch succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fakeSale
    } as Response);

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-inv-100"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('FAC-202610-0042')).toBeTruthy();
    });

    expect(screen.getByText('Quincaillerie Centrale')).toBeTruthy();
    expect(screen.getByText('Javel 5L')).toBeTruthy();

    const printBtn = screen.getByRole('button', { name: /Imprimer Facture A4/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalled();
  });

  it('displays offline/network error message and retry button when fetch fails', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new TypeError('Failed to fetch');
      }
      return {
        ok: true,
        json: async () => fakeSale
      } as Response;
    });

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-inv-100"
      />
    );

    // Wait for offline/network error to appear
    await waitFor(() => {
      expect(screen.getByText(/Serveur inaccessible ou appareil hors-ligne/i)).toBeTruthy();
    });

    // Loading indicator is gone and print button is disabled
    expect(screen.queryByText('Chargement de la facture...')).toBeNull();
    const printBtn = screen.getByRole('button', { name: /Imprimer Facture A4/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);

    // Retry button is available and works
    const retryBtn = screen.getByRole('button', { name: /Réessayer/i });
    expect(retryBtn).toBeTruthy();

    fireEvent.click(retryBtn);

    // After retry succeeds, invoice is shown and print button is re-enabled
    await waitFor(() => {
      expect(screen.getByText('FAC-202610-0042')).toBeTruthy();
    });
    expect(screen.queryByText(/Serveur inaccessible ou appareil hors-ligne/i)).toBeNull();
    expect((printBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('displays 404 not found error state and disables print button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404
    } as Response);

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-nonexistent"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Facture introuvable/i)).toBeTruthy();
    });

    expect(screen.queryByText('Chargement de la facture...')).toBeNull();
    const printBtn = screen.getByRole('button', { name: /Imprimer Facture A4/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('displays 500 server error with status code and retry button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500
    } as Response);

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-inv-500"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Erreur serveur lors du chargement de la facture \(code 500\)/i)).toBeTruthy();
    });

    const printBtn = screen.getByRole('button', { name: /Imprimer Facture A4/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Réessayer/i })).toBeTruthy();
  });

  it('loads offline sale from clientDb queue with draft notice for temp_ id', async () => {
    const mockPendingItem = {
      temp_client_id: 'temp_1791650000000',
      action_type: 'SALE',
      payload: {
        temp_client_id: 'temp_1791650000000',
        date: '2026-10-10T11:00:00.000Z',
        customer_name: 'Client Hors-Ligne',
        subtotal_ht: 42.017,
        tva_amount: 7.983,
        total_ttc: 50.000,
        total_discount: 0,
        cash_paid: 50.000,
        items: [
          {
            description: 'Savon Mains 500ml',
            quantity: 5,
            unit_price: 10.000,
            pack_multiplier: 1,
            line_total: 50.000
          }
        ]
      },
      created_at: '2026-10-10T11:00:00.000Z'
    };

    vi.spyOn(clientDb.pending_sync_queue, 'where').mockImplementation(() => ({
      equals: () => ({
        first: async () => mockPendingItem
      })
    } as any));

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="temp_1791650000000"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Client Hors-Ligne')).toBeTruthy();
    });

    expect(screen.getByText('Savon Mains 500ml')).toBeTruthy();
    expect(screen.getByText(/Vente hors-ligne en attente de synchronisation/i)).toBeTruthy();
  });

  it('shows unsynced notice when temp_ id is not found in clientDb queue', async () => {
    vi.spyOn(clientDb.pending_sync_queue, 'where').mockImplementation(() => ({
      equals: () => ({
        first: async () => null
      })
    } as any));

    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="temp_unknown_999"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Vente hors-ligne non synchronisée/i)).toBeTruthy();
    });

    const printBtn = screen.getByRole('button', { name: /Imprimer Facture A4/i });
    expect((printBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
