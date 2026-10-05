import { round3 } from './money.js';

export interface SalePaymentInput {
  total_ttc: number;
  subtotal: number;
  total_discount?: number | null;
  cash_paid?: number | null;
  cash_tendered?: number | null;
  wallet_paid?: number | null;
  credit_amount?: number | null;
}

export interface SalePaymentResult {
  ok: boolean;
  error?: string;
  cash_paid: number;
  cash_tendered: number;
  wallet_paid: number;
  credit_amount: number;
  change_given: number;
}

function toFiniteNumber(value: unknown, field: string): { ok: boolean; value: number; error?: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 0 };
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return { ok: false, value: 0, error: `${field} must be a finite number` };
  }
  return { ok: true, value: num };
}

/**
 * Shared payment validation for online sales and offline sync flush.
 * - All amounts must be finite and non-negative.
 * - cash_paid + wallet_paid + credit_amount must equal total_ttc.
 * - cash_tendered must cover cash_paid (defaults to cash_paid when absent = exact tender).
 * - change_given is always computed server-side as cash_tendered - cash_paid, never trusted.
 * - total_discount must be finite and between 0 and the subtotal.
 */
export function validateSalePayment(input: SalePaymentInput): SalePaymentResult {
  const fail = (error: string): SalePaymentResult => ({
    ok: false,
    error,
    cash_paid: 0,
    cash_tendered: 0,
    wallet_paid: 0,
    credit_amount: 0,
    change_given: 0
  });

  const totalRes = toFiniteNumber(input.total_ttc, 'total_ttc');
  if (!totalRes.ok) return fail(totalRes.error!);
  const subtotalRes = toFiniteNumber(input.subtotal, 'subtotal');
  if (!subtotalRes.ok) return fail(subtotalRes.error!);
  const discountRes = toFiniteNumber(input.total_discount ?? 0, 'total_discount');
  if (!discountRes.ok) return fail(discountRes.error!);
  const cashRes = toFiniteNumber(input.cash_paid ?? 0, 'cash_paid');
  if (!cashRes.ok) return fail(cashRes.error!);
  const walletRes = toFiniteNumber(input.wallet_paid ?? 0, 'wallet_paid');
  if (!walletRes.ok) return fail(walletRes.error!);
  const creditRes = toFiniteNumber(input.credit_amount ?? 0, 'credit_amount');
  if (!creditRes.ok) return fail(creditRes.error!);
  // Absent cash_tendered means exact tender (back-compat with exact-pay payloads).
  const tenderedRaw: unknown = input.cash_tendered;
  const tenderedRes = toFiniteNumber(
    tenderedRaw === undefined || tenderedRaw === null || tenderedRaw === ''
      ? cashRes.value
      : tenderedRaw,
    'cash_tendered'
  );
  if (!tenderedRes.ok) return fail(tenderedRes.error!);

  const total = round3(totalRes.value);
  const subtotal = round3(subtotalRes.value);
  const totalDiscount = round3(discountRes.value);
  const cashPaid = round3(cashRes.value);
  const walletPaid = round3(walletRes.value);
  const creditAmount = round3(creditRes.value);
  const cashTendered = round3(tenderedRes.value);

  for (const [name, amount] of [
    ['total_ttc', total],
    ['subtotal', subtotal],
    ['total_discount', totalDiscount],
    ['cash_paid', cashPaid],
    ['cash_tendered', cashTendered],
    ['wallet_paid', walletPaid],
    ['credit_amount', creditAmount]
  ] as const) {
    if (amount < 0) return fail(`${name} must be non-negative`);
  }

  if (totalDiscount > subtotal) {
    return fail(`total_discount (${totalDiscount} DT) cannot exceed subtotal (${subtotal} DT)`);
  }

  const paidSum = round3(cashPaid + walletPaid + creditAmount);
  if (Math.abs(paidSum - total) > 0.0005) {
    return fail(
      `Payment total (${paidSum} DT) does not equal sale total (${total} DT). Cash: ${cashPaid}, Wallet: ${walletPaid}, Credit: ${creditAmount}`
    );
  }

  if (cashTendered < cashPaid) {
    return fail(`cash_tendered (${cashTendered} DT) cannot be less than cash_paid (${cashPaid} DT)`);
  }

  return {
    ok: true,
    cash_paid: cashPaid,
    cash_tendered: cashTendered,
    wallet_paid: walletPaid,
    credit_amount: creditAmount,
    change_given: round3(cashTendered - cashPaid)
  };
}
