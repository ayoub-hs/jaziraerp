import { describe, it, expect } from 'vitest';
import { escapeCsvCell } from './csv.js';

describe('escapeCsvCell (formula-injection guard)', () => {
  it.each([['=1+1'], ['+123'], ['-5'], ['@SUM(A1)']])(
    'prefixes %s with an apostrophe',
    (text: string) => {
      expect(escapeCsvCell(text)).toBe(`"'${text}"`);
    }
  );

  it('leaves normal text and numeric values untouched', () => {
    expect(escapeCsvCell('Detergent 10L')).toBe('"Detergent 10L"');
    expect(escapeCsvCell(12.5)).toBe('"12.5"');
    expect(escapeCsvCell(0)).toBe('"0"');
  });

  it('still escapes double quotes', () => {
    expect(escapeCsvCell('Say "hi"')).toBe('"Say ""hi"""');
  });
});
