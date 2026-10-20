// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RefundModal } from './RefundModal';

describe('RefundModal Component — F6 Field Names & Split-Payout UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockSale = {
    id: 'sale-test-123',
    receipt_number: 'REC-20261020-0001',
    date: '2026-10-20T10:00:00Z',
    customer_id: 'cust-1',
    customer_name: 'Client Fidèle',
    total_ttc: 50.000,
    cash_paid: 20.000,
    credit_amount: 30.000,
    status: 'COMPLETED',
    session_id: 'ses-1',
    items: [
      {
        id: 'si-1',
        description: 'Javel 5L',
        quantity: 5,
        unit_price: 10.000,
        line_total: 50.000,
        // Backend DB column name is quantity_refunded (Finding F6)
        quantity_refunded: 2
      }
    ]
  };

  const mockPriorRefunds = [
    {
      id: 'ref-1',
      refund_number: 'REF-20261020-0001',
      date: '2026-10-20T10:30:00Z',
      // Backend DB columns (Finding F6)
      total_refunded: 20.000,
      credit_reduced: 20.000,
      cash_refunded: 0,
      wallet_refunded: 0,
      refund_method: 'CREDIT_REDUCTION',
      reason: '2 bidons endommagés'
    }
  ];

  const mockPreview = {
    sale_id: 'sale-test-123',
    total_refunded: 10.000,
    items: [
      {
        sale_item_id: 'si-1',
        quantity_refunded: 1,
        amount_refunded: 10.000,
        stock_restored: 1
      }
    ],
    capacities: {
      open_debt: 10.000,
      max_cash: 20.000,
      max_wallet: 20.000,
      prior_refunded: 20.000,
      prior_cash: 0,
      prior_wallet: 0,
      prior_credit: 20.000
    },
    suggested_allocation: {
      credit_reduced: 10.000,
      cash_refunded: 0,
      wallet_refunded: 0
    }
  };

  it('correctly reads quantity_refunded and total_refunded (F6 fix)', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/register/open-sessions')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/sales/sale-test-123/refunds')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPriorRefunds) });
      }
      if (url.includes('/api/sales/sale-test-123/refund/preview')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPreview) });
      }
      if (url.includes('/api/sales/sale-test-123')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSale) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <RefundModal
        isOpen={true}
        onClose={() => {}}
        onRefundCompleted={() => {}}
        initialSaleId="sale-test-123"
      />
    );

    // 1. Prior refund shows total_refunded (20.000 DT) rather than 0.000 DT
    await waitFor(() => {
      expect(screen.getByText(/20\.000\s*DT/i)).toBeInTheDocument();
    });

    // 2. Select dropdown option shows correct remaining quantity (5 - 2 = 3 restant)
    const select = screen.getByRole('combobox');
    expect(select).toHaveTextContent(/Restant\s*:\s*3/i);
  });

  it('renders split-payout inputs and pre-fills suggested debt-first allocation', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/register/open-sessions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 'ses-1', session_number: 'SES-001', counter_name: 'Caisse 1' }
          ])
        });
      }
      if (url.includes('/api/sales/sale-test-123/refunds')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url.includes('/api/sales/sale-test-123/refund/preview')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPreview) });
      }
      if (url.includes('/api/sales/sale-test-123')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSale) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    render(
      <RefundModal
        isOpen={true}
        onClose={() => {}}
        onRefundCompleted={() => {}}
        initialSaleId="sale-test-123"
      />
    );

    // Should render split-payout section
    await waitFor(() => {
      expect(screen.getByLabelText(/Réduction de dette/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Espèces/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Portefeuille/i)).toBeInTheDocument();
    });

    // Inputs are pre-filled from preview suggested allocation
    const creditInput = screen.getByLabelText(/Réduction de dette/i) as HTMLInputElement;
    expect(Number(creditInput.value)).toBe(10);
  });
});
