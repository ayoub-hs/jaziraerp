import { clientDb, type PendingSyncItem } from '../db/clientDb.js';

export type SyncState = 'ONLINE_SYNCED' | 'OFFLINE_PENDING' | 'SYNCING';

export class SyncManager {
  private state: SyncState = 'ONLINE_SYNCED';
  private listeners: Array<(state: SyncState, pendingCount: number) => void> = [];
  private isFlushing = false;
  private flushPromise: Promise<{ processed: number }> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleNetworkChange());
      window.addEventListener('offline', () => this.handleNetworkChange());
    }
  }

  public subscribe(fn: (state: SyncState, pendingCount: number) => void): () => void {
    this.listeners.push(fn);
    this.notify();
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  public getState(): SyncState {
    return this.state;
  }

  public async getPendingCount(): Promise<number> {
    try {
      return await clientDb.pending_sync_queue.count();
    } catch {
      return 0;
    }
  }

  private async notify() {
    const count = await this.getPendingCount();
    for (const listener of this.listeners) {
      listener(this.state, count);
    }
  }

  private async handleNetworkChange() {
    if (navigator.onLine) {
      const count = await this.getPendingCount();
      if (count > 0) {
        await this.flushSyncQueue();
      } else {
        this.state = 'ONLINE_SYNCED';
        await this.notify();
      }
    } else {
      this.state = 'OFFLINE_PENDING';
      await this.notify();
    }
  }

  /**
   * Pulls current master catalog from server and replicates locally into IndexedDB.
   */
  public async pullMasterCatalog(): Promise<void> {
    try {
      const res = await fetch('/api/sync/pull');
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();

      await clientDb.transaction('rw', [clientDb.products, clientDb.customers, clientDb.container_types], async () => {
        await clientDb.products.clear();
        await clientDb.customers.clear();
        await clientDb.container_types.clear();

        if (Array.isArray(data.products)) {
          await clientDb.products.bulkPut(data.products);
        }
        if (Array.isArray(data.customers)) {
          await clientDb.customers.bulkPut(data.customers);
        }
        if (Array.isArray(data.container_types)) {
          await clientDb.container_types.bulkPut(data.container_types);
        }
      });

      const pendingCount = await this.getPendingCount();
      this.state = pendingCount > 0 ? 'OFFLINE_PENDING' : 'ONLINE_SYNCED';
      await this.notify();
    } catch (err) {
      console.warn('[SyncManager] Failed to pull master catalog:', err);
      const pendingCount = await this.getPendingCount();
      this.state = pendingCount > 0 ? 'OFFLINE_PENDING' : 'ONLINE_SYNCED';
      await this.notify();
    }
  }

  /**
   * Queues an offline sale, optimistically decrements local product stock in IndexedDB,
   * and attempts immediate background flush if network is available.
   */
  public async queueOfflineSale(payload: any): Promise<string> {
    const tempClientId = 'temp_' + crypto.randomUUID();

    // Optimistically deduct local stock in IndexedDB
    try {
      for (const item of payload.items || []) {
        if (!item.is_quick_add && item.product_id) {
          const localProd = await clientDb.products.get(item.product_id);
          if (localProd) {
            const deductQty = (Number(item.quantity) || 1) * (Number(item.pack_multiplier) || 1);
            await clientDb.products.update(item.product_id, {
              stock_quantity: localProd.stock_quantity - deductQty
            });
          }
        }
      }
    } catch (err) {
      console.warn('[SyncManager] Error optimistically updating local stock:', err);
    }

    // Add to outbox queue
    await clientDb.pending_sync_queue.add({
      temp_client_id: tempClientId,
      action_type: 'SALE',
      payload: { ...payload, temp_client_id: tempClientId },
      created_at: new Date().toISOString()
    });

    this.state = 'OFFLINE_PENDING';
    await this.notify();

    // If online, attempt background flush
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.flushSyncQueue().catch(err => console.error('[SyncManager] Background flush error:', err));
    }

    return tempClientId;
  }

  /**
   * Queues a non-sale offline operation (cash movement, container action, price/stock edit).
   */
  public async queueOfflineAction(
    actionType: PendingSyncItem['action_type'],
    payload: any
  ): Promise<string> {
    const tempClientId = 'temp_' + crypto.randomUUID();

    await clientDb.pending_sync_queue.add({
      temp_client_id: tempClientId,
      action_type: actionType,
      payload: { ...payload, temp_client_id: tempClientId },
      created_at: new Date().toISOString()
    });

    this.state = 'OFFLINE_PENDING';
    await this.notify();

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      this.flushSyncQueue().catch(err => console.error('[SyncManager] Background flush error:', err));
    }

    return tempClientId;
  }

  /**
   * Flushes all queued offline actions to the server.
   */
  public flushSyncQueue(): Promise<{ processed: number }> {
    if (this.isFlushing && this.flushPromise) {
      return this.flushPromise;
    }

    this.isFlushing = true;
    this.flushPromise = (async () => {
      const items = await clientDb.pending_sync_queue.toArray();
      if (items.length === 0) {
        this.state = 'ONLINE_SYNCED';
        await this.notify();
        return { processed: 0 };
      }

      this.state = 'SYNCING';
      await this.notify();

      try {
        const res = await fetch('/api/sync/flush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operations: items })
        });

        if (!res.ok) {
          throw new Error(`Sync flush failed with status ${res.status}`);
        }

        const data = await res.json();

        // Flag failed items for manual review in queue
        if (Array.isArray(data.failed) && data.failed.length > 0) {
          for (const f of data.failed) {
            const item = items.find(i => i.temp_client_id === f.temp_client_id);
            if (item && item.queue_id) {
              await clientDb.pending_sync_queue.update(item.queue_id, {
                error: f.reason || 'FAILED',
                needs_review: true
              });
            }
          }
        }

        // Delete only the queue items whose temp_client_id appears in the server's reconciled response
        const reconciledClientIds = new Set((data.reconciled || []).map((r: any) => r.temp_client_id));
        const queueIdsToDelete = items
          .filter(i => reconciledClientIds.has(i.temp_client_id) && i.queue_id)
          .map(i => i.queue_id!);

        if (queueIdsToDelete.length > 0) {
          await clientDb.pending_sync_queue.bulkDelete(queueIdsToDelete);
        }

        // Refresh master catalog
        await this.pullMasterCatalog();

        const remainingCount = await this.getPendingCount();
        this.state = remainingCount > 0 ? 'OFFLINE_PENDING' : 'ONLINE_SYNCED';
        await this.notify();
        return { processed: data.processed_count ?? (data.reconciled ? data.reconciled.length : 0) };
      } catch (err) {
        console.warn('[SyncManager] Flush failed, keeping queue for next retry:', err);
        this.state = 'OFFLINE_PENDING';
        await this.notify();
        throw err;
      }
    })().finally(() => {
      this.isFlushing = false;
      this.flushPromise = null;
    });

    return this.flushPromise;
  }
}

export const syncManager = new SyncManager();
