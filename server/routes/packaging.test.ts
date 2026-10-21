import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Product Packaging Items API & Cost Preview', () => {
  beforeEach(() => {
    resetTestDb();
  });

  async function setupMfgProduct() {
    const matChem = await request(app).post('/api/materials').send({
      name: 'Chemical Detergent', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 0.800
    });
    const matBottle = await request(app).post('/api/materials').send({
      name: 'Bouteille 1.5L', category: 'bottle', unit: 'pcs', stock_quantity: 50, latest_purchase_cost: 0.350
    });
    const matCap = await request(app).post('/api/materials').send({
      name: 'Bouchon 28mm', category: 'cap', unit: 'pcs', stock_quantity: 50, latest_purchase_cost: 0.050
    });
    const matLabel = await request(app).post('/api/materials').send({
      name: 'Etiquette 1.5L', category: 'label', unit: 'pcs', stock_quantity: 50, latest_purchase_cost: 0.080
    });

    const form = await request(app).post('/api/formulations').send({
      name: 'Formule Vaisselle 100L', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: matChem.body.id, quantity_required: 100 }]
    });

    const fam = await request(app).post('/api/products/families').send({
      name: 'Liquide Vaisselle', category: 'Detergents', type: 'MANUFACTURED', formulation_id: form.body.id
    });

    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Vaisselle Citron 1.5L', size_label: '1.5L', size_volume: 1.5, stock_quantity: 0
    });

    return {
      matChem: matChem.body,
      matBottle: matBottle.body,
      matCap: matCap.body,
      matLabel: matLabel.body,
      form: form.body,
      fam: fam.body,
      prod: prod.body
    };
  }

  it('lists packaging items for a product via GET /api/products/:id/packaging', async () => {
    const { prod } = await setupMfgProduct();

    // Initially empty
    const resEmpty = await request(app).get(`/api/products/${prod.id}/packaging`);
    expect(resEmpty.status).toBe(200);
    expect(resEmpty.body).toEqual([]);

    // 404 for non-existent product
    const resNotFound = await request(app).get('/api/products/unknown-prod-id/packaging');
    expect(resNotFound.status).toBe(404);
    expect(resNotFound.body.error).toMatch(/introuvable/i);
  });

  it('adds packaging items via POST /api/products/:id/packaging and enforces validations', async () => {
    const { prod, matBottle, matCap } = await setupMfgProduct();

    // 1. Rejects unknown product (404)
    const resUnknownProd = await request(app).post('/api/products/unknown-prod/packaging').send({
      material_id: matBottle.id, quantity_per_unit: 1
    });
    expect(resUnknownProd.status).toBe(404);
    expect(resUnknownProd.body.error).toMatch(/produit introuvable/i);

    // 2. Rejects missing material_id (400)
    const resNoMat = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      quantity_per_unit: 1
    });
    expect(resNoMat.status).toBe(400);
    expect(resNoMat.body.error).toMatch(/article d'emballage est obligatoire/i);

    // 3. Rejects non-existent material (404)
    const resMat404 = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: 'unknown-mat-id', quantity_per_unit: 1
    });
    expect(resMat404.status).toBe(404);
    expect(resMat404.body.error).toMatch(/matière première introuvable/i);

    // 4. Rejects quantity <= 0 or invalid (400)
    const resZeroQty = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 0
    });
    expect(resZeroQty.status).toBe(400);

    const resNegQty = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: -1.5
    });
    expect(resNegQty.status).toBe(400);

    const resAbcQty = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 'abc'
    });
    expect(resAbcQty.status).toBe(400);

    // 5. Successful addition -> 201
    const resAdd1 = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 1
    });
    expect(resAdd1.status).toBe(201);
    expect(resAdd1.body.product_id).toBe(prod.id);
    expect(resAdd1.body.material_id).toBe(matBottle.id);
    expect(resAdd1.body.quantity_per_unit).toBe(1);
    expect(resAdd1.body.material_name).toBe('Bouteille 1.5L');

    // 6. Rejects duplicate material on same product (409)
    const resDup = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 2
    });
    expect(resDup.status).toBe(409);
    expect(resDup.body.error).toMatch(/déjà associé/i);

    // 7. Adding packaging must NOT change products.cost_reference
    const initialCost = prod.cost_reference;
    const resAddCap = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matCap.id, quantity_per_unit: 1
    });
    expect(resAddCap.status).toBe(201);

    const prodAfterAdd = await request(app).get(`/api/products/${prod.id}`);
    expect(prodAfterAdd.body.cost_reference).toBe(initialCost);
  });

  it('rejects POST /api/products/:id/packaging if product is not MANUFACTURED or material is not packaging category', async () => {
    const { matBottle, matChem } = await setupMfgProduct();

    // Create a RESALE product
    const famResale = await request(app).post('/api/products/families').send({
      name: 'Fam Resale', category: 'Other', type: 'RESALE'
    });
    const prodResale = await request(app).post('/api/products').send({
      family_id: famResale.body.id, name: 'Eponge', size_label: '1pc', stock_quantity: 10
    });

    // 1. Rejects packaging for RESALE product (400)
    const resResale = await request(app).post(`/api/products/${prodResale.body.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 1
    });
    expect(resResale.status).toBe(400);
    expect(resResale.body.error).toMatch(/fabriqué/i);

    // 2. Rejects material that is not in (bottle, cap, label, packaging), e.g. chemical
    const { prod } = await setupMfgProduct();
    const resChem = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matChem.id, quantity_per_unit: 1
    });
    expect(resChem.status).toBe(400);
    expect(resChem.body.error).toMatch(/emballage valide/i);
  });

  it('rejects double-counting on POST /api/products/:id/packaging if recipe contains packaging category', async () => {
    const matBot = await request(app).post('/api/materials').send({
      name: 'Bottle Mat', category: 'bottle', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.5
    });
    const formWithBot = await request(app).post('/api/formulations').send({
      name: 'Form with Bottle', base_yield_quantity: 100, base_yield_unit: 'L',
      items: [{ material_id: matBot.body.id, quantity_required: 100 }]
    });
    const fam = await request(app).post('/api/products/families').send({
      name: 'Fam Bot', category: 'C', type: 'MANUFACTURED', formulation_id: formWithBot.body.id
    });
    const prod = await request(app).post('/api/products').send({
      family_id: fam.body.id, name: 'Prod Bot', size_label: '1L', size_volume: 1.0, stock_quantity: 0
    });

    const res = await request(app).post(`/api/products/${prod.body.id}/packaging`).send({
      material_id: matBot.body.id, quantity_per_unit: 1
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/double décompte/i);
  });

  it('updates a packaging item via PUT /api/products/:id/packaging/:itemId and deletes via DELETE without modifying cost_reference', async () => {
    const { prod, matBottle } = await setupMfgProduct();

    const addRes = await request(app).post(`/api/products/${prod.id}/packaging`).send({
      material_id: matBottle.id, quantity_per_unit: 1
    });
    expect(addRes.status).toBe(201);
    const itemId = addRes.body.id;

    const initialCost = prod.cost_reference;

    // 1. Rejects unknown item on PUT (404)
    const putUnknown = await request(app).put(`/api/products/${prod.id}/packaging/unknown-item`).send({
      quantity_per_unit: 2
    });
    expect(putUnknown.status).toBe(404);

    // 2. Rejects invalid quantity on PUT (400)
    const putZero = await request(app).put(`/api/products/${prod.id}/packaging/${itemId}`).send({
      quantity_per_unit: 0
    });
    expect(putZero.status).toBe(400);

    // 3. Successful update -> 200, cost_reference unchanged
    const putOk = await request(app).put(`/api/products/${prod.id}/packaging/${itemId}`).send({
      quantity_per_unit: 2
    });
    expect(putOk.status).toBe(200);
    expect(putOk.body.quantity_per_unit).toBe(2);

    const prodAfterPut = await request(app).get(`/api/products/${prod.id}`);
    expect(prodAfterPut.body.cost_reference).toBe(initialCost);

    // 4. Rejects unknown item on DELETE (404)
    const delUnknown = await request(app).delete(`/api/products/${prod.id}/packaging/unknown-item`);
    expect(delUnknown.status).toBe(404);

    // 5. Successful DELETE -> 200, cost_reference unchanged
    const delOk = await request(app).delete(`/api/products/${prod.id}/packaging/${itemId}`);
    expect(delOk.status).toBe(200);
    expect(delOk.body.success).toBe(true);

    const prodAfterDel = await request(app).get(`/api/products/${prod.id}`);
    expect(prodAfterDel.body.cost_reference).toBe(initialCost);
  });

  it('supports previewing cost for arbitrary inputs via POST /api/products/preview-cost', async () => {
    const { fam, matBottle, matCap, matLabel } = await setupMfgProduct();

    const res = await request(app).post('/api/products/preview-cost').send({
      family_id: fam.id,
      size_volume: 1.5,
      packaging_items: [
        { material_id: matBottle.id, quantity_per_unit: 1 },
        { material_id: matCap.id, quantity_per_unit: 1 },
        { material_id: matLabel.id, quantity_per_unit: 1 }
      ]
    });

    expect(res.status).toBe(200);
    // Bulk: 1.5 * 0.800 = 1.200. Packaging: 0.350 + 0.050 + 0.080 = 0.480. Total = 1.680
    expect(res.body.cost_per_finished_unit).toBe(1.68);
    expect(res.body.bulk_portion).toBe(1.2);
    expect(res.body.packaging_portion).toBe(0.48);
  });

  it('creates product with packaging_items array atomically via POST /api/products', async () => {
    const { fam, matBottle, matCap } = await setupMfgProduct();

    const res = await request(app).post('/api/products').send({
      family_id: fam.id,
      name: 'Atomic SKU 1.5L',
      size_label: '1.5L',
      size_volume: 1.5,
      stock_quantity: 10,
      packaging_items: [
        { material_id: matBottle.id, quantity_per_unit: 1 },
        { material_id: matCap.id, quantity_per_unit: 1 }
      ]
    });

    expect(res.status).toBe(201);
    expect(res.body.cost_reference).toBe(1.6); // 1.2 + 0.35 + 0.05

    // Verify packaging items were saved
    const pkgRes = await request(app).get(`/api/products/${res.body.id}/packaging`);
    expect(pkgRes.status).toBe(200);
    expect(pkgRes.body).toHaveLength(2);
  });
});
