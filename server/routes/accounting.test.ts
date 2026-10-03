import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Inventory Adjustments & Accounting Ledger Module — Real HTTP Integration Tests', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // Seed raw material and product
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-labsa-acc', 'Sulfonic Acid LABSA', 'surfactant', 'kg', 100, 5.000, '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-acc', 'Detergent Family', 'Detergents', 'MANUFACTURED', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, cost_reference, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-acc-1l', 'fam-acc', 'Lavender Floor Cleaner 1L', '1L', '619000777111', 50, 1.800, 3.000, 2.500, '2026-09-07', '2026-09-07')
    `).run();

    // Seed open register session
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
      VALUES ('ses-exp-1', 'SES-EXP-01', 'Countertop', '2026-09-07', 100.000, 100.000, 'OPEN')
    `).run();
  });

  it('performs manual inventory adjustment for raw material and verifies audit log via real endpoints', async () => {
    // 5 kg lost due to container puncture spillage
    const adjustRes = await request(app)
      .post('/api/inventory/adjust')
      .send({
        item_type: 'RAW_MATERIAL',
        item_id: 'mat-labsa-acc',
        quantity_delta: -5,
        reason: 'Container puncture spillage in storage'
      });

    expect(adjustRes.status).toBe(201);
    expect(adjustRes.body.success).toBe(true);
    expect(adjustRes.body.new_stock).toBe(95);

    // Verify stock in database
    const db = getDb();
    const mat: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('mat-labsa-acc');
    expect(mat.stock_quantity).toBe(95);

    // Verify GET /api/inventory/adjustments
    const listRes = await request(app).get('/api/inventory/adjustments?item_type=RAW_MATERIAL');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body[0].quantity_delta).toBe(-5);
    expect(listRes.body[0].reason).toBe('Container puncture spillage in storage');
  });

  it('performs manual inventory adjustment for finished product and verifies audit log via real endpoints', async () => {
    // 2 bottles dropped and broken
    const adjustRes = await request(app)
      .post('/api/inventory/adjust')
      .send({
        item_type: 'PRODUCT',
        item_id: 'prod-acc-1l',
        quantity_delta: -2,
        reason: 'Dropped from shelf and broken'
      });

    expect(adjustRes.status).toBe(201);
    expect(adjustRes.body.success).toBe(true);
    expect(adjustRes.body.new_stock).toBe(48);

    const db = getDb();
    const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-acc-1l');
    expect(prod.stock_quantity).toBe(48);

    const listRes = await request(app).get('/api/inventory/adjustments?item_type=PRODUCT');
    expect(listRes.status).toBe(200);
    expect(listRes.body[0].quantity_delta).toBe(-2);
    expect(listRes.body[0].item_name).toBe('Lavender Floor Cleaner 1L');
  });

  it('records general expenses and links cash movements when paid from register drawer', async () => {
    // 1. Rent expense of 450.000 DT via BANK_OTHER
    const rentRes = await request(app)
      .post('/api/accounting/expenses')
      .send({
        category: 'Rent',
        amount: 450.000,
        payment_source: 'BANK_OTHER',
        description: 'Monthly shop rent'
      });
    expect(rentRes.status).toBe(201);

    // 2. Supplies expense of 15.000 DT via REGISTER_CASH from ses-exp-1
    const suppRes = await request(app)
      .post('/api/accounting/expenses')
      .send({
        category: 'Supplies',
        amount: 15.000,
        payment_source: 'REGISTER_CASH',
        session_id: 'ses-exp-1',
        description: 'Store coffee & cups'
      });
    expect(suppRes.status).toBe(201);

    // List expenses
    const listRes = await request(app).get('/api/accounting/expenses');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);

    // Verify automatic CASH_OUT movement in register_cash_movements
    const db = getDb();
    const mov: any = db.prepare('SELECT * FROM register_cash_movements WHERE session_id = ?').get('ses-exp-1');
    expect(mov).toBeDefined();
    expect(mov.amount).toBe(15.000);
    expect(mov.type).toBe('CASH_OUT');
    expect(mov.expense_id).toBe(suppRes.body.id);
  });

  it('deletes general expense and its linked register CASH_OUT movement in one transaction', async () => {
    const db = getDb();
    // 1. Create legacy movement without expense_id
    db.prepare(`
      INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at, expense_id)
      VALUES ('legacy-mov', 'ses-exp-1', '2026-09-07', 'CASH_OUT', 5.000, 'Legacy drawer payout', '2026-09-07', NULL)
    `).run();

    // 2. Create expense linked to register cash
    const expRes = await request(app)
      .post('/api/accounting/expenses')
      .send({
        category: 'Cleaning',
        amount: 20.000,
        payment_source: 'REGISTER_CASH',
        session_id: 'ses-exp-1',
        description: 'Brooms & mop'
      });
    expect(expRes.status).toBe(201);
    const expId = expRes.body.id;

    // Verify linked movement exists
    const linkedMov: any = db.prepare('SELECT * FROM register_cash_movements WHERE expense_id = ?').get(expId);
    expect(linkedMov).toBeDefined();
    expect(linkedMov.amount).toBe(20.000);

    // 3. Delete expense
    const delRes = await request(app).delete(`/api/accounting/expenses/${expId}`);
    expect(delRes.status).toBe(200);

    // Verify both expense and linked movement are deleted
    const deletedExp = db.prepare('SELECT * FROM general_expenses WHERE id = ?').get(expId);
    expect(deletedExp).toBeUndefined();
    const deletedMov = db.prepare('SELECT * FROM register_cash_movements WHERE expense_id = ?').get(expId);
    expect(deletedMov).toBeUndefined();

    // Verify legacy movement is untouched
    const legacyMov = db.prepare('SELECT * FROM register_cash_movements WHERE id = ?').get('legacy-mov');
    expect(legacyMov).toBeDefined();
  });

  it('reconciles cash-flow ledger: money in (sales, debt payments) vs money out (purchases, expenses, refunds)', async () => {
    const db = getDb();

    // 1. Sale with cash: 100.000 DT
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-exp-1',
        items: [{ is_quick_add: true, quick_add_name: 'Bulk Detergent', quantity: 1, unit_price: 100.000 }],
        cash_paid: 100.000,
        cash_tendered: 100.000
      });
    expect(saleRes.status).toBe(201);

    // 2. Supplier purchase: 60.000 DT paid directly in cash
    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-cf', 'CF Supplier', '2026-09-07', '2026-09-07')
    `).run();

    const purchaseRes = await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: 'sup-cf',
        purchase_number: 'PO-CF-1',
        date: '2026-09-07',
        payment_status: 'PAID',
        payment_method: 'CASH',
        items: [
          { item_type: 'RAW_MATERIAL', material_id: 'mat-labsa-acc', quantity: 12, unit_cost: 5.000, total_cost: 60.000 }
        ]
      });
    expect(purchaseRes.status).toBe(201);

    // 3. General expense: 15.000 DT
    const expRes = await request(app)
      .post('/api/accounting/expenses')
      .send({
        category: 'Maintenance',
        amount: 15.000,
        payment_source: 'REGISTER_CASH',
        session_id: 'ses-exp-1'
      });
    expect(expRes.status).toBe(201);

    // Total In = 100.000 DT, Total Out = 60.000 + 15.000 = 75.000 DT, Net = 25.000 DT
    const cashFlowRes = await request(app).get('/api/accounting/cash-flow');
    expect(cashFlowRes.status).toBe(200);
    expect(cashFlowRes.body.money_in.total_in).toBe(100.000);
    expect(cashFlowRes.body.money_out.total_out).toBe(75.000);
    expect(cashFlowRes.body.net_cash_flow).toBe(25.000);
  });

  it('computes stock valuation at cost for raw materials and finished goods via GET /api/accounting/stock-valuation', async () => {
    // Current state:
    // Raw material: mat-labsa-acc: 100 kg @ 5.000 DT/kg = 500.000 DT
    // Product: prod-acc-1l: 50 pcs @ cost_reference 1.800 DT/pc = 90.000 DT
    // Total valuation = 500 + 90 = 590.000 DT

    const valRes = await request(app).get('/api/accounting/stock-valuation');
    expect(valRes.status).toBe(200);
    expect(valRes.body.raw_materials_valuation).toBe(500.000);
    expect(valRes.body.finished_goods_valuation).toBe(90.000);
    expect(valRes.body.total_stock_valuation).toBe(590.000);
  });
});
