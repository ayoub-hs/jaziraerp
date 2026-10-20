import { describe, it, expect } from 'vitest';
import {
  requireFinitePositive,
  requireFiniteNonNegative,
  requireOptionalFinitePositive,
  requireOptionalFiniteNonNegative,
  ValidationError
} from './validation.js';

describe('Tightened validation helpers', () => {
  describe('requireFinitePositive', () => {
    it('accepts real finite positive numbers', () => {
      expect(requireFinitePositive(10, 'qty')).toBe(10);
      expect(requireFinitePositive(0.001, 'qty')).toBe(0.001);
    });

    it('accepts valid plain decimal strings with optional sign and surrounding whitespace', () => {
      expect(requireFinitePositive('10', 'qty')).toBe(10);
      expect(requireFinitePositive('  25.500  ', 'qty')).toBe(25.5);
      expect(requireFinitePositive('+3.14', 'qty')).toBe(3.14);
    });

    it('rejects zero and negative numbers', () => {
      expect(() => requireFinitePositive(0, 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive(-5, 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive('-0.5', 'qty')).toThrow(ValidationError);
    });

    it('rejects booleans', () => {
      expect(() => requireFinitePositive(true, 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive(false, 'qty')).toThrow(ValidationError);
    });

    it('rejects arrays and objects', () => {
      expect(() => requireFinitePositive([10], 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive([], 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive({ amount: 10 } as any, 'qty')).toThrow(ValidationError);
    });

    it('rejects hex and exponent forms', () => {
      expect(() => requireFinitePositive('0x10', 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive('1e5', 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive('2.5e-3', 'qty')).toThrow(ValidationError);
    });

    it('rejects whitespace-only strings and empty strings', () => {
      expect(() => requireFinitePositive('   ', 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive('', 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive('\t\n', 'qty')).toThrow(ValidationError);
    });

    it('rejects NaN and Infinities', () => {
      expect(() => requireFinitePositive(NaN, 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive(Infinity, 'qty')).toThrow(ValidationError);
      expect(() => requireFinitePositive(-Infinity, 'qty')).toThrow(ValidationError);
    });
  });

  describe('requireFiniteNonNegative', () => {
    it('accepts zero and positive numbers and strings', () => {
      expect(requireFiniteNonNegative(0, 'price')).toBe(0);
      expect(requireFiniteNonNegative('0', 'price')).toBe(0);
      expect(requireFiniteNonNegative(' 0.000 ', 'price')).toBe(0);
      expect(requireFiniteNonNegative(15.5, 'price')).toBe(15.5);
    });

    it('supports defaultValue when value is undefined, null, or empty string', () => {
      expect(requireFiniteNonNegative(undefined, 'price', 10)).toBe(10);
      expect(requireFiniteNonNegative(null, 'price', 5)).toBe(5);
      expect(requireFiniteNonNegative('', 'price', 0)).toBe(0);
      expect(requireFiniteNonNegative('   ', 'price', 0)).toBe(0);
    });

    it('rejects negative numbers and strings', () => {
      expect(() => requireFiniteNonNegative(-1, 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative('-0.001', 'price')).toThrow(ValidationError);
    });

    it('rejects booleans, arrays, hex, exponents, and invalid strings', () => {
      expect(() => requireFiniteNonNegative(true, 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative(false, 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative([0], 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative('0x0', 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative('1e2', 'price')).toThrow(ValidationError);
      expect(() => requireFiniteNonNegative('abc', 'price')).toThrow(ValidationError);
    });
  });

  describe('requireOptionalFinitePositive & requireOptionalFiniteNonNegative', () => {
    it('returns undefined for empty/null/undefined', () => {
      expect(requireOptionalFinitePositive(undefined, 'opt')).toBeUndefined();
      expect(requireOptionalFinitePositive(null, 'opt')).toBeUndefined();
      expect(requireOptionalFinitePositive('', 'opt')).toBeUndefined();
      expect(requireOptionalFinitePositive('   ', 'opt')).toBeUndefined();

      expect(requireOptionalFiniteNonNegative(undefined, 'opt')).toBeUndefined();
      expect(requireOptionalFiniteNonNegative(null, 'opt')).toBeUndefined();
      expect(requireOptionalFiniteNonNegative('', 'opt')).toBeUndefined();
      expect(requireOptionalFiniteNonNegative('   ', 'opt')).toBeUndefined();
    });

    it('enforces tightened rules when value is provided', () => {
      expect(() => requireOptionalFinitePositive(true, 'opt')).toThrow(ValidationError);
      expect(() => requireOptionalFinitePositive('0x10', 'opt')).toThrow(ValidationError);
      expect(() => requireOptionalFinitePositive('1e5', 'opt')).toThrow(ValidationError);
      expect(() => requireOptionalFiniteNonNegative(false, 'opt')).toThrow(ValidationError);
      expect(() => requireOptionalFiniteNonNegative('0x10', 'opt')).toThrow(ValidationError);
      expect(() => requireOptionalFiniteNonNegative('1e5', 'opt')).toThrow(ValidationError);
    });
  });
});
