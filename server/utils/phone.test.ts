import { describe, it, expect } from 'vitest';
import { normalizePhone } from './phone.js';
import { ValidationError } from './validation.js';

describe('normalizePhone utility', () => {
  it('accepts clean 8-digit Tunisian phone numbers', () => {
    expect(normalizePhone('98123456')).toBe('98123456');
    expect(normalizePhone('20112233')).toBe('20112233');
    expect(normalizePhone('55998877')).toBe('55998877');
    expect(normalizePhone('71234567')).toBe('71234567');
  });

  it('strips whitespace inside and around the number', () => {
    expect(normalizePhone(' 98 123 456 ')).toBe('98123456');
    expect(normalizePhone('20 11 22 33')).toBe('20112233');
    expect(normalizePhone('  55998877\t\n')).toBe('55998877');
  });

  it('strips leading +216 prefix', () => {
    expect(normalizePhone('+21698123456')).toBe('98123456');
    expect(normalizePhone('+216 98 123 456')).toBe('98123456');
    expect(normalizePhone(' +216 20 112 233 ')).toBe('20112233');
  });

  it('strips leading 00216 prefix', () => {
    expect(normalizePhone('0021698123456')).toBe('98123456');
    expect(normalizePhone('00216 98 123 456')).toBe('98123456');
    expect(normalizePhone(' 00216 55 998 877 ')).toBe('55998877');
  });

  it('rejects numbers with fewer than 8 digits with a French 400 error', () => {
    expect(() => normalizePhone('9812345')).toThrow(ValidationError);
    expect(() => normalizePhone('9812345')).toThrow(/8 chiffres/i);
  });

  it('rejects numbers with more than 8 digits with a French 400 error', () => {
    expect(() => normalizePhone('981234567')).toThrow(ValidationError);
    expect(() => normalizePhone('981234567')).toThrow(/8 chiffres/i);
    expect(() => normalizePhone('+216981234567')).toThrow(/8 chiffres/i);
  });

  it('rejects non-numeric characters', () => {
    expect(() => normalizePhone('9812345a')).toThrow(ValidationError);
    expect(() => normalizePhone('98-123-456')).toThrow(ValidationError);
    expect(() => normalizePhone('telephone')).toThrow(ValidationError);
  });

  it('rejects empty, null, or undefined inputs', () => {
    expect(() => normalizePhone('')).toThrow(ValidationError);
    expect(() => normalizePhone('   ')).toThrow(ValidationError);
    expect(() => normalizePhone(null as any)).toThrow(ValidationError);
    expect(() => normalizePhone(undefined as any)).toThrow(ValidationError);
  });

  it('rejects foreign country prefixes other than +216 / 00216', () => {
    expect(() => normalizePhone('+33612345678')).toThrow(ValidationError);
    expect(() => normalizePhone('0033612345678')).toThrow(ValidationError);
  });
});
