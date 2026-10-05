import { describe, it, expect } from 'vitest';
import { validateSalePayment } from './payments.js';

describe('validateSalePayment (shared online + sync validation)', () => {
  it('accepts exact tender and computes zero change', () => {
    const r = validateSalePayment({ total_ttc: 30, subtotal: 30, cash_paid: 30, cash_tendered: 30 });
    expect(r.ok).toBe(true);
    expect(r.change_given).toBe(0);
  });

  it('accepts over-tender and computes change server-side', () => {
    const r = validateSalePayment({ total_ttc: 30, subtotal: 30, cash_paid: 30, cash_tendered: 50 });
    expect(r.ok).toBe(true);
    expect(r.change_given).toBe(20);
  });

  it('defaults absent cash_tendered to exact tender', () => {
    const r = validateSalePayment({ total_ttc: 10, subtotal: 10, cash_paid: 10 });
    expect(r.ok).toBe(true);
    expect(r.cash_tendered).toBe(10);
    expect(r.change_given).toBe(0);
  });

  it('rejects non-finite and negative amounts', () => {
    expect(validateSalePayment({ total_ttc: 10, subtotal: 10, cash_paid: NaN }).ok).toBe(false);
    expect(validateSalePayment({ total_ttc: 10, subtotal: 10, cash_paid: 11, wallet_paid: -1, cash_tendered: 11 }).ok).toBe(false);
  });

  it('rejects payment sum mismatch', () => {
    const r = validateSalePayment({ total_ttc: 30, subtotal: 30, cash_paid: 5, cash_tendered: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not equal/);
  });

  it('rejects cash_tendered below cash_paid', () => {
    const r = validateSalePayment({ total_ttc: 30, subtotal: 30, cash_paid: 30, cash_tendered: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cash_tendered/);
  });

  it('rejects total_discount outside 0..subtotal', () => {
    expect(validateSalePayment({ total_ttc: 0, subtotal: 10, total_discount: 50, cash_paid: 0 }).ok).toBe(false);
    expect(validateSalePayment({ total_ttc: 10, subtotal: 10, total_discount: -1, cash_paid: 10 }).ok).toBe(false);
  });
});
