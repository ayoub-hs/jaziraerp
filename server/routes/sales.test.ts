import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';
import { round3 } from '../utils/money.js';

describe('POS Sales & Checkout Module — Real HTTP Integration Tests', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // Seed customers: Retail, Wallet, Reseller
    db.prepare(`
      INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
      VALUES
        ('cust-retail', 'Walk-in Retail', 'RETAIL', 0, 0, '2026-09-07', '2026-09-07'),
        ('cust-wallet', 'Wallet Customer', 'RETAIL', 0, 20.000, '2026-09-07', '2026-09-07'),
        ('cust-reseller', 'Pro Reseller SARL', 'RESELLER', 10, 0, '2026-09-07', '2026-09-07')
    `).run();

    // Seed catalog items
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-cleaners', 'Surface Cleaners', 'Detergents', 'MANUFACTURED', '2026-09-07', '2026-09-07')
    `).run();

    // SKU 1: Floor Cleaner 1L (Retail 3.000 DT, Wholesale 2.500 DT)
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-clean-1l', 'fam-cleaners', 'Floor Cleaner 1L', '1L', '619000123456', 100, 3.000, 2.500, '2026-09-07', '2026-09-07')
    `).run();

    // Pack multiplier for Floor Cleaner 1L: Box of 12 pcs
    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode)
      VALUES ('pack-12-clean', 'prod-clean-1l', 'Box of 12', 12, 33.000, '619000123412')
    `).run();

    // Open register session
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
      VALUES ('ses-01', 'SES-01', 'Countertop', '2026-09-07 08:00:00', 100.000, 100.000, 'OPEN')
    `).run();

    // Seed container types and link to products
    db.prepare(`
      INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
      VALUES
        ('ct-bidon-1l', 'Bidon 1L', 1.0, 50, '2026-09-07'),
        ('ct-bidon-10l', 'Bidon 10L Consigné', 10.0, 20, '2026-09-07')
    `).run();

    db.prepare(`
      UPDATE products SET container_type_id = 'ct-bidon-1l' WHERE id = 'prod-clean-1l'
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, container_type_id, created_at, updated_at)
      VALUES ('prod-vaisselle-bulk', 'fam-cleaners', 'Liquide Vaisselle Vrac', NULL, '619000999888', 500, 1.800, 1.400, 'ct-bidon-10l', '2026-09-07', '2026-09-07')
    `).run();
  });

  it('calculates reseller price automatically using negotiated discount off wholesale and completes sale', async () => {
    // Wholesale is 2.500 DT with 10% discount = 2.250 DT unit price
    const unitPrice = 2.250;
    const qty = 2;
    const totalTTC = 4.500;

    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-reseller',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: qty, unit_price: unitPrice }],
        cash_paid: totalTTC,
        cash_tendered: totalTTC
      });

    expect(res.status).toBe(201);
    expect(res.body.total_ttc).toBe(4.500);
    expect(res.body.receipt_number).toBeDefined();

    // Product stock decremented from 100 to 98
    const db = getDb();
    const product: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
    expect(product.stock_quantity).toBe(98);
  });

  it('rejects wallet payment when requested amount exceeds available balance without going negative', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-wallet',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 10, unit_price: 3.000 }], // 30.000 DT
        wallet_paid: 25.000, // Exceeds wallet_balance of 20.000 DT
        cash_paid: 5.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wallet balance/i);

    // Wallet balance and stock remain completely untouched
    const db = getDb();
    const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-wallet');
    expect(customer.wallet_balance).toBe(20.000);

    const product: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
    expect(product.stock_quantity).toBe(100);
  });

  it('accepts wallet payment when within balance and deducts store credit cleanly', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-wallet',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 5, unit_price: 3.000 }], // 15.000 DT
        wallet_paid: 15.000,
        cash_paid: 0
      });

    expect(res.status).toBe(201);
    expect(res.body.wallet_paid).toBe(15.000);

    // Customer balance updated from 20.000 to 5.000 DT
    const db = getDb();
    const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-wallet');
    expect(customer.wallet_balance).toBe(5.000);

    // Wallet transaction recorded
    const tx: any = db.prepare('SELECT * FROM customer_wallet_transactions WHERE customer_id = ?').get('cust-wallet');
    expect(tx).toBeDefined();
    expect(tx.type).toBe('SALE_PAYMENT');
    expect(tx.amount).toBe(15.000);
  });

  it('triggers cash drawer kick flag only when cash is part of the tender', async () => {
    // 1. Cash sale -> should_kick_drawer = true
    const cashRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
        cash_paid: 3.000,
        cash_tendered: 5.000
      });
    expect(cashRes.status).toBe(201);
    expect(cashRes.body.should_kick_drawer).toBe(true);

    // 2. Pure wallet sale -> should_kick_drawer = false
    const walletRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-wallet',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
        wallet_paid: 3.000,
        cash_paid: 0
      });
    expect(walletRes.status).toBe(201);
    expect(walletRes.body.should_kick_drawer).toBe(false);

    // 3. Pure credit sale -> should_kick_drawer = false
    const creditRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-reseller',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 2.500 }],
        credit_amount: 2.500,
        cash_paid: 0
      });
    expect(creditRes.status).toBe(201);
    expect(creditRes.body.should_kick_drawer).toBe(false);
  });

  it('accepts over-tendered cash via buildPaymentPayload output and only counts applied cash in register', async () => {
    const { calculateSessionExpectedCash } = await import('../services/registerService.js');
    const db = getDb();
    const before = calculateSessionExpectedCash(db, 'ses-01');
    expect(before.expected_cash).toBe(100.0);

    // Exact output of buildPaymentPayload(30, 50, 0, 0): applied 30, tendered 50
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 10, unit_price: 3.0 }],
        cash_paid: 30.0,
        cash_tendered: 50.0,
        wallet_paid: 0,
        credit_amount: 0
      });

    expect(res.status).toBe(201);
    expect(res.body.change_given).toBe(20.0);

    const after = calculateSessionExpectedCash(getDb(), 'ses-01');
    expect(after.expected_cash).toBe(130.0);
  });

  it('calculates change due correctly on cash tender', async () => {
    const saleTotal = 3.000;
    const cashTendered = 10.000;

    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: saleTotal }],
        cash_paid: saleTotal,
        cash_tendered: cashTendered
      });

    expect(res.status).toBe(201);
    expect(res.body.change_given).toBe(7.000);
  });

  it('processes split payment (Cash + Wallet + Credit) and verifies exact reconciliation and debt ticket', async () => {
    // 20 units @ 3.000 = 60.000 DT total
    const totalTTC = 60.000;
    const cashPaid = 25.000;
    const walletPaid = 15.000;
    const creditAmount = 20.000;

    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-wallet',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 20, unit_price: 3.000 }],
        cash_paid: cashPaid,
        wallet_paid: walletPaid,
        credit_amount: creditAmount,
        cash_tendered: cashPaid
      });

    expect(res.status).toBe(201);
    expect(res.body.total_ttc).toBe(60.000);
    expect(res.body.subtotal_ht).toBe(round3(60.000 / 1.19));
    expect(res.body.tva_amount).toBe(round3(60.000 - 60.000 / 1.19));

    // Credit component creates an open debt ticket linked to sale_id
    const db = getDb();
    const ticket: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(res.body.id);
    expect(ticket).toBeDefined();
    expect(ticket.total_amount).toBe(20.000);
    expect(ticket.remaining_amount).toBe(20.000);
    expect(ticket.status).toBe('UNPAID');

    // Customer wallet deducted
    const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-wallet');
    expect(customer.wallet_balance).toBe(5.000); // 20 - 15 = 5 DT
  });

  it('supports uncataloged quick-add items without deducting product inventory stock', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [
          {
            is_quick_add: true,
            quick_add_name: 'Special Mop Handle',
            quantity: 1,
            unit_price: 12.000
          }
        ],
        cash_paid: 12.000,
        cash_tendered: 12.000
      });

    expect(res.status).toBe(201);

    // Floor cleaner stock remains untouched at 100
    const db = getDb();
    const product: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
    expect(product.stock_quantity).toBe(100);

    // Sale item has is_quick_add = 1 and base_stock_deducted = 0
    const item: any = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(res.body.id);
    expect(item.is_quick_add).toBe(1);
    expect(item.quick_add_name).toBe('Special Mop Handle');
    expect(item.base_stock_deducted).toBe(0);
  });

  it('deducts correct base piece stock when selling pack size multipliers', async () => {
    // Sell 2 boxes of 12 pcs -> deducts 24 pcs from base SKU stock (100 -> 76)
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-clean-1l',
            pack_size_id: 'pack-12-clean',
            quantity: 2,
            unit_price: 33.000
          }
        ],
        cash_paid: 66.000,
        cash_tendered: 70.000
      });

    expect(res.status).toBe(201);
    expect(res.body.change_given).toBe(4.000);

    const db = getDb();
    const updatedStock: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
    expect(updatedStock.stock_quantity).toBe(76); // 100 - 24 = 76
  });

  it('automatically loans container when loan_container is true and decrements shop stock and tracks customer loan', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-clean-1l',
            quantity: 3,
            unit_price: 3.000,
            loan_container: true
          }
        ],
        cash_paid: 9.000,
        cash_tendered: 10.000
      });

    expect(res.status).toBe(201);
    expect(res.body.container_loans).toBeDefined();
    expect(res.body.container_loans.length).toBe(1);
    expect(res.body.container_loans[0].quantity).toBe(3);

    const db = getDb();
    // Shop stock decremented from 50 to 47
    const ct: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon-1l');
    expect(ct.stock_quantity).toBe(47);

    // Customer container loan recorded: 3 owed
    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?')
      .get('cust-retail', 'ct-bidon-1l');
    expect(loan.quantity_owed).toBe(3);

    // Container transaction recorded with action GIVE
    const tx: any = db.prepare('SELECT * FROM container_transactions WHERE customer_id = ? AND action = ?')
      .get('cust-retail', 'GIVE');
    expect(tx).toBeDefined();
    expect(tx.quantity).toBe(3);
  });

  it('correctly tracks 1 container (not 10) when customer buys 10L of bulk liquid in a 10L container', async () => {
    const db = getDb();
    // Buy 10 Liters of vaisselle
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-vaisselle-bulk',
            quantity: 10, // 10 Liters
            unit_price: 1.800,
            loan_container: true
          }
        ],
        cash_paid: 18.000,
        cash_tendered: 20.000
      });

    expect(res.status).toBe(201);
    expect(res.body.container_loans).toBeDefined();
    expect(res.body.container_loans.length).toBe(1);
    // MUST track 1 bidon, NOT 10 bidons!
    expect(res.body.container_loans[0].quantity).toBe(1);

    // Verify shop stock of Bidon 10L is decremented by 1 (20 - 1 = 19)
    const ct: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon-10l');
    expect(ct.stock_quantity).toBe(19);

    // Verify customer owes exactly 1 bidon
    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?')
      .get('cust-retail', 'ct-bidon-10l');
    expect(loan.quantity_owed).toBe(1);

    // Verify transaction logs GIVE quantity 1
    const tx: any = db.prepare('SELECT quantity FROM container_transactions WHERE customer_id = ? AND container_type_id = ? AND action = ?')
      .get('cust-retail', 'ct-bidon-10l', 'GIVE');
    expect(tx.quantity).toBe(1);
  });

  it('correctly tracks 1 container when buying 15L (between 10L and 20L) in a 10L container', async () => {
    const db = getDb();
    // 15 Liters bought with 10L capacity container -> floor(15/10) = 1 container
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-vaisselle-bulk',
            quantity: 15,
            unit_price: 1.800,
            loan_container: true
          }
        ],
        cash_paid: 27.000,
        cash_tendered: 30.000
      });

    expect(res.status).toBe(201);
    expect(res.body.container_loans.length).toBe(1);
    expect(res.body.container_loans[0].quantity).toBe(1);
  });

  it('loans 0 containers when volume is less than capacity (5L in a 10L container)', async () => {
    const db = getDb();
    const ctBefore: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon-10l');
    const loansBefore: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?')
      .get('cust-retail', 'ct-bidon-10l');
    const initialOwed = loansBefore?.quantity_owed || 0;

    // Buy 5 Liters of bulk vaisselle with 10L bidon
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-vaisselle-bulk',
            quantity: 5,
            unit_price: 1.800,
            loan_container: true
          }
        ],
        cash_paid: 9.000,
        cash_tendered: 10.000
      });

    expect(res.status).toBe(201);
    // container_loans array in response should be empty because cQty is 0
    expect(res.body.container_loans).toBeDefined();
    expect(res.body.container_loans.length).toBe(0);

    // Verify container stock was NOT decremented
    const ctAfter: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon-10l');
    expect(ctAfter.stock_quantity).toBe(ctBefore.stock_quantity);

    // Verify customer owed quantity was NOT changed
    const loansAfter: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?')
      .get('cust-retail', 'ct-bidon-10l');
    expect(loansAfter?.quantity_owed || 0).toBe(initialOwed);
  });

  it('correctly applies per-item discount and per-sale discount to calculate line totals and total TTC', async () => {
    // 2 items @ 3.000 = 6.000 DT, -1.000 DT item discount = 5.000 DT subtotal
    // -0.500 DT global sale discount = 4.500 DT total TTC
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        total_discount: 0.500,
        items: [
          {
            product_id: 'prod-clean-1l',
            quantity: 2,
            unit_price: 3.000,
            discount_amount: 1.000
          }
        ],
        cash_paid: 4.500,
        cash_tendered: 5.000
      });

    expect(res.status).toBe(201);
    expect(res.body.total_ttc).toBe(4.500);
    expect(res.body.items[0].discount_amount).toBe(1.000);
    expect(res.body.items[0].line_total).toBe(5.000);

    const db = getDb();
    const saleRow: any = db.prepare('SELECT total_discount, total_ttc FROM sales WHERE id = ?').get(res.body.id);
    expect(saleRow.total_discount).toBe(0.500);
    expect(saleRow.total_ttc).toBe(4.500);

    const saleItemRow: any = db.prepare('SELECT discount_amount, line_total FROM sale_items WHERE sale_id = ?').get(res.body.id);
    expect(saleItemRow.discount_amount).toBe(1.000);
    expect(saleItemRow.line_total).toBe(5.000);
  });

  it('supports register_session_id alias in checkout payload and links session properly', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        register_session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
        cash_paid: 3.000,
        cash_tendered: 3.000
      });

    expect(res.status).toBe(201);
    expect(res.body.session_id).toBe('ses-01');

    const db = getDb();
    const saleRow: any = db.prepare('SELECT session_id FROM sales WHERE id = ?').get(res.body.id);
    expect(saleRow.session_id).toBe('ses-01');
  });

  it('allows fetching sale and processing refund using receipt_number instead of UUID', async () => {
    const createRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 2, unit_price: 3.000 }],
        cash_paid: 6.000,
        cash_tendered: 10.000
      });

    expect(createRes.status).toBe(201);
    const receiptNumber = createRes.body.receipt_number;
    expect(receiptNumber).toBeDefined();

    // Fetch by receipt number
    const getRes = await request(app).get(`/api/sales/${receiptNumber}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(createRes.body.id);
    expect(getRes.body.items.length).toBe(1);

    const saleItemId = getRes.body.items[0].id;

    // Refund by receipt number
    const refundRes = await request(app)
      .post(`/api/sales/${receiptNumber}/refund`)
      .send({
        items: [{ sale_item_id: saleItemId, quantity: 1 }],
        cash_refunded: 3.000,
        reason: 'Customer returned 1 item'
      });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.sale_id).toBe(createRes.body.id);
    expect(refundRes.body.total_refunded).toBe(3.000);

    // Check refunds list by receipt number
    const listRefundsRes = await request(app).get(`/api/sales/${receiptNumber}/refunds`);
    expect(listRefundsRes.status).toBe(200);
    expect(listRefundsRes.body.length).toBe(1);
    expect(listRefundsRes.body[0].total_refunded).toBe(3.000);
  });

  it('rejects checkout when the register session is closed', async () => {
    const db = getDb();
    // Close the register session
    db.prepare("UPDATE register_sessions SET status = 'CLOSED' WHERE id = 'ses-01'").run();

    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ is_quick_add: true, quick_add_name: 'Bag', quantity: 1, unit_price: 1.000 }],
        cash_paid: 1.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('caisse est fermée');
  });

  it('rejects checkout when no open register session exists in the system', async () => {
    const db = getDb();
    // Delete all register sessions
    db.prepare('DELETE FROM register_sessions').run();

    const res = await request(app)
      .post('/api/sales')
      .send({
        items: [{ is_quick_add: true, quick_add_name: 'Bag', quantity: 1, unit_price: 1.000 }],
        cash_paid: 1.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('caisse est fermée');
  });

  it('computes catalog_unit_price and flags overridden price when operator deviates from catalog price', async () => {
    // prod-clean-1l has retail_price: 3.000. Operator sells at 3.500 (overridden)
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-clean-1l',
            quantity: 1,
            unit_price: 3.500
          }
        ],
        cash_paid: 3.500
      });

    expect(res.status).toBe(201);
    const saleId = res.body.id;

    const detailRes = await request(app).get(`/api/sales/${saleId}`);
    expect(detailRes.status).toBe(200);
    const item = detailRes.body.items[0];
    expect(item.unit_price).toBe(3.500);
    expect(item.catalog_unit_price).toBe(3.000);
    expect(item.overridden).toBe(true);
  });

  it('computes catalog_unit_price and sets overridden: false when unit_price matches catalog price', async () => {
    // prod-clean-1l has retail_price: 3.000. Operator sells at 3.000 (standard)
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [
          {
            product_id: 'prod-clean-1l',
            quantity: 2,
            unit_price: 3.000
          }
        ],
        cash_paid: 6.000
      });

    expect(res.status).toBe(201);
    const saleId = res.body.id;

    const detailRes = await request(app).get(`/api/sales/${saleId}`);
    expect(detailRes.status).toBe(200);
    const item = detailRes.body.items[0];
    expect(item.unit_price).toBe(3.000);
    expect(item.catalog_unit_price).toBe(3.000);
    expect(item.overridden).toBe(false);
  });

  it('legacy sale_items with NULL catalog_unit_price display as overridden: false', async () => {
    const db = getDb();
    const legacySaleId = 'sale-legacy-test';
    const legacyItemId = 'item-legacy-test';

    db.prepare(`
      INSERT INTO sales (
        id, receipt_number, session_id, date, subtotal_ht, tva_rate, tva_amount,
        total_ttc, total_discount, cash_paid, wallet_paid, credit_amount, change_given,
        status, created_at
      ) VALUES (?, 'REC-LEGACY', 'ses-01', '2026-09-01', 2.521, 0.19, 0.479, 3.000, 0, 3.000, 0, 0, 0, 'COMPLETED', '2026-09-01')
    `).run(legacySaleId);

    db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, is_quick_add, pack_multiplier, quantity,
        quantity_refunded, base_stock_deducted, unit_price, catalog_unit_price, discount_amount, line_total
      ) VALUES (?, ?, 'prod-clean-1l', 0, 1, 1, 0, 1, 4.000, NULL, 0, 4.000)
    `).run(legacyItemId, legacySaleId);

    const detailRes = await request(app).get(`/api/sales/${legacySaleId}`);
    expect(detailRes.status).toBe(200);
    const item = detailRes.body.items[0];
    expect(item.catalog_unit_price).toBeNull();
    expect(item.overridden).toBe(false);
  });

  it('rejects mismatched pack_size_id that belongs to another product', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-retail',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-vaisselle-bulk', pack_size_id: 'pack-12-clean', quantity: 1, unit_price: 1.8 }],
        cash_paid: 1.8,
        cash_tendered: 1.8
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
  });

  it('rejects non-finite and negative payment amounts', async () => {
    const badFinite = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.0 }],
        cash_paid: 'not-a-number',
        cash_tendered: 3.0
      });
    expect(badFinite.status).toBe(400);
    expect(badFinite.body.error).toMatch(/finite/i);

    const negative = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-wallet',
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.0 }],
        cash_paid: 4.0,
        wallet_paid: -1.0,
        cash_tendered: 4.0
      });
    expect(negative.status).toBe(400);
    expect(negative.body.error).toMatch(/non-negative/i);
  });

  it('rejects payment sum mismatch and under-tendered cash', async () => {
    const mismatch = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 10, unit_price: 3.0 }],
        cash_paid: 5.0,
        cash_tendered: 5.0
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/does not equal/i);

    const underTendered = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 10, unit_price: 3.0 }],
        cash_paid: 30.0,
        cash_tendered: 20.0
      });
    expect(underTendered.status).toBe(400);
    expect(underTendered.body.error).toMatch(/cash_tendered/i);
  });

  it('computes change server-side and ignores client-supplied change_given', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.0 }],
        cash_paid: 3.0,
        cash_tendered: 10.0,
        change_given: 999
      });
    expect(res.status).toBe(201);
    expect(res.body.change_given).toBe(7.0);
  });

  it('rejects total_discount above the subtotal', async () => {
    const res = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-01',
        items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.0 }],
        total_discount: 10.0,
        cash_paid: 0,
        cash_tendered: 0
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/total_discount/i);
  });

  it('supports listing sales with search, date range, status, limit, and offset filters', async () => {
    const db = getDb();

    // Create 3 sales on different dates and statuses
    db.prepare(`
      INSERT INTO sales (
        id, receipt_number, session_id, customer_id, date, subtotal_ht, tva_rate, tva_amount,
        total_ttc, total_discount, cash_paid, wallet_paid, credit_amount, change_given,
        status, created_at
      ) VALUES
        ('sale-filter-1', 'REC-ALPHA-01', 'ses-01', 'cust-retail', '2026-09-10 10:00:00', 10, 0.19, 1.9, 11.9, 0, 11.9, 0, 0, 0, 'COMPLETED', '2026-09-10 10:00:00'),
        ('sale-filter-2', 'REC-BETA-02', 'ses-01', 'cust-wallet', '2026-09-15 12:00:00', 20, 0.19, 3.8, 23.8, 0, 0, 20.0, 3.8, 0, 'PARTIALLY_REFUNDED', '2026-09-15 12:00:00'),
        ('sale-filter-3', 'REC-GAMMA-03', 'ses-01', 'cust-reseller', '2026-09-20 14:00:00', 30, 0.19, 5.7, 35.7, 0, 35.7, 0, 0, 0, 'FULLY_REFUNDED', '2026-09-20 14:00:00')
    `).run();

    // 1. Search by receipt number
    const resSearchRec = await request(app).get('/api/sales?search=ALPHA');
    expect(resSearchRec.status).toBe(200);
    expect(resSearchRec.body.length).toBe(1);
    expect(resSearchRec.body[0].receipt_number).toBe('REC-ALPHA-01');

    // 2. Search by customer name
    const resSearchCust = await request(app).get('/api/sales?search=Wallet Customer');
    expect(resSearchCust.status).toBe(200);
    expect(resSearchCust.body.length).toBe(1);
    expect(resSearchCust.body[0].receipt_number).toBe('REC-BETA-02');

    // 3. Date range filter
    const resDateRange = await request(app).get('/api/sales?from_date=2026-09-12&to_date=2026-09-18');
    expect(resDateRange.status).toBe(200);
    expect(resDateRange.body.length).toBe(1);
    expect(resDateRange.body[0].receipt_number).toBe('REC-BETA-02');

    // 4. Status filter
    const resStatus = await request(app).get('/api/sales?status=FULLY_REFUNDED');
    expect(resStatus.status).toBe(200);
    expect(resStatus.body.length).toBe(1);
    expect(resStatus.body[0].receipt_number).toBe('REC-GAMMA-03');

    // 5. Pagination: limit and offset
    const resPaginated = await request(app).get('/api/sales?limit=2&offset=1');
    expect(resPaginated.status).toBe(200);
    expect(resPaginated.body.length).toBe(2);
  });
});

