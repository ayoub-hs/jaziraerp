import { describe, it, expect } from 'vitest';
import { roundMoney, formatMoney, formatMoneyRaw } from './formatters.js';
import { calculateTaxBreakdown as clientCalculateTaxBreakdown } from './tax.js';
import { calculateTaxBreakdown as serverCalculateTaxBreakdown } from '../../server/utils/money.js';

describe('Frontend Currency & Tax Breakdown Utilities (Item 19)', () => {
  it('roundMoney preserves exact 3-decimal numbers without altering any value', () => {
    // Test known tricky decimal values and continuous millimes steps
    const sampleValues = [
      0.001, 0.005, 0.125, 0.250, 0.333, 0.500, 0.625, 0.750, 0.875, 1.005, 2.005, 10.125, 999.999
    ];
    for (const val of sampleValues) {
      expect(roundMoney(val)).toBe(val);
      expect(roundMoney(-val)).toBe(-val);
    }

    // Continuous verification across 20,000 exact millimes values (-10.000 to +10.000)
    for (let i = -10000; i <= 10000; i++) {
      const exact = i / 1000;
      expect(roundMoney(exact)).toBe(exact);
    }
  });

  it('formatMoney and formatMoneyRaw round amounts properly using roundMoney', () => {
    expect(formatMoney(1.005)).toBe('1.005 DT');
    expect(formatMoney(12.5)).toBe('12.500 DT');
    expect(formatMoneyRaw(1.005)).toBe('1.005');
    expect(formatMoneyRaw(12.5)).toBe('12.500');
    expect(formatMoney(null)).toBe('0.000 DT');
    expect(formatMoneyRaw(null)).toBe('0.000');
  });

  it('frontend calculateTaxBreakdown matches backend calculateTaxBreakdown across 1000 random amounts', () => {
    for (let i = 0; i < 1000; i++) {
      // Random TTC amount up to 10,000 DT with arbitrary float precision
      const randomTTC = Math.random() * 10000;
      const clientResult = clientCalculateTaxBreakdown(randomTTC, 0.19);
      const serverResult = serverCalculateTaxBreakdown(randomTTC, 0.19);

      expect(clientResult.totalTTC).toBe(serverResult.totalTTC);
      expect(clientResult.subtotalHT).toBe(serverResult.subtotalHT);
      expect(clientResult.tvaAmount).toBe(serverResult.tvaAmount);
      expect(clientResult.tvaRate).toBe(serverResult.tvaRate);

      // Verify HT + TVA === TTC
      expect(roundMoney(clientResult.subtotalHT + clientResult.tvaAmount)).toBe(clientResult.totalTTC);
    }
  });
});
