import { describe, it, expect } from 'vitest';
import { parseSizeToLiters, calculateContainersNeeded } from './container.js';

describe('Container Calculation Utilities', () => {
  describe('parseSizeToLiters', () => {
    it('parses standard liter sizes', () => {
      expect(parseSizeToLiters('10L')).toBe(10);
      expect(parseSizeToLiters('1L')).toBe(1);
      expect(parseSizeToLiters('1.5L')).toBe(1.5);
      expect(parseSizeToLiters('5l')).toBe(5);
      expect(parseSizeToLiters('20 Litres')).toBe(20);
      expect(parseSizeToLiters('Litre')).toBe(1);
    });

    it('parses milliliter sizes into fractional liters', () => {
      expect(parseSizeToLiters('500ml')).toBe(0.5);
      expect(parseSizeToLiters('750 ml')).toBe(0.75);
    });

    it('falls back to product name if size label is not specified or non-volume', () => {
      expect(parseSizeToLiters(null, 'Liquide Vaisselle Citron 10L')).toBe(10);
      expect(parseSizeToLiters('Piece', 'Javel 5L')).toBe(5);
      expect(parseSizeToLiters(null, 'Éponge Abrasive')).toBeNull();
    });
  });

  describe('calculateContainersNeeded', () => {
    it('calculates 1 container for 10L vaisselle in a 10L bidon (user scenario)', () => {
      // 10 Liters bought, container capacity is 10L -> 1 bidon
      const result = calculateContainersNeeded(10, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(1);
    });

    it('calculates 2 containers for 20L vaisselle in 10L bidons', () => {
      const result = calculateContainersNeeded(20, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(2);
    });

    it('calculates 1 container for qty between 10 and 20 (e.g. 15L in 10L bidons requires 1 bidon, not 2)', () => {
      const result = calculateContainersNeeded(15, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(1);
    });

    it('handles volume less than container capacity (5L in 10L bidon requires 0 bidons)', () => {
      const result = calculateContainersNeeded(5, 1, null, 10, 'Liquide Vaisselle');
      expect(result).toBe(0);
    });

    it('correctly handles pre-packaged sized products (e.g. 2 x 5L bottles with 5L bidon)', () => {
      const result = calculateContainersNeeded(2, 1, '5L', 5, 'Liquide Vaisselle 5L');
      expect(result).toBe(2);
    });

    it('correctly handles pre-packaged 10L bottle (1 x 10L bottle with 10L bidon)', () => {
      const result = calculateContainersNeeded(1, 1, '10L', 10, 'Liquide Vaisselle 10L');
      expect(result).toBe(1);
    });

    it('handles pack multipliers (1 pack of 12 x 1L bottles with 1L container)', () => {
      const result = calculateContainersNeeded(1, 12, '1L', 1, 'Sol Lavande 1L');
      expect(result).toBe(12);
    });

    it('returns 1 container per unit when container has no capacity limit', () => {
      const result = calculateContainersNeeded(4, 1, 'Piece', null, 'Caisse Resale');
      expect(result).toBe(4);
    });

    it('returns 0 when quantity is 0 or negative', () => {
      expect(calculateContainersNeeded(0, 1, '10L', 10)).toBe(0);
      expect(calculateContainersNeeded(-5, 1, '10L', 10)).toBe(0);
    });
  });
});
