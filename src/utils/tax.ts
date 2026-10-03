import { roundMoney } from './formatters.js';

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
  const roundedTTC = roundMoney(totalTTC);
  const subtotalHT = roundMoney(roundedTTC / (1 + tvaRate));
  const tvaAmount = roundMoney(roundedTTC - subtotalHT);

  return {
    subtotalHT,
    tvaRate,
    tvaAmount,
    totalTTC: roundedTTC
  };
}
