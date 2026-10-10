import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb, getDb } from '../../tests/testApp.js';

describe('Delivery Notes (Bon de Livraison) API (Batch 2 Item B3)', () => {
  let saleId1: string;
  let saleId2: string;

  beforeEach(async () => {
    resetTestDb();
    const db = getDb();

    // Seed customer
    db.prepare(`
      INSERT INTO customers (id, name, type, created_at, updated_at)
      VALUES ('cust-bl-1', 'Entreprise Trabelsi', 'WHOLESALE', '2026-10-10', '2026-10-10')
    `).run();

    // Seed product family & product
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-bl-1', 'Javel Bleach', 'Detergents', 'MANUFACTURED', '2026-10-10', '2026-10-10')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, stock_quantity, low_stock_threshold, cost_reference, retail_price, wholesale_price, active, created_at, updated_at)
      VALUES ('prod-bl-1', 'fam-bl-1', 'Javel 5L', 100, 10, 2.000, 4.000, 3.500, 1, '2026-10-10', '2026-10-10')
    `).run();

    // Open register session
    await request(app).post('/api/register/open').send({
      counter_name: 'Countertop',
      opening_cash: 100
    });

    // Create 2 sales
    const res1 = await request(app).post('/api/sales').send({
      customer_id: 'cust-bl-1',
      items: [{ product_id: 'prod-bl-1', quantity: 5, unit_price: 3.500 }],
      cash_paid: 17.500
    });
    expect(res1.status).toBe(201);
    saleId1 = res1.body.id;

    const res2 = await request(app).post('/api/sales').send({
      customer_id: 'cust-bl-1',
      items: [{ product_id: 'prod-bl-1', quantity: 10, unit_price: 3.500 }],
      cash_paid: 35.000
    });
    expect(res2.status).toBe(201);
    saleId2 = res2.body.id;
  });

  it('generates a persistent delivery note with format BL-YYYYMMDD-XXXX', async () => {
    // GET /api/sales/:id before generation had null delivery_note
    const getSaleBefore = await request(app).get(`/api/sales/${saleId2}`);
    expect(getSaleBefore.status).toBe(200);
    expect(getSaleBefore.body.delivery_note).toBeNull();

    const res = await request(app).post(`/api/sales/${saleId1}/delivery-note`);
    expect(res.status).toBe(201);
    expect(res.body.sale_id).toBe(saleId1);
    expect(res.body.number).toMatch(/^BL-\d{8}-\d{4}$/);

    const blNumber = res.body.number;

    // Second call for same sale must return the EXACT same delivery note (idempotent / persistent)
    const resDuplicate = await request(app).post(`/api/sales/${saleId1}/delivery-note`);
    expect(resDuplicate.status).toBe(200);
    expect(resDuplicate.body.number).toBe(blNumber);
    expect(resDuplicate.body.id).toBe(res.body.id);

    // GET /api/sales/:id/delivery-note also returns this delivery note
    const getRes = await request(app).get(`/api/sales/${saleId1}/delivery-note`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.number).toBe(blNumber);

    // GET /api/sales/:id now includes the delivery_note
    const getSaleAfter = await request(app).get(`/api/sales/${saleId1}`);
    expect(getSaleAfter.status).toBe(200);
    expect(getSaleAfter.body.delivery_note).not.toBeNull();
    expect(getSaleAfter.body.delivery_note.number).toBe(blNumber);
  });

  it('generates sequential numbers for different sales', async () => {
    const res1 = await request(app).post(`/api/sales/${saleId1}/delivery-note`);
    expect(res1.status).toBe(201);

    const res2 = await request(app).post(`/api/sales/${saleId2}/delivery-note`);
    expect(res2.status).toBe(201);

    expect(res1.body.number).not.toBe(res2.body.number);
    const seq1 = parseInt(res1.body.number.slice(-4), 10);
    const seq2 = parseInt(res2.body.number.slice(-4), 10);
    expect(seq2).toBe(seq1 + 1);
  });

  it('returns 404 for unknown sale', async () => {
    const res = await request(app).post('/api/sales/unknown-sale-id/delivery-note');
    expect(res.status).toBe(404);
  });
});
