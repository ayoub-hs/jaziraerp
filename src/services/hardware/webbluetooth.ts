import { buildDrawerKickCommand, buildReceiptEscPos } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';
import { Capacitor } from '@capacitor/core';
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';

export interface BluetoothPrinterStatus {
  isSupported: boolean;
  isConnected: boolean;
  deviceName?: string;
}

export class WebBluetoothPrinterService {
  private device: any = null; // BluetoothDevice
  private characteristic: any = null; // BluetoothRemoteGATTCharacteristic
  private statusListeners: Array<(status: BluetoothPrinterStatus) => void> = [];

  public isSupported(): boolean {
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) return true;
    // Native shell (no WebView WebBluetooth): pairable via the Capgo BLE shim.
    try {
      return Capacitor.isNativePlatform();
    } catch {
      return false;
    }
  }

  /**
   * Installs the native BLE shim when navigator.bluetooth is missing
   * (Capacitor WebView). No-op on web. Idempotent. Throws a descriptive
   * error when the shim cannot be installed instead of failing later on
   * `undefined.requestDevice`.
   */
  public async ensureShim(): Promise<void> {
    if (typeof navigator !== 'undefined' && typeof (navigator as any).bluetooth?.requestDevice === 'function') return;
    let native = false;
    let platform = 'web';
    try {
      native = Capacitor.isNativePlatform();
      platform = Capacitor.getPlatform();
    } catch {
      native = false;
    }
    if (!native) return;
    let installError = '';
    try {
      BluetoothLowEnergy.shimWebBluetooth();
    } catch (err: any) {
      installError = err?.message || String(err);
    }
    if (typeof (navigator as any).bluetooth?.requestDevice !== 'function') {
      let pluginVisible = false;
      try {
        pluginVisible = Capacitor.isPluginAvailable('BluetoothLowEnergy');
      } catch {
        pluginVisible = false;
      }
      // Ground-truth snapshot: tells exactly why the facade is missing.
      const btVal = (navigator as any).bluetooth;
      const btType =
        btVal === undefined || btVal === null
          ? String(btVal)
          : typeof btVal + (btVal?.constructor?.name ? `:${btVal.constructor.name}` : '');
      let btKeys = '';
      try {
        if (btVal && (typeof btVal === 'object' || typeof btVal === 'function')) {
          btKeys = Object.getOwnPropertyNames(btVal).slice(0, 8).join(',');
        }
      } catch {
        btKeys = '';
      }
      const shimFlag = (window as any).__capgoBluetoothLowEnergyShimInstalled === true;
      throw new Error(
        `Bluetooth natif indisponible (plateforme: ${platform}, plugin BLE visible: ${pluginVisible ? 'oui' : 'non'}, ` +
          `navigator.bluetooth: ${btType}${btKeys ? ` [${btKeys}]` : ''}, shim installé: ${shimFlag ? 'oui' : 'non'}` +
          `${installError ? `, erreur install: ${installError}` : ''}). ` +
          `Réinstallez l'APK la plus récente ou utilisez Chrome Android.`
      );
    }
    this.notifyStatus();
  }

  public getStatus(): BluetoothPrinterStatus {
    return {
      isSupported: this.isSupported(),
      isConnected: Boolean(this.device && this.characteristic),
      deviceName: this.device ? this.device.name || 'Bluetooth Receipt Printer' : undefined
    };
  }

  public subscribeStatus(fn: (status: BluetoothPrinterStatus) => void): () => void {
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
   * Prompts user to pair with a Bluetooth thermal printer
   */
  public async requestAndConnect(): Promise<boolean> {
    await this.ensureShim();
    if (!this.isSupported()) {
      throw new Error('WebBluetooth API is not supported in this browser. Please use Chrome on Android.');
    }

    try {
      const bluetooth = (navigator as any).bluetooth;
      if (typeof bluetooth?.requestDevice !== 'function') {
        throw new Error('Bluetooth indisponible sur cet appareil. Réinstallez l\'APK la plus récente ou utilisez Chrome Android.');
      }

      // Common BLE thermal printer service UUIDs
      const serviceUUIDs = [
        '000018f0-0000-1000-8000-00805f9b34fb', // Standard Printer
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Pos-58 / Rongta / Xprinter
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent Serial
        0xffe0, // Generic BLE Serial
        0x18f0
      ];

      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: serviceUUIDs
      });

      device.addEventListener('gattserverdisconnected', () => {
        this.characteristic = null;
        this.device = null;
        this.notifyStatus();
      });

      const server = await device.gatt.connect();

      // Find writable characteristic
      let writeChar: any = null;
      for (const uuid of serviceUUIDs) {
        try {
          const service = await server.getPrimaryService(uuid);
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writeChar = char;
              break;
            }
          }
          if (writeChar) break;
        } catch {
          // Continue to next service UUID
        }
      }

      if (!writeChar) {
        throw new Error('No writable ESC/POS characteristic found on paired Bluetooth printer.');
      }

      this.device = device;
      this.characteristic = writeChar;
      this.notifyStatus();
      console.log(`[WebBluetooth] Connected to ${device.name || 'Bluetooth Printer'}`);
      return true;
    } catch (err: any) {
      console.warn('[WebBluetooth] Connection failed:', err);
      this.notifyStatus();
      throw err;
    }
  }

  /**
   * Sends binary ESC/POS data chunked (max 100 bytes per packet) to respect BLE MTU limits.
   */
  public async sendRaw(data: Uint8Array): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Bluetooth printer is not connected');
    }

    const CHUNK_SIZE = 100;
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
      const slice = data.slice(offset, offset + CHUNK_SIZE);
      if (this.characteristic.writeValueWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(slice);
      } else {
        await this.characteristic.writeValue(slice);
      }
      // Small 15ms pause between packets to prevent buffer overflow on micro-controllers
      await new Promise(r => setTimeout(r, 15));
    }
  }

  /**
   * Kicks cash drawer over Bluetooth ESC/POS pulse command.
   */
  public async kickDrawer(): Promise<boolean> {
    if (!this.characteristic) return false;
    try {
      const kick = buildDrawerKickCommand(0);
      await this.sendRaw(kick);
      return true;
    } catch (err) {
      console.warn('[WebBluetooth] Drawer kick error:', err);
      return false;
    }
  }

  /**
   * Prints full 58mm thermal receipt over Bluetooth.
   */
  public async printReceipt(sale: SaleSummary): Promise<boolean> {
    if (!this.characteristic) return false;
    try {
      const receipt = buildReceiptEscPos(sale);
      await this.sendRaw(receipt);
      return true;
    } catch (err) {
      console.warn('[WebBluetooth] Print error:', err);
      return false;
    }
  }
}

export const webBluetoothPrinter = new WebBluetoothPrinterService();
