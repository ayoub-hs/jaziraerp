import { registerPlugin, Capacitor } from '@capacitor/core';
import { buildDrawerKickCommand, buildReceiptEscPos } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';

export interface ErpSppPrinterPlugin {
  listBonded(): Promise<{ devices: Array<{ name: string; address: string }> }>;
  connect(options: { address: string }): Promise<{ name: string; address: string }>;
  write(options: { data: string }): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<{ connected: boolean; address?: string }>;
  checkPermissions?(): Promise<{ bluetooth: string }>;
  requestPermissions?(options?: { permissions: string[] }): Promise<{ bluetooth: string }>;
}

export const ErpSppPrinter = registerPlugin<ErpSppPrinterPlugin>('ErpSppPrinter');

export interface SppPrinterStatus {
  isSupported: boolean;
  isConnected: boolean;
  deviceName?: string;
}

/**
 * Bluetooth Classic (SPP) printer service for bonded serial printers
 * (e.g. MPT-II, which bonds as SPP with no BLE GATT service).
 * Hardened with:
 * - Single in-flight reconnect
 * - 6s timeout on connect & write
 * - One automatic reconnect retry on write failure
 * - Serialized print job queue
 * - Actionable BLUETOOTH_CONNECT permission check
 */
export class NativeSppPrinterService {
  private statusListeners: Array<(status: SppPrinterStatus) => void> = [];
  private connectedName: string | null = null;
  private reconnectPromise: Promise<boolean> | null = null;
  private printQueue: Promise<void> = Promise.resolve();

  constructor(private plugin: ErpSppPrinterPlugin = ErpSppPrinter) {}

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

  public async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs = 6000,
    errorMsg = 'Délai d’attente dépassé (6s)'
  ): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err: any = new Error(errorMsg);
        err.code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Check and request Android 12+ BLUETOOTH_CONNECT permission.
   * Throws an actionable error message if denied.
   */
  public async ensureBluetoothPermission(): Promise<void> {
    if (!this.isNative()) return;
    try {
      if (typeof this.plugin.checkPermissions === 'function') {
        const perm = await this.plugin.checkPermissions();
        if (perm && perm.bluetooth !== 'granted') {
          const req = typeof this.plugin.requestPermissions === 'function'
            ? await this.plugin.requestPermissions({ permissions: ['bluetooth'] })
            : null;
          if (req && req.bluetooth !== 'granted') {
            const err: any = new Error(
              'Permission Bluetooth refusée. Veuillez autoriser les appareils à proximité dans les paramètres Android.'
            );
            err.code = 'PERMISSION_DENIED';
            throw err;
          }
        }
      }
    } catch (err: any) {
      if (err?.code === 'PERMISSION_DENIED') throw err;
      // Continue if permission API is unavailable on this platform version
    }
  }

  /**
   * Connects to the bonded MPT-II with single in-flight deduplication.
   */
  public async autoConnect(nameHint = 'MPT-II'): Promise<boolean> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }
    this.reconnectPromise = this.doConnect(nameHint).finally(() => {
      this.reconnectPromise = null;
    });
    return this.reconnectPromise;
  }

  private async doConnect(nameHint = 'MPT-II'): Promise<boolean> {
    if (!this.isNative()) {
      const err: any = new Error('SPP printer is only available in the native app.');
      err.code = 'NOT_NATIVE';
      throw err;
    }

    await this.ensureBluetoothPermission();

    const { devices } = await this.withTimeout(
      this.plugin.listBonded(),
      6000,
      'Délai de recherche Bluetooth dépassé (6s)'
    );

    if (!devices || devices.length === 0) {
      const err: any = new Error('Aucune imprimante Bluetooth appairée. Appairez la MPT-II dans les réglages Android.');
      err.code = 'NO_BONDED';
      throw err;
    }

    const match =
      devices.find(d => (d.name || '').toUpperCase().includes(nameHint.toUpperCase())) || devices[0];

    const res = await this.withTimeout(
      this.plugin.connect({ address: match.address }),
      6000,
      'Délai de connexion Bluetooth dépassé (6s)'
    );

    this.connectedName = res.name || match.name || match.address;
    this.notifyStatus();
    return true;
  }

  public async disconnect(): Promise<void> {
    try {
      await this.plugin.disconnect();
    } catch {
      // already closed on the native side
    }
    this.connectedName = null;
    this.notifyStatus();
  }

  /**
   * Serialized print queue execution. Calls are chained to prevent interleaving.
   * Single automatic retry on write failure with reconnect.
   */
  public printReceipt(sale: SaleSummary): Promise<void> {
    const job = async () => {
      await this.executePrintWithRetry(sale);
    };
    const next = this.printQueue.then(job, job);
    this.printQueue = next;
    return next;
  }

  private async executePrintWithRetry(sale: SaleSummary): Promise<void> {
    const bytes = buildReceiptEscPos(sale);
    const data = this.toBase64(bytes);

    if (!this.connectedName) {
      await this.autoConnect();
    }

    try {
      await this.withTimeout(
        this.plugin.write({ data }),
        6000,
        'Délai d’impression Bluetooth dépassé (6s)'
      );
    } catch (firstErr) {
      console.warn('[SPP] Print attempt 1 failed; reconnecting and retrying once...', firstErr);
      await this.disconnect();
      await this.autoConnect();
      await this.withTimeout(
        this.plugin.write({ data }),
        6000,
        'Délai d’impression Bluetooth dépassé (6s)'
      );
    }
  }

  public async kickDrawer(): Promise<boolean> {
    if (!this.isNative()) return false;
    try {
      if (!this.connectedName) {
        await this.autoConnect();
      }
      await this.withTimeout(
        this.plugin.write({ data: this.toBase64(buildDrawerKickCommand(0)) }),
        6000,
        'Délai d’ouverture tiroir dépassé (6s)'
      );
      return true;
    } catch (err) {
      console.warn('[SPP] Drawer kick failed:', err);
      return false;
    }
  }
}

export const nativeSppPrinter = new NativeSppPrinterService();
