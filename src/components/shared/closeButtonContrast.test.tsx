// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { UpdateBanner } from './UpdateBanner.js';
import { SessionModal } from './SessionModal.js';
import { InvoicePrintModal } from './InvoicePrintModal.js';
import { ReceiptPrintModal } from './ReceiptPrintModal.js';
import { DeliveryNotePrintModal } from './DeliveryNotePrintModal.js';
import { CheckoutModal } from './CheckoutModal.js';
import { ConfirmDeleteModal } from '../backoffice/ConfirmDeleteModal.js';
import { CreateCustomerModal } from '../backoffice/CreateCustomerModal.js';
import { CashMovementModal } from './CashMovementModal.js';
import { HeldCartsModal } from './HeldCartsModal.js';
import { QuickPriceLookupModal } from './QuickPriceLookupModal.js';
import { RefundModal } from './RefundModal.js';
import { CreateProductModal } from '../backoffice/CreateProductModal.js';

describe('F17: Close button touch target >= 44px and contrast >= 4.5:1', () => {
  it('UpdateBanner dismiss button enforces >= 44px and text-slate-950 contrast', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ version: '2.0.0', build_id: 'build-different' })
    } as Response);

    render(<UpdateBanner />);

    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('text-slate-950');
    expect(alert.className).toContain('bg-amber-500');

    const dismissBtn = screen.getByRole('button', { name: /Ignorer/i });
    expect(dismissBtn.className).toContain('min-w-[44px]');
    expect(dismissBtn.className).toContain('min-h-[44px]');
    // Must NOT be shrunk on sm screens
    expect(dismissBtn.className).not.toContain('sm:min-w-0');
    expect(dismissBtn.className).not.toContain('sm:min-h-0');
  });

  it('SessionModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <SessionModal
        isOpen={true}
        onClose={vi.fn()}
        mode="OPEN"
        activeSession={null}
        onSessionUpdated={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('InvoicePrintModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <InvoicePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-1"
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('ReceiptPrintModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <ReceiptPrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-1"
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('DeliveryNotePrintModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <DeliveryNotePrintModal
        isOpen={true}
        onClose={vi.fn()}
        saleId="sale-1"
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('CheckoutModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={vi.fn()}
        items={[]}
        customer={null}
        onCompleteSale={vi.fn()}
        onPrintReceipt={vi.fn()}
        onPrintInvoice={vi.fn()}
        onPrintDeliveryNote={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
  });

  it('ConfirmDeleteModal close button has min-w-[44px] and min-h-[44px] and text-slate-600 contrast on white', () => {
    render(
      <ConfirmDeleteModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Supprimer article"
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-600');
    expect(closeBtn.className).not.toContain('text-slate-400');
  });

  it('CreateCustomerModal close button has min-w-[44px] and min-h-[44px] and text-slate-600 contrast on white', () => {
    render(
      <CreateCustomerModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-600');
    expect(closeBtn.className).not.toContain('text-slate-400');
  });

  it('CashMovementModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <CashMovementModal
        isOpen={true}
        onClose={vi.fn()}
        activeSession={{ id: 's1', opened_at: '2026-10-22', opening_cash: 100 } as any}
        onSuccess={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-300');
  });

  it('HeldCartsModal close button has min-w-[44px] and min-h-[44px]', () => {
    render(
      <HeldCartsModal
        isOpen={true}
        onClose={vi.fn()}
        products={[]}
        currentCartItems={[]}
        currentCustomer={null}
        currentSaleDiscount={0}
        onResumeCart={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-300');
  });

  it('QuickPriceLookupModal close button has min-w-[44px], min-h-[44px] and text-slate-300', () => {
    render(
      <QuickPriceLookupModal
        isOpen={true}
        onClose={vi.fn()}
        products={[]}
        customer={null}
        onAddToCart={vi.fn()}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-300');
    expect(closeBtn.className).not.toContain('text-slate-400');
  });

  it('RefundModal close button has min-w-[44px], min-h-[44px] and text-slate-300', () => {
    render(
      <RefundModal
        isOpen={true}
        onClose={vi.fn()}
        onRefundCompleted={vi.fn()}
        activeSessionId="s1"
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-300');
    expect(closeBtn.className).not.toContain('text-slate-400');
  });

  it('CreateProductModal close button has min-w-[44px], min-h-[44px] and text-slate-600', () => {
    render(
      <CreateProductModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        families={[]}
        formulations={[]}
        containerTypes={[]}
      />
    );

    const closeBtn = screen.getByLabelText('Fermer');
    expect(closeBtn.className).toContain('min-w-[44px]');
    expect(closeBtn.className).toContain('min-h-[44px]');
    expect(closeBtn.className).toContain('text-slate-600');
    expect(closeBtn.className).not.toContain('text-slate-400');
  });
});
