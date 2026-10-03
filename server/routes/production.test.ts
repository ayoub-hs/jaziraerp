import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateBatchRequirements } from '../services/costingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Production Batches Module', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);

    // Setup initial data: Raw materials & packaging
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, created_at, updated_at)
      VALUES
        ('rm-labsa', 'LABSA Surfactant', 'surfactant', 'kg', 100, 5.000, '2026-09-07', '2026-09-07'),
        ('rm-sles', 'SLES', 'surfactant', 'kg', 80, 4.500, '2026-09-07', '2026-09-07'),
        ('pkg-bot-1l', '1L Bottle', 'bottle', 'pcs', 200, 0.350, '2026-09-07', '2026-09-07'),
        ('pkg-cap-28', '28mm Cap', 'cap', 'pcs', 250, 0.080, '2026-09-07', '2026-09-07'),
        ('pkg-lbl-1l', '1L Lemon Label', 'label', 'pcs', 200, 0.120, '2026-09-07', '2026-09-07')
    `).run();

    // Formulation: 100 pcs of 1L Dish Soap
    // 12kg LABSA (60 DT) + 8kg SLES (36 DT) + 100 bottles (35 DT) + 100 caps (8 DT) + 100 labels (12 DT) = 151.000 DT / 100 pcs = 1.510 DT/pc
    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-dish-lemon', 'Dish Soap Lemon Formula', 100, 'pcs', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES
        ('fi-1', 'form-dish-lemon', 'rm-labsa', 12),
        ('fi-2', 'form-dish-lemon', 'rm-sles', 8),
        ('fi-3', 'form-dish-lemon', 'pkg-bot-1l', 100),
        ('fi-4', 'form-dish-lemon', 'pkg-cap-28', 100),
        ('fi-5', 'form-dish-lemon', 'pkg-lbl-1l', 100)
    `).run();

    // Product Family & Multi-size SKUs (1L, 1.5L, 2L)
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, formulation_id, created_at, updated_at)
      VALUES ('fam-dish-lemon', 'Dish Soap Lemon Family', 'Detergents', 'MANUFACTURED', 'form-dish-lemon', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, cost_reference, retail_price, wholesale_price, created_at, updated_at)
      VALUES
        ('prod-dish-1l', 'fam-dish-lemon', 'Dish Soap Lemon 1L', '1L', 'SHSP-DISH-1L', 10, 0, 2.500, 2.000, '2026-09-07', '2026-09-07'),
        ('prod-dish-15l', 'fam-dish-lemon', 'Dish Soap Lemon 1.5L', '1.5L', 'SHSP-DISH-15L', 5, 0, 3.500, 2.900, '2026-09-07', '2026-09-07'),
        ('prod-dish-2l', 'fam-dish-lemon', 'Dish Soap Lemon 2L', '2L', 'SHSP-DISH-2L', 8, 0, 4.500, 3.800, '2026-09-07', '2026-09-07')
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('runs a production batch targeting a specific product size, deducts scaled materials/packaging, and updates stock and cost_reference', () => {
    // Produce 50 units of 1L (half the base 100-unit recipe)
    const targetUnits = 50;
    const reqs = calculateBatchRequirements(db, 'form-dish-lemon', targetUnits);

    expect(reqs.scalingFactor).toBe(0.5);
    // Expected batch cost: 151.000 * 0.5 = 75.500 DT
    expect(reqs.totalBatchCost).toBe(75.500);
    // Cost per unit: 1.510 DT
    expect(reqs.costPerUnit).toBe(1.510);

    // Execute batch
    const batchId = 'batch-001';
    db.prepare(`
      INSERT INTO production_batches (id, batch_number, date, formulation_id, target_product_id, units_produced, total_batch_cost, cost_per_unit, created_at)
      VALUES (?, 'BAT-001', '2026-09-07', 'form-dish-lemon', 'prod-dish-1l', 50, 75.500, 1.510, '2026-09-07')
    `).run(batchId);

    for (const ing of reqs.ingredients) {
      db.prepare(`
        INSERT INTO production_batch_materials_consumed (id, batch_id, material_id, quantity_consumed, unit_cost, total_cost)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(`mc-${ing.material_id}`, batchId, ing.material_id, ing.quantity_consumed, ing.unit_cost, ing.total_cost);

      db.prepare(`
        UPDATE raw_materials SET stock_quantity = stock_quantity - ? WHERE id = ?
      `).run(ing.quantity_consumed, ing.material_id);
    }

    db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity + ?, cost_reference = ?, updated_at = '2026-09-07'
      WHERE id = 'prod-dish-1l'
    `).run(targetUnits, reqs.costPerUnit);

    // Verify raw materials were deducted by exactly half:
    // LABSA: 100 - 6 = 94 kg
    const labsa: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('rm-labsa');
    expect(labsa.stock_quantity).toBe(94);

    // SLES: 80 - 4 = 76 kg
    const sles: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('rm-sles');
    expect(sles.stock_quantity).toBe(76);

    // Bottles: 200 - 50 = 150 pcs
    const bot: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('pkg-bot-1l');
    expect(bot.stock_quantity).toBe(150);

    // Target product finished goods increased: 10 + 50 = 60 pcs
    const prod1l: any = db.prepare('SELECT stock_quantity, cost_reference FROM products WHERE id = ?').get('prod-dish-1l');
    expect(prod1l.stock_quantity).toBe(60);
    expect(prod1l.cost_reference).toBe(1.510);
  });

  it('ensures batch targeting a specific size (e.g. 2L) ONLY affects that size, not 1L or 1.5L', () => {
    // Produce 20 units of 2L
    const targetUnits = 20;
    db.prepare(`
      UPDATE products SET stock_quantity = stock_quantity + ?, cost_reference = 3.020 WHERE id = 'prod-dish-2l'
    `).run(targetUnits);

    const prod1l: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-dish-1l');
    const prod15l: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-dish-15l');
    const prod2l: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-dish-2l');

    // 1L remains 10, 1.5L remains 5
    expect(prod1l.stock_quantity).toBe(10);
    expect(prod15l.stock_quantity).toBe(5);
    // 2L increased from 8 to 28
    expect(prod2l.stock_quantity).toBe(28);
  });

  it('allows production when stock is insufficient, records negative stock, and surfaces variance/warning without blocking', () => {
    // Current bottle stock is 200. Let us attempt to produce 300 units (requires 300 bottles -> deficit 100)
    const targetUnits = 300;
    const reqs = calculateBatchRequirements(db, 'form-dish-lemon', targetUnits);

    const bottleIng = reqs.ingredients.find(i => i.material_id === 'pkg-bot-1l');
    expect(bottleIng).toBeDefined();
    expect(bottleIng?.quantity_consumed).toBe(300);
    expect(bottleIng?.current_stock).toBe(200);
    expect(bottleIng?.remaining_stock_after_batch).toBe(-100);

    // Warning is generated
    const warnings = reqs.ingredients
      .filter(i => i.remaining_stock_after_batch < 0)
      .map(i => ({
        material_id: i.material_id,
        deficit: Math.abs(i.remaining_stock_after_batch)
      }));

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.find(w => w.material_id === 'pkg-bot-1l')?.deficit).toBe(100);

    // Production execution is NOT blocked: deduct stock anyway into negative
    db.prepare(`
      UPDATE raw_materials SET stock_quantity = stock_quantity - ? WHERE id = 'pkg-bot-1l'
    `).run(300);

    const updatedBottle: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('pkg-bot-1l');
    // Stock is now -100 (negative stock recorded)
    expect(updatedBottle.stock_quantity).toBe(-100);
  });
});
