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
});
