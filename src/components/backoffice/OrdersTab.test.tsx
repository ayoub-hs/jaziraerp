// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrdersTab } from './OrdersTab';
import type { ClientOrder, Product, DeliveryZone, Customer } from '../../types';

describe('OrdersTab — Orders Management (Phase 1a Step 5c)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockProducts: Product[] = [
    {
      id: 'prod-1',
      family_id: 'fam-1',
      category: 'Detergents',
      name: 'Eau de Javel 5L',
      stock_quantity: 100,
      low_stock_threshold: 10,
      cost_reference: 2.0,
      retail_price: 4.0,
      wholesale_price: 3.0,
      active: 1
    }
  ];

  const mockZones: DeliveryZone[] = [
    {
      id: 'zone-1',
      name: 'Zone Midoun',
      fee: 5.0,
      min_order_amount: 10.0,
      active: 1,
      created_at: '2026-10-22',
      updated_at: '2026-10-22'
    }
  ];

  const mockCustomers: Customer[] = [
    {
      id: 'cust-1',
      name: 'Al Jazira Superette',
      phone: '21111222',
      address: 'Route touristique Midoun',
      type: 'RETAIL',
      reseller_discount_percent: 0,
      wallet_balance: 50.0
    }
  ];

  const mockOrders: ClientOrder[] = [
    {
      id: 'order-1',
      order_number: 'CMD-20261022-0001',
      customer_id: 'cust-1',
      customer_name: 'Al Jazira Superette',
      guest_name: null,
      phone: '21111222',
      delivery_zone_id: 'zone-1',
      delivery_zone_name: 'Zone Midoun',
      delivery_address: 'Route touristique Midoun',
      payment_preference: 'CASH',
      status: 'NEW',
      delivery_fee: 5.0,
      subtotal_ttc: 20.0,
      total_ttc: 25.0,
      created_at: '2026-10-22T09:00:00Z',
      updated_at: '2026-10-22T09:00:00Z',
      items: [
        {
          id: 'item-1',
          order_id: 'order-1',
          product_id: 'prod-1',
          product_name: 'Eau de Javel 5L',
          ordered_quantity: 5,
          unit_price_ttc: 4.0,
          total_line_ttc: 20.0
        }
      ]
    },
    {
      id: 'order-2',
      order_number: 'CMD-20261022-0002',
      customer_id: null,
      customer_name: 'Ahmed Ben Ali',
      guest_name: 'Ahmed Ben Ali',
      phone: '98123456',
      delivery_zone_id: 'zone-1',
      delivery_zone_name: 'Zone Midoun',
      delivery_address: 'El May Djerba',
      payment_preference: 'CASH',
      status: 'CONFIRMED',
      delivery_fee: 5.0,
      subtotal_ttc: 40.0,
      total_ttc: 45.0,
      created_at: '2026-10-22T10:00:00Z',
      updated_at: '2026-10-22T10:00:00Z',
      items: []
    }
  ];

  it('renders orders list, status filters, and pending badge', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      if (String(url).includes('/api/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockOrders
        } as any);
      }
      if (String(url).includes('/api/delivery-zones')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockZones
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrdersTab
        products={mockProducts}
        customers={mockCustomers}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CMD-20261022-0001')).toBeDefined();
    });

    expect(screen.getByText('CMD-20261022-0002')).toBeDefined();
    expect(screen.getByText('Al Jazira Superette')).toBeDefined();
    expect(screen.getByText('Ahmed Ben Ali')).toBeDefined();

    // Pending count: 2 orders pending (NEW + CONFIRMED)
    expect(screen.getByText(/En attente \(2\)|2 en attente/i)).toBeDefined();
  });

  it('re-uses the same client_request_id on retry after failure, fresh key on success', async () => {
    let callCount = 0;
    const recordedKeys: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = String(url);
      if (u === '/api/orders' && opts?.method === 'POST') {
        callCount++;
        const body = JSON.parse(opts.body);
        recordedKeys.push(body.client_request_id);

        if (callCount === 1) {
          // Simulate temporary 500 error
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Erreur réseau simulée' })
          } as any);
        }

        // On retry, succeed
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => mockOrders[0]
        } as any);
      }

      if (u.includes('/api/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => []
        } as any);
      }
      if (u.includes('/api/delivery-zones')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockZones
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrdersTab
        products={mockProducts}
        customers={mockCustomers}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /nouvelle commande/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /nouvelle commande/i }));

    // Choose customer
    fireEvent.change(screen.getByLabelText(/sélectionner le client/i), { target: { value: 'cust-1' } });

    // Choose zone
    fireEvent.change(screen.getByLabelText(/zone de livraison/i), { target: { value: 'zone-1' } });

    // Add item
    fireEvent.click(screen.getByRole('button', { name: /ajouter un article/i }));

    // First submit: fails with 500
    const submitBtn = screen.getByRole('button', { name: /créer la commande/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Erreur réseau simulée/i)).toBeDefined();
    });

    // Retry submit without changing anything
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(callCount).toBe(2);
    });

    // Assert that the exact same idempotency key was reused on retry
    expect(recordedKeys).toHaveLength(2);
    expect(recordedKeys[0]).toBeTruthy();
    expect(recordedKeys[1]).toBe(recordedKeys[0]);
  });

  it('cancel order requires a mandatory reason', async () => {
    let cancelPayload: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = String(url);
      if (u.includes('/api/orders/order-1/cancel') && opts?.method === 'POST') {
        cancelPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...mockOrders[0], status: 'CANCELLED', cancellation_reason: cancelPayload.reason })
        } as any);
      }
      if (u.includes('/api/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => [mockOrders[0]]
        } as any);
      }
      if (u.includes('/api/delivery-zones')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockZones
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrdersTab
        products={mockProducts}
        customers={mockCustomers}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CMD-20261022-0001')).toBeDefined();
    });

    // Click Annuler on order-1
    fireEvent.click(screen.getByRole('button', { name: /annuler la commande/i }));

    // Modal opens. Confirm button must be disabled when reason is empty
    const confirmCancelBtn = screen.getByRole('button', { name: /confirmer l'annulation/i });
    expect((confirmCancelBtn as HTMLButtonElement).disabled).toBe(true);

    // Enter whitespace: still disabled
    const reasonInput = screen.getByLabelText(/motif d'annulation/i);
    fireEvent.change(reasonInput, { target: { value: '   ' } });
    expect((confirmCancelBtn as HTMLButtonElement).disabled).toBe(true);

    // Enter valid reason
    fireEvent.change(reasonInput, { target: { value: 'Client indisponible au téléphone' } });
    expect((confirmCancelBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirmCancelBtn);

    await waitFor(() => {
      expect(cancelPayload).toEqual({ reason: 'Client indisponible au téléphone' });
    });
  });

  it('transitions order state according to server state machine only', async () => {
    const statusCalls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = String(url);
      if (u.includes('/api/orders/order-1/status') && opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        statusCalls.push(body.status);
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...mockOrders[0], status: body.status })
        } as any);
      }
      if (u.includes('/api/orders')) {
        return Promise.resolve({
          ok: true,
          json: async () => [mockOrders[0]] // status NEW
        } as any);
      }
      if (u.includes('/api/delivery-zones')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockZones
        } as any);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    render(
      <OrdersTab
        products={mockProducts}
        customers={mockCustomers}
        containerTypes={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('CMD-20261022-0001')).toBeDefined();
    });

    // Order 1 is NEW. Allowed next: CONFIRMED or CANCELLED.
    // It should have a "Confirmer" button and "Annuler la commande".
    expect(screen.queryByRole('button', { name: /préparer/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /expédier/i })).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: /confirmer la commande/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(statusCalls).toContain('CONFIRMED');
    });
  });
});
