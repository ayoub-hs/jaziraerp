import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateFormulationCost, calculateBatchRequirements } from '../services/costingService.js';
import { recordMaterialPriceHistory } from './materials.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Formulations & Recipe Costing Module', () => {
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

  it('creates a formulation linking multiple raw materials and packaging items with correct quantities', () => {
    // 1. Setup raw materials & packaging
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES
        ('mat-labsa', 'Sulfonic Acid LABSA', 'surfactant', 'kg', 500, 5.000, '2026-09-07', '2026-09-07'),
        ('mat-sles', 'SLES 70%', 'surfactant', 'kg', 300, 4.500, '2026-09-07', '2026-09-07'),
        ('mat-frag', 'Lemon Fragrance', 'fragrance', 'kg', 20, 38.000, '2026-09-07', '2026-09-07'),
        ('pkg-bot', '1L PET Bottle', 'bottle', 'pcs', 1000, 0.350, '2026-09-07', '2026-09-07'),
        ('pkg-cap', 'Screw Cap 28mm', 'cap', 'pcs', 1000, 0.080, '2026-09-07', '2026-09-07'),
        ('pkg-lbl', 'Lemon Label 1L', 'label', 'pcs', 1000, 0.120, '2026-09-07', '2026-09-07')
    `).run();

    // 2. Create formulation for 100 Liters / 100 Bottles of Dish Soap Lemon 1L
    db.prepare(`
      INSERT INTO formulations (id, name, notes, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-dish-1l', 'Dish Soap Lemon 1L Formula', 'Standard commercial formula', 100, 'pcs', '2026-09-07', '2026-09-07')
    `).run();

    // 3. Link ingredients and packaging
    const insertItem = db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES (?, 'form-dish-1l', ?, ?)
    `);

    // Chemical recipe for 100L:
    // LABSA: 12 kg @ 5.000 = 60.000 DT
    // SLES: 8 kg @ 4.500 = 36.000 DT
    // Fragrance: 0.5 kg @ 38.000 = 19.000 DT
    // Packaging for 100 finished bottles:
    // Bottle: 100 pcs @ 0.350 = 35.000 DT
    // Cap: 100 pcs @ 0.080 = 8.000 DT
    // Label: 100 pcs @ 0.120 = 12.000 DT
    insertItem.run('fi-1', 'mat-labsa', 12);
    insertItem.run('fi-2', 'mat-sles', 8);
    insertItem.run('fi-3', 'mat-frag', 0.5);
    insertItem.run('fi-4', 'pkg-bot', 100);
    insertItem.run('fi-5', 'pkg-cap', 100);
    insertItem.run('fi-6', 'pkg-lbl', 100);

    const costInfo = calculateFormulationCost(db, 'form-dish-1l');

    // Total cost = 60 + 36 + 19 + 35 + 8 + 12 = 170.000 DT
    expect(costInfo.total_cost).toBe(170.000);
    // Cost per unit = 170.000 / 100 = 1.700 DT
    expect(costInfo.cost_per_unit).toBe(1.700);
    expect(costInfo.items.length).toBe(6);
  });

  it('dynamically updates formulation cost when raw material purchase price changes', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES
        ('mat-labsa2', 'Sulfonic Acid LABSA', 'surfactant', 'kg', 100, 5.000, '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-simple', 'Simple LABSA Dilution', 10, 'kg', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES ('fi-simple-1', 'form-simple', 'mat-labsa2', 10)
    `).run();

    // Initially: 10 kg @ 5.000 DT = 50.000 DT total, 5.000 DT/unit
    let cost = calculateFormulationCost(db, 'form-simple');
    expect(cost.total_cost).toBe(50.000);
    expect(cost.cost_per_unit).toBe(5.000);

    // Purchase LABSA at higher price: 6.200 DT
    recordMaterialPriceHistory(db, {
      materialId: 'mat-labsa2',
      costPerUnit: 6.200,
      quantityAdded: 50
    });

    // Re-calculating must reflect the updated purchase cost: 10 * 6.200 = 62.000 DT
    cost = calculateFormulationCost(db, 'form-simple');
    expect(cost.total_cost).toBe(62.000);
    expect(cost.cost_per_unit).toBe(6.200);
  });

  it('correctly calculates scaled batch requirements and proportional costs', () => {
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES
        ('mat-soap-base', 'Soap Base', 'surfactant', 'kg', 200, 4.000, '2026-09-07', '2026-09-07'),
        ('pkg-bottle-500', '500ml Bottle', 'bottle', 'pcs', 300, 0.250, '2026-09-07', '2026-09-07')
    `).run();

    // Base yield is 100 pcs: 10 kg Soap Base + 100 Bottles
    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-500ml', '500ml Hand Soap', 100, 'pcs', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES
        ('fi-hb-1', 'form-500ml', 'mat-soap-base', 10),
        ('fi-hb-2', 'form-500ml', 'pkg-bottle-500', 100)
    `).run();

    // Scale batch to target 250 pcs (scaling factor = 2.5)
    const batchReq = calculateBatchRequirements(db, 'form-500ml', 250);

    expect(batchReq.scalingFactor).toBe(2.5);
    expect(batchReq.targetOutputUnits).toBe(250);

    // Soap base: 10 * 2.5 = 25 kg @ 4.000 DT = 100.000 DT
    const soapBase = batchReq.ingredients.find(i => i.material_id === 'mat-soap-base');
    expect(soapBase?.quantity_consumed).toBe(25);
    expect(soapBase?.total_cost).toBe(100.000);

    // Bottles: 100 * 2.5 = 250 pcs @ 0.250 DT = 62.500 DT
    const bottles = batchReq.ingredients.find(i => i.material_id === 'pkg-bottle-500');
    expect(bottles?.quantity_consumed).toBe(250);
    expect(bottles?.total_cost).toBe(62.500);

    // Total batch cost = 162.500 DT
    expect(batchReq.totalBatchCost).toBe(162.500);
    // Cost per unit = 162.500 / 250 = 0.650 DT
    expect(batchReq.costPerUnit).toBe(0.650);
  });
});
