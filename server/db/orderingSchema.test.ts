import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, getDb } from '../../tests/testApp.js';

describe('Ordering Schema & Plumbing (Step 1)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('creates delivery_zones, client_orders, client_order_items tables with indices', () => {
    const db = getDb();
    const tables: any[] = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('delivery_zones');
    expect(tableNames).toContain('client_orders');
    expect(tableNames).toContain('client_order_items');

    const customerCols: any[] = db.prepare('PRAGMA table_info(customers)').all();
    expect(customerCols.some(c => c.name === 'credit_limit')).toBe(true);

    const indices: any[] = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
    const indexNames = indices.map(i => i.name);
    expect(indexNames).toContain('idx_client_orders_status');
    expect(indexNames).toContain('idx_client_orders_customer');
    expect(indexNames).toContain('idx_client_order_items_order');
  });

  it('ensures the dedicated Livraison counter exists idempotently', () => {
    const db = getDb();
    const deliveryCounter: any = db.prepare("SELECT * FROM counters WHERE name = 'Livraison'").get();
    expect(deliveryCounter).toBeDefined();
    expect(deliveryCounter.id).toBe('counter-delivery');
    expect(deliveryCounter.is_active).toBe(1);
  });

  it('enforces CHECK constraints on client_orders status, source, and payment_preference', () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO delivery_zones (id, name, min_order_amount, delivery_fee, created_at)
      VALUES ('zone-test', 'Djerba', 0, 0, ?)
    `).run(now);

    // Valid insert
    const insertOrder = db.prepare(`
      INSERT INTO client_orders (
        id, order_number, source, customer_id, customer_name, customer_phone,
        delivery_address, delivery_zone_id, subtotal_ttc, delivery_fee, total_ttc,
        payment_preference, loan_containers_requested, status, idempotency_key, access_token,
        created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'Client Test', '98123456', 'El May', 'zone-test', 20, 0, 20, ?, 0, ?, ?, ?, ?, ?)
    `);

    expect(() => {
      insertOrder.run('ord-1', 'ORD-001', 'MANUAL_ENTRY', 'CASH_ON_DELIVERY', 'CONFIRMED', 'key-1', 'tok-1', now, now);
    }).not.toThrow();

    // Invalid status -> throws
    expect(() => {
      insertOrder.run('ord-2', 'ORD-002', 'MANUAL_ENTRY', 'CASH_ON_DELIVERY', 'INVALID_STATUS', 'key-2', 'tok-2', now, now);
    }).toThrow();

    // Invalid source -> throws
    expect(() => {
      db.prepare(`
        INSERT INTO client_orders (
          id, order_number, source, customer_name, customer_phone,
          delivery_address, delivery_zone_id, subtotal_ttc, delivery_fee, total_ttc,
          payment_preference, status, idempotency_key, access_token, created_at, updated_at
        ) VALUES ('ord-3', 'ORD-003', 'HACKED_SOURCE', 'Test', '98123456', 'El May', 'zone-test', 20, 0, 20, 'CASH_ON_DELIVERY', 'NEW', 'key-3', 'tok-3', ?, ?)
      `).run(now, now);
    }).toThrow();
  });
});
