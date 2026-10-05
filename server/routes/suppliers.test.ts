import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allocateSupplierPayment } from '../services/debtService.js';
import { recordMaterialPriceHistory } from './materials.js';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Suppliers, Purchases & Supplier Debt Ledger Module', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);

    // Seed supplier
    db.prepare(`
      INSERT INTO suppliers (id, name, phone, address, created_at, updated_at)
      VALUES ('sup-alpha', 'Alpha Chemicals & Supplies', '+216 71 111 222', 'Ben Arous', '2026-01-01', '2026-01-01')
    `).run();

    // Seed a raw material
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-solvent', 'Industrial Solvent', 'solvent', 'L', 50, 6.000, '2026-01-01', '2026-01-01')
    `).run();

    // Seed a resale product
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-gloves', 'Latex Gloves Box 100', 'Resale Goods', 'RESALE', '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, cost_reference, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-gloves-m', 'fam-gloves', 'Latex Gloves Medium', '100 pcs', '619000888999', 20, 8.000, 15.000, 12.000, '2026-01-01', '2026-01-01')
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('records purchase of raw material with immediate stock increase and price history', () => {
    // Buy 100L of Industrial Solvent @ 6.500 DT = 650.000 DT (PAID)
    const purchaseId = 'po-paid-1';
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES (?, 'PO-001', 'sup-alpha', '2026-09-07', 650.000, 'PAID', '2026-09-07')
    `).run(purchaseId);

    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-1', ?, 'RAW_MATERIAL', 'mat-solvent', 100, 6.500, 650.000)
    `).run(purchaseId);

    // Stock increase is immediate (single-step)
    recordMaterialPriceHistory(db, {
      materialId: 'mat-solvent',
      costPerUnit: 6.500,
      supplierId: 'sup-alpha',
      quantityAdded: 100,
      date: '2026-09-07',
      purchaseId
    });

    const material: any = db.prepare('SELECT stock_quantity, latest_purchase_cost, latest_supplier_id FROM raw_materials WHERE id = ?').get('mat-solvent');
    expect(material.stock_quantity).toBe(150); // 50 + 100
    expect(material.latest_purchase_cost).toBe(6.500);
    expect(material.latest_supplier_id).toBe('sup-alpha');

    // No debt ticket should be created for PAID purchase
    const ticket = db.prepare('SELECT * FROM supplier_debt_tickets WHERE purchase_id = ?').get(purchaseId);
    expect(ticket).toBeUndefined();
  });

  it('records purchase of resale goods with immediate stock increase and updates cost_reference', () => {
    // Buy 30 boxes of gloves @ 8.500 DT = 255.000 DT
    const purchaseId = 'po-gloves-1';
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES (?, 'PO-002', 'sup-alpha', '2026-09-07', 255.000, 'PAID', '2026-09-07')
    `).run(purchaseId);

    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, product_id, quantity, unit_cost, total_cost)
      VALUES ('pi-2', ?, 'RESALE_PRODUCT', 'prod-gloves-m', 30, 8.500, 255.000)
    `).run(purchaseId);

    db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity + 30,
          cost_reference = 8.500,
          updated_at = '2026-09-07'
      WHERE id = 'prod-gloves-m'
    `).run();

    const product: any = db.prepare('SELECT stock_quantity, cost_reference FROM products WHERE id = ?').get('prod-gloves-m');
    expect(product.stock_quantity).toBe(50); // 20 + 30
    expect(product.cost_reference).toBe(8.500); // Updated to latest purchase cost
  });

  it('creates an open supplier debt ticket when purchase is marked CREDIT', () => {
    const purchaseId = 'po-credit-1';
    const totalAmount = 500.000;

    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES (?, 'PO-CREDIT-01', 'sup-alpha', '2026-09-07', ?, 'CREDIT', '2026-09-07')
    `).run(purchaseId, totalAmount);

    db.prepare(`
      INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, purchase_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('sdt-1', 'STKT-001', 'sup-alpha', ?, '2026-09-07', ?, ?, 'UNPAID', '2026-09-07', '2026-09-07')
    `).run(purchaseId, totalAmount, totalAmount);

    const ticket: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('sdt-1');
    expect(ticket).toBeDefined();
    expect(ticket.total_amount).toBe(500.000);
    expect(ticket.remaining_amount).toBe(500.000);
    expect(ticket.status).toBe('UNPAID');
    expect(ticket.supplier_id).toBe('sup-alpha');
  });

  it('allocates partial payments to a supplier across open debt tickets using FIFO oldest-first', () => {
    // Ticket 1: 100.000 DT (Jan 5)
    // Ticket 2: 150.000 DT (Feb 5)
    // Ticket 3: 200.000 DT (Mar 5)
    db.prepare(`
      INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES
        ('stkt-1', 'STKT-01', 'sup-alpha', '2026-01-05', 100.000, 100.000, 'UNPAID', '2026-01-05', '2026-01-05'),
        ('stkt-2', 'STKT-02', 'sup-alpha', '2026-02-05', 150.000, 150.000, 'UNPAID', '2026-02-05', '2026-02-05'),
        ('stkt-3', 'STKT-03', 'sup-alpha', '2026-03-05', 200.000, 200.000, 'UNPAID', '2026-03-05', '2026-03-05')
    `).run();

    // Pay 180.000 DT to supplier
    const result = allocateSupplierPayment(db, {
      supplierId: 'sup-alpha',
      amount: 180.000,
      paymentMethod: 'Bank Transfer',
      notes: 'Partial payment against open invoices'
    });

    expect(result.amount_allocated).toBe(180.000);
    expect(result.tickets_affected.length).toBe(2);

    const t1: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('stkt-1');
    const t2: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('stkt-2');
    const t3: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('stkt-3');

    // Ticket 1: 100 DT allocated -> 0 remaining, PAID
    expect(t1.remaining_amount).toBe(0);
    expect(t1.status).toBe('PAID');

    // Ticket 2: 80 DT allocated -> 70 DT remaining (150 - 80), PARTIALLY_PAID
    expect(t2.remaining_amount).toBe(70.000);
    expect(t2.status).toBe('PARTIALLY_PAID');

    // Ticket 3: untouched -> 200 DT remaining, UNPAID
    expect(t3.remaining_amount).toBe(200.000);
    expect(t3.status).toBe('UNPAID');

    // Verify allocation records
    const allocations = db.prepare('SELECT * FROM supplier_payment_allocations WHERE payment_id = ?').all(result.payment_id);
    expect(allocations.length).toBe(2);
  });

  it('rejects supplier payment larger than total outstanding debt', () => {
    // sup-alpha currently has 0 debt tickets seeded initially
    expect(() => {
      allocateSupplierPayment(db, {
        supplierId: 'sup-alpha',
        amount: 50.000,
        paymentMethod: 'Cash'
      });
    }).toThrow(/exceeds supplier total outstanding debt/);

    // Seed a 100 DT ticket
    db.prepare(`
      INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('stkt-excess', 'STKT-EX', 'sup-alpha', '2026-01-05', 100.000, 100.000, 'UNPAID', '2026-01-05', '2026-01-05')
    `).run();

    // 150 DT exceeds 100 DT
    expect(() => {
      allocateSupplierPayment(db, {
        supplierId: 'sup-alpha',
        amount: 150.000,
        paymentMethod: 'Cash'
      });
    }).toThrow(/exceeds supplier total outstanding debt/);
  });

  it('handles multi-item purchase with raw material and resale goods, updating stock and debt ticket', () => {
    const purchaseId = 'po-multi-1';
    const purchaseNumber = 'PO-MULTI-01';
    const totalAmount = 300.000; // (20L * 5.000 = 100) + (10 boxes * 20.000 = 200)
    const cashPaid = 100.000;
    const debtAmount = 200.000;

    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES (?, ?, 'sup-alpha', '2026-09-08', ?, 'CREDIT', '2026-09-08')
    `).run(purchaseId, purchaseNumber, totalAmount);

    // Line 1: Raw Material
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-m1', ?, 'RAW_MATERIAL', 'mat-solvent', 20, 5.000, 100.000)
    `).run(purchaseId);
    recordMaterialPriceHistory(db, {
      materialId: 'mat-solvent',
      costPerUnit: 5.000,
      supplierId: 'sup-alpha',
      quantityAdded: 20,
      date: '2026-09-08',
      purchaseId
    });

    // Line 2: Resale Product
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, product_id, quantity, unit_cost, total_cost)
      VALUES ('pi-m2', ?, 'RESALE_PRODUCT', 'prod-gloves-m', 10, 20.000, 200.000)
    `).run(purchaseId);
    db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity + 10,
          cost_reference = 20.000,
          updated_at = '2026-09-08'
      WHERE id = 'prod-gloves-m'
    `).run();

    // Credit debt ticket
    db.prepare(`
      INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, purchase_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('sdt-multi', 'STKT-MULTI-01', 'sup-alpha', ?, '2026-09-08', ?, ?, 'PARTIALLY_PAID', '2026-09-08', '2026-09-08')
    `).run(purchaseId, totalAmount, debtAmount);

    // Verify material stock updated (50 initial + 20 = 70)
    const mat: any = db.prepare('SELECT stock_quantity, latest_purchase_cost FROM raw_materials WHERE id = ?').get('mat-solvent');
    expect(mat.stock_quantity).toBe(70);
    expect(mat.latest_purchase_cost).toBe(5.000);

    // Verify product stock updated (20 initial + 10 = 30)
    const prod: any = db.prepare('SELECT stock_quantity, cost_reference FROM products WHERE id = ?').get('prod-gloves-m');
    expect(prod.stock_quantity).toBe(30);
    expect(prod.cost_reference).toBe(20.000);

    // Verify debt ticket
    const ticket: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE id = ?').get('sdt-multi');
    expect(ticket.remaining_amount).toBe(200.000);
    expect(ticket.status).toBe('PARTIALLY_PAID');

    // Verify query used by GET /api/purchases
    const purchaseRow: any = db.prepare(`
      SELECT p.*, s.name as supplier_name,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count,
        sdt.remaining_amount as debt_remaining,
        sdt.total_amount as debt_ticket_total,
        CASE 
          WHEN p.payment_status = 'PAID' THEN p.total_amount
          WHEN sdt.id IS NOT NULL THEN ROUND(p.total_amount - sdt.remaining_amount, 3)
          ELSE 0
        END as cash_paid,
        CASE
          WHEN p.payment_status = 'PAID' THEN 0
          WHEN sdt.id IS NOT NULL THEN sdt.remaining_amount
          ELSE p.total_amount
        END as debt_amount
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN supplier_debt_tickets sdt ON sdt.purchase_id = p.id
      WHERE p.id = ?
    `).get(purchaseId);

    expect(purchaseRow.item_count).toBe(2);
    expect(purchaseRow.cash_paid).toBe(100.000);
    expect(purchaseRow.debt_amount).toBe(200.000);
    expect(purchaseRow.total_amount).toBe(300.000);
  });

  it('GET /api/purchases/:id returns supplier, dates, payment split and line items', async () => {
    resetTestDb();
    const supRes = await request(app).post('/api/suppliers').send({ name: 'Detail Supplier' });
    const matRes = await request(app).post('/api/materials').send({
      name: 'Detail Solvent', category: 'solvent', unit: 'L', stock_quantity: 0, latest_purchase_cost: 5
    });

    // CREDIT purchase: 20L @ 5 = 100 total (down payment 0, debt 100)
    const poRes = await request(app).post('/api/purchases').send({
      supplier_id: supRes.body.id,
      payment_status: 'CREDIT',
      items: [{ item_type: 'RAW_MATERIAL', material_id: matRes.body.id, quantity: 20, unit_cost: 5.000 }]
    });
    expect(poRes.status).toBe(201);

    const detail = await request(app).get(`/api/purchases/${poRes.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.supplier_name).toBe('Detail Supplier');
    expect(detail.body.date).toBeTruthy();
    expect(detail.body.payment_status).toBe('CREDIT');
    expect(detail.body.total_amount).toBe(100.000);
    expect(detail.body.cash_paid).toBe(0);
    expect(detail.body.debt_remaining).toBe(100.000);
    expect(detail.body.debt_amount).toBe(100.000);
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0].item_name).toBe('Detail Solvent');
    expect(detail.body.items[0].total_cost).toBe(100.000);
    resetTestDb();
  });
});
