import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getMaterialUnitCosts,
  getMaterialUnitCost,
  calculateFormulationCost,
  calculateBatchRequirements
} from './costingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('costingService: Quantity-Weighted Average Costing', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);
  });

  afterEach(() => {
    db.close();
  });

  // a. Material with no purchases in the target year: returns latest_purchase_cost.
  it('a) returns latest_purchase_cost when material has no purchases in target year', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-a', 'Material A', 'chemical', 'kg', 10, 7.500, '2026-01-01', '2026-01-01')
    `).run();

    // No purchases at all
    expect(getMaterialUnitCost(db, 'mat-a', 2026)).toBe(7.500);
    const costMap = getMaterialUnitCosts(db, 2026);
    expect(costMap.get('mat-a')).toBe(7.500);
  });

  // b. Material with 2 purchases in the target year (e.g. 10 kg @ 5 DT, 20 kg @ 4 DT = 130 / 30 = 4.333 DT): returns 4.333.
  it('b) returns 4.333 for 2 purchases in target year (10 kg @ 5 DT, 20 kg @ 4 DT = 130 / 30 = 4.333 DT)', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-b', 'Material B', 'chemical', 'kg', 0, 5.000, '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-1', 'Supplier 1', '2026-01-01', '2026-01-01')
    `).run();

    // Purchase 1: 10 kg @ 5.000 DT = 50.000 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-1', 'PO-001', 'sup-1', '2026-02-10', 50.000, 'PAID', '2026-02-10')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-1', 'po-1', 'RAW_MATERIAL', 'mat-b', 10, 5.000, 50.000)
    `).run();

    // Purchase 2: 20 kg @ 4.000 DT = 80.000 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-2', 'PO-002', 'sup-1', '2026-03-15', 80.000, 'PAID', '2026-03-15')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-2', 'po-2', 'RAW_MATERIAL', 'mat-b', 20, 4.000, 80.000)
    `).run();

    // 130 / 30 = 4.333333... -> round3 = 4.333
    expect(getMaterialUnitCost(db, 'mat-b', 2026)).toBe(4.333);
    const costMap = getMaterialUnitCosts(db, 2026);
    expect(costMap.get('mat-b')).toBe(4.333);
  });

  // d. Purchases with year < target year: ignored.
  it('d) ignores purchases with year < target year', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-d', 'Material D', 'chemical', 'kg', 0, 2.500, '2025-01-01', '2025-01-01')
    `).run();

    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-d', 'Supplier D', '2025-01-01', '2025-01-01')
    `).run();

    // Purchase in 2025 (prior year): 100 kg @ 10.000 DT = 1000.000 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-d1', 'PO-D1', 'sup-d', '2025-12-15', 1000.000, 'PAID', '2025-12-15')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-d1', 'po-d1', 'RAW_MATERIAL', 'mat-d', 100, 10.000, 1000.000)
    `).run();

    // In 2026: with no 2026 purchases, the 2025 purchase is ignored and falls back to latest_purchase_cost (2.500)
    expect(getMaterialUnitCost(db, 'mat-d', 2026)).toBe(2.500);

    // Now add a 2026 purchase: 10 kg @ 3.000 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-d2', 'PO-D2', 'sup-d', '2026-01-10', 30.000, 'PAID', '2026-01-10')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-d2', 'po-d2', 'RAW_MATERIAL', 'mat-d', 10, 3.000, 30.000)
    `).run();

    // In 2026: unit cost should be 3.000 DT, ignoring the 2025 purchase of 100 kg @ 10.000
    expect(getMaterialUnitCost(db, 'mat-d', 2026)).toBe(3.000);
  });

  // e. Purchases of item_type='RESALE_PRODUCT': ignored.
  it('e) ignores purchases of item_type="RESALE_PRODUCT"', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-e', 'Material E', 'chemical', 'kg', 0, 1.200, '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-resale', 'Resale Fam', 'Resale', 'RESALE', '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, cost_reference, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-resale', 'fam-resale', 'Resale Sponge', '1pc', 'SPONGE', 0, 0.500, 2.000, 1.500, '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-e', 'Supplier E', '2026-01-01', '2026-01-01')
    `).run();

    // Purchase contains both RESALE_PRODUCT and RAW_MATERIAL
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-e', 'PO-E', 'sup-e', '2026-05-01', 520.000, 'PAID', '2026-05-01')
    `).run();
    // Resale item: 100 units @ 5.000 DT = 500.000 DT
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, product_id, quantity, unit_cost, total_cost)
      VALUES ('pi-e1', 'po-e', 'RESALE_PRODUCT', 'prod-resale', 100, 5.000, 500.000)
    `).run();
    // Raw material item: 10 kg @ 2.000 DT = 20.000 DT
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-e2', 'po-e', 'RAW_MATERIAL', 'mat-e', 10, 2.000, 20.000)
    `).run();

    // Material E unit cost should only be based on the RAW_MATERIAL line: 20.000 / 10 = 2.000 DT
    expect(getMaterialUnitCost(db, 'mat-e', 2026)).toBe(2.000);
  });

  it('calculates formulation cost and batch requirements using weighted average', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES ('mat-f', 'Material F', 'surfactant', 'kg', 150, 3.000, '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO suppliers (id, name, created_at, updated_at)
      VALUES ('sup-f', 'Supplier F', '2026-01-01', '2026-01-01')
    `).run();

    // 100 kg @ 3.000 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-f1', 'PO-F1', 'sup-f', '2026-01-10', 300.000, 'PAID', '2026-01-10')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-f1', 'po-f1', 'RAW_MATERIAL', 'mat-f', 100, 3.000, 300.000)
    `).run();

    // 50 kg @ 3.200 DT
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, created_at)
      VALUES ('po-f2', 'PO-F2', 'sup-f', '2026-02-10', 160.000, 'PAID', '2026-02-10')
    `).run();
    db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, quantity, unit_cost, total_cost)
      VALUES ('pi-f2', 'po-f2', 'RAW_MATERIAL', 'mat-f', 50, 3.200, 160.000)
    `).run();

    // Weighted unit cost = 460 / 150 = 3.067 DT
    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-f', 'Formula F', 1, 'unit', '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES ('fi-f1', 'form-f', 'mat-f', 1)
    `).run();

    const formCost = calculateFormulationCost(db, 'form-f', 2026);
    expect(formCost.total_cost).toBe(3.067);
    expect(formCost.cost_per_unit).toBe(3.067);

    // Batch of 20 units -> 20 kg @ 3.067 = 61.340 DT
    const batchReq = calculateBatchRequirements(db, 'form-f', 20, 2026);
    expect(batchReq.totalBatchCost).toBe(61.340);
    expect(batchReq.costPerUnit).toBe(3.067);
  });
});
