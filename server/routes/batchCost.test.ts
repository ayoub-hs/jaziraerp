import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';
import { getDb } from '../db/index.js';

describe('Size Volume Backfill & Batch Cost Endpoints (Commit 4)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  function setupTestData() {
    const db = getDb();
    const now = new Date().toISOString();

    // 1. Raw Materials
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, low_stock_threshold, latest_purchase_cost, created_at, updated_at)
      VALUES 
        ('mat-acid', 'Acide Sulfonique', 'chemical', 'kg', 500, 50, 4.000, ?, ?),
        ('mat-b15', 'Bouteille 1.5L', 'bottle', 'pcs', 1000, 100, 0.350, ?, ?),
        ('mat-b2', 'Bouteille 2L', 'bottle', 'pcs', 800, 100, 0.420, ?, ?),
        ('mat-cap', 'Bouchon Standard', 'cap', 'pcs', 2000, 200, 0.050, ?, ?),
        ('mat-lbl15', 'Etiquette 1.5L', 'label', 'pcs', 1500, 150, 0.080, ?, ?),
        ('mat-lbl2', 'Etiquette 2L', 'label', 'pcs', 1200, 150, 0.090, ?, ?)
    `).run(now, now, now, now, now, now, now, now, now, now, now, now);

    // 2. Bulk Formulation: 100 L requires 20 kg acid (20 * 4.000 = 80.000 DT / 100 L = 0.800 DT/L)
    db.prepare(`
      INSERT INTO formulations (id, name, base_yield_quantity, base_yield_unit, created_at, updated_at)
      VALUES ('form-bulk-1', 'Formule Vaisselle Vrac 100L', 100, 'L', ?, ?)
    `).run(now, now);

    db.prepare(`
      INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
      VALUES ('fi-1', 'form-bulk-1', 'mat-acid', 20)
    `).run();

    // 3. Product Families
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, formulation_id, created_at, updated_at)
      VALUES 
        ('fam-mfg', 'Liquide Vaisselle Citron', 'Detergents', 'MANUFACTURED', 'form-bulk-1', ?, ?),
        ('fam-resale', 'Éponge Abrasive', 'Accessoires', 'RESALE', NULL, ?, ?)
    `).run(now, now, now, now);

    // 4. Products:
    // - prod-15: MANUFACTURED, size_label='1.5L', size_volume=NULL, stock=20, cost_reference=1.000
    // - prod-2: MANUFACTURED, size_label='2 L', size_volume=NULL, stock=10, cost_reference=1.200
    // - prod-vrac: MANUFACTURED, size_label='Vrac', size_volume=NULL, stock=50, cost_reference=0.500
    // - prod-unknown: MANUFACTURED, size_label='Format Mystère', size_volume=NULL, stock=5, cost_reference=1.000
    // - prod-ready: MANUFACTURED, size_label='1.5L', size_volume=1.5, stock=15, cost_reference=1.680
    // - prod-resale: RESALE, size_label='Unité', size_volume=NULL, stock=100, cost_reference=0.500
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, size_volume, barcode, stock_quantity, low_stock_threshold, cost_reference, retail_price, wholesale_price, active, created_at, updated_at)
      VALUES
        ('prod-15', 'fam-mfg', 'Liquide Vaisselle 1.5L', '1.5L', NULL, 'BC-15', 20, 5, 1.000, 2.500, 2.000, 1, ?, ?),
        ('prod-2', 'fam-mfg', 'Liquide Vaisselle 2L', '2 L', NULL, 'BC-2', 10, 5, 1.200, 3.200, 2.800, 1, ?, ?),
        ('prod-vrac', 'fam-mfg', 'Liquide Vaisselle Vrac', 'Vrac', NULL, 'BC-VRAC', 50, 5, 0.500, 1.200, 1.000, 1, ?, ?),
        ('prod-unknown', 'fam-mfg', 'Liquide Vaisselle Mystère', 'Format Mystère', NULL, 'BC-UNK', 5, 5, 1.000, 2.000, 1.800, 1, ?, ?),
        ('prod-ready', 'fam-mfg', 'Liquide Vaisselle Déjà Configuré', '1.5L', 1.5, 'BC-RDY', 15, 5, 1.680, 2.500, 2.000, 1, ?, ?),
        ('prod-resale', 'fam-resale', 'Éponge Simple', 'Unité', NULL, 'BC-RES', 100, 10, 0.500, 1.000, 0.800, 1, ?, ?)
    `).run(now, now, now, now, now, now, now, now, now, now, now, now);

    // 5. Packaging Items for prod-15 (bottle 0.350 + cap 0.050 + label 0.080 = 0.480)
    // When size_volume is 1.5, bulk part = 1.5 * 0.800 = 1.200. Total expected cost = 1.200 + 0.480 = 1.680 DT
    db.prepare(`
      INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit)
      VALUES 
        ('pkg-15-1', 'prod-15', 'mat-b15', 1),
        ('pkg-15-2', 'prod-15', 'mat-cap', 1),
        ('pkg-15-3', 'prod-15', 'mat-lbl15', 1),
        ('pkg-ready-1', 'prod-ready', 'mat-b15', 1),
        ('pkg-ready-2', 'prod-ready', 'mat-cap', 1),
        ('pkg-ready-3', 'prod-ready', 'mat-lbl15', 1)
    `).run();
  }

  describe('POST /api/products/backfill-size-preview', () => {
    it('returns candidates with NULL size_volume and parses suggested volumes', async () => {
      setupTestData();

      const res = await request(app).post('/api/products/backfill-size-preview');
      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(4); // prod-15, prod-2, prod-vrac, prod-unknown (ignores prod-ready and prod-resale)

      const c15 = res.body.candidates.find((c: any) => c.id === 'prod-15');
      expect(c15).toBeDefined();
      expect(c15.suggested_size_volume).toBe(1.5);
      expect(c15.size_label).toBe('1.5L');
      expect(c15.stock_quantity).toBe(20);
      expect(c15.current_cost).toBe(1.000);
      expect(c15.current_valuation).toBe(20.000);

      const c2 = res.body.candidates.find((c: any) => c.id === 'prod-2');
      expect(c2.suggested_size_volume).toBe(2.0);

      const cVrac = res.body.candidates.find((c: any) => c.id === 'prod-vrac');
      expect(cVrac.suggested_size_volume).toBe(1.0);

      const cUnk = res.body.candidates.find((c: any) => c.id === 'prod-unknown');
      expect(cUnk.suggested_size_volume).toBeNull();
    });
  });

  describe('POST /api/products/backfill-size-confirm', () => {
    it('validates input and rejects empty, invalid items, or already-set products', async () => {
      setupTestData();

      const resEmpty = await request(app).post('/api/products/backfill-size-confirm').send({ items: [] });
      expect(resEmpty.status).toBe(400);

      const resInvalidVol = await request(app).post('/api/products/backfill-size-confirm').send({
        items: [{ id: 'prod-15', size_volume: -1 }]
      });
      expect(resInvalidVol.status).toBe(400);

      const resResale = await request(app).post('/api/products/backfill-size-confirm').send({
        items: [{ id: 'prod-resale', size_volume: 1.0 }]
      });
      expect(resResale.status).toBe(400);
      expect(resResale.body.error).toMatch(/fabriqué/i);

      // prod-ready already has size_volume: 1.5 -> must be rejected
      const resAlreadySet = await request(app).post('/api/products/backfill-size-confirm').send({
        items: [{ id: 'prod-ready', size_volume: 2.0 }]
      });
      expect(resAlreadySet.status).toBe(400);
      expect(resAlreadySet.body.error).toMatch(/déjà/i);
    });

    it('updates size_volume in one transaction without changing cost_reference and returns total_valuation with dropped delta', async () => {
      setupTestData();
      const db = getDb();

      const res = await request(app).post('/api/products/backfill-size-confirm').send({
        items: [
          { id: 'prod-15', size_volume: 1.5 },
          { id: 'prod-2', size_volume: 2.0 }
        ]
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updated_count).toBe(2);
      // prod-15: 20 * 1.000 = 20.000; prod-2: 10 * 1.200 = 12.000 => total 32.000
      expect(res.body.total_valuation).toBe(32.000);
      expect(res.body.valuation_unchanged).toBe(true);
      expect(res.body.delta_valuation).toBeUndefined();

      const p15: any = db.prepare('SELECT size_volume, cost_reference FROM products WHERE id = ?').get('prod-15');
      expect(p15.size_volume).toBe(1.5);
      expect(p15.cost_reference).toBe(1.000); // INVARIANT: cost_reference UNCHANGED by backfill

      const p2: any = db.prepare('SELECT size_volume, cost_reference FROM products WHERE id = ?').get('prod-2');
      expect(p2.size_volume).toBe(2.0);
      expect(p2.cost_reference).toBe(1.200);
    });
  });

  describe('POST /api/products/batch-cost-preview', () => {
    it('previews unit cost and valuation deltas for manufactured products', async () => {
      setupTestData();

      // At setup, prod-ready has size_volume=1.5 and packaging (cost should be 1.680)
      // prod-15 has size_volume=NULL so its status must be 'size_manquante'
      const res = await request(app).post('/api/products/batch-cost-preview');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();

      const readyItem = res.body.items.find((i: any) => i.id === 'prod-ready');
      expect(readyItem).toBeDefined();
      expect(readyItem.status).toBe('ok');
      expect(readyItem.calculated_cost).toBe(1.680);
      expect(readyItem.current_cost).toBe(1.680);
      expect(readyItem.bulk_part).toBe(1.200);
      expect(readyItem.packaging_part).toBe(0.480);
      expect(readyItem.current_valuation).toBe(25.200);
      expect(readyItem.new_valuation).toBe(25.200);
      expect(readyItem.delta_valuation).toBe(0.000);

      const nullSizeItem = res.body.items.find((i: any) => i.id === 'prod-15');
      expect(nullSizeItem).toBeDefined();
      expect(nullSizeItem.status).toBe('size_manquante');
      expect(nullSizeItem.calculated_cost).toBeNull();
    });

    it('computes valuation delta accurately after size_volume backfill', async () => {
      setupTestData();
      const db = getDb();

      // Backfill prod-15 size_volume to 1.5
      db.prepare('UPDATE products SET size_volume = 1.5 WHERE id = ?').run('prod-15');

      const res = await request(app).post('/api/products/batch-cost-preview');
      expect(res.status).toBe(200);

      const p15 = res.body.items.find((i: any) => i.id === 'prod-15');
      expect(p15.status).toBe('ok');
      expect(p15.calculated_cost).toBe(1.680);
      expect(p15.current_cost).toBe(1.000);
      // stock=20: current_val = 20 * 1.000 = 20.000; new_val = 20 * 1.680 = 33.600; delta = +13.600
      expect(p15.current_valuation).toBe(20.000);
      expect(p15.new_valuation).toBe(33.600);
      expect(p15.delta_valuation).toBe(13.600);
    });
  });

  describe('POST /api/products/batch-cost-confirm', () => {
    it('validates input and rejects empty array, missing size, or negative cost', async () => {
      setupTestData();

      const resEmpty = await request(app).post('/api/products/batch-cost-confirm').send({ items: [] });
      expect(resEmpty.status).toBe(400);

      const resNeg = await request(app).post('/api/products/batch-cost-confirm').send({
        items: [{ id: 'prod-ready', new_cost: -0.5 }]
      });
      expect(resNeg.status).toBe(400);

      // prod-15 has NULL size_volume -> rejected
      const resNullSize = await request(app).post('/api/products/batch-cost-confirm').send({
        items: [{ id: 'prod-15', new_cost: 1.680 }]
      });
      expect(resNullSize.status).toBe(400);
      expect(resNullSize.body.error).toMatch(/taille|size/i);
    });

    it('rejects tampered new_cost with 409 and leaves cost_reference unchanged', async () => {
      setupTestData();
      const db = getDb();
      db.prepare('UPDATE products SET size_volume = 1.5 WHERE id = ?').run('prod-15');

      // Client attempts to inject 999.000
      const res = await request(app).post('/api/products/batch-cost-confirm').send({
        items: [{ id: 'prod-15', new_cost: 999.000 }]
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/a changé ou ne correspond pas au calcul serveur/i);

      // Check DB: cost_reference must be completely unchanged
      const p15: any = db.prepare('SELECT cost_reference FROM products WHERE id = ?').get('prod-15');
      expect(p15.cost_reference).toBe(1.000);
    });

    it('rejects with 409 if material cost changed between preview and confirm', async () => {
      setupTestData();
      const db = getDb();
      db.prepare('UPDATE products SET size_volume = 1.5 WHERE id = ?').run('prod-15');

      // Raw material purchase cost updates on acid: from 4.000 to 5.000
      db.prepare('UPDATE raw_materials SET latest_purchase_cost = 5.000 WHERE id = ?').run('mat-acid');

      // Client sends previously previewed 1.680:
      const res = await request(app).post('/api/products/batch-cost-confirm').send({
        items: [{ id: 'prod-15', new_cost: 1.680 }]
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/a changé ou ne correspond pas au calcul serveur/i);

      const p15: any = db.prepare('SELECT cost_reference FROM products WHERE id = ?').get('prod-15');
      expect(p15.cost_reference).toBe(1.000);
    });

    it('updates cost_reference with server-computed values in one transaction and reports accurate valuation delta', async () => {
      setupTestData();
      const db = getDb();

      // Set prod-15 size_volume to 1.5
      db.prepare('UPDATE products SET size_volume = 1.5 WHERE id = ?').run('prod-15');

      // prod-15: stock 20, old_cost 1.000 (val 20.000), new_cost 1.680 (val 33.600) -> delta +13.600
      // prod-ready: stock 15, old_cost 1.680 (val 25.200), new_cost 1.680 (val 25.200) -> delta 0.000
      // Total old: 45.200, Total new: 58.800, Total delta: 13.600
      const res = await request(app).post('/api/products/batch-cost-confirm').send({
        items: [
          { id: 'prod-15', new_cost: 1.680 },
          { id: 'prod-ready', new_cost: 1.680 }
        ]
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.updated_count).toBe(2);
      expect(res.body.old_valuation).toBe(45.200);
      expect(res.body.new_valuation).toBe(58.800);
      expect(res.body.delta_valuation).toBe(13.600);

      const p15: any = db.prepare('SELECT cost_reference FROM products WHERE id = ?').get('prod-15');
      expect(p15.cost_reference).toBe(1.680);

      const pRdy: any = db.prepare('SELECT cost_reference FROM products WHERE id = ?').get('prod-ready');
      expect(pRdy.cost_reference).toBe(1.680);
    });
  });
});
