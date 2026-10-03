import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SQLite Database Schema & Integrity', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schemaSql);
  });

  afterEach(() => {
    db.close();
  });

  it('creates all expected core tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row: any) => row.name);

    const expectedTables = [
      'settings',
      'raw_materials',
      'material_price_history',
      'formulations',
      'formulation_items',
      'product_families',
      'products',
      'product_pack_sizes',
      'production_batches',
      'production_batch_materials_consumed',
      'customers',
      'customer_debt_tickets',
      'customer_payments',
      'customer_payment_allocations',
      'customer_wallet_transactions',
      'suppliers',
      'purchases',
      'purchase_items',
      'supplier_debt_tickets',
      'supplier_payments',
      'supplier_payment_allocations',
      'container_types',
      'customer_container_loans',
      'container_transactions',
      'register_sessions',
      'register_cash_movements',
      'sales',
      'sale_items',
      'refunds',
      'refund_items',
      'inventory_adjustments',
      'general_expenses'
    ];

    for (const expected of expectedTables) {
      expect(tables).toContain(expected);
    }
  });

  it('enforces foreign key constraints', () => {
    // Attempting to insert a product with non-existent family_id must fail
    expect(() => {
      db.prepare(`
        INSERT INTO products (id, family_id, name, size_label, barcode, created_at, updated_at)
        VALUES ('p1', 'non-existent-family', 'Test Product', '1L', '123456', '2026-09-07', '2026-09-07')
      `).run();
    }).toThrow();
  });

  it('verifies supplier debt ledger schema exists and works', () => {
    // Insert a supplier
    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-1', 'Chemical Corp', '2026-09-07', '2026-09-07')
    `).run();

    // Insert a credit purchase
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-1', 'PO-001', 'sup-1', '2026-09-07', 500.000, 'CREDIT', '2026-09-07')
    `).run();

    // Insert supplier debt ticket
    db.prepare(`
      INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, purchase_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('sdt-1', 'STKT-001', 'sup-1', 'po-1', '2026-09-07', 500.000, 500.000, 'UNPAID', '2026-09-07', '2026-09-07')
    `).run();

    const ticket: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('sdt-1');
    expect(ticket.supplier_id).toBe('sup-1');
    expect(ticket.remaining_amount).toBe(500.000);
    expect(ticket.status).toBe('UNPAID');
  });

  it('verifies refund and refund_items schema support partial refunds', () => {
    // Insert dummy sale with line item
    db.prepare(`
      INSERT INTO sales (id, receipt_number, date, subtotal_ht, tva_rate, tva_amount, total_ttc, status, created_at)
      VALUES ('sale-1', 'REC-001', '2026-09-07', 84.034, 0.19, 15.966, 100.000, 'COMPLETED', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO sale_items (id, sale_id, quantity, quantity_refunded, base_stock_deducted, unit_price, line_total)
      VALUES ('item-1', 'sale-1', 5, 0, 5, 20.000, 100.000)
    `).run();

    // Insert a partial refund of 2 units
    db.prepare(`
      INSERT INTO refunds (id, refund_number, sale_id, date, total_refunded, cash_refunded, created_at)
      VALUES ('ref-1', 'REF-001', 'sale-1', '2026-09-07', 40.000, 40.000, '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO refund_items (id, refund_id, sale_item_id, quantity_refunded, amount_refunded)
      VALUES ('ref-item-1', 'ref-1', 'item-1', 2, 40.000)
    `).run();

    // Update sale_items quantity_refunded and sale status to PARTIALLY_REFUNDED
    db.prepare(`
      UPDATE sale_items SET quantity_refunded = 2 WHERE id = 'item-1'
    `).run();

    db.prepare(`
      UPDATE sales SET status = 'PARTIALLY_REFUNDED' WHERE id = 'sale-1'
    `).run();

    const sale: any = db.prepare('SELECT * FROM sales WHERE id = ?').get('sale-1');
    expect(sale.status).toBe('PARTIALLY_REFUNDED');

    const item: any = db.prepare('SELECT * FROM sale_items WHERE id = ?').get('item-1');
    expect(item.quantity_refunded).toBe(2);
  });
});
