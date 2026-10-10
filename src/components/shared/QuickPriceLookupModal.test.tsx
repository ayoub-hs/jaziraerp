// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QuickPriceLookupModal } from './QuickPriceLookupModal.js';
import type { Product, Customer } from '../../types/index.js';
import { scannerService } from '../../services/hardware/scanner.js';

describe('QuickPriceLookupModal (Batch 2 Item B5)', () => {
  const dummyProducts: Product[] = [
    {
      id: 'prod-1',
      family_id: 'fam-1',
      category: 'Detergents',
      name: 'Savon Liquide Citron',
      size_label: '1L',
      barcode: '619000100101',
      stock_quantity: 45,
      low_stock_threshold: 10,
      cost_reference: 1.500,
      retail_price: 3.500,
      wholesale_price: 2.800,
      active: 1,
      pack_sizes: [
        {
          id: 'ps-1',
          product_id: 'prod-1',
          pack_label: 'Pack ×6',
          multiplier: 6,
          barcode: '619000100106',
          price_override: 19.500
        },
        {
          id: 'ps-2',
          product_id: 'prod-1',
          pack_label: 'Carton ×12',
          multiplier: 12,
          barcode: '619000100112'
        }
      ]
    },
    {
      id: 'prod-2',
      family_id: 'fam-2',
      category: 'Detergents',
      name: 'Javel Jazira 5L',
      size_label: '5L',
      barcode: '619000200202',
      stock_quantity: 3,
      low_stock_threshold: 5,
      cost_reference: 2.000,
      retail_price: 4.500,
      wholesale_price: 4.000,
      active: 1
    },
    {
      id: 'prod-3',
      family_id: 'fam-3',
      category: 'Solvants',
      name: 'Degraissant Industriel',
      size_label: '20L',
      barcode: '619000300303',
      stock_quantity: 0,
      low_stock_threshold: 2,
      cost_reference: 30.000,
      retail_price: 50.000,
      wholesale_price: 42.000,
      active: 1
    }
  ];

  const resellerCustomer: Customer = {
    id: 'cust-reseller-1',
    name: 'Société Ben Ali (Revendeur)',
    type: 'RESELLER',
    reseller_discount_percent: 10,
    wallet_balance: 0
  };

  const wholesaleCustomer: Customer = {
    id: 'cust-wholesale-1',
    name: 'Grossiste Al Baraka',
    type: 'WHOLESALE',
    reseller_discount_percent: 0,
    wallet_balance: 0
  };

  it('pauses scannerService when opened and resumes when closed', () => {
    const isPausedBefore = scannerService.isPaused();
    const { unmount } = render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
      />
    );

    expect(scannerService.isPaused()).toBe(true);

    unmount();
    expect(scannerService.isPaused()).toBe(isPausedBefore);
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <QuickPriceLookupModal
        isOpen={false}
        onClose={vi.fn()}
        products={dummyProducts}
      />
    );

    expect(screen.queryByPlaceholderText(/recherche|code-barres/i)).toBeNull();
  });

  it('auto-focuses search input and searches by product name', () => {
    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
      />
    );

    const input = screen.getByPlaceholderText(/recherche|code-barres/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'Savon' } });

    expect(screen.getByText(/Savon Liquide Citron/i)).toBeTruthy();
    expect(screen.queryByText(/Degraissant Industriel/i)).toBeNull();
  });

  it('searches and finds product by exact barcode and by pack barcode', () => {
    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
      />
    );

    const input = screen.getByPlaceholderText(/recherche|code-barres/i) as HTMLInputElement;

    // Scan or type main barcode
    fireEvent.change(input, { target: { value: '619000200202' } });
    expect(screen.getByText(/Javel Jazira 5L/i)).toBeTruthy();
    expect(screen.queryByText(/Savon Liquide Citron/i)).toBeNull();

    // Scan pack barcode
    fireEvent.change(input, { target: { value: '619000100106' } });
    expect(screen.getByText(/Savon Liquide Citron/i)).toBeTruthy();
    expect(screen.queryByText(/Javel Jazira 5L/i)).toBeNull();
  });

  it('displays accurate stock status: In stock, Low stock, and Out of stock', () => {
    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
      />
    );

    // prod-1: 45 units (in stock)
    expect(screen.getByText(/En stock \(45\)/i)).toBeTruthy();
    // prod-2: 3 units (low stock <= 5)
    expect(screen.getByText(/Stock faible \(3\)/i)).toBeTruthy();
    // prod-3: 0 units (rupture)
    expect(screen.getByText(/Rupture de stock \(0\)/i)).toBeTruthy();
  });

  it('displays retail price, wholesale price, and standard reseller tier prices without customer', () => {
    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        customer={null}
      />
    );

    // For Savon (Retail: 3.500, Wholesale: 2.800)
    // Reseller -5%: 2.800 * 0.95 = 2.660
    // Reseller -10%: 2.800 * 0.90 = 2.520
    // Reseller -15%: 2.800 * 0.85 = 2.380
    expect(screen.getAllByText(/3\.500/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.800/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.660/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.520/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\.380/).length).toBeGreaterThan(0);
  });

  it('highlights customer-specific price when customer is selected (Wholesale & Reseller)', () => {
    const { rerender } = render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        customer={wholesaleCustomer}
      />
    );

    // Wholesale client info displayed
    expect(screen.getByText(/Grossiste Al Baraka/i)).toBeTruthy();

    // Now test with Reseller customer (10% discount on wholesale 2.800 = 2.520)
    rerender(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={dummyProducts}
        customer={resellerCustomer}
      />
    );

    expect(screen.getByText(/Société Ben Ali/i)).toBeTruthy();
    expect(screen.getAllByText(/-10%/).length).toBeGreaterThan(0);
  });

  it('displays pack sizes with computed prices and allows adding pack to cart', () => {
    const onAddToCart = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={onClose}
        products={dummyProducts}
        customer={null}
        onAddToCart={onAddToCart}
      />
    );

    // Pack x6 has retail override 19.500
    expect(screen.getAllByText(/Pack ×6/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19\.500/).length).toBeGreaterThan(0);

    // Carton x12 has 12 * 3.500 = 42.000
    expect(screen.getAllByText(/Carton ×12/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/42\.000/).length).toBeGreaterThan(0);

    // Click "Ajouter" for Pack x6
    const packAddBtn = screen.getByRole('button', { name: /Ajouter Pack ×6/i });
    fireEvent.click(packAddBtn);

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(
      dummyProducts[0],
      6,
      'Pack ×6',
      dummyProducts[0].pack_sizes![0]
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows adding base unit (1 pc) to cart and closes modal', () => {
    const onAddToCart = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={onClose}
        products={dummyProducts}
        customer={resellerCustomer}
        onAddToCart={onAddToCart}
      />
    );

    const addButtons = screen.getAllByRole('button', { name: /Ajouter au panier/i });
    fireEvent.click(addButtons[0]);

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(onAddToCart).toHaveBeenCalledWith(dummyProducts[0], 1, undefined, null);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key press or close button click', () => {
    const onClose = vi.fn();

    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={onClose}
        products={dummyProducts}
      />
    );

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Click close button
    const closeBtns = screen.getAllByRole('button', { name: /fermer|close/i });
    fireEvent.click(closeBtns[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
