import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';
import { generateBarcode, isValidBarcode } from '../utils/barcode.js';

describe('Products & Sizing Model Module (HTTP Routes)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('generates valid Code-128 barcode strings', () => {
    const code = generateBarcode('SHSP');
    expect(code.startsWith('SHSP-')).toBe(true);
    expect(isValidBarcode(code)).toBe(true);
  });

  it('creates manufactured product family and resale product family via POST /api/products/families', async () => {
    // 1. Create a formulation
    const formRes = await request(app)
      .post('/api/formulations')
      .send({
        name: 'Detergent Lavender Formula',
        base_yield_quantity: 100,
        base_yield_unit: 'L'
      });
    expect(formRes.status).toBe(201);
    const formulationId = formRes.body.id;

    // 2. Manufactured family linked to formulation
    const mfgRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Lavender Floor Cleaner',
        category: 'Detergents',
        type: 'MANUFACTURED',
        formulation_id: formulationId
      });
    expect(mfgRes.status).toBe(201);
    expect(mfgRes.body.type).toBe('MANUFACTURED');
    expect(mfgRes.body.formulation_id).toBe(formulationId);

    // 3. Resale family without formulation
    const resaleRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Microfiber Cloth Blue',
        category: 'Resale Goods',
        type: 'RESALE'
      });
    expect(resaleRes.status).toBe(201);
    expect(resaleRes.body.type).toBe('RESALE');
    expect(resaleRes.body.formulation_id).toBeNull();

    // 4. Verify list via GET /api/products/families
    const listRes = await request(app).get('/api/products/families');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(2);
  });

  it('handles liquid/weight sizes as separate SKUs with independent stock counts via POST /api/products and /api/sales', async () => {
    // 1. Create family
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Dish Soap Lemon',
        category: 'Detergents',
        type: 'MANUFACTURED'
      });
    expect(famRes.status).toBe(201);
    const familyId = famRes.body.id;

    // 2. 1L SKU with supplier barcode
    const p1lRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Dish Soap Lemon 1L',
        size_label: '1L',
        barcode: '6191234567890',
        stock_quantity: 50,
        low_stock_threshold: 10,
        retail_price: 2.500,
        wholesale_price: 2.100
      });
    expect(p1lRes.status).toBe(201);
    const p1lId = p1lRes.body.id;

    // 3. 1.5L SKU
    const p15lRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Dish Soap Lemon 1.5L',
        size_label: '1.5L',
        barcode: '6191234567891',
        stock_quantity: 30,
        low_stock_threshold: 10,
        retail_price: 3.500,
        wholesale_price: 3.000
      });
    expect(p15lRes.status).toBe(201);
    const p15lId = p15lRes.body.id;

    // 4. 2L SKU
    const p2lRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Dish Soap Lemon 2L',
        size_label: '2L',
        barcode: 'SHSP-2L-001',
        stock_quantity: 20,
        low_stock_threshold: 5,
        retail_price: 4.500,
        wholesale_price: 3.900
      });
    expect(p2lRes.status).toBe(201);
    const p2lId = p2lRes.body.id;

    // 5. Open register session and sell 5 units of 2L SKU
    const sesRes = await request(app)
      .post('/api/register/open')
      .send({ opening_cash: 100.000 });
    const sessionId = sesRes.body.id;

    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        session_id: sessionId,
        items: [{ product_id: p2lId, quantity: 5, unit_price: 4.500 }],
        cash_paid: 22.500
      });
    expect(saleRes.status).toBe(201);

    // 6. Verify with GET /api/products/:id
    const p1lCheck = await request(app).get(`/api/products/${p1lId}`);
    const p15lCheck = await request(app).get(`/api/products/${p15lId}`);
    const p2lCheck = await request(app).get(`/api/products/${p2lId}`);

    // 1L and 1.5L remain completely unaffected
    expect(p1lCheck.body.stock_quantity).toBe(50);
    expect(p15lCheck.body.stock_quantity).toBe(30);
    // 2L decreased from 20 to 15
    expect(p2lCheck.body.stock_quantity).toBe(15);
  });

  it('shares piece stock across pack size multipliers (e.g. 6/12 pcs) via POST /api/products/:id/pack-sizes', async () => {
    // 1. Create family
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Heavy Duty Sponge',
        category: 'Resale Goods',
        type: 'RESALE'
      });
    const familyId = famRes.body.id;

    // 2. Base SKU: 1 piece with 120 pieces in stock
    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Heavy Duty Sponge',
        size_label: '1 pc',
        barcode: '6199990001',
        stock_quantity: 120,
        retail_price: 1.000,
        wholesale_price: 0.800
      });
    const productId = prodRes.body.id;

    // 3. Pack of 6
    const pack6Res = await request(app)
      .post(`/api/products/${productId}/pack-sizes`)
      .send({
        pack_label: 'Pack of 6',
        multiplier: 6,
        price_override: 5.500,
        barcode: '6199990006'
      });
    expect(pack6Res.status).toBe(201);

    // 4. Box of 12
    const pack12Res = await request(app)
      .post(`/api/products/${productId}/pack-sizes`)
      .send({
        pack_label: 'Box of 12',
        multiplier: 12,
        price_override: 10.000,
        barcode: '6199990012'
      });
    expect(pack12Res.status).toBe(201);
    const pack12Id = pack12Res.body.id;

    // 5. Open session and sell 2 boxes of 12 (deducts 2 * 12 = 24 units from parent stock)
    const sesRes = await request(app)
      .post('/api/register/open')
      .send({ opening_cash: 100.000 });
    const sessionId = sesRes.body.id;

    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        session_id: sessionId,
        items: [{ product_id: productId, pack_size_id: pack12Id, quantity: 2, unit_price: 10.000 }],
        cash_paid: 20.000
      });
    expect(saleRes.status).toBe(201);

    // 6. Verify parent product stock via GET /api/products/:id
    const updatedProd = await request(app).get(`/api/products/${productId}`);
    expect(updatedProd.body.stock_quantity).toBe(96); // 120 - 24 = 96
  });

  it('triggers low-stock alert when stock crosses threshold via GET /api/products?low_stock=true', async () => {
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Alert Test Family',
        category: 'Detergents',
        type: 'MANUFACTURED'
      });
    const familyId = famRes.body.id;

    await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Low Item',
        stock_quantity: 3,
        low_stock_threshold: 5
      });

    await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Sufficient Item',
        stock_quantity: 20,
        low_stock_threshold: 5
      });

    const lowStockRes = await request(app).get('/api/products?low_stock=true');
    expect(lowStockRes.status).toBe(200);
    expect(lowStockRes.body.length).toBe(1);
    expect(lowStockRes.body[0].name).toBe('Low Item');
    expect(lowStockRes.body[0].is_low_stock).toBe(1);
  });

  it('enables barcode lookup for both base SKU and pack size multipliers via GET /api/products/lookup/:barcode', async () => {
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Scanner Test Family',
        category: 'Detergents',
        type: 'MANUFACTURED'
      });
    const familyId = famRes.body.id;

    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Bleach 1L',
        size_label: '1L',
        barcode: '619000111222',
        stock_quantity: 40,
        retail_price: 1.500,
        wholesale_price: 1.200
      });
    const productId = prodRes.body.id;

    await request(app)
      .post(`/api/products/${productId}/pack-sizes`)
      .send({
        pack_label: 'Carton of 6',
        multiplier: 6,
        price_override: 8.500,
        barcode: '619000111666'
      });

    // 1. Direct SKU lookup
    const skuRes = await request(app).get('/api/products/lookup/619000111222');
    expect(skuRes.status).toBe(200);
    expect(skuRes.body.match_type).toBe('SKU');
    expect(skuRes.body.product.name).toBe('Bleach 1L');

    // 2. Pack size lookup
    const packRes = await request(app).get('/api/products/lookup/619000111666');
    expect(packRes.status).toBe(200);
    expect(packRes.body.match_type).toBe('PACK_SIZE');
    expect(packRes.body.matched_pack_size.multiplier).toBe(6);
    expect(packRes.body.product.name).toBe('Bleach 1L');
  });

  it('allows manual initial cost override saving to cost_reference on SKU creation and update', async () => {
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Floor Mop Commercial',
        category: 'Cleaning Tools',
        type: 'RESALE'
      });
    const familyId = famRes.body.id;

    // 1. Create SKU with manual cost_reference override
    const createRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Floor Mop Standard',
        cost_reference: 4.250,
        retail_price: 7.500,
        wholesale_price: 6.000,
        stock_quantity: 20
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.cost_reference).toBe(4.25);
    const productId = createRes.body.id;

    // 2. Update SKU cost_reference via PUT
    const updateRes = await request(app)
      .put(`/api/products/${productId}`)
      .send({
        cost_reference: 4.500
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.cost_reference).toBe(4.5);
  });
});
