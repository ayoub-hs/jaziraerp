// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomerStatementModal } from './CustomerStatementModal';
import * as csvUtil from '../../utils/csv';
import type { Customer } from '../../types';

const mockCustomer: Customer = {
  id: 'cust-statement-1',
  name: 'Société Horizon Sud',
  phone: '+216 75 123 456',
  address: 'Houmt Souk, Djerba',
  type: 'RESELLER',
  reseller_discount_percent: 10,
  wallet_balance: 20.000,
  total_debt: 50.000
};

const mockStatementData = {
  customer_id: 'cust-statement-1',
  debt: {
    entries: [
      {
        id: 'tkt-1',
        entry_type: 'TICKET',
        reference: 'TKT-20261010-001',
        date: '2026-10-01T09:00:00Z',
        debit: 100.000,
        credit: 0,
        status: 'UNPAID',
        created_at: '2026-10-01T09:00:00Z',
        running_balance: 100.000
      },
      {
        id: 'pay-1',
        entry_type: 'PAYMENT',
        reference: 'Espèces → TKT-20261010-001',
        date: '2026-10-05T10:00:00Z',
        debit: 0,
        credit: 40.000,
        status: 'Applied to TKT-20261010-001',
        created_at: '2026-10-05T10:00:00Z',
        running_balance: 60.000
      },
      {
        id: 'ref-1',
        entry_type: 'REFUND_CREDIT',
        reference: 'Remboursement REF-001 → TKT-20261010-001',
        date: '2026-10-08T11:00:00Z',
        debit: 0,
        credit: 10.000,
        status: 'Réduction dette',
        created_at: '2026-10-08T11:00:00Z',
        running_balance: 50.000
      }
    ],
    final_balance: 50.000
  },
  wallet: {
    entries: [
      {
        id: 'w-1',
        entry_type: 'WALLET',
        reference: 'TOP_UP',
        date: '2026-10-02T10:00:00Z',
        credit: 30.000,
        debit: 0,
        status: 'Recharge initiale',
        created_at: '2026-10-02T10:00:00Z',
        running_balance: 30.000
      },
      {
        id: 'w-2',
        entry_type: 'WALLET',
        reference: 'SALE_PAYMENT',
        date: '2026-10-06T15:00:00Z',
        credit: 0,
        debit: 10.000,
        status: 'Paiement vente REC-009',
        created_at: '2026-10-06T15:00:00Z',
        running_balance: 20.000
      }
    ],
    final_balance: 20.000
  }
};

describe('CustomerStatementModal (Batch 2 Item B2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/customers/cust-statement-1/statement')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStatementData)
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('renders statement matching RES-01 ledger endpoint with correct debt and wallet totals', async () => {
    render(
      <CustomerStatementModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
      />
    );

    // Wait for statement to load
    await waitFor(() => {
      expect(screen.getAllByText('50.000 DT').length).toBeGreaterThan(0);
      expect(screen.getAllByText('20.000 DT').length).toBeGreaterThan(0);
    });

    // Customer info rendered
    expect(screen.getAllByText(/Société Horizon Sud/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+216 75 123 456/i).length).toBeGreaterThan(0);

    // Entries rendered
    expect(screen.getAllByText('TKT-20261010-001').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Remboursement REF-001/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('TOP_UP').length).toBeGreaterThan(0);
  });

  it('renders the exact financial figures returned by /api/customers/:id/statement in tables and summary cards', async () => {
    render(
      <CustomerStatementModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
      />
    );

    await waitFor(() => {
      // Summary cards exact figures
      expect(screen.getAllByText('50.000 DT').length).toBeGreaterThan(0); // Final debt
      expect(screen.getAllByText('20.000 DT').length).toBeGreaterThan(0); // Final wallet
      expect(screen.getAllByText('30.000 DT').length).toBeGreaterThan(0); // Net position: 50.000 - 20.000 = 30.000
    });

    // Debt table exact line items: debit 100.000, credits 40.000 and 10.000, running balances 100.000, 60.000, 50.000
    expect(screen.getAllByText('100.000 DT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('40.000 DT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10.000 DT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60.000 DT').length).toBeGreaterThan(0);

    // Wallet table line items: credit 30.000, debit 10.000, balances 30.000, 20.000
    expect(screen.getAllByText('Paiement vente REC-009').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recharge initiale').length).toBeGreaterThan(0);
  });

  it('triggers window.print() when "Imprimer / PDF" button is clicked', async () => {
    const originalPrint = window.print;
    const printSpy = vi.fn();
    window.print = printSpy;

    try {
      render(
        <CustomerStatementModal
          isOpen={true}
          onClose={vi.fn()}
          customer={mockCustomer}
        />
      );

      await waitFor(() => {
        expect(screen.getAllByText('50.000 DT').length).toBeGreaterThan(0);
      });

      const printBtn = screen.getByRole('button', { name: /Imprimer \/ PDF/i });
      fireEvent.click(printBtn);

      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.print = originalPrint;
    }
  });

  it('exports matching rows with running balance and proper types via CSV export', async () => {
    const csvSpy = vi.spyOn(csvUtil, 'exportToCsv').mockImplementation(() => {});

    render(
      <CustomerStatementModal
        isOpen={true}
        onClose={vi.fn()}
        customer={mockCustomer}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('50.000 DT').length).toBeGreaterThan(0);
    });

    const exportBtn = screen.getByRole('button', { name: /Exporter CSV/i });
    fireEvent.click(exportBtn);

    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, headers, rows] = csvSpy.mock.calls[0];

    expect(filename).toContain('releve_Societe_Horizon_Sud_');
    expect(headers).toEqual([
      'Registre',
      'Date',
      'Type',
      'Reference',
      'Debit (DT)',
      'Credit (DT)',
      'Solde Progressif (DT)',
      'Statut / Notes'
    ]);

    // Rows should contain both Debt entries (3) and Wallet entries (2) = 5 rows
    expect(rows).toHaveLength(5);

    // First row should be debt ticket
    const ticketRow = rows.find(r => r[3] === 'TKT-20261010-001');
    expect(ticketRow).toBeDefined();
    expect(ticketRow![0]).toBe('Dette');
    expect(ticketRow![2]).toBe('Billet de dette');
    expect(ticketRow![4]).toBe('100.000');
    expect(ticketRow![6]).toBe('100.000');

    // Refund credit row
    const refundRow = rows.find(r => String(r[3]).includes('REF-001'));
    expect(refundRow).toBeDefined();
    expect(refundRow![0]).toBe('Dette');
    expect(refundRow![2]).toBe('Réduction dette (Remboursement)');
    expect(refundRow![5]).toBe('10.000');
    expect(refundRow![6]).toBe('50.000');

    // Wallet rows
    const walletTopUp = rows.find(r => r[3] === 'TOP_UP');
    expect(walletTopUp).toBeDefined();
    expect(walletTopUp![0]).toBe('Portefeuille');
    expect(walletTopUp![5]).toBe('30.000');
    expect(walletTopUp![6]).toBe('30.000');
  });
});
