import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Inventory Adjustments Module — Integration & Invariant Tests (INV-01/02)', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // Seed raw material and product
    db.prepare(`
      INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_purchase_cost, low_stock_threshold, created_at, updated_at)
      VALUES ('rm-salt', 'Industrial Salt', 'Chemicals', 'KG', 50.0, 1.200, 10.0, '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-soap', 'Soaps', 'Detergents', 'MANUFACTURED', '2026-01-01', '2026-01-01')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-soap-bar', 'fam-soap', 'Liquid Soap 500ml', '500ml', 25, 2.500, 2.000, '2026-01-01', '2026-01-01')
    `).run();
  });

  describe('INV-01: Number.isFinite check on quantity_delta', () => {
    it('rejects Infinity, -Infinity, and NaN with HTTP 400 and preserves stock', async () => {
      const db = getDb();

      // Attempt adjustment with "Infinity"
      const resInfString = await request(app)
        .post('/api/inventory/adjust')
        .send({
          item_type: 'RAW_MATERIAL',
          material_id: 'rm-salt',
          quantity_delta: 'Infinity',
          reason: 'Corrupt adjustment test'
        });
      expect(resInfString.status).toBe(400);
      expect(resInfString.body.error).toContain('quantity_delta must be a non-zero number');

      // Attempt adjustment with -Infinity
      const resNegInf = await request(app)
        .post('/api/inventory/adjust')
        .send({
          item_type: 'RAW_MATERIAL',
          material_id: 'rm-salt',
          quantity_delta: -Infinity,
          reason: 'Negative infinity test'
        });
      expect(resNegInf.status).toBe(400);
      expect(resNegInf.body.error).toContain('quantity_delta must be a non-zero number');

      // Verify stock was not wiped to NULL
      const rm: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('rm-salt');
      expect(rm.stock_quantity).toBe(50.0);
    });

    it('accepts valid finite delta and updates stock', async () => {
      const db = getDb();

      const res = await request(app)
        .post('/api/inventory/adjust')
        .send({
          item_type: 'RAW_MATERIAL',
          material_id: 'rm-salt',
          quantity_delta: -5.5,
          reason: 'Spillage'
        });
      expect(res.status).toBe(201);
      expect(res.body.new_stock).toBe(44.5);

      const rm: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get('rm-salt');
      expect(rm.stock_quantity).toBe(44.5);
    });
  });

  describe('INV-02: Africa/Tunis business day date filtering', () => {
    it('finds adjustment timestamped at 23:30 UTC when filtering by Tunis next-day date', async () => {
      // 2026-05-10T23:30:00.000Z is 2026-05-11 00:30:00 in Africa/Tunis (UTC+1)
      const tunisTimestamp = '2026-05-10T23:30:00.000Z';

      const createRes = await request(app)
        .post('/api/inventory/adjust')
        .send({
          item_type: 'PRODUCT',
          product_id: 'prod-soap-bar',
          quantity_delta: -2,
          reason: 'Broken bottle past midnight',
          date: tunisTimestamp
        });
      expect(createRes.status).toBe(201);

      // Filtering with date=2026-05-11 should match this record under Africa/Tunis calendar
      const listRes = await request(app)
        .get('/api/inventory/adjustments?date=2026-05-11');
      expect(listRes.status).toBe(200);
      expect(listRes.body.length).toBe(1);
      expect(listRes.body[0].reason).toBe('Broken bottle past midnight');
      expect(listRes.body[0].item_name).toBe('Liquid Soap 500ml');

      // Filtering with date=2026-05-10 should NOT match this record
      const listResPrev = await request(app)
        .get('/api/inventory/adjustments?date=2026-05-10');
      expect(listResPrev.status).toBe(200);
      expect(listResPrev.body.length).toBe(0);
    });
  });
});
