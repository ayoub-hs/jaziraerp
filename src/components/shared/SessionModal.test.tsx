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
      expect(screen.getByText('250.000 DT')).toBeTruthy();
    });

    const countedInput = screen.getByPlaceholderText('0.000');
    fireEvent.change(countedInput, { target: { value: '250.000' } });

    // Submit close form
    const submitBtn = screen.getByRole('button', { name: /Close Session/i });
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

    // Verify summary screen is shown with reprint button
    expect(screen.getByText(/Session de caisse clôturée avec succès/i)).toBeTruthy();
    expect(screen.getByText(/Imprimante thermique hors ligne/i)).toBeTruthy();

    const reprintBtn = screen.getByRole('button', { name: /Réimprimer Rapport Z/i });
    expect(reprintBtn).toBeTruthy();

    // Click reprint button
    fireEvent.click(reprintBtn);
    expect(printSpy).toHaveBeenCalledTimes(2);
  });
});
