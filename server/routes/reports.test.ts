import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';

describe('Reports API Endpoints', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('generates Sales by Customer report with tender breakdown and summary', async () => {
    // 0. Open register session
    await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Countertop', opening_cash: 100 });

    // 1. Create a customer
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Société CleanPlus', phone: '98111222' });
    const customerId = custRes.body.id;

    // 2. Create a sale for this customer
    await request(app)
      .post('/api/sales')
      .send({
        customer_id: customerId,
        date: '2026-09-08T10:00:00Z',
        items: [{ is_quick_add: 1, quick_add_name: 'Detergent Bulk 10L', quantity: 2, unit_price: 25.000 }],
        subtotal_ht: 42.017,
        tva_rate: 0.19,
        tva_amount: 7.983,
        total_ttc: 50.000,
        cash_paid: 30.000,
        wallet_paid: 0,
        credit_amount: 20.000
      });

    // 3. Create a walk-in sale (no customer_id)
    await request(app)
      .post('/api/sales')
      .send({
        date: '2026-09-08T11:00:00Z',
        items: [{ is_quick_add: 1, quick_add_name: 'Bleach 1L', quantity: 1, unit_price: 3.500 }],
        subtotal_ht: 2.941,
        tva_rate: 0.19,
        tva_amount: 0.559,
        total_ttc: 3.500,
        cash_paid: 3.500,
        cash_tendered: 5.000,
        change_given: 1.500
      });

    // 4. Request report
    const res = await request(app)
      .get('/api/reports/sales-by-customer?start_date=2026-09-01&end_date=2026-09-30');
    expect(res.status).toBe(200);
    expect(res.body.customer_sales.length).toBe(2);

    const named = res.body.customer_sales.find((c: any) => c.customer_name === 'Société CleanPlus');
    expect(named).toBeDefined();
    expect(named.total_ttc).toBe(50.000);
    expect(named.cash_paid).toBe(30.000);
    expect(named.credit_amount).toBe(20.000);

    const walkIn = res.body.customer_sales.find((c: any) => c.customer_name === 'Walk-in Customer');
    expect(walkIn).toBeDefined();
    expect(walkIn.total_ttc).toBe(3.500);

    // Summary verification
    expect(res.body.summary.total_sales_count).toBe(2);
    expect(res.body.summary.total_ttc).toBe(53.500);
    expect(res.body.summary.total_credit).toBe(20.000);
  });

  it('attributes late-night UTC sales to the next Tunis business day', async () => {
    await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Countertop', opening_cash: 100 });

    const mkSale = (date: string) =>
      request(app).post('/api/sales').send({
        date,
        items: [{ is_quick_add: 1, quick_add_name: 'Night Item', quantity: 1, unit_price: 10.0 }],
        cash_paid: 10.0,
        cash_tendered: 10.0
      });
    expect((await mkSale('2026-01-15T23:30:00.000Z')).status).toBe(201);
    expect((await mkSale('2026-01-15T22:30:00.000Z')).status).toBe(201);

    const nextDay = await request(app).get(
      '/api/reports/sales-by-customer?start_date=2026-01-16&end_date=2026-01-16'
    );
    expect(nextDay.status).toBe(200);
    expect(nextDay.body.summary.total_sales_count).toBe(1);
    expect(nextDay.body.summary.total_ttc).toBe(10.0);

    const sameDay = await request(app).get(
      '/api/reports/sales-by-register?start_date=2026-01-15&end_date=2026-01-15'
    );
    expect(sameDay.status).toBe(200);
    expect(sameDay.body.summary.total_sales_count).toBe(1);
  });

  it('generates Sales by Register report grouped by counter_name', async () => {
    // 1. Open session on Countertop
    const s1 = await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Countertop', opening_cash: 100 });
    const s1Id = s1.body.id;

    // Sale on Countertop
    await request(app)
      .post('/api/sales')
      .send({
        session_id: s1Id,
        date: '2026-09-08T10:00:00Z',
        items: [{ is_quick_add: 1, quick_add_name: 'Item A', quantity: 1, unit_price: 15 }],
        subtotal_ht: 12.605,
        tva_rate: 0.19,
        tva_amount: 2.395,
        total_ttc: 15.000,
        cash_paid: 15.000
      });

    // 2. Open session on Mobile Register
    const s2 = await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Mobile Register', opening_cash: 0 });
    const s2Id = s2.body.id;

    // Sale on Mobile Register
    await request(app)
      .post('/api/sales')
      .send({
        session_id: s2Id,
        date: '2026-09-08T12:00:00Z',
        items: [{ is_quick_add: 1, quick_add_name: 'Item B', quantity: 2, unit_price: 10 }],
        subtotal_ht: 16.807,
        tva_rate: 0.19,
        tva_amount: 3.193,
        total_ttc: 20.000,
        cash_paid: 20.000
      });

    const res = await request(app).get('/api/reports/sales-by-register');
    expect(res.status).toBe(200);
    expect(res.body.register_sales.length).toBe(2);

    const countertop = res.body.register_sales.find((r: any) => r.counter_name === 'Countertop');
    expect(countertop.total_ttc).toBe(15.000);

    const mobile = res.body.register_sales.find((r: any) => r.counter_name === 'Mobile Register');
    expect(mobile.total_ttc).toBe(20.000);

    expect(res.body.summary.total_ttc).toBe(35.000);
  });

  it('generates Customer Debt Payments report with chronological and customer groupings', async () => {
    // 1. Create customer
    const c = await request(app)
      .post('/api/customers')
      .send({ name: 'Hôtel Le Sultan', phone: '72000111' });
    const customerId = c.body.id;

    // 2. Record 2 debt repayments
    await request(app)
      .post(`/api/customers/${customerId}/payments`)
      .send({
        amount: 80.000,
        payment_method: 'Cash',
        notes: 'Partial payment invoice #44'
      });

    await request(app)
      .post(`/api/customers/${customerId}/payments`)
      .send({
        amount: 40.000,
        payment_method: 'Bank Transfer',
        notes: 'Final settlement'
      });

    const res = await request(app).get('/api/reports/customer-debt-payments');
    expect(res.status).toBe(200);
    expect(res.body.payments.length).toBe(2);
    expect(res.body.by_customer.length).toBe(1);
    expect(res.body.by_customer[0].total_paid).toBe(120.000);
    expect(res.body.summary.total_amount_paid).toBe(120.000);
  });

  it('generates Inventory Valuation report calculating line valuations and grand totals', async () => {
    // 1. Create product family & SKU
    const fam = await request(app)
      .post('/api/products/families')
      .send({ name: 'Bleach Regular', category: 'Detergents', type: 'MANUFACTURED' });

    await request(app)
      .post('/api/products')
      .send({
        family_id: fam.body.id,
        name: 'Bleach 1L',
        stock_quantity: 100,
        cost_reference: 1.200,
        retail_price: 2.000
      });

    // 2. Create raw material
    await request(app)
      .post('/api/materials')
      .send({
        name: 'Chlorine Concentrate',
        category: 'Chemicals',
        unit: 'kg',
        stock_quantity: 50,
        latest_purchase_cost: 4.000
      });

    const res = await request(app).get('/api/reports/inventory-valuation');
    expect(res.status).toBe(200);
    // Product valuation: 100 * 1.200 = 120.000 DT
    expect(res.body.summary.product_cost_valuation).toBe(120.000);
    // Material valuation: 50 * 4.000 = 200.000 DT
    expect(res.body.summary.material_cost_valuation).toBe(200.000);
    // Grand total = 320.000 DT
    expect(res.body.summary.grand_total_cost_valuation).toBe(320.000);
  });

  it('correctly nets out refunds in sales-by-customer and sales-by-register reports', async () => {
    // 1. Open register
    const regRes = await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Countertop', opening_cash: 100 });
    const sessionId = regRes.body.id;

    // 2. Create customer
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Net Report Test Client', phone: '99000111' });
    const customerId = custRes.body.id;

    // 3. Make sale: 100 DT split payment (60 cash, 40 credit)
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        session_id: sessionId,
        customer_id: customerId,
        date: '2026-09-08T10:00:00Z',
        items: [{ is_quick_add: 1, quick_add_name: 'Industrial Cleaner 20L', quantity: 2, unit_price: 50.000 }],
        subtotal_ht: 84.034,
        tva_rate: 0.19,
        tva_amount: 15.966,
        total_ttc: 100.000,
        cash_paid: 60.000,
        credit_amount: 40.000
      });
    expect(saleRes.status).toBe(201);
    const sale = saleRes.body.sale;

    // 4. Perform refund of 1 item (50 DT): 30 cash refund, 20 credit reduction
    const saleItemId = sale.items[0].id;
    const refRes = await request(app)
      .post(`/api/sales/${sale.id}/refund`)
      .send({
        items: [{ sale_item_id: saleItemId, quantity: 1 }],
        cash_refunded: 30.000,
        credit_reduced: 20.000,
        reason: 'Customer returned 1 item'
      });
    expect(refRes.status).toBe(201);

    // 5. Verify /api/reports/sales-by-customer
    const custReport = await request(app).get(`/api/reports/sales-by-customer?customer_id=${customerId}`);
    expect(custReport.status).toBe(200);
    const row = custReport.body.customer_sales[0];
    expect(row.gross_ttc).toBe(100.000);
    expect(row.refunded_amount).toBe(50.000);
    expect(row.net_ttc).toBe(50.000);
    expect(row.total_ttc).toBe(50.000); // Netted
    expect(row.cash_paid).toBe(30.000); // 60 - 30 = 30
    expect(row.credit_amount).toBe(20.000); // 40 - 20 = 20

    // Summary checks
    expect(custReport.body.summary.total_gross_ttc).toBe(100.000);
    expect(custReport.body.summary.total_refunded).toBe(50.000);
    expect(custReport.body.summary.total_net_ttc).toBe(50.000);
    expect(custReport.body.summary.total_cash).toBe(30.000);
    expect(custReport.body.summary.total_credit).toBe(20.000);

    // 6. Verify /api/reports/sales-by-register
    const regReport = await request(app).get('/api/reports/sales-by-register?counter_name=Countertop');
    expect(regReport.status).toBe(200);
    const regRow = regReport.body.register_sales[0];
    expect(regRow.gross_ttc).toBe(100.000);
    expect(regRow.refunded_amount).toBe(50.000);
    expect(regRow.net_ttc).toBe(50.000);
    expect(regRow.cash_paid).toBe(30.000);
    expect(regRow.credit_amount).toBe(20.000);
  });

  it('decomposes refunds per refund row across all sales reports (3 refunds on 1 sale, refunds across 2 sales) (REP-01)', async () => {
    // 0. Open register
    await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Countertop', opening_cash: 200 });

    // 1. Create 2 customers
    const cust1 = (await request(app).post('/api/customers').send({ name: 'Client TripleRefund', phone: '98000001' })).body;
    const cust2 = (await request(app).post('/api/customers').send({ name: 'Client SingleRefund', phone: '98000002' })).body;

    // 2. Sale 1 for Customer 1: 3 items of 15.000 DT = 45.000 DT TTC
    // HT = round3(45 / 1.19) = 37.815, TVA = 7.185
    const sale1Res = await request(app).post('/api/sales').send({
      customer_id: cust1.id,
      date: '2026-09-10T10:00:00Z',
      items: [
        { is_quick_add: 1, quick_add_name: 'Item A', quantity: 1, unit_price: 15.000 },
        { is_quick_add: 1, quick_add_name: 'Item B', quantity: 1, unit_price: 15.000 },
        { is_quick_add: 1, quick_add_name: 'Item C', quantity: 1, unit_price: 15.000 }
      ],
      subtotal_ht: 37.815,
      tva_rate: 0.19,
      tva_amount: 7.185,
      total_ttc: 45.000,
      cash_paid: 45.000
    });
    expect(sale1Res.status).toBe(201);
    const sale1 = sale1Res.body.sale;

    // 3. Sale 2 for Customer 2: 2 items of 20.000 DT = 40.000 DT TTC
    // HT = round3(40 / 1.19) = 33.613, TVA = 6.387
    const sale2Res = await request(app).post('/api/sales').send({
      customer_id: cust2.id,
      date: '2026-09-10T11:00:00Z',
      items: [
        { is_quick_add: 1, quick_add_name: 'Item D', quantity: 1, unit_price: 20.000 },
        { is_quick_add: 1, quick_add_name: 'Item E', quantity: 1, unit_price: 20.000 }
      ],
      subtotal_ht: 33.613,
      tva_rate: 0.19,
      tva_amount: 6.387,
      total_ttc: 40.000,
      cash_paid: 40.000
    });
    expect(sale2Res.status).toBe(201);
    const sale2 = sale2Res.body.sale;

    // 4. Perform 3 partial refunds on Sale 1:
    // Refund 1: Item A (15.000 DT) -> HT = round3(15/1.19) = 12.605, TVA = 2.395
    const ref1_1 = await request(app).post(`/api/sales/${sale1.id}/refund`).send({
      items: [{ sale_item_id: sale1.items[0].id, quantity: 1 }],
      cash_refunded: 15.000,
      reason: 'Refund item A'
    });
    expect(ref1_1.status).toBe(201);

    // Refund 2: Item B (15.000 DT) -> HT = 12.605, TVA = 2.395
    const ref1_2 = await request(app).post(`/api/sales/${sale1.id}/refund`).send({
      items: [{ sale_item_id: sale1.items[1].id, quantity: 1 }],
      cash_refunded: 15.000,
      reason: 'Refund item B'
    });
    expect(ref1_2.status).toBe(201);

    // Refund 3: Item C (15.000 DT) -> HT = 12.605, TVA = 2.395
    // Sum of 3 refunded HTs = 37.815, sum of 3 refunded TVAs = 7.185 (Total = 45.000)
    const ref1_3 = await request(app).post(`/api/sales/${sale1.id}/refund`).send({
      items: [{ sale_item_id: sale1.items[2].id, quantity: 1 }],
      cash_refunded: 15.000,
      reason: 'Refund item C'
    });
    expect(ref1_3.status).toBe(201);

    // 5. Perform 1 partial refund on Sale 2:
    // Item D (20.000 DT) -> HT = round3(20/1.19) = 16.807, TVA = 3.193
    const ref2_1 = await request(app).post(`/api/sales/${sale2.id}/refund`).send({
      items: [{ sale_item_id: sale2.items[0].id, quantity: 1 }],
      cash_refunded: 20.000,
      reason: 'Refund item D'
    });
    expect(ref2_1.status).toBe(201);

    // 6. Test GET /api/reports/sales-by-customer
    const custReport = await request(app).get('/api/reports/sales-by-customer?start_date=2026-09-01&end_date=2026-09-30');
    expect(custReport.status).toBe(200);

    const rowCust1 = custReport.body.customer_sales.find((c: any) => c.customer_id === cust1.id);
    expect(rowCust1).toBeDefined();
    expect(rowCust1.gross_ttc).toBe(45.000);
    expect(rowCust1.refunded_amount).toBe(45.000);
    expect(rowCust1.net_ttc).toBe(0.000);
    // Net HT + Net TVA == Net TTC
    expect(rowCust1.net_ht + rowCust1.net_tva).toBe(rowCust1.net_ttc);
    expect(rowCust1.total_ht + rowCust1.total_tva).toBe(rowCust1.total_ttc);
    expect(rowCust1.net_ht).toBe(0.000);
    expect(rowCust1.net_tva).toBe(0.000);

    const rowCust2 = custReport.body.customer_sales.find((c: any) => c.customer_id === cust2.id);
    expect(rowCust2).toBeDefined();
    expect(rowCust2.gross_ttc).toBe(40.000);
    expect(rowCust2.refunded_amount).toBe(20.000);
    expect(rowCust2.net_ttc).toBe(20.000);
    // Net HT + Net TVA == Net TTC
    expect(rowCust2.net_ht + rowCust2.net_tva).toBe(rowCust2.net_ttc);
    expect(rowCust2.total_ht + rowCust2.total_tva).toBe(rowCust2.total_ttc);
    expect(rowCust2.net_ht).toBe(16.806); // 33.613 - 16.807 = 16.806
    expect(rowCust2.net_tva).toBe(3.194); // 6.387 - 3.193 = 3.194

    // Check summary in sales-by-customer
    const custSummary = custReport.body.summary;
    expect(custSummary.total_net_ht + custSummary.total_net_tva).toBe(custSummary.total_net_ttc);
    expect(custSummary.total_ht + custSummary.total_tva).toBe(custSummary.total_ttc);
    expect(custSummary.total_net_ttc).toBe(20.000);

    // 7. Test GET /api/reports/sales-by-register
    const regReport = await request(app).get('/api/reports/sales-by-register?start_date=2026-09-01&end_date=2026-09-30');
    expect(regReport.status).toBe(200);

    const regRow = regReport.body.register_sales[0];
    expect(regRow).toBeDefined();
    expect(regRow.gross_ttc).toBe(85.000); // 45 + 40
    expect(regRow.refunded_amount).toBe(65.000); // 45 + 20
    expect(regRow.net_ttc).toBe(20.000);
    expect(regRow.net_ht + regRow.net_tva).toBe(regRow.net_ttc);
    expect(regRow.total_ht + regRow.total_tva).toBe(regRow.total_ttc);

    const regSummary = regReport.body.summary;
    expect(regSummary.total_net_ht + regSummary.total_net_tva).toBe(regSummary.total_net_ttc);
    expect(regSummary.total_ht + regSummary.total_tva).toBe(regSummary.total_ttc);
    expect(regSummary.total_net_ttc).toBe(20.000);
  });
});

