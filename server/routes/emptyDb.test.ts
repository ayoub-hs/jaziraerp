import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb, getDb } from '../../tests/testApp.js';

describe('C2: Empty-Database & Full Lifecycle API Tests', () => {
  beforeEach(() => {
    resetTestDb();
  });

  describe('Part a: GET Routes on Pristine Empty Database', () => {
    // Helper to deeply verify that no numeric property is NaN, Infinity, or string "NaN"
    function assertNoNaNOrInfinity(obj: any, path = ''): void {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'number') {
        expect(Number.isNaN(obj), `Numeric field at ${path} is NaN`).toBe(false);
        expect(Number.isFinite(obj), `Numeric field at ${path} is Infinity`).toBe(true);
        return;
      }
      if (typeof obj === 'string') {
        expect(obj, `String field at ${path} contains "NaN"`).not.toBe('NaN');
        expect(obj, `String field at ${path} contains "Infinity"`).not.toBe('Infinity');
        return;
      }
      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => assertNoNaNOrInfinity(item, `${path}[${idx}]`));
        return;
      }
      if (typeof obj === 'object') {
        for (const [key, val] of Object.entries(obj)) {
          assertNoNaNOrInfinity(val, path ? `${path}.${key}` : key);
        }
      }
    }

    const getRoutes = [
      '/api/auth/status',
      '/api/categories',
      '/api/suppliers',
      '/api/materials',
      '/api/formulations',
      '/api/products',
      '/api/products/families',
      '/api/production/batches',
      '/api/customers',
      '/api/purchases',
      '/api/containers/types',
      '/api/containers',
      '/api/containers/loans',
      '/api/containers/transactions',
      '/api/sales',
      '/api/inventory/adjustments',
      '/api/accounting/expenses',
      '/api/accounting/cash-flow',
      '/api/accounting/stock-valuation',
      '/api/register/counters',
      '/api/register/current',
      '/api/register/open-sessions',
      '/api/register/sessions',
      '/api/reports/sales-by-customer',
      '/api/reports/sales-by-register',
      '/api/reports/customer-debt-payments',
      '/api/reports/inventory-valuation',
      '/api/sync/pull',
      '/api/backups',
      '/api/hardware/drawer/status',
      '/api/hardware/printer/status'
    ];

    for (const route of getRoutes) {
      it(`returns HTTP 200 without NaN/Infinity on ${route}`, async () => {
        const res = await request(app).get(route);
        expect(res.status, `Failed GET ${route}: ${JSON.stringify(res.body)}`).toBe(200);
        assertNoNaNOrInfinity(res.body, route);
      });
    }

    it('asserts that aggregate reports have valid numbers on empty database', async () => {
      // 1. Accounting cash flow
      const cfRes = await request(app).get('/api/accounting/cash-flow');
      expect(cfRes.status).toBe(200);
      expect(typeof cfRes.body.total_inflow).toBe('number');
      expect(typeof cfRes.body.total_outflow).toBe('number');
      expect(typeof cfRes.body.money_in.sales_cash).toBe('number');
      expect(typeof cfRes.body.money_out.general_expenses).toBe('number');
      expect(typeof cfRes.body.net_cash_flow).toBe('number');
      expect(cfRes.body.net_cash_flow).toBe(0);

      // 2. Accounting stock valuation
      const svRes = await request(app).get('/api/accounting/stock-valuation');
      expect(svRes.status).toBe(200);
      expect(typeof svRes.body.total_inventory_valuation).toBe('number');
      expect(typeof svRes.body.raw_materials_valuation).toBe('number');
      expect(typeof svRes.body.finished_goods_valuation).toBe('number');
      expect(svRes.body.total_inventory_valuation).toBe(0);

      // 3. Reports: inventory valuation
      const ivRes = await request(app).get('/api/reports/inventory-valuation');
      expect(ivRes.status).toBe(200);
      expect(Array.isArray(ivRes.body.products)).toBe(true);
      expect(Array.isArray(ivRes.body.materials)).toBe(true);
      expect(ivRes.body.products.length).toBe(0);
      expect(ivRes.body.materials.length).toBe(0);

      // 4. Sync pull
      const syncRes = await request(app).get('/api/sync/pull');
      expect(syncRes.status).toBe(200);
      expect(Array.isArray(syncRes.body.products)).toBe(true);
      expect(Array.isArray(syncRes.body.customers)).toBe(true);
      expect(Array.isArray(syncRes.body.container_types)).toBe(true);
    });
  });

  describe('Part b: Full Lifecycle API Test from Empty Database', () => {
    it('executes full business lifecycle with exact hand-computed values', async () => {
      // -------------------------------------------------------------
      // 1. Initial Security Setup
      // -------------------------------------------------------------
      const authSetupRes = await request(app)
        .post('/api/auth/setup')
        .send({
          pin: '1234',
          password: 'MasterPassword123',
          shop_name: 'Société Al Jazira SHSP'
        });
      expect(authSetupRes.status).toBe(200);
      expect(authSetupRes.body.configured).toBe(true);

      // -------------------------------------------------------------
      // 2. Master Data Setup
      // -------------------------------------------------------------
      // a) Category
      const catRes = await request(app)
        .post('/api/categories')
        .send({ id: 'cat-det-liq', name: 'Detergent Liquids', type: 'PRODUCT' });
      expect(catRes.status).toBe(201);

      // b) Supplier
      const supRes = await request(app)
        .post('/api/suppliers')
        .send({
          name: 'Sfax Chemical Co',
          phone: '+216 74 111 222',
          address: 'Route de Gabes Km 3'
        });
      expect(supRes.status).toBe(201);
      const supplierId = supRes.body.id;

      // c) Raw Material
      // Initial stock: 0.000 kg
      const matRes = await request(app)
        .post('/api/materials')
        .send({
          name: 'Labsa Sulfonic Acid',
          category: 'surfactant',
          unit: 'kg',
          low_stock_threshold: 10
        });
      expect(matRes.status).toBe(201);
      const materialId = matRes.body.id;

      // d) Customers: Retail + Reseller
      const custRetailRes = await request(app)
        .post('/api/customers')
        .send({
          name: 'Ali Trabelsi',
          phone: '+216 98 100 200',
          type: 'RETAIL'
        });
      expect(custRetailRes.status).toBe(201);
      const retailCustomerId = custRetailRes.body.id;

      const custResellerRes = await request(app)
        .post('/api/customers')
        .send({
          name: 'Comptoir Sud',
          phone: '+216 98 300 400',
          type: 'RESELLER',
          reseller_discount_percent: 10 // 10% reseller discount
        });
      expect(custResellerRes.status).toBe(201);
      const resellerCustomerId = custResellerRes.body.id;

      // e) Returnable Container Type
      const containerRes = await request(app)
        .post('/api/containers/types')
        .send({
          name: '5L Jerrycan',
          capacity_liters: 5,
          stock_quantity: 50
        });
      expect(containerRes.status).toBe(201);
      const containerTypeId = containerRes.body.id;

      // f) Formulation: 1 unit requires 1 kg of Labsa (base_yield: 1 unit = 1 kg Labsa)
      const formRes = await request(app)
        .post('/api/formulations')
        .send({
          name: 'Standard Liquid Soap Formula',
          base_yield_quantity: 1,
          base_yield_unit: 'piece',
          items: [
            { material_id: materialId, quantity_required: 1.0 }
          ]
        });
      expect(formRes.status).toBe(201);
      const formulationId = formRes.body.id;

      // g) Product Family & Product SKU with Pack Size
      const familyRes = await request(app)
        .post('/api/products/families')
        .send({
          name: 'Savon Liquide Citron',
          category: 'Detergent Liquids',
          type: 'MANUFACTURED',
          formulation_id: formulationId
        });
      expect(familyRes.status).toBe(201);
      const familyId = familyRes.body.id;

      const prodRes = await request(app)
        .post('/api/products')
        .send({
          family_id: familyId,
          name: 'Savon Liquide 5L',
          size_label: '5L',
          barcode: 'JAZ-LAV-5L',
          retail_price: 15.000,   // Standard retail: 15.000 DT
          wholesale_price: 12.000,
          container_type_id: containerTypeId
        });
      expect(prodRes.status).toBe(201);
      const productId = prodRes.body.id;

      const packRes = await request(app)
        .post(`/api/products/${productId}/pack-sizes`)
        .send({
          pack_label: 'Carton of 4 (20L)',
          multiplier: 4,
          price_override: 55.000,
          barcode: 'JAZ-PACK-4'
        });
      expect(packRes.status).toBe(201);

      // -------------------------------------------------------------
      // 3. Purchases: Cash Purchase and Credit Purchase with Down Payment
      // -------------------------------------------------------------
      // Purchase 1 (CASH):
      // 100 kg Labsa at 3.000 DT/kg = 300.000 DT
      // Arithmetic: Labsa stock = 0 + 100 = 100 kg
      const po1Res = await request(app)
        .post('/api/purchases')
        .send({
          supplier_id: supplierId,
          date: '2026-10-04',
          payment_status: 'PAID',
          cash_paid: 300.000,
          items: [
            {
              item_type: 'RAW_MATERIAL',
              material_id: materialId,
              quantity: 100,
              unit_cost: 3.000
            }
          ]
        });
      expect(po1Res.status).toBe(201);

      // Purchase 2 (CREDIT with down payment):
      // 50 kg Labsa at 3.200 DT/kg = 160.000 DT total
      // Down payment: 60.000 DT cash
      // Arithmetic:
      //   Remaining supplier debt ticket: 160.000 - 60.000 = 100.000 DT (PARTIALLY_PAID)
      //   Labsa stock = 100 + 50 = 150 kg
      const po2Res = await request(app)
        .post('/api/purchases')
        .send({
          supplier_id: supplierId,
          date: '2026-10-04',
          payment_status: 'CREDIT',
          cash_paid: 60.000,
          items: [
            {
              item_type: 'RAW_MATERIAL',
              material_id: materialId,
              quantity: 50,
              unit_cost: 3.200
            }
          ]
        });
      expect(po2Res.status).toBe(201);

      // -------------------------------------------------------------
      // 4. Production Batch
      // -------------------------------------------------------------
      // Produce 20 units of 'Savon Liquide 5L'
      // Formula requires: 20 units * 1.0 kg/unit = 20 kg Labsa
      // Arithmetic:
      //   Labsa stock consumed: 20 kg
      //   Labsa stock remaining: 150 - 20 = 130 kg
      //   Savon Liquide 5L stock produced: 0 + 20 = 20 units
      const batchRes = await request(app)
        .post('/api/production/batches')
        .send({
          formulation_id: formulationId,
          target_product_id: productId,
          units_produced: 20,
          date: '2026-10-04'
        });
      expect(batchRes.status).toBe(201);
      expect(batchRes.body.total_batch_cost).toBe(61.340);
      expect(batchRes.body.cost_per_unit).toBe(3.067);

      // -------------------------------------------------------------
      // 5. Open Register Session
      // -------------------------------------------------------------
      // Opening float: 100.000 DT
      const openSessionRes = await request(app)
        .post('/api/register/open')
        .send({
          counter_name: 'Countertop',
          opening_cash: 100.000
        });
      expect(openSessionRes.status).toBe(201);
      const sessionId = openSessionRes.body.id;

      // -------------------------------------------------------------
      // 6. Sales Operations & Partial Refund
      // -------------------------------------------------------------
      // a) Sale 1 (Cash Sale with Change):
      // Retail Customer buys 2 units at 15.000 DT = 30.000 DT total TTC
      // Tender: cash_paid: 30.000 DT applied, cash_tendered: 50.000 DT -> change given: 20.000 DT
      // Net cash into drawer: 30.000 DT
      // Arithmetic:
      //   Product stock: 20 - 2 = 18 units
      //   Register expected cash: 100.000 float + 30.000 net sale = 130.000 DT
      const sale1Res = await request(app)
        .post('/api/sales')
        .send({
          session_id: sessionId,
          customer_id: retailCustomerId,
          date: '2026-10-04',
          cash_paid: 30.000,
          cash_tendered: 50.000,
          wallet_paid: 0,
          credit_amount: 0,
          items: [
            {
              product_id: productId,
              quantity: 2,
              unit_price: 15.000,
              line_total: 30.000
            }
          ]
        });
      expect(sale1Res.status).toBe(201);
      const sale1Id = sale1Res.body.id;
      const sale1ItemId = sale1Res.body.items[0].id;
      expect(sale1Res.body.change_given).toBe(20.000);

      // b) Wallet Top-Up for Reseller Customer:
      // Deposit 100.000 DT into wallet
      // Arithmetic: Reseller wallet = 0 + 100.000 = 100.000 DT
      const topUpRes = await request(app)
        .post(`/api/customers/${resellerCustomerId}/wallet/top-up`)
        .send({
          amount: 100.000,
          notes: 'Prepayment deposit'
        });
      expect(topUpRes.status).toBe(201);

      // c) Sale 2 (Wallet Sale):
      // Reseller buys 4 units at 10% discount: 15.000 * 0.9 = 13.500 DT each
      // Total TTC = 4 * 13.500 = 54.000 DT
      // Payment: wallet_paid = 54.000 DT
      // Arithmetic:
      //   Reseller wallet balance: 100.000 - 54.000 = 46.000 DT
      //   Product stock: 18 - 4 = 14 units
      //   Register expected cash: 130.000 DT (wallet payment does not enter register cash)
      const sale2Res = await request(app)
        .post('/api/sales')
        .send({
          session_id: sessionId,
          customer_id: resellerCustomerId,
          date: '2026-10-04',
          wallet_paid: 54.000,
          cash_paid: 0,
          credit_amount: 0,
          items: [
            {
              product_id: productId,
              quantity: 4,
              unit_price: 13.500,
              line_total: 54.000
            }
          ]
        });
      expect(sale2Res.status).toBe(201);

      // d) Sale 3 (Credit Sale):
      // Reseller buys 2 units on credit: 2 * 13.500 = 27.000 DT total TTC
      // Payment: credit_amount = 27.000 DT
      // Arithmetic:
      //   Customer debt ticket created: total: 27.000 DT, remaining: 27.000 DT
      //   Product stock: 14 - 2 = 12 units
      //   Register expected cash: 130.000 DT
      const sale3Res = await request(app)
        .post('/api/sales')
        .send({
          session_id: sessionId,
          customer_id: resellerCustomerId,
          date: '2026-10-04',
          credit_amount: 27.000,
          cash_paid: 0,
          wallet_paid: 0,
          items: [
            {
              product_id: productId,
              quantity: 2,
              unit_price: 13.500,
              line_total: 27.000
            }
          ]
        });
      expect(sale3Res.status).toBe(201);

      // e) Partial Refund on Sale 1:
      // Refund 1 unit from Sale 1 (purchased at 15.000 DT)
      // Paid out from register cash: 15.000 DT
      // Arithmetic:
      //   Product stock restored: 12 + 1 = 13 units
      //   Register expected cash: 130.000 - 15.000 = 115.000 DT
      const refundRes = await request(app)
        .post(`/api/sales/${sale1Id}/refund`)
        .send({
          date: '2026-10-04',
          reason: 'Customer returned 1 undamaged bottle',
          session_id: sessionId,
          cash_refunded: 15.000,
          items: [
            {
              sale_item_id: sale1ItemId,
              quantity: 1
            }
          ]
        });
      expect(refundRes.status).toBe(201);

      // -------------------------------------------------------------
      // 7. Customer Debt Payment with Overpayment
      // -------------------------------------------------------------
      // Reseller has 1 debt ticket for 27.000 DT.
      // Customer pays 37.000 DT cash.
      // Arithmetic:
      //   Debt ticket remaining: 27.000 - 27.000 = 0.000 DT (status = 'PAID')
      //   Overpayment deposit into wallet: 37.000 - 27.000 = 10.000 DT
      //   Reseller wallet balance: 46.000 + 10.000 = 56.000 DT
      const custPayRes = await request(app)
        .post(`/api/customers/${resellerCustomerId}/payments`)
        .send({
          amount: 37.000,
          payment_method: 'Cash',
          date: '2026-10-04'
        });
      expect(custPayRes.status).toBe(200);
      expect(custPayRes.body.overpayment_wallet_credit).toBe(10.000);

      // -------------------------------------------------------------
      // 8. Supplier Payment
      // -------------------------------------------------------------
      // Remaining debt on Purchase 2 ticket: 100.000 DT (160.000 total - 60.000 down payment)
      // Pay 100.000 DT
      // Arithmetic:
      //   Remaining supplier debt ticket: 100.000 - 100.000 = 0.000 DT (status = 'PAID')
      const supPayRes = await request(app)
        .post(`/api/suppliers/${supplierId}/payments`)
        .send({
          amount: 100.000,
          payment_method: 'Bank',
          date: '2026-10-04'
        });
      expect(supPayRes.status).toBe(200);
      expect(supPayRes.body.amount_allocated).toBe(100.000);

      // -------------------------------------------------------------
      // 9. Close Register Session
      // -------------------------------------------------------------
      // Expected cash in drawer:
      //   100.000 (opening float)
      // +  30.000 (net cash from Sale 1: 50.000 tender - 20.000 change)
      // -  15.000 (cash refund payout on Sale 1)
      // = 115.000 DT expected
      // Note: S1 tenders 50.000 DT cash on a 30.000 DT total with 20.000 DT change.
      // The old flawed formula (opening_cash + cash_paid - change_given - refund) would give 95.000 DT;
      // the correct formula yields 115.000 DT.
      // Counted: 115.000 DT -> difference = 0.000 DT
      const closeSessionRes = await request(app)
        .post('/api/register/close')
        .send({
          session_id: sessionId,
          counted_cash: 115.000
        });
      expect(closeSessionRes.status).toBe(200);
      expect(closeSessionRes.body.expected_cash).toBe(115.000);
      expect(closeSessionRes.body.counted_cash).toBe(115.000);
      expect(closeSessionRes.body.difference).toBe(0.000);
      expect(closeSessionRes.body.status).toBe('CLOSED');

      // -------------------------------------------------------------
      // 10. Final State Verification & Hand-Computed Invariant Checks
      // -------------------------------------------------------------
      const db = getDb();

      // a) Raw Material Stock Quantity
      // Arithmetic: 0 initial + 100 (PO1) + 50 (PO2) - 20 (Batch consumed) = 130 kg
      const finalMat: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(materialId);
      expect(finalMat.stock_quantity).toBe(130.000);

      // b) Finished Product Stock Quantity
      // Arithmetic: 0 initial + 20 (Batch produced) - 2 (Sale 1) - 4 (Sale 2) - 2 (Sale 3) + 1 (Refund restored) = 13 units
      const finalProd: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId);
      expect(finalProd.stock_quantity).toBe(13.000);

      // c) Customer Wallet Balance
      // Arithmetic: 0 initial + 100.000 (Top-up) - 54.000 (Sale 2 wallet paid) + 10.000 (Overpayment deposit) = 56.000 DT
      const finalCust: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(resellerCustomerId);
      expect(finalCust.wallet_balance).toBe(56.000);

      // d) Customer Debt Tickets
      // Arithmetic: Sale 3 created 27.000 DT ticket; Customer paid 37.000 DT (27.000 allocated); Remaining = 0.000 DT
      const custTickets: any[] = db.prepare('SELECT * FROM customer_debt_tickets WHERE customer_id = ?').all(resellerCustomerId);
      expect(custTickets.length).toBe(1);
      expect(custTickets[0].total_amount).toBe(27.000);
      expect(custTickets[0].remaining_amount).toBe(0.000);
      expect(custTickets[0].status).toBe('PAID');

      // e) Supplier Balance & Debt Tickets
      // Arithmetic: PO2 created 160.000 DT ticket; 60.000 initial down payment + 100.000 subsequent payment; Remaining = 0.000 DT
      const supTickets: any[] = db.prepare('SELECT * FROM supplier_debt_tickets WHERE supplier_id = ?').all(supplierId);
      expect(supTickets.length).toBe(1);
      expect(supTickets[0].total_amount).toBe(160.000);
      expect(supTickets[0].remaining_amount).toBe(0.000);
      expect(supTickets[0].status).toBe('PAID');

      // f) Closed Register Session Details
      // Arithmetic: 100.000 (float) + 30.000 (cash sale) - 15.000 (cash refund) = 115.000 DT expected
      const sessionRow: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(sessionId);
      expect(sessionRow.status).toBe('CLOSED');
      expect(sessionRow.opening_cash).toBe(100.000);
      expect(sessionRow.expected_cash).toBe(115.000);
      expect(sessionRow.counted_cash).toBe(115.000);
      expect(sessionRow.difference).toBe(0.000);

      // -------------------------------------------------------------
      // 11. Reports & Financial Invariants Verification
      // -------------------------------------------------------------

      // a) Sales Report by Customer (GET /api/reports/sales-by-customer)
      // Arithmetic:
      //   Gross TTC: 30.000 (S1) + 54.000 (S2) + 27.000 (S3) = 111.000 DT
      //   Refunded: 15.000 DT (Sale 1 partial refund)
      //   Net TTC: 111.000 - 15.000 = 96.000 DT
      //   Payment method net breakdown (reduced by matching refund amounts):
      //     Cash: 30.000 gross - 15.000 cash refund = 15.000 DT net
      //     Wallet: 54.000 gross - 0.000 wallet refund = 54.000 DT net
      //     Credit: 27.000 gross - 0.000 credit reduced = 27.000 DT net
      //     Total net payments: 15.000 + 54.000 + 27.000 = 96.000 DT
      const salesCustReport = await request(app).get('/api/reports/sales-by-customer');
      expect(salesCustReport.status).toBe(200);
      expect(salesCustReport.body.summary.total_gross_ttc).toBe(111.000);
      expect(salesCustReport.body.summary.total_refunded).toBe(15.000);
      expect(salesCustReport.body.summary.total_net_ttc).toBe(96.000);
      expect(salesCustReport.body.summary.total_cash).toBe(15.000);
      expect(salesCustReport.body.summary.total_wallet).toBe(54.000);
      expect(salesCustReport.body.summary.total_credit).toBe(27.000);

      // Customer rows check:
      // Retail customer: gross 30.000, refund 15.000, net 15.000, cash_paid 15.000
      const retailRow = salesCustReport.body.customer_sales.find((r: any) => r.customer_id === retailCustomerId);
      expect(retailRow).toBeDefined();
      expect(retailRow.gross_ttc).toBe(30.000);
      expect(retailRow.refunded_amount).toBe(15.000);
      expect(retailRow.net_ttc).toBe(15.000);
      expect(retailRow.cash_paid).toBe(15.000);

      // Reseller customer: gross 81.000 (54 + 27), refund 0.000, net 81.000, wallet_paid 54.000, credit_amount 27.000
      const resellerRow = salesCustReport.body.customer_sales.find((r: any) => r.customer_id === resellerCustomerId);
      expect(resellerRow).toBeDefined();
      expect(resellerRow.gross_ttc).toBe(81.000);
      expect(resellerRow.refunded_amount).toBe(0.000);
      expect(resellerRow.net_ttc).toBe(81.000);
      expect(resellerRow.wallet_paid).toBe(54.000);
      expect(resellerRow.credit_amount).toBe(27.000);

      // b) Sales Report by Register (GET /api/reports/sales-by-register)
      // Arithmetic:
      //   Countertop register:
      //   Gross TTC: 111.000 DT (30.000 + 54.000 + 27.000)
      //   Refunded: 15.000 DT
      //   Net TTC: 96.000 DT
      //   Net payments: cash 15.000 DT, wallet 54.000 DT, credit 27.000 DT
      const salesRegReport = await request(app).get('/api/reports/sales-by-register');
      expect(salesRegReport.status).toBe(200);
      expect(salesRegReport.body.summary.total_gross_ttc).toBe(111.000);
      expect(salesRegReport.body.summary.total_refunded).toBe(15.000);
      expect(salesRegReport.body.summary.total_net_ttc).toBe(96.000);
      expect(salesRegReport.body.summary.total_cash).toBe(15.000);
      expect(salesRegReport.body.summary.total_wallet).toBe(54.000);
      expect(salesRegReport.body.summary.total_credit).toBe(27.000);

      const regRow = salesRegReport.body.register_sales[0];
      expect(regRow.gross_ttc).toBe(111.000);
      expect(regRow.refunded_amount).toBe(15.000);
      expect(regRow.net_ttc).toBe(96.000);
      expect(regRow.cash_paid).toBe(15.000);
      expect(regRow.wallet_paid).toBe(54.000);
      expect(regRow.credit_amount).toBe(27.000);

      // c) Accounting Cash-Flow Report (GET /api/accounting/cash-flow)
      // Arithmetic:
      // Money In:
      //   sales_cash: 30.000 DT (Sale 1 cash)
      //   customer_debt_repayments: 37.000 DT (Reseller debt payment)
      //   wallet_top_ups: 100.000 DT (Reseller wallet deposit)
      //   total_inflow = 30.000 + 37.000 + 100.000 = 167.000 DT
      // Money Out:
      //   paid_purchases: 300.000 DT (PO1 cash purchase)
      //   supplier_debt_repayments: 160.000 DT (PO2 down payment: 60.000 DT + subsequent payment: 100.000 DT)
      //   general_expenses: 0.000 DT
      //   cash_refunds: 15.000 DT (Sale 1 partial refund payout)
      //   total_outflow = 300.000 + 160.000 + 0 + 15.000 = 475.000 DT
      // Net Cash Flow:
      //   total_inflow (167.000) - total_outflow (475.000) = -308.000 DT
      const cashFlowRes = await request(app).get('/api/accounting/cash-flow');
      expect(cashFlowRes.status).toBe(200);
      expect(cashFlowRes.body.total_inflow).toBe(167.000);
      expect(cashFlowRes.body.total_outflow).toBe(475.000);
      expect(cashFlowRes.body.net_cash_flow).toBe(-308.000);
      expect(cashFlowRes.body.money_in.sales_cash).toBe(30.000);
      expect(cashFlowRes.body.money_in.customer_debt_repayments).toBe(37.000);
      expect(cashFlowRes.body.money_in.wallet_top_ups).toBe(100.000);
      expect(cashFlowRes.body.money_out.paid_purchases).toBe(300.000);
      expect(cashFlowRes.body.money_out.supplier_debt_repayments).toBe(160.000);
      expect(cashFlowRes.body.money_out.general_expenses).toBe(0.000);
      expect(cashFlowRes.body.money_out.cash_refunds).toBe(15.000);

      // d) Inventory Stock Valuation Report (GET /api/accounting/stock-valuation & GET /api/reports/inventory-valuation)
      // Arithmetic:
      // Raw Material (Labsa):
      //   Stock: 130 kg (0 initial + 100 PO1 + 50 PO2 - 20 consumed)
      //   Weighted average cost: (100 kg * 3.000 + 50 kg * 3.200) / 150 kg = 460 / 150 = 3.067 DT/kg
      //   Valuation: 130 kg * 3.067 DT/kg = 398.710 DT
      // Finished Product (Savon Liquide 5L):
      //   Stock: 13 units (0 initial + 20 batch - 2 S1 - 4 S2 - 2 S3 + 1 refund)
      //   Unit cost: 3.067 DT/unit (Batch cost: 20 kg Labsa * 3.067 / 20 units = 3.067 DT)
      //   Valuation: 13 units * 3.067 DT/unit = 39.871 DT
      // Total Inventory Valuation:
      //   398.710 + 39.871 = 438.581 DT
      const stockValRes = await request(app).get('/api/accounting/stock-valuation');
      expect(stockValRes.status).toBe(200);
      expect(stockValRes.body.raw_materials_valuation).toBe(398.710);
      expect(stockValRes.body.finished_goods_valuation).toBe(39.871);
      expect(stockValRes.body.total_inventory_valuation).toBe(438.581);

      const invReportRes = await request(app).get('/api/reports/inventory-valuation');
      expect(invReportRes.status).toBe(200);
      expect(invReportRes.body.summary.material_cost_valuation).toBe(398.710);
      expect(invReportRes.body.summary.product_cost_valuation).toBe(39.871);
      expect(invReportRes.body.summary.grand_total_cost_valuation).toBe(438.581);
    });
  });
});
