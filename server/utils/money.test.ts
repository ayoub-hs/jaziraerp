import { describe, it, expect } from 'vitest';
import {
  toMillimes,
  fromMillimes,
  round3,
  addMoney,
  subtractMoney,
  multiplyMoney,
  divideMoney,
  formatTND,
  calculateTaxBreakdown,
  calculateResellerPrice
} from './money.js';

describe('TND Money Utilities & 3-Decimal Precision', () => {
  it('converts to and from millimes accurately', () => {
    expect(toMillimes(12.5)).toBe(12500);
    expect(toMillimes(0.005)).toBe(5);
    expect(toMillimes(15.750)).toBe(15750);
    expect(fromMillimes(12500)).toBe(12.5);
    expect(fromMillimes(5)).toBe(0.005);
  });

  it('rounds to 3 decimal places without floating-point error', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    expect(round3(10.1234)).toBe(10.123);
    expect(round3(10.1236)).toBe(10.124);
  });

  it('adds and subtracts money amounts cleanly', () => {
    expect(addMoney(10.125, 5.375)).toBe(15.5);
    expect(subtractMoney(20.000, 7.250)).toBe(12.75);
  });

  it('multiplies and divides with correct rounding', () => {
    expect(multiplyMoney(2.500, 3)).toBe(7.5);
    expect(multiplyMoney(10.000, 0.3333)).toBe(3.333);
    expect(divideMoney(10.000, 3)).toBe(3.333);
  });

  it('formats amounts in TND / DT currency string', () => {
    expect(formatTND(12.5)).toBe('12.500 DT');
    expect(formatTND(0.05)).toBe('0.050 DT');
    expect(formatTND(100)).toBe('100.000 DT');
  });

  it('calculates 19% TVA breakdown with exact reconciliation', () => {
    const testTotals = [1.190, 10.000, 23.800, 119.000, 15.750, 48.500];

    for (const totalTTC of testTotals) {
      const breakdown = calculateTaxBreakdown(totalTTC, 0.19);
      expect(breakdown.totalTTC).toBe(round3(totalTTC));
      expect(breakdown.tvaRate).toBe(0.19);
      // Crucial test: HT + TVA must equal TTC exactly to the millime
      const reconciled = round3(breakdown.subtotalHT + breakdown.tvaAmount);
      expect(reconciled).toBe(round3(totalTTC));
    }

    // Specific test for 119.000 DT: HT should be 100.000 DT, TVA should be 19.000 DT
    const b119 = calculateTaxBreakdown(119.000, 0.19);
    expect(b119.subtotalHT).toBe(100.000);
    expect(b119.tvaAmount).toBe(19.000);
  });

  it('calculates reseller price from wholesale price and discount %', () => {
    // Wholesale = 10.000 DT, 10% discount -> 9.000 DT
    expect(calculateResellerPrice(10.000, 10)).toBe(9.000);
    // Wholesale = 25.500 DT, 15% discount -> 21.675 DT
    expect(calculateResellerPrice(25.500, 15)).toBe(21.675);
    // 0% discount
    expect(calculateResellerPrice(50.000, 0)).toBe(50.000);
  });
});
