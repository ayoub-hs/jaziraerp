import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Central Category Management API', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('lists categories with correct product and material usage counts', async () => {
    // 1. Create a product family with category 'Detergents'
    await request(app)
      .post('/api/products/families')
      .send({
        name: 'Dishwashing Liquid Lemon',
        category: 'Detergents',
        type: 'MANUFACTURED'
      });

    // 2. Create raw materials with category 'Detergents' and 'Fragrance'
    await request(app)
      .post('/api/materials')
      .send({
        name: 'LABSA Surfactant',
        category: 'Detergents',
        unit: 'kg',
        stock_quantity: 100,
        low_stock_threshold: 10,
        latest_purchase_cost: 3.500
      });

    await request(app)
      .post('/api/materials')
      .send({
        name: 'Lemon Perfume Essence',
        category: 'Fragrance',
        unit: 'L',
        stock_quantity: 5,
        low_stock_threshold: 1,
        latest_purchase_cost: 25.000
      });

    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const detergents = res.body.find((c: any) => c.name.toLowerCase() === 'detergents');
    expect(detergents).toBeDefined();
    expect(detergents.product_count).toBe(1);
    expect(detergents.material_count).toBe(1);
    expect(detergents.total_count).toBe(2);
    expect(detergents.type).toBe('BOTH');

    const fragrance = res.body.find((c: any) => c.name.toLowerCase() === 'fragrance');
    expect(fragrance).toBeDefined();
    expect(fragrance.product_count).toBe(0);
    expect(fragrance.material_count).toBe(1);
    expect(fragrance.type).toBe('MATERIAL');
  });

  it('creates new category via POST /api/categories', async () => {
    const res = await request(app)
      .post('/api/categories')
      .send({
        name: 'Eco Cleaners',
        type: 'PRODUCT'
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Eco Cleaners');

    // Duplicate check
    const dup = await request(app)
      .post('/api/categories')
      .send({ name: 'Eco Cleaners' });
    expect(dup.status).toBe(400);
  });

  it('cascades category rename across product families and raw materials via PUT /api/categories/rename', async () => {
    // 1. Create product family in 'Old Category'
    const fam = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Surface Degreaser',
        category: 'Industrial Cleaners',
        type: 'MANUFACTURED'
      });
    const familyId = fam.body.id;

    // 2. Create material in 'Industrial Cleaners'
    const mat = await request(app)
      .post('/api/materials')
      .send({
        name: 'Caustic Soda Flakes',
        category: 'Industrial Cleaners',
        unit: 'kg',
        stock_quantity: 50,
        low_stock_threshold: 5,
        latest_purchase_cost: 1.800
      });
    const materialId = mat.body.id;

    // 3. Rename 'Industrial Cleaners' -> 'Heavy Duty Cleaners'
    const renameRes = await request(app)
      .put('/api/categories/rename')
      .send({
        old_name: 'Industrial Cleaners',
        new_name: 'Heavy Duty Cleaners'
      });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.success).toBe(true);
    expect(renameRes.body.updated_product_families).toBe(1);
    expect(renameRes.body.updated_materials).toBe(1);

    // 4. Verify family has new category
    const famCheck = await request(app).get(`/api/products/families/${familyId}`);
    expect(famCheck.body.category).toBe('Heavy Duty Cleaners');

    // 5. Verify material has new category
    const matCheck = await request(app).get(`/api/materials/${materialId}`);
    expect(matCheck.body.category).toBe('Heavy Duty Cleaners');
  });

  it('prevents deletion of category if items reference it, and allows deletion when empty', async () => {
    // Pre-create unused category
    await request(app)
      .post('/api/categories')
      .send({ name: 'Temporary Category' });

    // Delete unused -> success
    const delRes = await request(app).delete('/api/categories/Temporary%20Category');
    expect(delRes.status).toBe(200);

    // Create item in 'Permanent Category'
    await request(app)
      .post('/api/products/families')
      .send({
        name: 'Bleach Extra',
        category: 'Permanent Category',
        type: 'MANUFACTURED'
      });

    // Attempt delete -> fails with 400
    const failDel = await request(app).delete('/api/categories/Permanent%20Category');
    expect(failDel.status).toBe(400);
    expect(failDel.body.error).toContain('Cannot delete category');
  });
});
