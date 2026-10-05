import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Delete Guards & 409 Conflict Responses (Item 22)', () => {
  beforeEach(() => {
    const db = resetTestDb();
    const now = new Date().toISOString();

    // Seed test product family
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-test', 'Family Test', 'Cleaners', 'MANUFACTURED', ?, ?)
    `).run(now, now);

    // Seed product
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-test', 'fam-test', 'Product Test', '1L', '123456789012', 10, 5.0, 4.0, ?, ?)
    `).run(now, now);

    // Seed formulation
    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-test', 'Formulation Test', 100, 'L', ?, ?)
    `).run(now, now);

    // Seed raw material
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-test', 'Material Test', 'Chemicals', 'KG', 100, 2.5, ?, ?)
    `).run(now, now);
  });

  it('rejects formulation deletion with 409 when referenced in production batches', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO production_batches (id, batch_number, date, formulation_id, target_product_id, units_produced, total_batch_cost, cost_per_unit, created_at)
      VALUES ('batch-1', 'BATCH-001', '2026-09-01', 'form-test', 'prod-test', 50, 100, 2, ?)
    `).run(now);

    const res = await request(app).delete('/api/formulations/form-test');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('production batches');
  });

  it('rejects pack size deletion with 409 when referenced in sale items', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, barcode)
      VALUES ('pack-test', 'prod-test', 'Box of 6', 6, '999999999999')
    `).run();

    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
      VALUES ('ses-test', 'S-01', 'Countertop', ?, 100, 100, 'OPEN')
    `).run(now);

    db.prepare(`
      INSERT INTO sales (id, receipt_number, session_id, date, subtotal_ht, tva_rate, tva_amount, total_ttc, total_discount, cash_paid, wallet_paid, credit_amount, change_given, status, created_at)
      VALUES ('sale-test', 'REC-001', 'ses-test', ?, 20, 0.19, 3.8, 23.8, 0, 23.8, 0, 0, 0, 'COMPLETED', ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO sale_items (id, sale_id, product_id, is_quick_add, pack_size_id, pack_multiplier, quantity, quantity_refunded, base_stock_deducted, unit_price, line_total)
      VALUES ('si-test', 'sale-test', 'prod-test', 0, 'pack-test', 6, 1, 0, 6, 23.8, 23.8)
    `).run();

    const res = await request(app).delete('/api/products/pack-sizes/pack-test');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('sales history');
  });

  it('rejects raw material deletion with 409 when referenced in inventory adjustments', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO inventory_adjustments (id, date, item_type, material_id, quantity_delta, reason, created_at)
      VALUES ('adj-mat-1', '2026-09-01', 'RAW_MATERIAL', 'mat-test', -5, 'Spillage', ?)
    `).run(now);

    const res = await request(app).delete('/api/materials/mat-test');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Cannot delete raw material');
  });

  it('rejects product deletion with 409 when referenced in inventory adjustments', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO inventory_adjustments (id, date, item_type, product_id, quantity_delta, reason, created_at)
      VALUES ('adj-prod-1', '2026-09-01', 'PRODUCT', 'prod-test', -2, 'Damaged bottle', ?)
    `).run(now);

    const res = await request(app).delete('/api/products/prod-test');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Cannot delete product');
  });

  it('allows unreferenced formulations, pack sizes, materials, and products to be deleted', async () => {
    const db = getDb();

    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, barcode)
      VALUES ('pack-unused', 'prod-test', 'Pack of 2', 2, '888888888888')
    `).run();

    const delPack = await request(app).delete('/api/products/pack-sizes/pack-unused');
    expect(delPack.status).toBe(200);

    const delProd = await request(app).delete('/api/products/prod-test');
    expect(delProd.status).toBe(200);

    const delMat = await request(app).delete('/api/materials/mat-test');
    expect(delMat.status).toBe(200);

    const delForm = await request(app).delete('/api/formulations/form-test');
    expect(delForm.status).toBe(200);
  });
});
