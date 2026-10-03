/**
 * Web Serial Cash Drawer Hardware Service
 * Supports USB-to-Serial cash drawers (Prolific PL2303, CH340, FTDI, BT-100U trigger adapters).
 * Provides dual-mode operation:
 *  1. Browser-direct Web Serial API (navigator.serial)
 *  2. Server-side Linux serial port trigger (/api/hardware/drawer/kick)
 */

export interface SerialDrawerStatus {
  isSupported: boolean;
  isConnected: boolean;
  portName?: string;
}

export class WebSerialDrawerService {
  private port: any = null; // SerialPort
  private statusListeners: Array<(status: SerialDrawerStatus) => void> = [];

  constructor() {
    if (typeof navigator !== 'undefined' && 'serial' in navigator) {
      (navigator as any).serial.addEventListener('disconnect', (event: any) => {
        if (this.port && event.port === this.port) {
          this.port = null;
          this.notifyStatus();
        }
      });
    }
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  public getStatus(): SerialDrawerStatus {
    return {
      isSupported: this.isSupported(),
      isConnected: Boolean(this.port),
      portName: this.port ? 'USB Serial Cash Drawer' : undefined
    };
  }

  public subscribeStatus(fn: (status: SerialDrawerStatus) => void): () => void {
    this.statusListeners.push(fn);
    fn(this.getStatus());
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== fn);
    };
  }

  private notifyStatus() {
    const status = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  /**
   * Prompts user in Chrome to connect to USB-to-Serial adapter (e.g. Prolific PL2303 /dev/ttyUSB0)
   */
  public async requestAndConnect(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser. Please use Google Chrome on desktop.');
    }

    try {
      const port = await (navigator as any).serial.requestPort({
        filters: [
          { usbVendorId: 0x067b }, // Prolific Technology (PL2303)
          { usbVendorId: 0x1a86 }, // QinHeng Electronics (CH340)
          { usbVendorId: 0x0403 }, // FTDI
          { usbVendorId: 0x10c4 }  // Silicon Labs CP210x
        ]
      }).catch(async () => {
        // Fallback without filters if specific vendor filter misses
        return await (navigator as any).serial.requestPort();
      });

      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
      this.port = port;
      this.notifyStatus();
      console.log('[WebSerial] Connected to USB Serial Drawer');
      return true;
    } catch (err: any) {
      console.warn('[WebSerial] Connection failed:', err);
      this.notifyStatus();
      throw err;
    }
  }

  /**
   * Kicks the cash drawer solenoid.
   * Sends both ESC/POS pulse (1B 70 00 19 FA) and standalone USB trigger pulse (01 07 00).
   * Also triggers the server-side endpoint for direct /dev/ttyUSB0 hardware access.
   */
  public async kickDrawer(): Promise<boolean> {
    let triggered = false;

    // 1. If Web Serial port is open in browser, write directly
    if (this.port && this.port.writable) {
      try {
        const pulse = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x01, 0x07, 0x00]);
        const writer = this.port.writable.getWriter();
        await writer.write(pulse);
        writer.releaseLock();
        triggered = true;
        console.log('[WebSerial] Solenoid pulse sent directly via browser Web Serial.');
      } catch (err) {
        console.warn('[WebSerial] Direct write failed, falling back to server route:', err);
      }
    }

    // 2. Trigger server-side endpoint (/api/hardware/drawer/kick)
    try {
      const res = await fetch('/api/hardware/drawer/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        console.log('[Hardware] Server-side drawer kick successful:', data);
        triggered = true;
      }
    } catch (err) {
      console.warn('[Hardware] Server-side drawer kick route error:', err);
    }

    return triggered;
  }
}

export const webSerialDrawer = new WebSerialDrawerService();
