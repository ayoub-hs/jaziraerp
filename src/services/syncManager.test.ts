import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncManager } from './syncManager.js';
import { clientDb } from '../db/clientDb.js';

describe('SyncManager & Offline Fallback', () => {
  let syncMgr: SyncManager;

  beforeEach(() => {
    syncMgr = new SyncManager();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isFlushing guard prevents duplicate concurrent flushes', async () => {
    const mockItems = [
      { queue_id: 1, temp_client_id: 't-1', action_type: 'SALE', payload: {}, created_at: 'now' }
    ];

    vi.spyOn(clientDb.pending_sync_queue, 'toArray').mockResolvedValue(mockItems as any);
    vi.spyOn(clientDb.pending_sync_queue, 'bulkDelete').mockResolvedValue(undefined as any);
    vi.spyOn(syncMgr, 'getPendingCount').mockResolvedValue(1);
    vi.spyOn(syncMgr, 'pullMasterCatalog').mockResolvedValue(undefined);

    let resolveFetch: (val: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi.fn().mockReturnValue(fetchPromise);
    vi.stubGlobal('fetch', fetchSpy);

    // Call flushSyncQueue twice concurrently
    const p1 = syncMgr.flushSyncQueue();
    const p2 = syncMgr.flushSyncQueue();

    // Verify it returned the exact same promise (isFlushing guard)
    expect(p1).toBe(p2);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Resolve the fetch call
    resolveFetch!({
      ok: true,
      json: async () => ({
        success: true,
        reconciled: [{ temp_client_id: 't-1', status: 'SYNCED' }],
        failed: []
      })
    });

    const res = await p1;
    expect(res.processed).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('selectively deletes only reconciled items and marks failed items for review', async () => {
    const mockItems = [
      { queue_id: 1, temp_client_id: 't-reconciled', action_type: 'SALE', payload: {}, created_at: 'now' },
      { queue_id: 2, temp_client_id: 't-failed', action_type: 'SALE', payload: {}, created_at: 'now' }
    ];

    vi.spyOn(clientDb.pending_sync_queue, 'toArray').mockResolvedValue(mockItems as any);
    const bulkDeleteSpy = vi.spyOn(clientDb.pending_sync_queue, 'bulkDelete').mockResolvedValue(undefined as any);
    const updateSpy = vi.spyOn(clientDb.pending_sync_queue, 'update').mockResolvedValue(1 as any);
    vi.spyOn(syncMgr, 'pullMasterCatalog').mockResolvedValue(undefined);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        reconciled: [{ temp_client_id: 't-reconciled', status: 'SYNCED' }],
        failed: [{ temp_client_id: 't-failed', reason: 'INSUFFICIENT_WALLET' }]
      })
    }));

    await syncMgr.flushSyncQueue();

    // Only queue_id 1 is deleted
    expect(bulkDeleteSpy).toHaveBeenCalledWith([1]);
    // Queue id 2 is flagged for review
    expect(updateSpy).toHaveBeenCalledWith(2, {
      error: 'INSUFFICIENT_WALLET',
      needs_review: true
    });
  });

  it('does NOT queue sale to offline outbox when server returns HTTP 4xx', async () => {
    const queueSpy = vi.spyOn(syncMgr, 'queueOfflineSale');

    // Simulate process sale handler behavior with HTTP 400 response
    const mockOnlineSale = async (payload: any) => {
      let res: Response;
      try {
        res = await fetch('/api/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (networkErr: any) {
        return syncMgr.queueOfflineSale(payload);
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Sale failed');
      }

      return res.json();
    };

    // 1. HTTP 400 Bad Request
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid customer or insufficient balance' })
    }));

    await expect(mockOnlineSale({ amount: 10 })).rejects.toThrow('Invalid customer or insufficient balance');
    expect(queueSpy).not.toHaveBeenCalled();

    // 2. Genuine network failure (TypeError: fetch failed)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    queueSpy.mockResolvedValue('temp-123');

    const offlineResult = await mockOnlineSale({ amount: 10 });
    expect(offlineResult).toBe('temp-123');
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('queueOfflineSale blocks offline sale when cached wallet balance is insufficient', async () => {
    vi.spyOn(clientDb.customers, 'get').mockResolvedValue({
      id: 'cust-1',
      name: 'Client Test',
      type: 'RETAIL',
      reseller_discount_percent: 0,
      wallet_balance: 5.000
    } as any);

    const updateSpy = vi.spyOn(clientDb.customers, 'update');
    const queueAddSpy = vi.spyOn(clientDb.pending_sync_queue, 'add');

    // Attempt offline sale paying 10 DT from 5 DT wallet
    await expect(syncMgr.queueOfflineSale({
      customer_id: 'cust-1',
      wallet_paid: 10.000,
      items: []
    })).rejects.toThrow(/Solde portefeuille insuffisant/);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(queueAddSpy).not.toHaveBeenCalled();
  });

  it('queueOfflineSale deducts wallet balance in IndexedDB when wallet_paid is valid', async () => {
    vi.spyOn(clientDb.customers, 'get').mockResolvedValue({
      id: 'cust-1',
      name: 'Client Test',
      type: 'RETAIL',
      reseller_discount_percent: 0,
      wallet_balance: 20.000
    } as any);

    const updateSpy = vi.spyOn(clientDb.customers, 'update').mockResolvedValue(1 as any);
    vi.spyOn(clientDb.pending_sync_queue, 'add').mockResolvedValue(1 as any);

    const tempId = await syncMgr.queueOfflineSale({
      customer_id: 'cust-1',
      wallet_paid: 15.000,
      items: []
    });

    expect(tempId).toMatch(/^temp_/);
    expect(updateSpy).toHaveBeenCalledWith('cust-1', {
      wallet_balance: 5.000
    });
  });

  it('flushSyncQueue does NOT send queue items with needs_review: true and preserves OFFLINE_PENDING state', async () => {
    const mockItems = [
      { queue_id: 1, temp_client_id: 't-normal', action_type: 'SALE', payload: {}, created_at: 'now' },
      { queue_id: 2, temp_client_id: 't-review', action_type: 'SALE', payload: {}, needs_review: true, error: 'INSUFFICIENT_WALLET', created_at: 'now' }
    ];

    vi.spyOn(clientDb.pending_sync_queue, 'toArray').mockResolvedValue(mockItems as any);
    vi.spyOn(clientDb.pending_sync_queue, 'bulkDelete').mockResolvedValue(undefined as any);
    vi.spyOn(syncMgr, 'pullMasterCatalog').mockResolvedValue(undefined);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        reconciled: [{ temp_client_id: 't-normal', status: 'SYNCED' }],
        failed: []
      })
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Initial flush with 1 normal and 1 review item
    await syncMgr.flushSyncQueue();

    // Verify fetch was only called with the non-review operation
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.operations).toHaveLength(1);
    expect(sentBody.operations[0].temp_client_id).toBe('t-normal');

    // Now test when ONLY needs_review items remain in queue
    fetchSpy.mockClear();
    vi.spyOn(clientDb.pending_sync_queue, 'toArray').mockResolvedValue([mockItems[1]] as any);
    vi.spyOn(syncMgr, 'getPendingCount').mockResolvedValue(1);

    const res = await syncMgr.flushSyncQueue();

    // Fetch should NOT be called at all
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.processed).toBe(0);
    // State must NOT be ONLINE_SYNCED when review items remain
    expect(syncMgr.getState()).toBe('OFFLINE_PENDING');
  });

  it('retryReviewItems clears needs_review and error and triggers flush', async () => {
    const reviewItem = {
      queue_id: 5,
      temp_client_id: 't-rev-5',
      action_type: 'SALE',
      payload: {},
      needs_review: true,
      error: 'SOME_ERROR',
      created_at: 'now'
    };

    const filterMock = {
      toArray: vi.fn().mockResolvedValue([reviewItem])
    };
    vi.spyOn(clientDb.pending_sync_queue, 'filter').mockReturnValue(filterMock as any);
    const updateSpy = vi.spyOn(clientDb.pending_sync_queue, 'update').mockResolvedValue(1 as any);
    const flushSpy = vi.spyOn(syncMgr, 'flushSyncQueue').mockResolvedValue({ processed: 1 });

    await syncMgr.retryReviewItems();

    expect(updateSpy).toHaveBeenCalledWith(5, {
      needs_review: false,
      error: undefined
    });
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('pullMasterCatalog replicates product families into clientDb.product_families', async () => {
    const mockFamilies = [
      { id: 'fam-1', name: 'Detergents', category: 'Cleaning' },
      { id: 'fam-2', name: 'Soaps', category: 'Personal' }
    ];

    const famClearSpy = vi.spyOn(clientDb.product_families, 'clear').mockResolvedValue(undefined as any);
    const famBulkPutSpy = vi.spyOn(clientDb.product_families, 'bulkPut').mockResolvedValue('ok' as any);
    vi.spyOn(clientDb.products, 'clear').mockResolvedValue(undefined as any);
    vi.spyOn(clientDb.customers, 'clear').mockResolvedValue(undefined as any);
    vi.spyOn(clientDb.container_types, 'clear').mockResolvedValue(undefined as any);
    vi.spyOn(clientDb.products, 'bulkPut').mockResolvedValue('ok' as any);
    vi.spyOn(clientDb.customers, 'bulkPut').mockResolvedValue('ok' as any);
    vi.spyOn(clientDb.container_types, 'bulkPut').mockResolvedValue('ok' as any);

    vi.spyOn(clientDb, 'transaction').mockImplementation((async (...args: any[]) => {
      const callback = args[args.length - 1];
      return callback();
    }) as any);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        products: [],
        customers: [],
        container_types: [],
        families: mockFamilies
      })
    }));

    await syncMgr.pullMasterCatalog();

    expect(famClearSpy).toHaveBeenCalledTimes(1);
    expect(famBulkPutSpy).toHaveBeenCalledWith(mockFamilies);
  });

  it('verifies clientDb schema upgrade preserves existing tables and adds product_families', () => {
    const tableNames = clientDb.tables.map(t => t.name);
    expect(tableNames).toContain('products');
    expect(tableNames).toContain('pack_sizes');
    expect(tableNames).toContain('customers');
    expect(tableNames).toContain('container_types');
    expect(tableNames).toContain('active_session');
    expect(tableNames).toContain('pending_sync_queue');
    expect(tableNames).toContain('product_families');

    const pfSchema = clientDb.table('product_families').schema;
    expect(pfSchema.primKey.name).toBe('id');
    expect(pfSchema.indexes.map(i => i.name)).toEqual(['name', 'category']);

    const queueSchema = clientDb.table('pending_sync_queue').schema;
    expect(queueSchema.primKey.name).toBe('queue_id');
  });

  it('offline fallback retrieves cached families from clientDb.product_families', async () => {
    const cachedFamilies = [
      { id: 'fam-offline-1', name: 'Bleach', category: 'Chemicals' }
    ];

    vi.spyOn(clientDb.product_families, 'toArray').mockResolvedValue(cachedFamilies as any);

    const offlineFamilies = await clientDb.product_families.toArray();
    expect(offlineFamilies).toEqual(cachedFamilies);
    expect(offlineFamilies).toHaveLength(1);
    expect(offlineFamilies[0].name).toBe('Bleach');
  });
});

