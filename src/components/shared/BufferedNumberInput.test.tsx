// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BufferedNumberInput } from './BufferedNumberInput.js';

describe('BufferedNumberInput (Batch 2 Item A2)', () => {
  it('commits normal value within range', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={2} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('2');

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(5);
  });

  it('caps quantity at 9999 when exceeding max', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={1} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '15000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(9999);
    expect(input.value).toBe('9999');
  });

  it('ignores a keystroke burst that looks like a barcode (>=6 digits within ~100ms) and keeps previous quantity', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={3} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    input.focus();

    // Simulate 12-digit barcode burst arriving at 12ms per keystroke (total ~144ms, with first 6 digits in 72ms < 100ms)
    let simulatedTime = 1000;
    const barcode = '619000333001';
    let val = '';
    for (let i = 0; i < barcode.length; i++) {
      simulatedTime += 12;
      vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
      val += barcode[i];
      fireEvent.keyDown(input, { key: barcode[i] });
      fireEvent.change(input, { target: { value: val } });
    }

    simulatedTime += 12;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
    fireEvent.keyDown(input, { key: 'Enter' });

    // Must NOT commit the barcode digits
    expect(onCommit).not.toHaveBeenCalled();
    // Must keep previous quantity
    expect(input.value).toBe('3');
  });

  it('allows deliberate human typing where digits are spaced > 100ms apart', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={1} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    input.focus();

    // Type 6 digits with 150ms between each stroke
    let simulatedTime = 1000;
    const digits = '123456';
    let val = '';
    for (let i = 0; i < digits.length; i++) {
      simulatedTime += 150;
      vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
      val += digits[i];
      fireEvent.keyDown(input, { key: digits[i] });
      fireEvent.change(input, { target: { value: val } });
    }

    simulatedTime += 150;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
    fireEvent.keyDown(input, { key: 'Enter' });

    // Capped at 9999 since 123456 > 9999
    expect(onCommit).toHaveBeenCalledWith(9999);
  });
});
