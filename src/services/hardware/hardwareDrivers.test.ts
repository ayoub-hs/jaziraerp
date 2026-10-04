import { describe, it, expect, vi } from 'vitest';
import { WebUsbPrinterService } from './webusb.js';
import { WebBluetoothPrinterService } from './webbluetooth.js';
import { renderCode128Barcode } from './barcode.js';
import { WebSerialDrawerService } from './webserial.js';

describe('Step 14: Hardware Drivers & Integrations', () => {
  describe('WebUSB Printer Driver', () => {
    it('initializes and reports unsupported status in Node test environment', () => {
      const usbService = new WebUsbPrinterService();
      expect(usbService.isSupported()).toBe(false);
      const status = usbService.getStatus();
      expect(status.isSupported).toBe(false);
      expect(status.isConnected).toBe(false);
    });

    it('subscribes to status changes', () => {
      const usbService = new WebUsbPrinterService();
      const statusListener = vi.fn();
      const unsub = usbService.subscribeStatus(statusListener);
      expect(statusListener).toHaveBeenCalledWith(expect.objectContaining({ isConnected: false }));
      unsub();
    });

    it('gracefully handles kickDrawer when disconnected without crashing', async () => {
      const usbService = new WebUsbPrinterService();
      const result = await usbService.kickDrawer();
      expect(result).toBe(false);
    });

    it('throws error when requesting connection in unsupported environment', async () => {
      const usbService = new WebUsbPrinterService();
      await expect(usbService.requestAndConnect()).rejects.toThrow('WebUSB API is not supported');
    });
  });

  describe('WebBluetooth Printer Driver', () => {
    it('initializes and reports unsupported status in Node test environment', () => {
      const btService = new WebBluetoothPrinterService();
      expect(btService.isSupported()).toBe(false);
      const status = btService.getStatus();
      expect(status.isSupported).toBe(false);
      expect(status.isConnected).toBe(false);
    });

    it('subscribes to status changes', () => {
      const btService = new WebBluetoothPrinterService();
      const statusListener = vi.fn();
      const unsub = btService.subscribeStatus(statusListener);
      expect(statusListener).toHaveBeenCalledWith(expect.objectContaining({ isConnected: false }));
      unsub();
    });

    it('gracefully handles kickDrawer when disconnected without crashing', async () => {
      const btService = new WebBluetoothPrinterService();
      const result = await btService.kickDrawer();
      expect(result).toBe(false);
    });

    it('throws error when requesting connection in unsupported environment', async () => {
      const btService = new WebBluetoothPrinterService();
      await expect(btService.requestAndConnect()).rejects.toThrow('WebBluetooth API is not supported');
    });
  });

  describe('Code-128 Barcode Renderer', () => {
    it('gracefully ignores empty or missing values', () => {
      const mockSvg = { setAttribute: vi.fn(), appendChild: vi.fn() } as unknown as SVGElement;
      expect(() => renderCode128Barcode(mockSvg, '')).not.toThrow();
    });

    it('safely attempts rendering with error boundary fallback', () => {
      const mockSvg = { setAttribute: vi.fn() } as unknown as SVGElement;
      expect(() => renderCode128Barcode(mockSvg, 'JAZ-LAV-1L', { width: 2, height: 40 })).not.toThrow();
    });
  });

  describe('WebSerial Drawer Driver', () => {
    it('initializes and reports unsupported status in Node test environment', () => {
      const serialService = new WebSerialDrawerService();
      expect(serialService.isSupported()).toBe(false);
      const status = serialService.getStatus();
      expect(status.isSupported).toBe(false);
      expect(status.isConnected).toBe(false);
    });

    it('throws error when requesting connection in unsupported environment', async () => {
      const serialService = new WebSerialDrawerService();
      await expect(serialService.requestAndConnect()).rejects.toThrow('Web Serial API is not supported');
    });

    it('does not retry requestPort if user cancelled with NotFoundError or AbortError', async () => {
      const serialService = new WebSerialDrawerService();
      vi.spyOn(serialService, 'isSupported').mockReturnValue(true);

      const requestPortMock = vi.fn().mockRejectedValue({ name: 'NotFoundError', message: 'No port selected' });
      Object.defineProperty(navigator, 'serial', {
        value: {
          requestPort: requestPortMock,
          addEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      await expect(serialService.requestAndConnect()).rejects.toEqual({ name: 'NotFoundError', message: 'No port selected' });
      expect(requestPortMock).toHaveBeenCalledTimes(1);
    });

    it('retries requestPort without filters on non-cancellation error', async () => {
      const serialService = new WebSerialDrawerService();
      vi.spyOn(serialService, 'isSupported').mockReturnValue(true);

      const mockPort = { open: vi.fn().mockResolvedValue(undefined) };
      const requestPortMock = vi.fn()
        .mockRejectedValueOnce(new Error('Vendor filter failed'))
        .mockResolvedValueOnce(mockPort);

      Object.defineProperty(navigator, 'serial', {
        value: {
          requestPort: requestPortMock,
          addEventListener: vi.fn(),
        },
        configurable: true,
        writable: true,
      });

      const result = await serialService.requestAndConnect();
      expect(result).toBe(true);
      expect(requestPortMock).toHaveBeenCalledTimes(2);
    });
  });
});
