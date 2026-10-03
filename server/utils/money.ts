// ==========================================================
// TND (Tunisian Dinar) Financial Math & 19% TVA Utilities
// Precision: 3 decimal places (millimes)
// ==========================================================

export function toMillimes(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 1000);
}

export function fromMillimes(millimes: number): number {
  return millimes / 1000;
}

export function round3(amount: number): number {
  return fromMillimes(toMillimes(amount));
}

export function addMoney(a: number, b: number): number {
  return fromMillimes(toMillimes(a) + toMillimes(b));
}

export function subtractMoney(a: number, b: number): number {
  return fromMillimes(toMillimes(a) - toMillimes(b));
}

export function multiplyMoney(amount: number, factor: number): number {
  return fromMillimes(Math.round(toMillimes(amount) * factor));
}

export function divideMoney(amount: number, divisor: number): number {
  if (divisor === 0) throw new Error('Division by zero');
  return fromMillimes(Math.round(toMillimes(amount) / divisor));
}

export function formatTND(amount: number): string {
  return `${round3(amount).toFixed(3)} DT`;
}

export interface TaxBreakdown {
  subtotalHT: number;
  tvaRate: number;
  tvaAmount: number;
  totalTTC: number;
}

/**
 * Calculates 19% TVA breakdown from a Tax-Inclusive (TTC) amount.
 * Guaranteed: subtotalHT + tvaAmount === totalTTC to 3 decimal places.
 */
export function calculateTaxBreakdown(totalTTC: number, tvaRate: number = 0.19): TaxBreakdown {
  const roundedTTC = round3(totalTTC);
  const subtotalHT = round3(roundedTTC / (1 + tvaRate));
  const tvaAmount = round3(roundedTTC - subtotalHT);

  return {
    subtotalHT,
    tvaRate,
    tvaAmount,
    totalTTC: roundedTTC
  };
}

/**
 * Calculates reseller unit price from wholesale price and reseller discount %.
 */
export function calculateResellerPrice(wholesalePrice: number, discountPercent: number): number {
  const discountFactor = Math.max(0, 1 - discountPercent / 100);
  return round3(wholesalePrice * discountFactor);
}
