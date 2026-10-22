// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionModal } from './SessionModal';
import * as zReportPrinter from '../../services/hardware/zReportPrinter';

describe('SessionModal Z-Report Thermal Slip', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/register/counters')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'c-1', name: 'Countertop' }])
        });
      }
      if (url.includes('/api/register/open-sessions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              id: 'ses-100',
              session_number: 'SES-20261010-0001',
              counter_name: 'Countertop',
              opened_at: '2026-10-10T08:00:00Z',
              opening_cash: 100,
              expected_cash: 250
            }
          ])
        });
      }
      if (url.includes('/api/register/sessions/ses-100')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'ses-100',
            session_number: 'SES-20261010-0001',
            counter_name: 'Countertop',
            opening_cash: 100,
            expected_cash: 250
          })
        });
      }
      if (url.includes('/api/register/close')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'ses-100',
            session_number: 'SES-20261010-0001',
            counter_name: 'Countertop',
            opened_at: '2026-10-10T08:00:00Z',
            closed_at: '2026-10-10T18:00:00Z',
            opening_cash: 100,
            expected_cash: 250,
            counted_cash: 250,
            difference: 0,
            status: 'CLOSED',
            notes: 'Reconciled',
            movements: [
              { type: 'CASH_IN', amount: 50, reason: 'Extra change' }
            ],
            audit_breakdown: {
              opening_cash: 100,
              cash_sales: 100,
              cash_refunds: 0,
              cash_in: 50,
              cash_out: 0,
              expected_cash: 250
            }
          })
        });
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });
  });

  it('auto-prints Z-report on session close and allows reprinting without throwing if printer fails', async () => {
    const printSpy = vi.spyOn(zReportPrinter, 'printZReportThermal').mockResolvedValue({
      success: false,
      error: 'Imprimante thermique hors ligne'
    });
    const onSessionUpdated = vi.fn();
    const onClose = vi.fn();

    render(
      <SessionModal
        isOpen={true}
        onClose={onClose}
        mode="CLOSE"
        activeSession={{
          id: 'ses-100',
          session_number: 'SES-20261010-0001',
          counter_name: 'Countertop',
          opened_at: '2026-10-10T08:00:00Z',
          opening_cash: 100,
          expected_cash: 250,
          status: 'OPEN'
        } as any}
        onSessionUpdated={onSessionUpdated}
      />
    );

    // Wait for session details to load
    await waitFor(() => {
      expect(screen.getByText('100.000 DT')).toBeTruthy();
    });

    const countedInput = screen.getByPlaceholderText('0.000') as HTMLInputElement;
    expect(countedInput.value).toBe(''); // Blind cash count: starts empty

    // In blind cash count mode, expected cash and variance are NOT shown before closing
    expect(screen.queryByText(/Espèces attendues en caisse/i)).toBeNull();
    expect(screen.queryByText(/Écart de caisse/i)).toBeNull();

    fireEvent.change(countedInput, { target: { value: '250.000' } });

    // Submit close form
    const submitBtn = screen.getByRole('button', { name: /Clôturer/i });
    fireEvent.click(submitBtn);

    // Verify session close called and updated callback fired
    await waitFor(() => {
      expect(onSessionUpdated).toHaveBeenCalledTimes(1);
    });

    // Verify auto-print was invoked with correct session data
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        session_number: 'SES-20261010-0001',
        expected_cash: 250,
        counted_cash: 250,
        difference: 0,
        movements: expect.arrayContaining([
          expect.objectContaining({ reason: 'Extra change' })
        ])
      })
    );

    // Verify summary screen is shown with reprint button and reveals expected cash
    expect(screen.getByText(/Session de caisse clôturée avec succès/i)).toBeTruthy();
    expect(screen.getByText(/Imprimante thermique hors ligne/i)).toBeTruthy();
    expect(screen.getByText(/Espèces attendues:/i)).toBeTruthy();

    const reprintBtn = screen.getByRole('button', { name: /Réimprimer Rapport Z/i });
    expect(reprintBtn).toBeTruthy();

    // Click reprint button
    fireEvent.click(reprintBtn);
    expect(printSpy).toHaveBeenCalledTimes(2);
  });

  it('renders initial opening float breakdown during session close view', async () => {
    render(
      <SessionModal
        isOpen={true}
        onClose={vi.fn()}
        mode="CLOSE"
        activeSession={{
          id: 'ses-100',
          session_number: 'SES-20261010-0001',
          counter_name: 'Countertop',
          opened_at: '2026-10-10T08:00:00Z',
          opening_cash: 100,
          expected_cash: 250,
          status: 'OPEN'
        } as any}
        onSessionUpdated={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Fond de caisse initial :')).toBeTruthy();
      expect(screen.getByText('100.000 DT')).toBeTruthy();
    });
  });

  it('F11: blocks closing when sync is pending unless "Clôturer quand même" is typed', async () => {
    const { syncManager } = await import('../../services/syncManager.js');
    vi.spyOn(syncManager, 'getPendingCount').mockResolvedValue(2);

    let sentClosePayload: any = null;
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string, init?: any) => {
      if (url.includes('/api/register/close')) {
        sentClosePayload = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: 'ses-100',
            session_number: 'SES-20261010-0001',
            counter_name: 'Countertop',
            opened_at: '2026-10-10T08:00:00Z',
            closed_at: '2026-10-10T18:00:00Z',
            opening_cash: 100,
            expected_cash: 250,
            counted_cash: 250,
            difference: 0,
            status: 'CLOSED',
            notes: sentClosePayload?.notes || '',
            movements: [],
            audit_breakdown: {
              opening_cash: 100,
              cash_sales: 150,
              cash_refunds: 0,
              cash_in: 0,
              cash_out: 0,
              expected_cash: 250
            }
          })
        });
      }
      return (originalFetch as any)(url, init);
    });

    render(
      <SessionModal
        isOpen={true}
        onClose={vi.fn()}
        mode="CLOSE"
        activeSession={{
          id: 'ses-100',
          session_number: 'SES-20261010-0001',
          counter_name: 'Countertop',
          opened_at: '2026-10-10T08:00:00Z',
          opening_cash: 100,
          expected_cash: 250,
          status: 'OPEN'
        } as any}
        onSessionUpdated={vi.fn()}
      />
    );

    // Wait for pending sync warning to be displayed
    await waitFor(() => {
      expect(screen.getByText(/Synchronisation en attente \(2 opération\(s\)\)/i)).toBeTruthy();
    });

    const submitBtn = screen.getByRole('button', { name: /Clôturer/i }) as HTMLButtonElement;
    // Enter counted cash
    const countedInput = screen.getByPlaceholderText('0.000');
    fireEvent.change(countedInput, { target: { value: '250.000' } });

    // Submit button MUST be disabled because sync is pending
    expect(submitBtn.disabled).toBe(true);

    // Override input exists
    const overrideInput = screen.getByPlaceholderText('Clôturer quand même');
    // Typing wrong string keeps submit disabled
    fireEvent.change(overrideInput, { target: { value: 'forcer' } });
    expect(submitBtn.disabled).toBe(true);

    // Typing exact override enables submit
    fireEvent.change(overrideInput, { target: { value: 'Clôturer quand même' } });
    expect(submitBtn.disabled).toBe(false);

    // Click submit
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(sentClosePayload).toBeTruthy();
    });

    // Verify notes recorded the override
    expect(sentClosePayload.notes).toContain('Clôturer quand même');
    expect(sentClosePayload.notes).toContain('Synchro en attente (2 op)');

    // Verify Z-report display shows warning of forced closure
    await waitFor(() => {
      expect(screen.getByText(/Clôture forcée avec synchronisation en attente/i)).toBeTruthy();
    });
  });
});
