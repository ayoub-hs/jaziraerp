// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderConversionModal } from './OrderConversionModal';
import type { ClientOrder, ContainerType } from '../../types';

describe('OrderConversionModal (Phase 1a Step 5e)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockCustomerOrder: ClientOrder = {
    id: 'order-conv-1',
    order_number: 'CMD-20261022-0001',
    customer_id: 'cust-1',
    customer_name: 'Supermarché Midoun',
    guest_name: null,
    phone: '21111222',
    delivery_zone_id: 'zone-1',
    delivery_zone_name: 'Zone Midoun',
    delivery_address: 'Centre Ville Midoun',
    payment_preference: 'CASH',
    status: 'CONFIRMED',
    delivery_fee: 5.0,
    subtotal_ttc: 32.0,
    total_ttc: 37.0,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    items: [
      {
        id: 'item-1',
        order_id: 'order-conv-1',
        product_id: 'prod-1',
        product_name: 'Eau de Javel 5L',
        size_label: '5L',
        ordered_quantity: 4,
        delivered_quantity: null,
        unit_price_ttc: 3.0,
        total_line_ttc: 12.0
      },
      {
        id: 'item-2',
        order_id: 'order-conv-1',
        product_id: 'prod-2',
        product_name: 'Savon Liquide 5L',
        size_label: '5L',
        ordered_quantity: 2,
        delivered_quantity: null,
        unit_price_ttc: 10.0,
        total_line_ttc: 20.0
      }
    ]
  };

  const mockGuestOrder: ClientOrder = {
    ...mockCustomerOrder,
    id: 'order-conv-guest',
    order_number: 'CMD-20261022-0002',
    customer_id: null,
    customer_name: 'Ali Passager',
    guest_name: 'Ali Passager',
    phone: '98765432'
  };

  const mockContainers: ContainerType[] = [
    {
      id: 'ct-1',
      name: 'Bidon 5L',
      capacity_liters: 5.0,
      stock_quantity: 50,
      total_loaned_out: 100
    }
  ];

  it('queries GET /api/register/current?counter_name=Livraison and offers to open if none open', async () => {
    let sessionQueriedUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      sessionQueriedUrl = String(url);
      if (sessionQueriedUrl.includes('/api/register/current')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Aucune session active' })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockCustomerOrder}
        containerTypes={mockContainers}
      />
    );

    await waitFor(() => {
      expect(sessionQueriedUrl).toContain('counter_name=Livraison');
    });

    expect(screen.getByText(/Aucune session de caisse ouverte sur le comptoir Livraison/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /ouvrir la session livraison/i })).toBeDefined();
  });

  it('per line delivered quantity defaults to ordered, cannot exceed ordered, recomputes total live', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/api/register/current')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'sess-livraison-1', counter_name: 'Livraison', status: 'OPEN' })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockCustomerOrder}
        containerTypes={mockContainers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Eau de Javel 5L')).toBeDefined();
    });

    // Inputs default to ordered quantities (4 and 2)
    const inputs = screen.getAllByRole('spinbutton', { name: /quantité livrée/i }) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe('4');
    expect(inputs[1].value).toBe('2');

    // Total should be: 4*3 + 2*10 + 5 (fee) = 37.000 DT
    expect(screen.getByText(/37,000 DT|37.000 DT/)).toBeDefined();

    // Change bleach delivered quantity from 4 to 2: new total = 2*3 + 2*10 + 5 = 31.000 DT
    fireEvent.change(inputs[0], { target: { value: '2' } });
    expect(screen.getByText(/31,000 DT|31.000 DT/)).toBeDefined();

    // Trying to exceed ordered quantity (e.g. 5) triggers error message and disables confirm
    fireEvent.change(inputs[0], { target: { value: '5' } });
    expect(screen.getByText(/ne peut pas dépasser la quantité commandée/i)).toBeDefined();
  });

  it('disables wallet and credit inputs for guest orders', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/api/register/current')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'sess-livraison-1', counter_name: 'Livraison', status: 'OPEN' })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockGuestOrder}
        containerTypes={mockContainers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Ali Passager')).toBeDefined();
    });

    const walletInput = screen.getByLabelText(/portefeuille client/i) as HTMLInputElement;
    const creditInput = screen.getByLabelText(/vente à crédit/i) as HTMLInputElement;

    expect(walletInput.disabled).toBe(true);
    expect(creditInput.disabled).toBe(true);
    expect(walletInput.value).toBe('0');
    expect(creditInput.value).toBe('0');
  });

  it('confirm button is disabled until tender equals total exactly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/api/register/current')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'sess-livraison-1', counter_name: 'Livraison', status: 'OPEN' })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockCustomerOrder}
        containerTypes={mockContainers}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Eau de Javel 5L')).toBeDefined();
    });

    const confirmBtn = screen.getByRole('button', { name: /valider la conversion/i }) as HTMLButtonElement;
    // Total is 37 DT. By default cash_paid is initialized to 37 DT, so confirm is enabled
    expect(confirmBtn.disabled).toBe(false);

    // Change cash_paid to 20 DT (17 DT short): confirm button must be disabled!
    const cashInput = screen.getByLabelText(/espèces/i);
    fireEvent.change(cashInput, { target: { value: '20.000' } });

    expect(confirmBtn.disabled).toBe(true);
    expect(screen.getByText(/écart.*17,000 DT|écart.*17.000 DT/i)).toBeDefined();

    // Fill remaining 17 DT in credit: total equals 37 DT again -> confirm enabled!
    const creditInput = screen.getByLabelText(/vente à crédit/i);
    fireEvent.change(creditInput, { target: { value: '17.000' } });

    expect(confirmBtn.disabled).toBe(false);
  });

  it('confirm button is disabled while submitting and same key reused on retry', async () => {
    let callCount = 0;
    const submittedKeys: string[] = [];
    let resolveFirstSubmit: any;

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = String(url);
      if (u.includes('/api/register/current')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'sess-livraison-1', counter_name: 'Livraison', status: 'OPEN' })
        } as any);
      }
      if (u.includes('/api/orders/order-conv-1/convert') && opts?.method === 'POST') {
        callCount++;
        const body = JSON.parse(opts.body);
        submittedKeys.push(body.client_request_id);

        if (callCount === 1) {
          return new Promise(resolve => {
            resolveFirstSubmit = () => resolve({
              ok: false,
              status: 500,
              json: async () => ({ error: 'Erreur serveur temporaire' })
            } as any);
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            order: { ...mockCustomerOrder, status: 'DELIVERED' },
            sale: { id: 'sale-1', receipt_number: 'REC-001' },
            delivery_note_number: 'BL-20261022-0001',
            warnings: []
          })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockCustomerOrder}
        containerTypes={mockContainers}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /valider la conversion/i })).toBeDefined();
    });

    const confirmBtn = screen.getByRole('button', { name: /valider la conversion/i }) as HTMLButtonElement;
    fireEvent.click(confirmBtn);

    // Confirm button must be disabled while submitting
    expect(confirmBtn.disabled).toBe(true);

    // Complete the first failed call
    resolveFirstSubmit();

    await waitFor(() => {
      expect(screen.getByText(/Erreur serveur temporaire/i)).toBeDefined();
    });

    // Confirm button re-enabled for retry
    expect(confirmBtn.disabled).toBe(false);

    // Click retry
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(callCount).toBe(2);
    });

    // Same idempotency key must be reused on retry!
    expect(submittedKeys).toHaveLength(2);
    expect(submittedKeys[0]).toBeTruthy();
    expect(submittedKeys[1]).toBe(submittedKeys[0]);
  });

  it('displays credit warning banner, delivery note number, and offers print on success', async () => {
    const onPrintNoteSpy = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = String(url);
      if (u.includes('/api/register/current')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: 'sess-livraison-1', counter_name: 'Livraison', status: 'OPEN' })
        } as any);
      }
      if (u.includes('/api/orders/order-conv-1/convert') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            order: { ...mockCustomerOrder, status: 'DELIVERED' },
            sale: { id: 'sale-1', receipt_number: 'REC-001' },
            delivery_note_number: 'BL-20261022-0042',
            warnings: ['Plafond de crédit dépassé pour le client Supermarché Midoun (encours: 600 DT, plafond: 500 DT).']
          })
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrderConversionModal
        isOpen={true}
        onClose={vi.fn()}
        order={mockCustomerOrder}
        containerTypes={mockContainers}
        onPrintDeliveryNote={onPrintNoteSpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /valider la conversion/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /valider la conversion/i }));

    // Warning banner displayed
    await waitFor(() => {
      expect(screen.getByText(/Plafond de crédit dépassé/i)).toBeDefined();
    });

    // Delivery note number displayed
    expect(screen.getByText('BL-20261022-0042')).toBeDefined();

    // Print delivery note button offered
    const printBtn = screen.getByRole('button', { name: /imprimer le bon de livraison/i });
    expect(printBtn).toBeDefined();
    fireEvent.click(printBtn);
    expect(onPrintNoteSpy).toHaveBeenCalledWith('sale-1');
  });
});
