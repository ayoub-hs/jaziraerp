import { buildDrawerKickCommand, buildReceiptEscPos } from './escpos.js';
import type { SaleSummary } from '../../types/index.js';

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
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
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
    if (!this.isSupported()) {
      throw new Error('WebBluetooth API is not supported in this browser. Please use Chrome on Android.');
    }

    try {
      const bluetooth = (navigator as any).bluetooth;

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
