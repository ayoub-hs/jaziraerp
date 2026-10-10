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

  it('drops buffer and does NOT fire onScan if e.defaultPrevented is true on Enter (POS-01)', () => {
    const scanner = new KeyboardWedgeScanner(50);
    const mockCallback = vi.fn();
    scanner.onScan(mockCallback);

    // Simulate input with data-scanner-input where user/scanner types barcode
    const inputElement = {
      tagName: 'INPUT',
      hasAttribute: (attr: string) => attr === 'data-scanner-input'
    } as unknown as HTMLElement;

    const barcode = '619000100101';
    for (const char of barcode) {
      scanner.handleKeyDown({
        key: char,
        target: inputElement,
        defaultPrevented: false,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);
    }

    // Input's onKeyDown handles Enter and calls e.preventDefault()
    scanner.handleKeyDown({
      key: 'Enter',
      target: inputElement,
      defaultPrevented: true,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);

    // Scanner should NOT fire onScan because input already handled it
    expect(mockCallback).not.toHaveBeenCalled();

    // Next scan outside an input should fire normally without old buffer residue
    for (const char of '619999999999') {
      scanner.handleKeyDown({
        key: char,
        target: { tagName: 'BODY' } as unknown as HTMLElement,
        defaultPrevented: false,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);
    }
    scanner.handleKeyDown({
      key: 'Enter',
      target: { tagName: 'BODY' } as unknown as HTMLElement,
      defaultPrevented: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);

    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(mockCallback).toHaveBeenCalledWith('619999999999');
  });
});

