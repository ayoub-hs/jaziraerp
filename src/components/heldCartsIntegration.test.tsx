// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DesktopPos } from './desktop/DesktopPos.js';
import { SessionModal } from './shared/SessionModal.js';
import { heldCartsService } from '../services/heldCartsService.js';
import type { Product, Customer, RegisterSession } from '../types/index.js';

describe('Held Carts Integration (Batch 2 Item B4)', () => {
  const dummyProduct: Product = {
    id: 'prod-test-1',
    family_id: 'fam-1',
    category: 'Detergents',
    name: 'Savon Liquide 1L',
    stock_quantity: 50,
    low_stock_threshold: 5,
    cost_reference: 1.500,
    retail_price: 3.000,
    wholesale_price: 2.500,
    active: 1
  };

  const dummyCustomer: Customer = {
    id: 'cust-test-1',
    name: 'Grossiste Al Baraka',
    type: 'WHOLESALE',
    reseller_discount_percent: 0,
    wallet_balance: 0
  };

  const dummySession: RegisterSession = {
    id: 'sess-1',
    session_number: 'SES-20261010-0001',
    counter_name: 'Countertop',
    opened_at: '2026-10-10T08:00:00Z',
    opening_cash: 100.000,
    status: 'OPEN'
  };

  beforeEach(() => {
    localStorage.clear();
    heldCartsService.clearAll();
    vi.restoreAllMocks();
  });

  it('allows holding a cart, clearing POS, and resuming it from the held carts modal in DesktopPos', async () => {
    render(
      <DesktopPos
        products={[dummyProduct]}
        families={[]}
        customers={[dummyCustomer]}
        containerTypes={[]}
        activeSession={dummySession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Click product to add to cart
    const prodCard = screen.getByText('Savon Liquide 1L');
    fireEvent.click(prodCard);

    // Verify item is in cart
    expect(screen.getByText(/Articles \(1 items/i)).toBeTruthy();

    // "En attente" button should be visible
    const holdBtn = screen.getByRole('button', { name: /En attente/i });
    fireEvent.click(holdBtn);

    // Cart should now be cleared
    expect(screen.getByText(/Scan barcode or click items/i)).toBeTruthy();
    expect(heldCartsService.getHeldCartCount()).toBe(1);

    // "Paniers (1)" button is now active
    const heldCartsBtn = screen.getByRole('button', { name: /Paniers \(1\)/i });
    fireEvent.click(heldCartsBtn);

    // Held carts modal opens
    expect(screen.getByText('Paniers en attente (1)')).toBeTruthy();

    // Click "Reprendre ce panier"
    const resumeBtn = screen.getByRole('button', { name: /Reprendre ce panier/i });
    fireEvent.click(resumeBtn);

    // Cart is restored in POS
    expect(screen.getByText(/Articles \(1 items/i)).toBeTruthy();
    expect(heldCartsService.getHeldCartCount()).toBe(0);
  });

  it('warns in SessionModal when closing session with active held carts', async () => {
    // Put 2 carts on hold
    heldCartsService.holdCart(
      [{ cart_item_id: 'c1', name: 'Savon 1L', unit_price: 3, quantity: 1, pack_multiplier: 1 }],
      null,
      0,
      'Panier Client 1'
    );
    heldCartsService.holdCart(
      [{ cart_item_id: 'c2', name: 'Javel 5L', unit_price: 5, quantity: 2, pack_multiplier: 1 }],
      null,
      0,
      'Panier Client 2'
    );
    expect(heldCartsService.getHeldCartCount()).toBe(2);

    // Mock fetch for register summary
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/api/register/summary')) {
        return {
          ok: true,
          json: async () => ({
            session: dummySession,
            opening_cash: 100,
            cash_sales: 50,
            cash_refunds: 0,
            cash_in: 0,
            cash_out: 0,
            expected_cash: 150
          })
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    render(
      <SessionModal
        isOpen={true}
        onClose={vi.fn()}
        mode="CLOSE"
        activeSession={dummySession}
        onSessionUpdated={vi.fn()}
      />
    );

    // Check held carts warning banner
    await waitFor(() => {
      expect(screen.getByText(/Attention : 2 panier\(s\) en attente non finalisé\(s\)/i)).toBeTruthy();
    });
  });
});
