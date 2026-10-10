// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DesktopPos } from './desktop/DesktopPos';
import { MobileRegister } from './mobile/MobileRegister';
import { CheckoutModal } from './shared/CheckoutModal';
import { scannerService } from '../services/hardware/scanner';
import type { Product, ProductFamily, Customer, RegisterSession } from '../types';

const mockProduct: Product = {
  id: 'prod-1',
  name: 'Javel Bleach 1L',
  barcode: '619000333001',
  family_id: 'fam-1',
  category: 'Detergents',
  stock_quantity: 50,
  low_stock_threshold: 5,
  cost_reference: 1.000,
  retail_price: 2.000,
  wholesale_price: 1.500,
  active: 1
};

const mockFamily: ProductFamily = {
  id: 'fam-1',
  name: 'Cleaning Chemicals',
  category: 'Detergents',
  type: 'MANUFACTURED',
  active: 1
};

const mockCustomer: Customer = {
  id: 'cust-1',
  name: 'Passager',
  type: 'RETAIL',
  reseller_discount_percent: 0,
  wallet_balance: 0,
  total_debt: 0
};

const mockSession: RegisterSession = {
  id: 'ses-1',
  session_number: 'SES-01',
  counter_name: 'Counter 1',
  opened_at: '2026-09-07',
  opening_cash: 100,
  status: 'OPEN'
};

function simulateScannerBurst(input: HTMLElement, barcode: string) {
  let simulatedTime = 1000;
  let val = '';
  for (let i = 0; i < barcode.length; i++) {
    simulatedTime += 12;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
    val += barcode[i];
    fireEvent.keyDown(input, { key: barcode[i] });
    fireEvent.change(input, { target: { value: val } });
  }
  simulatedTime += 12;
  vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Component tests for scanner bursts and checkout cash guards (Batch 3 Item 3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    scannerService.stop();
  });

  it('(a) a scanner burst + Enter with the DesktopPos search input focused adds exactly 1 unit', () => {
    render(
      <DesktopPos
        products={[mockProduct]}
        families={[mockFamily]}
        customers={[mockCustomer]}
        activeSession={mockSession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search products/i);
    searchInput.focus();

    simulateScannerBurst(searchInput, '619000333001');

    // Cart total pieces should be exactly 1, not 2
    expect(screen.getByText(/Articles \(1 items \/ 1 pcs\)/i)).toBeTruthy();
  });

  it('(a) a scanner burst + Enter with the MobileRegister search input focused adds exactly 1 unit', () => {
    render(
      <MobileRegister
        products={[mockProduct]}
        families={[mockFamily]}
        customers={[mockCustomer]}
        containerTypes={[]}
        activeSession={mockSession}
        onRefreshData={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText(/search products/i);
    searchInput.focus();

    simulateScannerBurst(searchInput, '619000333001');

    // Bottom cart pill should show 1 items in cart and 1 piece total
    expect(screen.getByText(/1 items in cart/i)).toBeTruthy();
    // The pill circle displays totalPieces
    const pill = screen.getByText(/1 items in cart/i).closest('.flex-1, div');
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('(b) a 12-digit burst + Enter in the CheckoutModal cash field neither submits sale nor leaves digits in field', () => {
    const onCompleteSale = vi.fn();
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        items={[
          {
            cart_item_id: 'cart-1',
            product_id: 'prod-1',
            name: 'Javel Bleach 1L',
            unit_price: 2.000,
            quantity: 1,
            pack_multiplier: 1,
            discount_amount: 0,
            loan_container: false
          }
        ]}
        customer={mockCustomer}
        onCompleteSale={onCompleteSale}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    const cashInput = screen.getAllByPlaceholderText('0.000')[0] as HTMLInputElement;
    cashInput.focus();

    simulateScannerBurst(cashInput, '619000333001');

    // Must not submit sale
    expect(onCompleteSale).not.toHaveBeenCalled();
    // Must clear digits from field
    expect(cashInput.value).toBe('');
    // Should display validation error
    expect(screen.getByText(/code-barres scanné/i)).toBeTruthy();
  });

  it('A1: while a modal is open, scanner scans do NOT add items to the cart; after closing, scan adds item', () => {
    render(
      <DesktopPos
        products={[mockProduct]}
        families={[mockFamily]}
        customers={[mockCustomer]}
        activeSession={mockSession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Initial cart is empty
    expect(screen.getByText(/Articles \(0 items \/ 0 pcs\)/i)).toBeTruthy();

    // Open Quick Add modal
    fireEvent.click(screen.getByText(/Quick Add/i));
    expect(screen.getByText(/Quick-Add Uncataloged Item/i)).toBeTruthy();

    // Trigger a scan while modal is open
    act(() => {
      scannerService.triggerScan('619000333001');
    });

    // Cart behind modal MUST remain empty
    expect(screen.getByText(/Articles \(0 items \/ 0 pcs\)/i)).toBeTruthy();

    // Close the modal
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText(/Quick-Add Uncataloged Item/i)).toBeNull();

    // Trigger scan now that modal is closed
    act(() => {
      scannerService.triggerScan('619000333001');
    });

    // Cart now has the item
    expect(screen.getByText(/Articles \(1 items \/ 1 pcs\)/i)).toBeTruthy();
  });

  it('A3: cart line displays correct price-source tag per customer type (Détail, Gros, -X% Revendeur, Modifié)', () => {
    const retailCustomer: Customer = {
      id: 'cust-retail',
      name: 'Client Détail',
      type: 'RETAIL',
      reseller_discount_percent: 0,
      wallet_balance: 0,
      total_debt: 0
    };
    const wholesaleCustomer: Customer = {
      id: 'cust-ws',
      name: 'Client Gros',
      type: 'WHOLESALE',
      reseller_discount_percent: 0,
      wallet_balance: 0,
      total_debt: 0
    };
    const resellerCustomer: Customer = {
      id: 'cust-res',
      name: 'Client Revendeur',
      type: 'RESELLER',
      reseller_discount_percent: 10,
      wallet_balance: 0,
      total_debt: 0
    };

    const { rerender } = render(
      <DesktopPos
        products={[mockProduct]}
        families={[mockFamily]}
        customers={[retailCustomer, wholesaleCustomer, resellerCustomer]}
        activeSession={mockSession}
        onRefreshData={vi.fn()}
        onPopDrawer={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // 1. Add item to cart for retail customer
    act(() => {
      scannerService.triggerScan('619000333001');
    });

    // Tag should be "Détail"
    expect(screen.getByText('Détail')).toBeTruthy();

    // 2. Switch to Wholesale customer
    const custSearchInput = screen.getByPlaceholderText(/Rechercher client/i);
    fireEvent.focus(custSearchInput);
    fireEvent.click(screen.getByText('Client Gros'));
    expect(screen.getByText('Gros')).toBeTruthy();

    // 3. Switch to Reseller customer (10% discount)
    fireEvent.click(screen.getByTitle(/Désélectionner le client/i));
    fireEvent.focus(screen.getByPlaceholderText(/Rechercher client/i));
    fireEvent.click(screen.getByText('Client Revendeur'));
    expect(screen.getByText('-10% Revendeur')).toBeTruthy();

    // 4. Manually override price
    const priceInput = screen.getByTitle('Modifier le prix unitaire');
    fireEvent.change(priceInput, { target: { value: '4.500' } });
    fireEvent.blur(priceInput);

    // Tag should now be "Modifié"
    expect(screen.getByText('Modifié')).toBeTruthy();
  });
});
