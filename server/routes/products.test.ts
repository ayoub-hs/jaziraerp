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

  it('rejects non-integer multipliers and negative price overrides on pack sizes', async () => {
    const famRes = await request(app)
      .post('/api/products/families')
      .send({ name: 'Pack Validation Fam', category: 'C', type: 'RESALE' });
    const prodRes = await request(app)
      .post('/api/products')
      .send({ family_id: famRes.body.id, name: 'Pack Validation Prod', stock_quantity: 10 });
    const productId = prodRes.body.id;

    for (const bad of [{ multiplier: 1.5 }, { multiplier: 1 }, { multiplier: 0 }, { multiplier: 'six' }]) {
      const res = await request(app)
        .post(`/api/products/${productId}/pack-sizes`)
        .send({ pack_label: 'Bad Pack', ...bad });
      expect(res.status).toBe(400);
    }

    for (const badOverride of [-1, 0, 'free']) {
      const res = await request(app)
        .post(`/api/products/${productId}/pack-sizes`)
        .send({ pack_label: 'Bad Override', multiplier: 6, price_override: badOverride });
      expect(res.status).toBe(400);
    }

    // Blank/null override = no override, accepted
    const blankRes = await request(app)
      .post(`/api/products/${productId}/pack-sizes`)
      .send({ pack_label: 'No Override Pack', multiplier: 6, price_override: null });
    expect(blankRes.status).toBe(201);
    expect(blankRes.body.price_override).toBeNull();
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

  it('supports active toggle on products and families, with ?active filtering and 409 delete text', async () => {
    // 1. Create family
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Active Test Family',
        category: 'Test Category',
        type: 'RESALE'
      });
    expect(famRes.status).toBe(201);
    const familyId = famRes.body.id;

    // 2. Create product SKU
    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Active Test SKU',
        cost_reference: 2.0,
        retail_price: 3.5,
        wholesale_price: 3.0,
        stock_quantity: 10
      });
    expect(prodRes.status).toBe(201);
    const productId = prodRes.body.id;

    // Default lists should include them
    const famsBefore = await request(app).get('/api/products/families');
    expect(famsBefore.body.some((f: any) => f.id === familyId)).toBe(true);
    const prodsBefore = await request(app).get('/api/products');
    expect(prodsBefore.body.some((p: any) => p.id === productId)).toBe(true);

    // 3. Deactivate product SKU via PUT
    const deactivateProdRes = await request(app)
      .put(`/api/products/${productId}`)
      .send({ active: 0 });
    expect(deactivateProdRes.status).toBe(200);
    expect(deactivateProdRes.body.active).toBe(0);

    // Product should disappear from default list (?active=1)
    const prodsActiveOnly = await request(app).get('/api/products');
    expect(prodsActiveOnly.body.some((p: any) => p.id === productId)).toBe(false);

    // Product should appear in ?active=0 and ?active=all
    const prodsInactiveOnly = await request(app).get('/api/products?active=0');
    expect(prodsInactiveOnly.body.some((p: any) => p.id === productId)).toBe(true);
    const prodsAll = await request(app).get('/api/products?active=all');
    expect(prodsAll.body.some((p: any) => p.id === productId)).toBe(true);

    // 4. Deactivate family via PUT
    const deactivateFamRes = await request(app)
      .put(`/api/products/families/${familyId}`)
      .send({ active: 0 });
    expect(deactivateFamRes.status).toBe(200);
    expect(deactivateFamRes.body.active).toBe(0);

    // Family should disappear from default list (?active=1)
    const famsActiveOnly = await request(app).get('/api/products/families');
    expect(famsActiveOnly.body.some((f: any) => f.id === familyId)).toBe(false);

    // Family should appear in ?active=0 and ?active=all
    const famsInactiveOnly = await request(app).get('/api/products/families?active=0');
    expect(famsInactiveOnly.body.some((f: any) => f.id === familyId)).toBe(true);
    const famsAll = await request(app).get('/api/products/families?active=all');
    expect(famsAll.body.some((f: any) => f.id === familyId)).toBe(true);

    // 5. Attempting to delete family with existing SKU returns 409
    const delFamRes = await request(app).delete(`/api/products/families/${familyId}`);
    expect(delFamRes.status).toBe(409);
    expect(delFamRes.body.error).toContain('Please deactivate the family or its SKUs instead');
  });

  it('auto-computes manufactured cost_reference from bulk formulation and packaging BOM, ignoring modal 0 payload', async () => {
    // 1. Setup materials
    const matChem = await request(app).post('/api/materials').send({ name: 'Bulk Mat', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 8.000 });
    const matBot = await request(app).post('/api/materials').send({ name: 'Bot 1.5', category: 'bottle', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.350 });
    const matCap = await request(app).post('/api/materials').send({ name: 'Cap', category: 'cap', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.050 });
    const matLbl = await request(app).post('/api/materials').send({ name: 'Lbl', category: 'label', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.080 });

    // 2. Setup bulk formula: 100 L yielding 10 kg @ 8.000 = 80.000 DT (0.800 DT/L)
    const form = await request(app).post('/api/formulations').send({
      name: 'Citron Bulk 100L', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: matChem.body.id, quantity_required: 10 }]
    });

    // 3. Setup manufactured family
    const fam = await request(app).post('/api/products/families').send({
      name: 'Citron Fam', category: 'Detergents', type: 'MANUFACTURED', formulation_id: form.body.id
    });

    // 4. Create SKU without size_volume -> 400
    const errRes = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Citron 1.5L Missing Size', size_label: '1.5L'
    });
    expect(errRes.status).toBe(400);
    expect(errRes.body.error).toMatch(/size_volume.*obligatoire/i);

    // 5. Create SKU with size_volume: 1.5 and modal default cost_reference: 0
    // Expected bulk cost: 1.5 * 0.800 = 1.200 DT
    const createRes = await request(app).post('/api/products').send({
      family_id: fam.body.id,
      name: 'Citron 1.5L',
      size_label: '1.5L',
      size_volume: 1.5,
      cost_reference: 0 // Modal sends 0 by default
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.cost_reference).toBe(1.200); // 0 was ignored!

    // 6. Add packaging BOM to product_packaging_items: + 0.480 DT -> total cost should be 1.680 DT
    const db = (await import('../db/index.js')).getDb();
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('p-b', createRes.body.id, matBot.body.id, 1);
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('p-c', createRes.body.id, matCap.body.id, 1);
    db.prepare('INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit) VALUES (?, ?, ?, ?)').run('p-l', createRes.body.id, matLbl.body.id, 1);

    // 7. Update product with modal payload (PUT /products/:id sends cost_reference: 0)
    // Invariant: PUT must NOT overwrite manufactured cost_reference with 0 unless allow_cost_override === true
    const updateRes = await request(app).put(`/api/products/${createRes.body.id}`).send({
      name: 'Citron 1.5L Updated',
      cost_reference: 0
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.cost_reference).toBe(1.200); // Not overwritten by 0!

    // 8. Explicit override works when allow_cost_override: true
    const overrideRes = await request(app).put(`/api/products/${createRes.body.id}`).send({
      cost_reference: 1.750,
      allow_cost_override: true
    });
    expect(overrideRes.status).toBe(200);
    expect(overrideRes.body.cost_reference).toBe(1.750);

    // 9. Cost preview endpoint verifies unit cost with packaging: 1.200 (chem) + 0.480 (pkg) = 1.680
    const previewRes = await request(app).get('/api/products/cost-preview');
    expect(previewRes.status).toBe(200);
    const itemPreview = previewRes.body.find((p: any) => p.product_id === createRes.body.id);
    expect(itemPreview).toBeDefined();
    expect(itemPreview.status).toBe('ok');
    expect(itemPreview.calculated_cost).toBe(1.680);
  });

  it('F12: writes an inventory_adjustments row on stock change through product PUT, none when unchanged', async () => {
    const fam = await request(app).post('/api/products/families').send({
      name: 'F12 Family', category: 'General', type: 'RESALE'
    });

    const createRes = await request(app).post('/api/products').send({
      family_id: fam.body.id,
      name: 'F12 Stock Item',
      stock_quantity: 50,
      retail_price: 5.000,
      wholesale_price: 4.000
    });
    expect(createRes.status).toBe(201);
    const prodId = createRes.body.id;

    const db = (await import('../db/index.js')).getDb();

    // Baseline: Exactly 1 row for OPENING_STOCK
    const initialAdjs = db.prepare('SELECT * FROM inventory_adjustments WHERE product_id = ?').all(prodId) as any[];
    expect(initialAdjs).toHaveLength(1);
    expect(initialAdjs[0].reason).toBe('OPENING_STOCK');

    // 1. Stock increases from 50 to 65 (+15)
    const incRes = await request(app).put(`/api/products/${prodId}`).send({
      stock_quantity: 65
    });
    expect(incRes.status).toBe(200);
    expect(incRes.body.stock_quantity).toBe(65);

    const editAdjs1 = db.prepare("SELECT * FROM inventory_adjustments WHERE product_id = ? AND reason = 'PRODUCT_EDIT' ORDER BY created_at ASC").all(prodId) as any[];
    expect(editAdjs1).toHaveLength(1);
    expect(editAdjs1[0].item_type).toBe('PRODUCT');
    expect(editAdjs1[0].product_id).toBe(prodId);
    expect(editAdjs1[0].quantity_delta).toBe(15);
    expect(editAdjs1[0].reason).toBe('PRODUCT_EDIT');

    // 2. Stock decreases from 65 to 40 (-25)
    const decRes = await request(app).put(`/api/products/${prodId}`).send({
      stock_quantity: 40
    });
    expect(decRes.status).toBe(200);
    expect(decRes.body.stock_quantity).toBe(40);

    const editAdjs2 = db.prepare("SELECT * FROM inventory_adjustments WHERE product_id = ? AND reason = 'PRODUCT_EDIT' ORDER BY created_at ASC").all(prodId) as any[];
    expect(editAdjs2).toHaveLength(2);
    expect(editAdjs2[1].quantity_delta).toBe(-25);
    expect(editAdjs2[1].reason).toBe('PRODUCT_EDIT');

    // 3. Unchanged stock_quantity (sent identical value 40) -> writes NO row
    const sameRes = await request(app).put(`/api/products/${prodId}`).send({
      stock_quantity: 40
    });
    expect(sameRes.status).toBe(200);

    const afterSame = db.prepare("SELECT * FROM inventory_adjustments WHERE product_id = ? AND reason = 'PRODUCT_EDIT'").all(prodId);
    expect(afterSame).toHaveLength(2);

    // 4. PUT without stock_quantity (e.g. changing retail_price only) -> writes NO row
    const priceRes = await request(app).put(`/api/products/${prodId}`).send({
      retail_price: 6.500
    });
    expect(priceRes.status).toBe(200);

    const afterPriceOnly = db.prepare("SELECT * FROM inventory_adjustments WHERE product_id = ? AND reason = 'PRODUCT_EDIT'").all(prodId);
    expect(afterPriceOnly).toHaveLength(2);
  });

  it('F12 follow-up: POST /api/products with stock_quantity > 0 writes one inventory_adjustments row (OPENING_STOCK); 0 or omitted writes none', async () => {
    const db = (await import('../db/index.js')).getDb();

    const fam = await request(app).post('/api/products/families').send({
      name: 'Opening Stock Family', category: 'General', type: 'RESALE'
    });
    const familyId = fam.body.id;

    // 1. Product created with stock_quantity: 35 (> 0)
    const pWithStock = await request(app).post('/api/products').send({
      family_id: familyId,
      name: 'Item With Stock',
      stock_quantity: 35,
      retail_price: 10,
      wholesale_price: 8
    });
    expect(pWithStock.status).toBe(201);
    const prodIdWithStock = pWithStock.body.id;

    const adjsWithStock = db.prepare('SELECT * FROM inventory_adjustments WHERE product_id = ?').all(prodIdWithStock) as any[];
    expect(adjsWithStock).toHaveLength(1);
    expect(adjsWithStock[0].item_type).toBe('PRODUCT');
    expect(adjsWithStock[0].product_id).toBe(prodIdWithStock);
    expect(adjsWithStock[0].quantity_delta).toBe(35);
    expect(adjsWithStock[0].reason).toBe('OPENING_STOCK');

    // 2. Product created with stock_quantity: 0
    const pZeroStock = await request(app).post('/api/products').send({
      family_id: familyId,
      name: 'Item Zero Stock',
      stock_quantity: 0,
      retail_price: 10,
      wholesale_price: 8
    });
    expect(pZeroStock.status).toBe(201);
    const prodIdZero = pZeroStock.body.id;

    const adjsZero = db.prepare('SELECT * FROM inventory_adjustments WHERE product_id = ?').all(prodIdZero);
    expect(adjsZero).toHaveLength(0);

    // 3. Product created with stock_quantity omitted
    const pNoStock = await request(app).post('/api/products').send({
      family_id: familyId,
      name: 'Item No Stock',
      retail_price: 10,
      wholesale_price: 8
    });
    expect(pNoStock.status).toBe(201);
    const prodIdNone = pNoStock.body.id;

    const adjsNone = db.prepare('SELECT * FROM inventory_adjustments WHERE product_id = ?').all(prodIdNone);
    expect(adjsNone).toHaveLength(0);
  });
});
