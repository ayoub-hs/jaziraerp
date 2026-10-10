// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { printZReportThermal } from './zReportPrinter.js';
import { webUsbPrinter } from './webusb.js';
import { nativeSppPrinter } from './nativeSpp.js';
import { webBluetoothPrinter } from './webbluetooth.js';
import type { ZReportSessionData } from './escpos.js';

const mockSession: ZReportSessionData = {
  session_number: 'SES-20261010-0001',
  counter_name: 'Countertop',
  opened_at: '2026-10-10T08:00:00Z',
  closed_at: '2026-10-10T18:00:00Z',
  opening_cash: 100,
  cash_sales: 250,
  cash_refunds: 10,
  cash_in: 20,
  cash_out: 15,
  expected_cash: 345,
  counted_cash: 345,
  difference: 0,
  movements: [
    { type: 'CASH_IN', amount: 20, reason: 'Monnaie fond' },
    { type: 'CASH_OUT', amount: 15, reason: 'Café bureau' }
  ]
};

describe('Z-Report Thermal Printer Dispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints via WebUSB when connected and returns success', async () => {
    vi.spyOn(webUsbPrinter, 'getStatus').mockReturnValue({
      isSupported: true,
      isConnected: true,
      deviceName: 'Thermal 58mm USB'
    });
    const sendRawSpy = vi.spyOn(webUsbPrinter, 'sendRaw').mockResolvedValue(undefined);

    const result = await printZReportThermal(mockSession, 58);
    expect(result.success).toBe(true);
    expect(sendRawSpy).toHaveBeenCalledTimes(1);

    const sentBytes = sendRawSpy.mock.calls[0][0];
    const decoded = new TextDecoder().decode(sentBytes);
    expect(decoded).toContain('SES-20261010-0001');
    expect(decoded).toContain('Monnaie fond');
  });

  it('prints via native Bluetooth SPP when WebUSB is disconnected but SPP is connected', async () => {
    vi.spyOn(webUsbPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: false });
    vi.spyOn(nativeSppPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: true });
    const sppSpy = vi.spyOn(nativeSppPrinter, 'sendRaw').mockResolvedValue(undefined);

    const result = await printZReportThermal(mockSession, 80);
    expect(result.success).toBe(true);
    expect(sppSpy).toHaveBeenCalledTimes(1);
  });

  it('prints via WebBluetooth when other hardware is disconnected but WebBluetooth is connected', async () => {
    vi.spyOn(webUsbPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: false });
    vi.spyOn(nativeSppPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: false });
    vi.spyOn(webBluetoothPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: true });
    const bleSpy = vi.spyOn(webBluetoothPrinter, 'sendRaw').mockResolvedValue(undefined);

    const result = await printZReportThermal(mockSession, 58);
    expect(result.success).toBe(true);
    expect(bleSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back safely to window.print() if no thermal printer is connected', async () => {
    vi.spyOn(webUsbPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: false });
    vi.spyOn(nativeSppPrinter, 'getStatus').mockReturnValue({ isSupported: false, isConnected: false });
    vi.spyOn(webBluetoothPrinter, 'getStatus').mockReturnValue({ isSupported: false, isConnected: false });

    const originalPrint = window.print;
    const mockPrint = vi.fn();
    window.print = mockPrint;

    try {
      const result = await printZReportThermal(mockSession, 58);
      expect(result.success).toBe(true);
      expect(mockPrint).toHaveBeenCalledTimes(1);
    } finally {
      window.print = originalPrint;
    }
  });

  it('NEVER throws even if hardware printer throws an exception during transfer', async () => {
    vi.spyOn(webUsbPrinter, 'getStatus').mockReturnValue({ isSupported: true, isConnected: true });
    vi.spyOn(webUsbPrinter, 'sendRaw').mockRejectedValue(new Error('Hardware I/O pipe broken'));
    vi.spyOn(nativeSppPrinter, 'getStatus').mockReturnValue({ isSupported: false, isConnected: false });
    vi.spyOn(webBluetoothPrinter, 'getStatus').mockReturnValue({ isSupported: false, isConnected: false });

    const originalPrint = window.print;
    // Window.print throws as well
    window.print = vi.fn().mockImplementation(() => {
      throw new Error('User cancelled print dialog');
    });

    try {
      // Must not throw!
      const result = await printZReportThermal(mockSession, 58);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      window.print = originalPrint;
    }
  });
});
