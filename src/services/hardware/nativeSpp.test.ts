import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeSppPrinterService, ErpSppPrinterPlugin } from './nativeSpp.js';
import { Capacitor } from '@capacitor/core';
import type { SaleSummary } from '../../types/index.js';

describe('Step 5: Native SPP Printer Hardening', () => {
  let service: NativeSppPrinterService;
  let mockPlugin: ErpSppPrinterPlugin;
  let mockListBonded: ReturnType<typeof vi.fn>;
  let mockConnect: ReturnType<typeof vi.fn>;
  let mockWrite: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let mockCheckPermissions: ReturnType<typeof vi.fn>;
  let mockRequestPermissions: ReturnType<typeof vi.fn>;

  const sampleSale: SaleSummary = {
    id: 'sale_101',
    receipt_number: 'REC-101',
    date: new Date().toISOString(),
    subtotal_ht: 100,
    tva_rate: 19,
    tva_amount: 19,
    total_ttc: 119,
    cash_paid: 120,
    wallet_paid: 0,
    credit_amount: 0,
    change_given: 1,
    status: 'COMPLETED',
    items: [
      {
        id: 'item_1',
        description: 'Produit Test',
        name: 'Produit Test',
        quantity: 2,
        unit_price: 50,
        pack_multiplier: 1,
        total_line: 100
      }
    ]
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

    mockListBonded = vi.fn().mockResolvedValue({
      devices: [{ name: 'MPT-II Printer', address: '00:11:22:33:44:55' }]
    });
    mockConnect = vi.fn().mockResolvedValue({
      name: 'MPT-II Printer',
      address: '00:11:22:33:44:55'
    });
    mockWrite = vi.fn().mockResolvedValue(undefined);
    mockDisconnect = vi.fn().mockResolvedValue(undefined);
    mockCheckPermissions = vi.fn().mockResolvedValue({ bluetooth: 'granted' });
    mockRequestPermissions = vi.fn().mockResolvedValue({ bluetooth: 'granted' });

    mockPlugin = {
      listBonded: mockListBonded,
      connect: mockConnect,
      write: mockWrite,
      disconnect: mockDisconnect,
      isConnected: vi.fn().mockResolvedValue({ connected: true }),
      checkPermissions: mockCheckPermissions,
      requestPermissions: mockRequestPermissions
    };

    service = new NativeSppPrinterService(mockPlugin);
  });

  it('deduplicates concurrent autoConnect calls into a single in-flight operation', async () => {
    let resolveConnect: any;
    mockConnect.mockImplementation(
      () => new Promise(res => { resolveConnect = res; })
    );

    const promise1 = service.autoConnect();
    const promise2 = service.autoConnect();

    // Await microtasks so permission check and listBonded proceed
    await new Promise(r => setTimeout(r, 20));

    // Verify only a single connect flow was initiated
    expect(mockListBonded).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    resolveConnect({ name: 'MPT-II Printer', address: '00:11:22:33:44:55' });
    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
  });

  it('checks and requests BLUETOOTH_CONNECT with actionable error message when denied', async () => {
    mockCheckPermissions.mockResolvedValue({ bluetooth: 'denied' });
    mockRequestPermissions.mockResolvedValue({ bluetooth: 'denied' });

    await expect(service.autoConnect()).rejects.toThrow(
      'Permission Bluetooth refusée. Veuillez autoriser les appareils à proximité dans les paramètres Android.'
    );
  });

  it('serializes concurrent print jobs so they execute sequentially', async () => {
    await service.autoConnect();
    mockWrite.mockClear();

    const writeLog: string[] = [];
    mockWrite.mockImplementation(async () => {
      writeLog.push('start');
      await new Promise(r => setTimeout(r, 20));
      writeLog.push('end');
    });

    const p1 = service.printReceipt(sampleSale);
    const p2 = service.printReceipt({ ...sampleSale, receipt_number: 'REC-102' });

    await Promise.all([p1, p2]);
    expect(mockWrite).toHaveBeenCalledTimes(2);
    // Serialized execution: start -> end -> start -> end
    expect(writeLog).toEqual(['start', 'end', 'start', 'end']);
  });

  it('retries once with reconnect when write fails on first attempt', async () => {
    await service.autoConnect();
    mockConnect.mockClear();
    mockDisconnect.mockClear();

    // Fail first write, succeed on second write
    mockWrite.mockRejectedValueOnce(new Error('Socket broken')).mockResolvedValueOnce(undefined);

    await service.printReceipt(sampleSale);

    // Disconnected then reconnected then re-wrote
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledTimes(2);
  });

  it('rejects on timeout when operation hangs beyond 6s', async () => {
    const hangingPromise = new Promise(r => setTimeout(r, 10000));
    await expect(
      service.withTimeout(hangingPromise, 50, 'Timeout 50ms')
    ).rejects.toThrow('Timeout 50ms');
  });
});
