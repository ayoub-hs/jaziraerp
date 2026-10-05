import { describe, it, expect } from 'vitest';
import { escapeCsvCell } from './csv.js';

describe('escapeCsvCell (formula-injection guard)', () => {
  it.each([['=1+1'], ['+123abc'], ['-5 apples'], ['@SUM(A1)']])(
    'prefixes %s with an apostrophe',
    (text: string) => {
      expect(escapeCsvCell(text)).toBe(`"'${text}"`);
    }
  );

  it('leaves normal text and numeric values untouched', () => {
    expect(escapeCsvCell('Detergent 10L')).toBe('"Detergent 10L"');
    expect(escapeCsvCell(12.5)).toBe('"12.5"');
    expect(escapeCsvCell(0)).toBe('"0"');
    expect(escapeCsvCell(-308)).toBe('"-308"');
  });

  it('leaves numeric-looking strings from ledger exports alone (no formula risk)', () => {
    // Negative cash-flow / adjustment amounts formatted as strings.
    for (const amount of ['-308.000', '-5', '+10', '1.500', '-0.250', '+0,750']) {
      expect(escapeCsvCell(amount)).toBe(`"${amount}"`);
    }
  });

  it('still guards non-numeric text starting with = + - @', () => {
    expect(escapeCsvCell('-5 apples')).toBe(`"'-5 apples"`);
    expect(escapeCsvCell('+cmd|run')).toBe(`"'+cmd|run"`);
  });

  it('still escapes double quotes', () => {
    expect(escapeCsvCell('Say "hi"')).toBe('"Say ""hi"""');
  });
});
