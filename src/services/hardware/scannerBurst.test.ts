import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardWedgeScanner } from './scanner.js';
import fs from 'fs';
import path from 'path';

describe('Step 7: 20-Barcode Scan Burst Test & captureInput Evaluation', () => {
  let scanner: KeyboardWedgeScanner;

  const testBarcodes = [
    '6191234567890',
    '6199876543210',
    'ALJ-DET-1L',
    'ALJ-DET-5L',
    'ALJ-PLAST-BOTTLE',
    '5012345678900',
    '7312345678901',
    '8412345678902',
    '9312345678903',
    '012345678905',
    'SKU-CARTON-12P',
    'SKU-PACK-6X1.5L',
    'JAZIRA-BLEACH-3L',
    'JAZIRA-SOAP-500ML',
    '4006381333931',
    '8712345678901',
    '3012345678902',
    '7612345678903',
    '8001234567894',
    '2000000123456'
  ];

  beforeEach(() => {
    scanner = new KeyboardWedgeScanner(60);
  });

  it('scans all 20 barcodes with rapid keystroke bursts (<20ms) with zero dropped characters', () => {
    const receivedBarcodes: string[] = [];
    scanner.onScan(code => {
      receivedBarcodes.push(code);
    });

    let simulatedTime = 1000;

    testBarcodes.forEach((barcode, index) => {
      // 100ms pause between barcodes (inter-scan delay)
      simulatedTime += 100;

      for (let i = 0; i < barcode.length; i++) {
        // 12ms between keystrokes (typical USB/Bluetooth HID scanner burst)
        simulatedTime += 12;
        vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);

        scanner.handleKeyDown({
          key: barcode[i],
          target: null,
          preventDefault: vi.fn()
        } as unknown as KeyboardEvent);
      }

      // Enter key terminates barcode
      simulatedTime += 12;
      vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
      scanner.handleKeyDown({
        key: 'Enter',
        target: null,
        preventDefault: vi.fn()
      } as unknown as KeyboardEvent);
    });

    expect(receivedBarcodes.length).toBe(20);
    expect(receivedBarcodes).toEqual(testBarcodes);
  });

  it('resets buffer when keystroke interval exceeds 60ms threshold (manual human typing)', () => {
    const receivedBarcodes: string[] = [];
    scanner.onScan(code => receivedBarcodes.push(code));

    let simulatedTime = 1000;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);

    // Keystroke 1
    scanner.handleKeyDown({ key: '6', target: null, preventDefault: vi.fn() } as any);

    // 150ms pause (slow manual typing)
    simulatedTime += 150;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);

    // Keystroke 2: buffer resets because interval > 60ms
    scanner.handleKeyDown({ key: '1', target: null, preventDefault: vi.fn() } as any);

    // Enter
    simulatedTime += 10;
    vi.spyOn(Date, 'now').mockReturnValue(simulatedTime);
    scanner.handleKeyDown({ key: 'Enter', target: null, preventDefault: vi.fn() } as any);

    // Single character '1' is under minBarcodeLength (3), so no scan emitted
    expect(receivedBarcodes.length).toBe(0);
  });

  it('verifies capacitor.config.ts leaves captureInput at Capacitor default', () => {
    const configPath = path.resolve(__dirname, '../../../capacitor.config.ts');
    const content = fs.readFileSync(configPath, 'utf8');

    // captureInput should NOT be forcibly enabled/overridden
    expect(content).not.toContain('captureInput: true');
    expect(content).not.toContain('captureInput: false');
  });
});
