import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Numeric validation and error handling (F9)', () => {
  let seed: {
    familyId: string;
    productId: string;
    customerId: string;
    supplierId: string;
    materialId: string;
    containerTypeId: string;
    sessionId: string;
  };

  beforeEach(async () => {
    resetTestDb();
    const fam = await request(app).post('/api/products/families').send({
      name: 'Validation Family',
      category: 'Detergents',
      type: 'MANUFACTURED'
    });
    const form = await request(app).post('/api/formulations').send({
      name: 'Validation Recipe',
      base_yield_quantity: 100,
      base_yield_unit: 'L',
      items: []
    });
    await request(app).put(`/api/products/families/${fam.body.id}`).send({
      formulation_id: form.body.id
    });
    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id,
      name: 'Validation Dish Soap 1L',
      retail_price: 10,
      wholesale_price: 8,
      stock_quantity: 50
    });
    const cust = await request(app).post('/api/customers').send({
      name: 'Validation Customer',
      type: 'RETAIL'
    });
    const sup = await request(app).post('/api/suppliers').send({
      name: 'Validation Supplier'
    });
    const mat = await request(app).post('/api/materials').send({
      name: 'Validation Material',
      category: 'Chemical',
      unit: 'kg',
      latest_purchase_cost: 5
    });
    const ctype = await request(app).post('/api/containers/types').send({
      name: 'Validation Bidon 5L',
      capacity_liters: 5,
      stock_quantity: 20
    });
    const sess = await request(app).post('/api/register/open').send({
      counter_name: 'Validation Counter',
      opening_cash: 100
    });

    seed = {
      familyId: fam.body.id,
      formulationId: form.body.id,
      productId: prod.body.id,
      customerId: cust.body.id,
      supplierId: sup.body.id,
      materialId: mat.body.id,
      containerTypeId: ctype.body.id,
      sessionId: sess.body.id
    };
  });

  // Row 1: Purchase quantity: "abc"
  it('rejects purchase with non-numeric quantity "abc" with 400 and French message', async () => {
    const res = await request(app).post('/api/purchases').send({
      supplier_id: seed.supplierId,
      items: [
        {
          item_type: 'RAW_MATERIAL',
          material_id: seed.materialId,
          quantity: 'abc',
          unit_cost: 10
        }
      ]
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/quantité|valide|positif/i);
  });

  // Row 2: Production units_produced: "abc"
  it('rejects production batch with units_produced "abc" with 400 and French message', async () => {
    const res = await request(app).post('/api/production/batches').send({
      formulation_id: seed.formulationId,
      target_product_id: seed.productId,
      units_produced: 'abc'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/unités|valide|positif/i);
  });

  // Row 3: Cash movement amount: "abc"
  it('rejects cash movement with amount "abc" with 400 and French message', async () => {
    const res = await request(app).post('/api/register/movement').send({
      session_id: seed.sessionId,
      type: 'CASH_IN',
      amount: 'abc',
      reason: 'Test non-numeric float'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/montant|valide|positif/i);
  });

  // Row 4: Customer payment amount: "abc"
  it('rejects customer payment with amount "abc" with 400 and French message (no SQL text)', async () => {
    const res = await request(app).post(`/api/customers/${seed.customerId}/payments`).send({
      amount: 'abc',
      payment_method: 'Cash'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/montant|valide|positif/i);
  });

  // Row 5: Supplier payment amount: "abc"
  it('rejects supplier payment with amount "abc" with 400 and French message (no SQL text)', async () => {
    const res = await request(app).post(`/api/suppliers/${seed.supplierId}/payments`).send({
      amount: 'abc',
      payment_method: 'Cash'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/montant|valide|positif/i);
  });

  // Row 6: Container PUT stock_quantity: "abc"
  it('rejects container PUT with stock_quantity "abc" with 400 and French message', async () => {
    const res = await request(app).put(`/api/containers/types/${seed.containerTypeId}`).send({
      stock_quantity: 'abc'
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/stock|quantité|valide|positif/i);
  });

  // Row 7: Product retail_price: "abc"
  it('rejects product creation with non-numeric retail_price "abc" with 400', async () => {
    const res = await request(app).post('/api/products').send({
      family_id: seed.familyId,
      name: 'Invalid Price Product',
      retail_price: 'abc',
      wholesale_price: 5
    });
    expect(res.status).toBe(400);
    expect(res.body.error).not.toMatch(/NOT NULL|constraint failed|SQLITE/i);
    expect(res.body.error).toMatch(/prix|valide|positif/i);
  });

  // Row 8: Product retail_price: -5, wholesale_price: -2
  it('rejects product with negative retail or wholesale price with 400', async () => {
    const res = await request(app).post('/api/products').send({
      family_id: seed.familyId,
      name: 'Negative Price Product',
      retail_price: -5,
      wholesale_price: -2
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prix.*positif|positif ou nul/i);
  });

  // Row 9: Material latest_purchase_cost: -5
  it('rejects raw material with negative latest_purchase_cost with 400', async () => {
    const res = await request(app).post('/api/materials').send({
      name: 'Negative Cost Material',
      category: 'Chemical',
      unit: 'kg',
      latest_purchase_cost: -5
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coût.*positif|positif ou nul/i);
  });

  // Row 10: Register open opening_cash: -50
  it('rejects register open with negative opening_cash with 400', async () => {
    const res = await request(app).post('/api/register/open').send({
      counter_name: 'Second Counter',
      opening_cash: -50
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fond de caisse|montant.*positif|positif ou nul/i);
  });
});
