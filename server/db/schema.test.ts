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
      INSERT INTO sale_items (id, sale_id, is_quick_add, quantity, quantity_refunded, base_stock_deducted, unit_price, line_total)
      VALUES ('item-1', 'sale-1', 1, 5, 0, 5, 20.000, 100.000)
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

  describe('C1: Table CHECK Constraints', () => {
    it('enforces customers.wallet_balance >= 0', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO customers (id, name, type, wallet_balance, created_at, updated_at)
          VALUES ('c-neg', 'Negative Wallet', 'RETAIL', -5.000, '2026-09-07', '2026-09-07')
        `).run();
      }).toThrow(/CHECK constraint failed/);

      // Positive and zero succeed
      db.prepare(`
        INSERT INTO customers (id, name, type, wallet_balance, created_at, updated_at)
        VALUES ('c-zero', 'Zero Wallet', 'RETAIL', 0, '2026-09-07', '2026-09-07')
      `).run();
      const c: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('c-zero');
      expect(c.wallet_balance).toBe(0);
    });

    it('enforces customer_debt_tickets remaining_amount >= 0', () => {
      db.prepare(`
        INSERT INTO customers (id, name, type, wallet_balance, created_at, updated_at)
        VALUES ('c-debt', 'Debt Cust', 'RETAIL', 0, '2026-09-07', '2026-09-07')
      `).run();

      expect(() => {
        db.prepare(`
          INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
          VALUES ('cdt-neg', 'TKT-NEG', 'c-debt', '2026-09-07', 100, -10, 'UNPAID', '2026-09-07', '2026-09-07')
        `).run();
      }).toThrow(/CHECK constraint failed/);
    });

    it('enforces supplier_debt_tickets remaining_amount >= 0', () => {
      db.prepare(`
        INSERT INTO suppliers (id, name, created_at, updated_at)
        VALUES ('sup-tst', 'Supplier Test', '2026-09-07', '2026-09-07')
      `).run();

      expect(() => {
        db.prepare(`
          INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, date, total_amount, remaining_amount, status, created_at, updated_at)
          VALUES ('sdt-neg', 'STKT-NEG', 'sup-tst', '2026-09-07', 100, -5, 'UNPAID', '2026-09-07', '2026-09-07')
        `).run();
      }).toThrow(/CHECK constraint failed/);
    });

    it('enforces purchase_items item_type and foreign key consistency', () => {
      db.prepare(`
        INSERT INTO suppliers (id, name, created_at, updated_at)
        VALUES ('sup-pi', 'Supplier PI', '2026-09-07', '2026-09-07')
      `).run();
      db.prepare(`
        INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
        VALUES ('po-pi', 'PO-PI', 'sup-pi', '2026-09-07', 100, 'PAID', '2026-09-07')
      `).run();
      db.prepare(`
        INSERT INTO raw_materials (id, name, category, unit, created_at, updated_at)
        VALUES ('mat-pi', 'Surfactant', 'surfactant', 'kg', '2026-09-07', '2026-09-07')
      `).run();

      // RAW_MATERIAL without material_id must fail
      expect(() => {
        db.prepare(`
          INSERT INTO purchase_items (id, purchase_id, item_type, material_id, product_id, quantity, unit_cost, total_cost)
          VALUES ('pi-bad', 'po-pi', 'RAW_MATERIAL', NULL, NULL, 10, 5, 50)
        `).run();
      }).toThrow(/CHECK constraint failed/);

      // RAW_MATERIAL with material_id succeeds
      db.prepare(`
        INSERT INTO purchase_items (id, purchase_id, item_type, material_id, product_id, quantity, unit_cost, total_cost)
        VALUES ('pi-good', 'po-pi', 'RAW_MATERIAL', 'mat-pi', NULL, 10, 5, 50)
      `).run();
      const pi: any = db.prepare('SELECT * FROM purchase_items WHERE id = ?').get('pi-good');
      expect(pi.material_id).toBe('mat-pi');
    });

    it('enforces sale_items is_quick_add or product_id requirement', () => {
      db.prepare(`
        INSERT INTO sales (id, receipt_number, date, subtotal_ht, tva_rate, tva_amount, total_ttc, status, created_at)
        VALUES ('s-chk', 'REC-CHK', '2026-09-07', 10, 0.19, 1.9, 11.9, 'COMPLETED', '2026-09-07')
      `).run();

      // Not quick add and product_id is NULL must fail
      expect(() => {
        db.prepare(`
          INSERT INTO sale_items (id, sale_id, product_id, is_quick_add, quantity, base_stock_deducted, unit_price, line_total)
          VALUES ('si-bad', 's-chk', NULL, 0, 1, 1, 10, 10)
        `).run();
      }).toThrow(/CHECK constraint failed/);

      // is_quick_add = 1 without product_id succeeds
      db.prepare(`
        INSERT INTO sale_items (id, sale_id, product_id, is_quick_add, quick_add_name, quantity, base_stock_deducted, unit_price, line_total)
        VALUES ('si-qa', 's-chk', NULL, 1, 'Custom Service', 1, 0, 10, 10)
      `).run();
      const si: any = db.prepare('SELECT * FROM sale_items WHERE id = ?').get('si-qa');
      expect(si.is_quick_add).toBe(1);
    });

    it('enforces inventory_adjustments item_type and foreign key consistency', () => {
      db.prepare(`
        INSERT INTO raw_materials (id, name, category, unit, created_at, updated_at)
        VALUES ('mat-adj', 'Dye', 'dye', 'kg', '2026-09-07', '2026-09-07')
      `).run();

      // RAW_MATERIAL without material_id must fail
      expect(() => {
        db.prepare(`
          INSERT INTO inventory_adjustments (id, date, item_type, material_id, product_id, quantity_delta, reason, created_at)
          VALUES ('adj-bad', '2026-09-07', 'RAW_MATERIAL', NULL, NULL, 5, 'Audit count', '2026-09-07')
        `).run();
      }).toThrow(/CHECK constraint failed/);

      // RAW_MATERIAL with material_id succeeds
      db.prepare(`
        INSERT INTO inventory_adjustments (id, date, item_type, material_id, product_id, quantity_delta, reason, created_at)
        VALUES ('adj-good', '2026-09-07', 'RAW_MATERIAL', 'mat-adj', NULL, 5, 'Audit count', '2026-09-07')
      `).run();
      const adj: any = db.prepare('SELECT * FROM inventory_adjustments WHERE id = ?').get('adj-good');
      expect(adj.material_id).toBe('mat-adj');
    });
  });
});
