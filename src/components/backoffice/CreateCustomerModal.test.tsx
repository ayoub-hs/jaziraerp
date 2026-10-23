// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateCustomerModal } from './CreateCustomerModal';
import type { Customer } from '../../types';

describe('CreateCustomerModal — Credit Limit Field (Phase 1a Step 5a)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockCustomerWithLimit: Customer = {
    id: 'cust-limit-1',
    name: 'Al Jazira Supermarché',
    phone: '+216 75 111 222',
    address: 'Houmt Souk',
    type: 'WHOLESALE',
    reseller_discount_percent: 0,
    wallet_balance: 0,
    credit_limit: 250.000
  };

  it('renders credit_limit input with 3 decimals step and loads existing value when editing', () => {
    render(
      <CreateCustomerModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        customerToEdit={mockCustomerWithLimit}
      />
    );

    const input = screen.getByLabelText(/plafond de crédit/i) as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.type).toBe('number');
    expect(input.step).toBe('0.001');
    expect(input.min).toBe('0');
    expect(input.value).toBe('250');
  });

  it('clears credit_limit to NULL when empty on PUT /api/customers/:id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockCustomerWithLimit, credit_limit: null })
    } as any);

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateCustomerModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        customerToEdit={mockCustomerWithLimit}
      />
    );

    const input = screen.getByLabelText(/plafond de crédit/i);
    // Clear the input
    fireEvent.change(input, { target: { value: '' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /enregistrer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/customers/cust-limit-1');
    expect(options?.method).toBe('PUT');

    const body = JSON.parse((options?.body as string) || '{}');
    expect(body.credit_limit).toBeNull();
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends parsed credit_limit with 3 decimals when updated via PUT /api/customers/:id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockCustomerWithLimit, credit_limit: 500.5 })
    } as any);

    render(
      <CreateCustomerModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        customerToEdit={mockCustomerWithLimit}
      />
    );

    const input = screen.getByLabelText(/plafond de crédit/i);
    fireEvent.change(input, { target: { value: '500.5' } });

    const submitBtn = screen.getByRole('button', { name: /enregistrer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1]?.body as string) || '{}');
    expect(body.credit_limit).toBe(500.5);
  });
});
