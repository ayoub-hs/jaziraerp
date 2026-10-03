import { buildDrawerKickCommand, buildReceiptEscPos } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';

export interface UsbPrinterStatus {
  isSupported: boolean;
  isConnected: boolean;
  deviceName?: string;
  error?: string;
}

export class WebUsbPrinterService {
  private device: any = null; // USBDevice
  private outEndpoint: number | null = null;
  private statusListeners: Array<(status: UsbPrinterStatus) => void> = [];

  constructor() {
    if (typeof navigator !== 'undefined' && 'usb' in navigator) {
      (navigator as any).usb.addEventListener('disconnect', (event: any) => {
        if (this.device && event.device === this.device) {
          this.device = null;
          this.outEndpoint = null;
          this.notifyStatus();
        }
      });
    }
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  public getStatus(): UsbPrinterStatus {
    return {
      isSupported: this.isSupported(),
      isConnected: Boolean(this.device && this.outEndpoint !== null),
      deviceName: this.device ? this.device.productName || 'USB Thermal Printer' : undefined
    };
  }

  public subscribeStatus(fn: (status: UsbPrinterStatus) => void): () => void {
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
   * Prompts user to pair a USB receipt printer (USB Class 7 = Printer, or vendor-specific)
   */
  public async requestAndConnect(): Promise<boolean> {
    if (!this.isSupported()) {
      throw new Error('WebUSB API is not supported in this browser. Please use Chrome on Linux/Desktop.');
    }

    try {
      const usb = (navigator as any).usb;
      // Filter for USB class 7 (Printers) or allow common receipt printer vendor IDs (Epson, Xprinter, Star)
      const device = await usb.requestDevice({
        filters: [
          { classCode: 7 }, // Printer class
          { vendorId: 0x0483, productId: 0x5840 }, // H313 POS Thermal Printer (Kotlin Desktop VID:PID)
          { vendorId: 0x0483 }, // STMicroelectronics
          { vendorId: 0x04b8 }, // Epson
          { vendorId: 0x1fc9 }, // NXP / Xprinter
          { vendorId: 0x0fe6 }, // Zjiang / POS-58 / Rongta / Winpal
          { vendorId: 0x0416 }, // Winbond / Zhuhai
          { vendorId: 0x0471 }, // Philips / Xprinter
          { vendorId: 0x1a86 }, // QinHeng / CH340 / USB POS
          { vendorId: 0x6868 }, // Generic USB Thermal Printer
          { vendorId: 0x0519 }, // Star Micronics
          { vendorId: 0x1504 }, // Bixolon
          { vendorId: 0x1d90 }  // Citizen
        ]
      });

      await this.connectDevice(device);
      return true;
    } catch (err: any) {
      console.warn('[WebUSB] Connection error:', err);
      this.notifyStatus();
      throw err;
    }
  }

  private async connectDevice(device: any): Promise<void> {
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Find printer interface
    let targetInterface: any = null;
    let targetEndpoint: any = null;

    for (const iface of device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        // Look for bulk OUT endpoint
        for (const ep of alt.endpoints) {
          if (ep.direction === 'out' && ep.type === 'bulk') {
            targetInterface = iface;
            targetEndpoint = ep;
            break;
          }
        }
        if (targetEndpoint) break;
      }
      if (targetEndpoint) break;
    }

    if (!targetInterface || !targetEndpoint) {
      throw new Error('No bulk OUT endpoint found on selected USB printer.');
    }

    await device.claimInterface(targetInterface.interfaceNumber);
    this.device = device;
    this.outEndpoint = targetEndpoint.endpointNumber;
    this.notifyStatus();
    console.log(`[WebUSB] Connected to ${device.productName || 'USB Printer'} on endpoint ${this.outEndpoint}`);
  }

  /**
   * Transmits raw ESC/POS binary buffer to the connected USB printer.
   */
  public async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.device || this.outEndpoint === null) {
      throw new Error('USB Printer is not connected');
    }
    await this.device.transferOut(this.outEndpoint, data);
  }

  /**
   * Kicks open the cash drawer via direct USB ESC/POS pulse.
   */
  public async kickDrawer(): Promise<boolean> {
    if (!this.device || this.outEndpoint === null) {
      return false;
    }
    try {
      const kickCommand = buildDrawerKickCommand(0);
      await this.sendRaw(kickCommand);
      return true;
    } catch (err) {
      console.warn('[WebUSB] Failed to kick drawer:', err);
      return false;
    }
  }

  /**
   * Prints full 58mm thermal receipt directly to USB printer.
   */
  public async printReceipt(sale: SaleSummary): Promise<boolean> {
    if (!this.device || this.outEndpoint === null) {
      return false;
    }
    try {
      const receiptData = buildReceiptEscPos(sale);
      await this.sendRaw(receiptData);
      return true;
    } catch (err) {
      console.warn('[WebUSB] Failed to print receipt:', err);
      return false;
    }
  }
}

export const webUsbPrinter = new WebUsbPrinterService();
