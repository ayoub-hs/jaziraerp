import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Raw Materials & Packaging Module (HTTP Routes)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('creates raw materials and packaging items (bottles, caps, labels) with category and unit via POST /api/materials', async () => {
    // 1. Create a supplier
    const supRes = await request(app)
      .post('/api/suppliers')
      .send({
        name: 'Plastik Packaging Co',
        phone: '+216 71 000 000',
        address: 'Tunis'
      });
    expect(supRes.status).toBe(201);
    const supplierId = supRes.body.id;

    // 2. Insert an active chemical ingredient
    const matRes = await request(app)
      .post('/api/materials')
      .send({
        name: 'Sodium Laureth Sulfate (SLES)',
        category: 'surfactant',
        unit: 'kg',
        stock_quantity: 200,
        latest_supplier_id: supplierId,
        latest_purchase_cost: 4.500,
        low_stock_threshold: 50
      });
    expect(matRes.status).toBe(201);
    expect(matRes.body.name).toBe('Sodium Laureth Sulfate (SLES)');
    expect(matRes.body.category).toBe('surfactant');
    expect(matRes.body.unit).toBe('kg');
    expect(matRes.body.stock_quantity).toBe(200);
    expect(matRes.body.latest_purchase_cost).toBe(4.5);

    // 3. Insert packaging materials (bottle, cap, label)
    const pkg1Res = await request(app)
      .post('/api/materials')
      .send({
        name: '1L PET Bottle Transparent',
        category: 'bottle',
        unit: 'pcs',
        stock_quantity: 1000,
        latest_supplier_id: supplierId,
        latest_purchase_cost: 0.350,
        low_stock_threshold: 200
      });
    expect(pkg1Res.status).toBe(201);
    expect(pkg1Res.body.category).toBe('bottle');
    expect(pkg1Res.body.stock_quantity).toBe(1000);

    const pkg2Res = await request(app)
      .post('/api/materials')
      .send({
        name: '28mm Screw Cap Yellow',
        category: 'cap',
        unit: 'pcs',
        stock_quantity: 1500,
        latest_supplier_id: supplierId,
        latest_purchase_cost: 0.080,
        low_stock_threshold: 300
      });
    expect(pkg2Res.status).toBe(201);

    const pkg3Res = await request(app)
      .post('/api/materials')
      .send({
        name: 'Dish Soap Lemon 1L Front/Back Label',
        category: 'label',
        unit: 'pcs',
        stock_quantity: 1200,
        latest_supplier_id: supplierId,
        latest_purchase_cost: 0.120,
        low_stock_threshold: 200
      });
    expect(pkg3Res.status).toBe(201);

    // 4. Verify all 4 materials are listed via GET /api/materials
    const listRes = await request(app).get('/api/materials');
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(4);
  });

  it('records stock increase and price history entry when purchasing via POST /api/purchases', async () => {
    const supRes = await request(app)
      .post('/api/suppliers')
      .send({ name: 'Global Chemical SARL' });
    expect(supRes.status).toBe(201);
    const supplierId = supRes.body.id;

    const matRes = await request(app)
      .post('/api/materials')
      .send({
        name: 'Lemon Fragrance Oil',
        category: 'fragrance',
        unit: 'kg',
        stock_quantity: 10,
        latest_supplier_id: supplierId,
        latest_purchase_cost: 35.000,
        low_stock_threshold: 5
      });
    expect(matRes.status).toBe(201);
    const materialId = matRes.body.id;

    // Record a new purchase at 38.000 DT with +20 kg
    const purRes = await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: supplierId,
        payment_status: 'PAID',
        items: [
          {
            item_type: 'RAW_MATERIAL',
            material_id: materialId,
            quantity: 20,
            unit_cost: 38.000
          }
        ]
      });
    expect(purRes.status).toBe(201);

    // Verify material stock increased and cost updated via GET /api/materials/:id
    const getRes = await request(app).get(`/api/materials/${materialId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.stock_quantity).toBe(30); // 10 + 20
    expect(getRes.body.latest_purchase_cost).toBe(38);
    expect(getRes.body.price_history.length).toBeGreaterThanOrEqual(1);

    // Verify price history endpoint GET /api/materials/:id/history
    const histRes = await request(app).get(`/api/materials/${materialId}/history`);
    expect(histRes.status).toBe(200);
    const purchaseHist = histRes.body.find((h: any) => h.cost_per_unit === 38);
    expect(purchaseHist).toBeDefined();
    expect(purchaseHist.supplier_id).toBe(supplierId);
  });

  it('shows correct price history trend across multiple purchases over time', async () => {
    const supRes = await request(app)
      .post('/api/suppliers')
      .send({ name: 'Acid Supply Co' });
    expect(supRes.status).toBe(201);
    const supplierId = supRes.body.id;

    const matRes = await request(app)
      .post('/api/materials')
      .send({
        name: 'Sulfonic Acid (LABSA)',
        category: 'surfactant',
        unit: 'kg',
        stock_quantity: 0,
        latest_purchase_cost: 0
      });
    expect(matRes.status).toBe(201);
    const materialId = matRes.body.id;

    // Purchase 1 in January: 100 @ 5.000
    await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: supplierId,
        date: '2026-01-15T08:00:00Z',
        items: [{ item_type: 'RAW_MATERIAL', material_id: materialId, quantity: 100, unit_cost: 5.000 }]
      });

    // Purchase 2 in March: 150 @ 5.400
    await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: supplierId,
        date: '2026-03-10T08:00:00Z',
        items: [{ item_type: 'RAW_MATERIAL', material_id: materialId, quantity: 150, unit_cost: 5.400 }]
      });

    // Purchase 3 in June: 200 @ 5.250
    await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: supplierId,
        date: '2026-06-01T08:00:00Z',
        items: [{ item_type: 'RAW_MATERIAL', material_id: materialId, quantity: 200, unit_cost: 5.250 }]
      });

    const histRes = await request(app).get(`/api/materials/${materialId}/history`);
    expect(histRes.status).toBe(200);
    expect(histRes.body.length).toBe(3);
    expect(histRes.body[0].cost_per_unit).toBe(5);
    expect(histRes.body[1].cost_per_unit).toBe(5.4);
    expect(histRes.body[2].cost_per_unit).toBe(5.25);

    const getRes = await request(app).get(`/api/materials/${materialId}`);
    expect(getRes.body.stock_quantity).toBe(450); // 100 + 150 + 200
    expect(getRes.body.latest_purchase_cost).toBe(5.25);
  });

  it('correctly flags low stock threshold when stock is below or equal to threshold', async () => {
    await request(app)
      .post('/api/materials')
      .send({
        name: 'Preservative Kathon',
        category: 'additive',
        unit: 'kg',
        stock_quantity: 2,
        low_stock_threshold: 5
      });

    await request(app)
      .post('/api/materials')
      .send({
        name: 'Sodium Chloride Salt',
        category: 'thickener',
        unit: 'kg',
        stock_quantity: 500,
        low_stock_threshold: 50
      });

    const lowStockRes = await request(app).get('/api/materials?low_stock=true');
    expect(lowStockRes.status).toBe(200);
    expect(lowStockRes.body.length).toBe(1);
    expect(lowStockRes.body[0].name).toBe('Preservative Kathon');
    expect(lowStockRes.body[0].is_low_stock).toBe(1);
  });
});
