// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MobileRegister } from './MobileRegister.js';
import { ContainerTransactionModal } from '../backoffice/ContainerTransactionModal.js';
import { clientDb } from '../../db/clientDb.js';

describe('F13: Quick-Edit and Container transactions offline queue fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('MobileRegister quick-edit queues stock_delta when stock changed, and omits stock keys on price-only edit', async () => {
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);
    const prodUpdateSpy = vi.spyOn(clientDb.products, 'update').mockResolvedValue(1 as any);

    const mockProduct = {
      id: 'prod-quick-1',
      name: 'Nettoyant Sol 1L',
      barcode: '111222333',
      retail_price: 3.500,
      wholesale_price: 2.800,
      stock_quantity: 15,
      cost_price: 2.000,
      category: 'Entretien',
      family_id: 'fam-1',
      low_stock_threshold: 5
    };

    // Simulate offline
    vi.stubGlobal('navigator', { onLine: false });

    const { unmount } = render(
      <MobileRegister
        products={[mockProduct as any]}
        families={[]}
        customers={[]}
        containerTypes={[]}
        activeSession={null}
        onRefreshData={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Navigate to QUICK-EDIT tab
    const quickEditNav = screen.getByText('Quick-Edit');
    fireEvent.click(quickEditNav);

    // Search for product barcode
    const searchInput = screen.getByPlaceholderText(/Scan barcode to edit.../i);
    fireEvent.change(searchInput, { target: { value: '111222333' } });

    // Product card appears
    await waitFor(() => {
      expect(screen.getByText('Nettoyant Sol 1L')).toBeDefined();
    });

    // 1. Modify retail price ONLY (stock left untouched at 15)
    const retailInput = screen.getByDisplayValue('3.500');
    fireEvent.change(retailInput, { target: { value: '4.200' } });

    // Click Save
    const saveButton = screen.getByRole('button', { name: /Save & Update/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    });

    const queuedPriceOnly = queueAddSpy.mock.calls[0][0];
    expect(queuedPriceOnly.action_type).toBe('PRICE_STOCK_EDIT');
    expect(queuedPriceOnly.payload.product_id).toBe('prod-quick-1');
    expect(queuedPriceOnly.payload.retail_price).toBe(4.200);
    // Price-only edit MUST NOT carry any stock key!
    expect('stock_quantity' in queuedPriceOnly.payload).toBe(false);
    expect('stock_delta' in queuedPriceOnly.payload).toBe(false);
    expect(queuedPriceOnly.payload.stock_quantity).toBeUndefined();
    expect(queuedPriceOnly.payload.stock_delta).toBeUndefined();

    // 2. Now also modify stock from 15 to 25 (delta = +10)
    queueAddSpy.mockClear();
    const stockInput = screen.getByDisplayValue('15');
    fireEvent.change(stockInput, { target: { value: '25' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    });

    const queuedStockEdit = queueAddSpy.mock.calls[0][0];
    expect(queuedStockEdit.action_type).toBe('PRICE_STOCK_EDIT');
    expect(queuedStockEdit.payload.product_id).toBe('prod-quick-1');
    expect(queuedStockEdit.payload.retail_price).toBe(4.200);
    expect(queuedStockEdit.payload.stock_delta).toBe(10); // new (25) minus orig (15)

    // Optimistic Dexie update carries new absolute stock
    expect(prodUpdateSpy).toHaveBeenCalledWith('prod-quick-1', expect.objectContaining({
      retail_price: 4.200,
      stock_quantity: 25
    }));

    // Expect French offline queued message
    expect(screen.getByText(/Modifié hors ligne/i)).toBeDefined();
    unmount();
  });

  it('MobileRegister quick-edit shows error and does NOT queue on TypeError from code bug', async () => {
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);

    const mockProduct = {
      id: 'prod-quick-err',
      name: 'Produit Bug Test',
      barcode: '999888777',
      retail_price: 10.000,
      wholesale_price: 8.000,
      stock_quantity: 5,
      cost_price: 5.000,
      category: 'Test',
      family_id: 'fam-1',
      low_stock_threshold: 2
    };

    // Online, but fetch rejects with a programming bug TypeError (NOT a network error)
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'foo')")));

    render(
      <MobileRegister
        products={[mockProduct as any]}
        families={[]}
        customers={[]}
        containerTypes={[]}
        activeSession={null}
        onRefreshData={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Quick-Edit'));
    fireEvent.change(screen.getByPlaceholderText(/Scan barcode to edit.../i), { target: { value: '999888777' } });

    await waitFor(() => {
      expect(screen.getByText('Produit Bug Test')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Save & Update/i }));

    // Must show error message, and MUST NOT queue offline
    await waitFor(() => {
      expect(screen.getByText(/Cannot read properties of undefined/i)).toBeDefined();
    });
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('online quick-edit: sends stock_quantity ONLY when stock changed; price-only sends NO stock_quantity key', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', { onLine: true });

    const mockProduct = {
      id: 'prod-online-qe',
      name: 'Produit Test Online QE',
      barcode: '555666777',
      retail_price: 5.000,
      wholesale_price: 4.000,
      stock_quantity: 12,
      cost_price: 3.000,
      category: 'Test',
      family_id: 'fam-1',
      low_stock_threshold: 2
    };

    const { unmount } = render(
      <MobileRegister
        products={[mockProduct as any]}
        families={[]}
        customers={[]}
        containerTypes={[]}
        activeSession={null}
        onRefreshData={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Navigate to QUICK-EDIT
    fireEvent.click(screen.getByText('Quick-Edit'));
    fireEvent.change(screen.getByPlaceholderText(/Scan barcode to edit.../i), { target: { value: '555666777' } });

    await waitFor(() => {
      expect(screen.getByText('Produit Test Online QE')).toBeDefined();
    });

    // Test (a): Price-only edit (modify retail_price to 6.000, leave stock untouched at 12)
    const retailInput = screen.getByDisplayValue('5.000');
    fireEvent.change(retailInput, { target: { value: '6.000' } });

    const saveButton = screen.getByRole('button', { name: /Save & Update/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [firstUrl, firstOptions] = fetchSpy.mock.calls[0];
    expect(firstUrl).toBe('/api/products/prod-online-qe');
    expect(firstOptions.method).toBe('PUT');
    const firstBody = JSON.parse(firstOptions.body);
    expect(firstBody.retail_price).toBe(6.000);
    // (a) price-only online edit: the request body has no stock_quantity key
    expect('stock_quantity' in firstBody).toBe(false);
    expect(firstBody.stock_quantity).toBeUndefined();

    // Test (b): Stock actually changed online (modify stock from 12 to 18)
    fetchSpy.mockClear();
    const stockInput = screen.getByDisplayValue('12');
    fireEvent.change(stockInput, { target: { value: '18' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [secondUrl, secondOptions] = fetchSpy.mock.calls[0];
    expect(secondUrl).toBe('/api/products/prod-online-qe');
    const secondBody = JSON.parse(secondOptions.body);
    expect(secondBody.retail_price).toBe(6.000);
    // (b) stock actually changed online: body carries the new stock_quantity
    expect('stock_quantity' in secondBody).toBe(true);
    expect(secondBody.stock_quantity).toBe(18);

    unmount();
  });

  it('MobileRegister container transaction falls back to pending_sync_queue when offline', async () => {
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);

    const mockCustomer = {
      id: 'cust-1',
      name: 'Client Test',
      phone: '12345678',
      type: 'RETAIL' as const,
      total_debt: 0,
      wallet_balance: 0,
      reseller_discount_percent: 0,
      created_at: '2026-10-22'
    };

    const mockContainerType = {
      id: 'cont-1',
      name: 'Bidon 5L',
      deposit_price: 2.000,
      stock_quantity: 50
    };

    // Simulate offline
    vi.stubGlobal('navigator', { onLine: false });

    render(
      <MobileRegister
        products={[]}
        families={[]}
        customers={[mockCustomer]}
        containerTypes={[mockContainerType as any]}
        activeSession={null}
        onRefreshData={vi.fn()}
        onProcessSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
      />
    );

    // Go to Customers tab
    const customersNav = screen.getByText('Customers');
    fireEvent.click(customersNav);

    // Click Bidons button
    const contBtn = screen.getByRole('button', { name: /Bidons/i });
    fireEvent.click(contBtn);

    // Select container type and submit
    const contSelect = screen.getByRole('combobox');
    fireEvent.change(contSelect, { target: { value: 'cont-1' } });

    const submitBtn = screen.getByRole('button', { name: /Enregistrer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    });

    const queued = queueAddSpy.mock.calls[0][0];
    expect(queued.action_type).toBe('CONTAINER_TRANSACTION');
    expect(queued.payload.customer_id).toBe('cust-1');
    expect(queued.payload.container_type_id).toBe('cont-1');
    expect(queued.payload.action).toBe('GIVE');
    expect(queued.payload.quantity).toBe(1);
  });

  it('ContainerTransactionModal falls back to pending_sync_queue when offline', async () => {
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    const mockCustomer = {
      id: 'cust-1',
      name: 'Client Test'
    };

    const mockContainerType = {
      id: 'cont-1',
      name: 'Bidon 5L',
      deposit_price: 2.000
    };

    vi.stubGlobal('navigator', { onLine: false });

    render(
      <ContainerTransactionModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        customers={[mockCustomer as any]}
        containerTypes={[mockContainerType as any]}
        initialCustomerId="cust-1"
        initialContainerTypeId="cont-1"
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Valider le prêt/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    });

    const queued = queueAddSpy.mock.calls[0][0];
    expect(queued.action_type).toBe('CONTAINER_TRANSACTION');
    expect(queued.payload.customer_id).toBe('cust-1');
    expect(queued.payload.container_type_id).toBe('cont-1');
    expect(queued.payload.action).toBe('GIVE');
    expect(queued.payload.quantity).toBe(1);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ContainerTransactionModal queues offline when fetch throws network error (even if navigator.onLine is true)', async () => {
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    render(
      <ContainerTransactionModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        customers={[{ id: 'cust-1', name: 'Client Test' } as any]}
        containerTypes={[{ id: 'cont-1', name: 'Bidon 5L', deposit_price: 2.000 } as any]}
        initialCustomerId="cust-1"
        initialContainerTypeId="cont-1"
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Valider le prêt/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(queueAddSpy).toHaveBeenCalledTimes(1);
    });

    const queued = queueAddSpy.mock.calls[0][0];
    expect(queued.action_type).toBe('CONTAINER_TRANSACTION');
    expect(queued.payload.customer_id).toBe('cust-1');

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
