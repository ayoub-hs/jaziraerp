import { registerPlugin, Capacitor } from '@capacitor/core';
import { buildDrawerKickCommand, buildReceiptEscPos } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';

interface ErpSppPrinterPlugin {
  listBonded(): Promise<{ devices: Array<{ name: string; address: string }> }>;
  connect(options: { address: string }): Promise<{ name: string; address: string }>;
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<{ connected: boolean; address?: string }>;
}

const ErpSppPrinter = registerPlugin<ErpSppPrinterPlugin>('ErpSppPrinter');

export interface SppPrinterStatus {
  isSupported: boolean;
  isConnected: boolean;
  deviceName?: string;
}

/**
 * Bluetooth Classic (SPP) printer service for bonded serial printers
 * (e.g. MPT-II, which bonds as SPP with no BLE GATT service).
 * Same shape as the WebBluetooth service so UI code stays symmetric.
 */
class NativeSppPrinterService {
  private statusListeners: Array<(status: SppPrinterStatus) => void> = [];
  private connectedName: string | null = null;

  private isNative(): boolean {
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }

  public isSupported(): boolean {
    return this.isNative();
  }

  public getStatus(): SppPrinterStatus {
    return {
      isSupported: this.isSupported(),
      isConnected: this.connectedName !== null,
      deviceName: this.connectedName || undefined
    };
  }

  public subscribeStatus(fn: (status: SppPrinterStatus) => void): () => void {
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

  private toBase64(data: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < data.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(data.subarray(i, i + CHUNK)) as any);
    }
    return btoa(binary);
  }

  /**
   * Connects to the bonded MPT-II (or first bonded device whose name
   * contains the hint). Throws a descriptive error on failure.
   */
  public async autoConnect(nameHint = 'MPT-II'): Promise<boolean> {
    if (!this.isNative()) {
      throw new Error('SPP printer is only available in the native app.');
    }
    const { devices } = await ErpSppPrinter.listBonded();
    if (!devices || devices.length === 0) {
      throw new Error('Aucune imprimante Bluetooth appairée. Appairez la MPT-II dans les réglages Android.');
    }
    const match =
      devices.find(d => (d.name || '').toUpperCase().includes(nameHint.toUpperCase())) || devices[0];
    const res = await ErpSppPrinter.connect({ address: match.address });
    this.connectedName = res.name || match.name || match.address;
    this.notifyStatus();
    return true;
  }

  public async disconnect(): Promise<void> {
    try {
      await ErpSppPrinter.disconnect();
    } catch {
      // already closed on the native side
    }
    this.connectedName = null;
    this.notifyStatus();
  }

  public async printReceipt(sale: SaleSummary): Promise<void> {
    if (!this.connectedName) {
      throw new Error('SPP printer is not connected');
    }
    const bytes = buildReceiptEscPos(sale);
    await ErpSppPrinter.write({ data: this.toBase64(bytes) });
  }

  public async kickDrawer(): Promise<boolean> {
    if (!this.connectedName) return false;
    try {
      await ErpSppPrinter.write({ data: this.toBase64(buildDrawerKickCommand(0)) });
      return true;
    } catch (err) {
      console.warn('[SPP] Drawer kick failed:', err);
      return false;
    }
  }
}

export const nativeSppPrinter = new NativeSppPrinterService();
