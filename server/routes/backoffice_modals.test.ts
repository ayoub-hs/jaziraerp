import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Backoffice Creation Modals & Flows Integration Tests', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('1. CreateMaterialModal flow: successfully creates a raw material with initial stock and supplier link', async () => {
    // First create a supplier
    const supRes = await request(app)
      .post('/api/suppliers')
      .send({
        name: 'Chimie Express Sousse',
        phone: '73200100',
        address: 'Zone Industrielle Akouda'
      })
      .expect(201);
    const supplierId = supRes.body.id;

    // Create raw material as modal does
    const matRes = await request(app)
      .post('/api/materials')
      .send({
        name: 'Sulfonic Acid LABSA 96%',
        category: 'surfactant',
        unit: 'kg',
        initial_stock: 250,
        latest_purchase_cost: 4.85,
        low_stock_threshold: 50,
        latest_supplier_id: supplierId
      })
      .expect(201);

    expect(matRes.body).toHaveProperty('id');
    expect(matRes.body.name).toBe('Sulfonic Acid LABSA 96%');
    expect(matRes.body.category).toBe('surfactant');
    expect(matRes.body.unit).toBe('kg');
    expect(matRes.body.stock_quantity).toBe(250);
    expect(matRes.body.latest_purchase_cost).toBe(4.85);
    expect(matRes.body.latest_supplier_id).toBe(supplierId);

    // Verify GET /api/materials includes it
    const listRes = await request(app).get('/api/materials').expect(200);
    const item = listRes.body.find((m: any) => m.id === matRes.body.id);
    expect(item).toBeDefined();
    expect(item.latest_supplier_name).toBe('Chimie Express Sousse');
  });

  it('2. CreateSupplierModal flow: successfully creates a supplier', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .send({
        name: 'Plastique du Sud',
        phone: '75390000',
        address: 'Gabès'
      })
      .expect(201);

    expect(res.body.name).toBe('Plastique du Sud');
    expect(res.body.phone).toBe('75390000');

    const list = await request(app).get('/api/suppliers').expect(200);
    expect(list.body.some((s: any) => s.id === res.body.id)).toBe(true);
  });

  it('3. CreateContainerModal flow: successfully creates a container type', async () => {
    const res = await request(app)
      .post('/api/containers')
      .send({
        name: 'Bidon 5L Rigide Blanc',
        capacity_liters: 5,
        stock_quantity: 80
      })
      .expect(201);

    expect(res.body.name).toBe('Bidon 5L Rigide Blanc');
    expect(res.body.capacity_liters).toBe(5);
    expect(res.body.stock_quantity).toBe(80);

    const list = await request(app).get('/api/containers').expect(200);
    expect(list.body.some((c: any) => c.id === res.body.id)).toBe(true);
  });

  it('4. CreateCustomerModal flow: successfully creates retail and wholesale customers', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({
        name: 'Société Clean Pro',
        phone: '98112233',
        address: 'Avenue Habib Bourguiba, Tunis',
        type: 'WHOLESALE',
        reseller_discount_percent: 0,
        wallet_balance: 50.0
      })
      .expect(201);

    expect(res.body.name).toBe('Société Clean Pro');
    expect(res.body.type).toBe('WHOLESALE');
    expect(res.body.wallet_balance).toBe(50.0);

    const list = await request(app).get('/api/customers').expect(200);
    expect(list.body.some((c: any) => c.id === res.body.id)).toBe(true);
  });

  it('5. CreateFormulationModal flow: successfully creates formulation recipe with ingredients', async () => {
    // Create ingredients first
    const mat1 = await request(app)
      .post('/api/materials')
      .send({ name: 'Eau Déminéralisée', category: 'solvent', unit: 'L', initial_stock: 1000, latest_purchase_cost: 0.1 })
      .expect(201);

    const mat2 = await request(app)
      .post('/api/materials')
      .send({ name: 'Texapon N70', category: 'surfactant', unit: 'kg', initial_stock: 100, latest_purchase_cost: 6.5 })
      .expect(201);

    const formRes = await request(app)
      .post('/api/formulations')
      .send({
        name: 'Liquide Vaisselle Citron Standard',
        base_yield_quantity: 100,
        base_yield_unit: 'L',
        notes: 'Mélanger lentement pour éviter la mousse',
        items: [
          { material_id: mat1.body.id, quantity_required: 85 },
          { material_id: mat2.body.id, quantity_required: 15 }
        ]
      })
      .expect(201);

    expect(formRes.body.name).toBe('Liquide Vaisselle Citron Standard');
    expect(formRes.body.items).toHaveLength(2);
    // Cost: 85 * 0.1 + 15 * 6.5 = 8.5 + 97.5 = 106 DT total for 100L -> 1.06 DT/L
    expect(formRes.body.total_batch_cost).toBe(106);
    expect(formRes.body.cost_per_liter).toBe(1.06);
  });

  it('6. CreateProductModal flow: creates Product Family and initial SKU linked to formulation', async () => {
    // Create container and formulation
    const cont = await request(app)
      .post('/api/containers')
      .send({ name: 'Flacon 1L Standard', capacity_liters: 1, stock_quantity: 100 })
      .expect(201);

    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Liquide Vaisselle Citron',
        category: 'Detergents',
        type: 'MANUFACTURED'
      })
      .expect(201);

    expect(famRes.body.name).toBe('Liquide Vaisselle Citron');

    const skuRes = await request(app)
      .post('/api/products')
      .send({
        family_id: famRes.body.id,
        size_label: '1L',
        barcode: '6191234567890',
        retail_price: 3.5,
        wholesale_price: 2.8,
        cost_reference: 1.25,
        stock_quantity: 45,
        low_stock_threshold: 10,
        container_type_id: cont.body.id
      })
      .expect(201);

    expect(skuRes.body.name).toBe('Liquide Vaisselle Citron - 1L');
    expect(skuRes.body.retail_price).toBe(3.5);
    expect(skuRes.body.stock_quantity).toBe(45);

    // Check product listing
    const prodList = await request(app).get('/api/products').expect(200);
    expect(prodList.body.some((p: any) => p.id === skuRes.body.id)).toBe(true);
  });

  it('7. InventoryAdjustmentModal flow: records stock delta with audit reason', async () => {
    // Create product
    const fam = await request(app)
      .post('/api/products/families')
      .send({ name: 'Javel 12°', category: 'Disinfectant', type: 'MANUFACTURED' })
      .expect(201);

    const prod = await request(app)
      .post('/api/products')
      .send({
        family_id: fam.body.id,
        size_label: '1L',
        retail_price: 1.5,
        wholesale_price: 1.2,
        stock_quantity: 20
      })
      .expect(201);

    // Apply manual negative adjustment (spoilage/breakage)
    const adjRes = await request(app)
      .post('/api/inventory/adjustment')
      .send({
        item_type: 'PRODUCT',
        item_id: prod.body.id,
        quantity_delta: -3,
        reason: 'Flacons endommagés lors de la manipulation'
      })
      .expect(201);

    expect(adjRes.body.success).toBe(true);
    expect(adjRes.body.new_stock).toBe(17);

    // Verify product stock in DB
    const checkProd = await request(app).get(`/api/products/${prod.body.id}`).expect(200);
    expect(checkProd.body.stock_quantity).toBe(17);
  });

  it('8. CreateExpenseModal flow: records general expense with category and note', async () => {
    const expRes = await request(app)
      .post('/api/accounting/expenses')
      .send({
        amount: 85.5,
        category: 'Électricité & Eau (Utilities)',
        description: 'Facture STEG compteur magasin',
        date: new Date().toISOString().slice(0, 10)
      })
      .expect(201);

    expect(expRes.body.amount).toBe(85.5);
    expect(expRes.body.category).toBe('Électricité & Eau (Utilities)');

    // Verify cash flow reflects expenses
    const cfRes = await request(app).get('/api/accounting/cash-flow').expect(200);
    expect(cfRes.body.money_out.general_expenses).toBe(85.5);
  });

  it('9. Supplier Ledger & FIFO debt repayment flow: allocates debt payment correctly', async () => {
    // 1. Create supplier
    const sup = await request(app)
      .post('/api/suppliers')
      .send({ name: 'Fournisseur Cartonnerie', phone: '71000000' })
      .expect(201);

    // 2. Create raw material
    const mat = await request(app)
      .post('/api/materials')
      .send({ name: 'Carton 12x1L', category: 'box', unit: 'pcs', initial_stock: 0, latest_purchase_cost: 1.2 })
      .expect(201);

    // 3. Purchase 100 cartons on credit (total 120 DT, 20 DT paid upfront, 100 DT debt)
    const poRes = await request(app)
      .post('/api/purchases')
      .send({
        supplier_id: sup.body.id,
        type: 'RAW_MATERIAL',
        item_id: mat.body.id,
        quantity: 100,
        unit_cost: 1.2,
        cash_paid: 20
      })
      .expect(201);

    expect(poRes.body.debt_ticket).toBeDefined();
    expect(poRes.body.debt_ticket.remaining_amount).toBe(100);

    // 4. Query supplier open tickets
    const ticketsRes = await request(app)
      .get(`/api/suppliers/${sup.body.id}/tickets`)
      .expect(200);

    expect(ticketsRes.body).toHaveLength(1);
    expect(ticketsRes.body[0].remaining_amount).toBe(100);

    // 5. Pay 60 DT towards supplier debt
    const payRes = await request(app)
      .post(`/api/suppliers/${sup.body.id}/debt/repay`)
      .send({ amount: 60 })
      .expect(200);

    expect(payRes.body.success).toBe(true);
    expect(payRes.body.allocated).toBe(60);
    expect(payRes.body.remaining_balance).toBe(40);

    // 6. Verify tickets and supplier total debt
    const ticketsAfter = await request(app)
      .get(`/api/suppliers/${sup.body.id}/tickets`)
      .expect(200);

    expect(ticketsAfter.body[0].remaining_amount).toBe(40);
    expect(ticketsAfter.body[0].status).toBe('PARTIALLY_PAID');

    const supAfter = await request(app)
      .get(`/api/suppliers/${sup.body.id}`)
      .expect(200);

    expect(supAfter.body.total_debt).toBe(40);
  });

  it('10. Endpoint aliases and hardening: price-history, families/:id, suppliers/purchases, and target_batch_size', async () => {
    // 1. Test material price history alias
    const mat = await request(app)
      .post('/api/materials')
      .send({ name: 'Pine Oil', category: 'fragrance', unit: 'kg', initial_stock: 10, latest_purchase_cost: 15.0 })
      .expect(201);

    const hist1 = await request(app).get(`/api/materials/${mat.body.id}/history`).expect(200);
    const hist2 = await request(app).get(`/api/materials/${mat.body.id}/price-history`).expect(200);
    expect(Array.isArray(hist1.body)).toBe(true);
    expect(Array.isArray(hist2.body)).toBe(true);
    expect(hist1.body.length).toBe(hist2.body.length);

    // 2. Test product family single GET /api/products/families/:id
    const fam = await request(app)
      .post('/api/products/families')
      .send({ name: 'Degreaser Pro', category: 'Degreasers', type: 'RESALE' })
      .expect(201);

    const getFam = await request(app).get(`/api/products/families/${fam.body.id}`).expect(200);
    expect(getFam.body.id).toBe(fam.body.id);
    expect(getFam.body.name).toBe('Degreaser Pro');
    expect(Array.isArray(getFam.body.products)).toBe(true);

    // 3. Test suppliers/purchases alias
    const purchasesAlias = await request(app).get('/api/suppliers/purchases').expect(200);
    expect(Array.isArray(purchasesAlias.body)).toBe(true);

    // 4. Test formulations preview-batch with target_batch_size
    const form = await request(app)
      .post('/api/formulations')
      .send({
        name: 'Window Cleaner Eco',
        base_yield_quantity: 10,
        base_yield_unit: 'L',
        items: [{ material_id: mat.body.id, quantity: 2, unit: 'kg' }]
      })
      .expect(201);

    const preview = await request(app)
      .get(`/api/formulations/${form.body.id}/preview-batch?target_batch_size=20`)
      .expect(200);
    expect(preview.body.scale_factor).toBe(2);
  });
});
