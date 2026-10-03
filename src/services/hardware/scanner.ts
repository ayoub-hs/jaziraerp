/**
 * Global Keyboard Wedge Barcode Scanner Listener.
 * Handheld USB & Bluetooth barcode scanners act as keyboard input devices,
 * typing characters very rapidly (< 50ms per key) and terminating with 'Enter'.
 */

export type BarcodeScanHandler = (barcode: string) => void;

export class KeyboardWedgeScanner {
  private buffer: string = '';
  private lastKeyTime: number = 0;
  private listeners: BarcodeScanHandler[] = [];
  private isListening: boolean = false;
  private maxIntervalMs: number = 60; // Max ms between keystrokes for hardware scanner
  private minBarcodeLength: number = 3;

  constructor(maxIntervalMs: number = 60) {
    this.maxIntervalMs = maxIntervalMs;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  public start(): void {
    if (this.isListening || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.handleKeyDown);
    this.isListening = true;
  }

  public stop(): void {
    if (!this.isListening || typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.handleKeyDown);
    this.isListening = false;
    this.buffer = '';
  }

  public onScan(callback: BarcodeScanHandler): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  public handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const isInput = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );

    // If focused on an input that isn't designated for barcode scanning, ignore manual typing
    if (isInput && !target.hasAttribute('data-scanner-input')) {
      return;
    }

    const now = Date.now();
    const diff = now - this.lastKeyTime;
    this.lastKeyTime = now;

    // If interval exceeded, reset buffer
    if (diff > this.maxIntervalMs && this.buffer.length > 0) {
      this.buffer = '';
    }

    if (e.key === 'Enter') {
      if (this.buffer.length >= this.minBarcodeLength) {
        const barcode = this.buffer.trim();
        this.buffer = '';
        this.notify(barcode);
        e.preventDefault();
      }
      this.buffer = '';
      return;
    }

    // Only append printable single characters
    if (e.key.length === 1) {
      this.buffer += e.key;
    }
  }

  /**
   * Directly simulate barcode scan (useful for camera scanner and testing)
   */
  public triggerScan(barcode: string): void {
    if (barcode && barcode.length >= this.minBarcodeLength) {
      this.notify(barcode.trim());
    }
  }

  private notify(barcode: string): void {
    for (const listener of this.listeners) {
      try {
        listener(barcode);
      } catch (err) {
        console.warn('[Scanner] Error in listener callback:', err);
      }
    }
  }
}

export const scannerService = new KeyboardWedgeScanner();
