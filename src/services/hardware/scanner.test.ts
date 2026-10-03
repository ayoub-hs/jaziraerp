import { describe, it, expect, vi } from 'vitest';
import { KeyboardWedgeScanner } from './scanner.js';

describe('Keyboard Wedge Barcode Scanner Service', () => {
  it('detects rapid keystrokes terminating in Enter as a barcode scan', () => {
    const scanner = new KeyboardWedgeScanner(50);
    const mockCallback = vi.fn();
    scanner.onScan(mockCallback);

    // Simulate hardware scanner sending "619000100101" within 10ms per stroke
    const barcode = '619000100101';
    for (const char of barcode) {
      scanner.handleKeyDown({
        key: char,
        target: { tagName: 'BODY' } as unknown as HTMLElement,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);
    }

    // Terminating Enter
    scanner.handleKeyDown({
      key: 'Enter',
      target: { tagName: 'BODY' } as unknown as HTMLElement,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith('619000100101');
  });

  it('allows manual triggerScan programmatically (e.g. from Camera Scanner)', () => {
    const scanner = new KeyboardWedgeScanner();
    const mockCallback = vi.fn();
    scanner.onScan(mockCallback);

    scanner.triggerScan('619999888777');
    expect(mockCallback).toHaveBeenCalledWith('619999888777');
  });
});
