// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DesktopPos } from './DesktopPos.js';
import type { Product, Customer, RegisterSession } from '../../types/index.js';

describe('DesktopPos Quick Price/Stock Lookup Integration (Batch 2 Item B5)', () => {
  const dummyProducts: Product[] = [
    {
      id: 'prod-lookup-1',
      family_id: 'fam-1',
      category: 'Detergents',
      name: 'Savon Liquide Jasmin',
      size_label: '1L',
      barcode: '619111222333',
      stock_quantity: 25,
      low_stock_threshold: 5,
      cost_reference: 1.500,
      retail_price: 3.500,
      wholesale_price: 2.800,
      active: 1,
      pack_sizes: [
        {
          id: 'ps-pack-6',
          product_id: 'prod-lookup-1',
          pack_label: 'Pack ×6',
          multiplier: 6,
          barcode: '619111222336',
          price_override: 19.000
        }
      ]
    },
    {
      id: 'prod-lookup-2',
      family_id: 'fam-2',
      category: 'Detergents',
      name: 'Nettoyant Sol 5L',
      size_label: '5L',
      barcode: '619444555666',
      stock_quantity: 8,
      low_stock_threshold: 10,
      cost_reference: 3.000,
      retail_price: 6.000,
      wholesale_price: 5.000,
      active: 1
    }
  ];

  const resellerCustomer: Customer = {
    id: 'cust-reseller-99',
    name: 'Société Hammamet Distribution',
    type: 'RESELLER',
    reseller_discount_percent: 15, // 15% discount on wholesale
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
    vi.restoreAllMocks();
  });

  it('opens lookup modal via toolbar button "Vérif Prix [F3]" and via F3 hotkey', () => {
    render(
      <DesktopPos
        products={dummyProducts}
        families={[]}
        customers={[]}
        containerTypes={[]}
        activeSession={dummySession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Initial state: lookup modal not visible
    expect(screen.queryByText(/Vérification Prix & Stock/i)).toBeNull();

    // Click toolbar button
    const verifBtn = screen.getByRole('button', { name: /Vérif Prix/i });
    fireEvent.click(verifBtn);

    // Lookup modal should now be open
    expect(screen.getByText(/Vérification Prix & Stock/i)).toBeTruthy();

    // Press Escape to close
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/Vérification Prix & Stock/i)).toBeNull();

    // Press F3 hotkey to open
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByText(/Vérification Prix & Stock/i)).toBeTruthy();
  });

  it('keeps current cart intact, displays reseller price for selected customer, and adds item from lookup', async () => {
    render(
      <DesktopPos
        products={dummyProducts}
        families={[]}
        customers={[resellerCustomer]}
        containerTypes={[]}
        activeSession={dummySession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // 1. First add a product to cart via product grid or barcode
    const posSearchInput = screen.getByPlaceholderText(/Search products by name/i) as HTMLInputElement;
    fireEvent.change(posSearchInput, { target: { value: '619444555666' } });
    fireEvent.keyDown(posSearchInput, { key: 'Enter' });

    // Verify Nettoyant Sol is in cart
    expect(screen.getAllByText(/Nettoyant Sol 5L/i).length).toBeGreaterThan(0);

    // 2. Select Reseller customer
    const customerInput = screen.getByPlaceholderText(/Rechercher client/i);
    fireEvent.focus(customerInput);
    const resellerOption = screen.getByText(/Société Hammamet Distribution/i);
    fireEvent.click(resellerOption);

    // 3. Open Lookup Modal via F3
    fireEvent.keyDown(window, { key: 'F3' });
    expect(screen.getByText(/Vérification Prix & Stock/i)).toBeTruthy();

    // Verify lookup modal displays reseller context
    expect(screen.getByText(/Client en cours :/i)).toBeTruthy();
    expect(screen.getAllByText(/Société Hammamet Distribution/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/-15%/).length).toBeGreaterThan(0);

    // Savon wholesale is 2.800. 15% discount: 2.800 * 0.85 = 2.380
    // Check displayed price for customer
    expect(screen.getAllByText(/2\.380/).length).toBeGreaterThan(0);

    // 4. In lookup, add Savon Liquide Jasmin to cart (1 pc)
    const addButtons = screen.getAllByRole('button', { name: /Ajouter au panier/i });
    fireEvent.click(addButtons[0]);

    // Modal should close
    expect(screen.queryByText(/Vérification Prix & Stock/i)).toBeNull();

    // 5. Verify both items exist in POS cart, and Savon Liquide was added at 2.380 DT (reseller rate)
    expect(screen.getAllByText(/Nettoyant Sol 5L/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Savon Liquide Jasmin/i).length).toBeGreaterThan(0);

    // Verify POS search input is refocused
    await waitFor(() => {
      expect(document.activeElement).toBe(posSearchInput);
    });
  });
});
