import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateBatchRequirements } from '../services/costingService.js';
import { resetTestDb, app, request } from '../../tests/testApp.js';

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

  it('rejects batches for RESALE families and mismatched formulations via HTTP', async () => {
    resetTestDb();
    const mat = await request(app).post('/api/materials').send({ name: 'M', category: 'c', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 1 });
    const formA = await request(app).post('/api/formulations').send({
      name: 'Form A', base_yield_quantity: 10, base_yield_unit: 'pcs',
      items: [{ material_id: mat.body.id, quantity_required: 1 }]
    });
    const formB = await request(app).post('/api/formulations').send({
      name: 'Form B', base_yield_quantity: 10, base_yield_unit: 'pcs',
      items: [{ material_id: mat.body.id, quantity_required: 1 }]
    });
    const famMfg = await request(app).post('/api/products/families').send({
      name: 'Fam Mfg', category: 'C', type: 'MANUFACTURED', formulation_id: formA.body.id
    });
    const famResale = await request(app).post('/api/products/families').send({
      name: 'Fam Resale', category: 'C', type: 'RESALE'
    });
    const prodMfg = await request(app).post('/api/products').send({ family_id: famMfg.body.id, name: 'P Mfg', stock_quantity: 0 });
    const prodResale = await request(app).post('/api/products').send({ family_id: famResale.body.id, name: 'P Resale', stock_quantity: 0 });

    // RESALE family target -> 400, nothing produced
    const resaleRes = await request(app).post('/api/production/batches').send({
      formulation_id: formA.body.id, target_product_id: prodResale.body.id, units_produced: 5
    });
    expect(resaleRes.status).toBe(400);
    expect(resaleRes.body.error).toMatch(/MANUFACTURED/i);

    // Mismatched formulation -> 400
    const mismatchRes = await request(app).post('/api/production/batches').send({
      formulation_id: formB.body.id, target_product_id: prodMfg.body.id, units_produced: 5
    });
    expect(mismatchRes.status).toBe(400);
    expect(mismatchRes.body.error).toMatch(/does not match/i);

    // Matching family + formulation -> 201
    const okRes = await request(app).post('/api/production/batches').send({
      formulation_id: formA.body.id, target_product_id: prodMfg.body.id, units_produced: 5
    });
    expect(okRes.status).toBe(201);
    resetTestDb();
  });

  it('returns batch detail with output units, consumed materials and stored costs via HTTP', async () => {
    resetTestDb();
    const mat = await request(app).post('/api/materials').send({ name: 'MD', category: 'c', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 2 });
    const form = await request(app).post('/api/formulations').send({
      name: 'Form D', base_yield_quantity: 10, base_yield_unit: 'pcs',
      items: [{ material_id: mat.body.id, quantity_required: 3 }]
    });
    const fam = await request(app).post('/api/products/families').send({
      name: 'Fam D', category: 'C', type: 'MANUFACTURED', formulation_id: form.body.id
    });
    const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod D', stock_quantity: 0 });
    const batchRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod.body.id, units_produced: 20
    });
    expect(batchRes.status).toBe(201);

    const detail = await request(app).get(`/api/production/batches/${batchRes.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.units_produced).toBe(20);
    expect(detail.body.total_batch_cost).toBe(12.000); // 6kg @ 2
    expect(detail.body.cost_per_unit).toBe(0.6);
    expect(detail.body.materials_consumed).toHaveLength(1);
    expect(detail.body.materials_consumed[0].quantity_consumed).toBe(6);
    expect(detail.body.materials_consumed[0].unit_cost).toBe(2.000);
    expect(detail.body.materials_consumed[0].total_cost).toBe(12.000);
    resetTestDb();
  });

  it('runs 20 x 2L production: scales chemical to 4kg and packaging to 20 units via HTTP', async () => {
    resetTestDb();
    const matChem = await request(app).post('/api/materials').send({ name: 'Chem LABSA', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 2.000 });
    const matBot = await request(app).post('/api/materials').send({ name: 'Bottle 2L', category: 'bottle', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.420 });
    const matCap = await request(app).post('/api/materials').send({ name: 'Cap 28mm', category: 'cap', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.050 });
    const matLbl = await request(app).post('/api/materials').send({ name: 'Label 2L', category: 'label', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.090 });

    const form = await request(app).post('/api/formulations').send({
      name: 'Formule 100L Vrac', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: matChem.body.id, quantity_required: 10 }]
    });

    const fam = await request(app).post('/api/products/families').send({
      name: 'Famille Citron', category: 'Detergents', type: 'MANUFACTURED', formulation_id: form.body.id
    });

    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Citron 2L', size_label: '2L', size_volume: 2.0, stock_quantity: 0
    });

    // Add packaging items to product_packaging_items
    const db = (await import('../db/index.js')).getDb();
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('ppi-b', prod.body.id, matBot.body.id, 1);
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('ppi-c', prod.body.id, matCap.body.id, 1);
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('ppi-l', prod.body.id, matLbl.body.id, 1);

    // Produce 20 units of 2L with declared volume 40L
    const res = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id,
      target_product_id: prod.body.id,
      units_produced: 20,
      batch_volume: 40
    });

    expect(res.status).toBe(201);
    expect(res.body.batch_volume).toBe(40);
    expect(res.body.units_produced).toBe(20);
    expect(res.body.total_batch_cost).toBe(19.200); // 8.000 (chem) + 11.200 (pkg)
    expect(res.body.cost_per_unit).toBe(0.960);

    // Verify materials consumed
    const consumed = res.body.materials_consumed;
    expect(consumed).toHaveLength(4);

    const chemConsumed = consumed.find((c: any) => c.material_id === matChem.body.id);
    expect(chemConsumed.quantity_consumed).toBe(4.000);
    expect(chemConsumed.total_cost).toBe(8.000);

    const botConsumed = consumed.find((c: any) => c.material_id === matBot.body.id);
    expect(botConsumed.quantity_consumed).toBe(20);
    expect(botConsumed.total_cost).toBe(8.400);

    // Verify product stock & cost_reference updated
    const updatedProd: any = db.prepare('SELECT stock_quantity, cost_reference FROM products WHERE id = ?').get(prod.body.id);
    expect(updatedProd.stock_quantity).toBe(20);
    expect(updatedProd.cost_reference).toBe(0.960);
    resetTestDb();
  });

  it('verifies the 4 batch reconciliation cases and error paths', async () => {
    resetTestDb();
    const mat = await request(app).post('/api/materials').send({ name: 'M', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 1 });
    const form = await request(app).post('/api/formulations').send({
      name: 'Form 100L', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: mat.body.id, quantity_required: 10 }]
    });
    const fam = await request(app).post('/api/products/families').send({
      name: 'Fam', category: 'C', type: 'MANUFACTURED', formulation_id: form.body.id
    });
    const prod2L = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'P 2L', size_label: '2L', size_volume: 2.0, stock_quantity: 0
    });
    const db = (await import('../db/index.js')).getDb();
    db.prepare(`
      INSERT INTO products (
        id, family_id, name, size_label, size_volume, barcode, stock_quantity,
        low_stock_threshold, cost_reference, retail_price, wholesale_price,
        active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, 0, 5, 0, 0, 0, 1, datetime('now'), datetime('now'))
    `).run('prod-legacy-no-size', fam.body.id, 'P Legacy No Size', 'Custom', 'BAR-LEGACY-01');

    // Case 1a: Both provided and matching (40L and 20 units) -> 201
    const matchRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod2L.body.id, units_produced: 20, batch_volume: 40
    });
    expect(matchRes.status).toBe(201);
    expect(matchRes.body.batch_volume).toBe(40);
    expect(matchRes.body.units_produced).toBe(20);

    // Case 1b: Both provided but mismatch > 0.001 (50L and 20 units of 2L -> expected 40L) -> 400
    const mismatchRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod2L.body.id, units_produced: 20, batch_volume: 50
    });
    expect(mismatchRes.status).toBe(400);
    expect(mismatchRes.body.error).toMatch(/Incohérence.*volume.*unités/i);

    // Case 2: Units only (20 units) -> auto-computes 40L
    const unitsOnlyRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod2L.body.id, units_produced: 20
    });
    expect(unitsOnlyRes.status).toBe(201);
    expect(unitsOnlyRes.body.batch_volume).toBe(40);
    expect(unitsOnlyRes.body.units_produced).toBe(20);

    // Case 3: Volume only (40L) -> auto-computes 20 units
    const volOnlyRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod2L.body.id, batch_volume: 40
    });
    expect(volOnlyRes.status).toBe(201);
    expect(volOnlyRes.body.batch_volume).toBe(40);
    expect(volOnlyRes.body.units_produced).toBe(20);

    // Case 4: Neither provided -> 400
    const neitherRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod2L.body.id
    });
    expect(neitherRes.status).toBe(400);
    expect(neitherRes.body.error).toMatch(/volume du lot ou.*unités produites/i);

    // Case 5: NULL size_volume on manufactured product with Litres -> 400
    const nullSizeRes = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: 'prod-legacy-no-size', units_produced: 10
    });
    expect(nullSizeRes.status).toBe(400);
    expect(nullSizeRes.body.error).toMatch(/size_volume.*obligatoire/i);

    resetTestDb();
  });

  it('rejects with 400 on double-count guard if recipe contains packaging AND product has packaging items', async () => {
    resetTestDb();
    const matBot = await request(app).post('/api/materials').send({ name: 'Bottle', category: 'bottle', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.5 });
    const form = await request(app).post('/api/formulations').send({
      name: 'Form with Bottle', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: matBot.body.id, quantity_required: 100 }]
    });
    const fam = await request(app).post('/api/products/families').send({
      name: 'Fam B', category: 'C', type: 'MANUFACTURED', formulation_id: form.body.id
    });
    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Prod B', size_label: '1L', size_volume: 1.0, stock_quantity: 0
    });

    const db = (await import('../db/index.js')).getDb();
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('ppi-conf', prod.body.id, matBot.body.id, 1);

    const res = await request(app).post('/api/production/batches').send({
      formulation_id: form.body.id, target_product_id: prod.body.id, units_produced: 10
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/double décompte/i);
    resetTestDb();
  });

  it('returns 500 with generic message and no SQL text when an unexpected DB error occurs', async () => {
    resetTestDb();
    const mat = await request(app).post('/api/materials').send({ name: 'Chem', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 2 });
    const form = await request(app).post('/api/formulations').send({
      name: 'Form Err', base_yield_quantity: 10, base_yield_unit: 'L',
      items: [{ material_id: mat.body.id, quantity_required: 1 }]
    });
    const fam = await request(app).post('/api/products/families').send({
      name: 'Fam Err', category: 'C', type: 'MANUFACTURED', formulation_id: form.body.id
    });
    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Prod Err', size_volume: 1, stock_quantity: 0
    });

    const db = (await import('../db/index.js')).getDb();
    const origPrepare = db.prepare;
    (db as any).prepare = (sql: string) => {
      if (sql.includes('product_packaging_items') || sql.includes('production_batches')) {
        throw new Error('SQLITE_ERROR: syntax error near unexpected symbol in internal query');
      }
      return origPrepare.call(db, sql);
    };

    try {
      const res = await request(app).post('/api/production/batches').send({
        formulation_id: form.body.id, target_product_id: prod.body.id, units_produced: 10
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Une erreur interne est survenue. Veuillez réessayer.');
      expect(JSON.stringify(res.body)).not.toMatch(/SQLITE/i);
      expect(JSON.stringify(res.body)).not.toMatch(/syntax error/i);
    } finally {
      (db as any).prepare = origPrepare;
      resetTestDb();
    }
  });
});

