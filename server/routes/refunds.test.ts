import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Returns & Line-Item Partial Refunds Module — Real HTTP Integration Tests', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // Seed customer
    db.prepare(`
      INSERT INTO customers (id, name, type, wallet_balance, created_at, updated_at)
      VALUES ('cust-refund-test', 'Ali Ben Amor', 'WHOLESALE', 0, '2026-09-07', '2026-09-07')
    `).run();

    // Seed products
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-ref', 'Cleaning Chemicals', 'Detergents', 'MANUFACTURED', '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES
        ('prod-bleach', 'fam-ref', 'Javel Bleach 1L', '1L', '619000333001', 50, 2.000, 1.500, '2026-09-07', '2026-09-07'),
        ('prod-degreaser', 'fam-ref', 'Heavy Degreaser 5L', '5L', '619000333005', 30, 15.000, 12.000, '2026-09-07', '2026-09-07')
    `).run();

    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('ses-refund-test', 'SES-REF-01', 'Countertop', '2026-09-07 08:00:00', 100.000, 'OPEN')
    `).run();
  });

  it('processes partial refund on a single line item, restores stock, and sets status to PARTIALLY_REFUNDED', async () => {
    // 1. Create a sale: 5x Bleach @ 2.000 = 10 DT, 2x Degreaser @ 15.000 = 30 DT. Total 40 DT cash
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [
          { product_id: 'prod-bleach', quantity: 5, unit_price: 2.000 },
          { product_id: 'prod-degreaser', quantity: 2, unit_price: 15.000 }
        ],
        cash_paid: 40.000,
        cash_tendered: 40.000
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;

    const db = getDb();
    const bleachItem: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?').get(saleId, 'prod-bleach');
    expect(bleachItem).toBeDefined();

    // Stock dropped from 50 to 45
    let bleach: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-bleach');
    expect(bleach.stock_quantity).toBe(45);

    // 2. Refund 2 of the 5 Bleach bottles in cash (2 * 2.000 = 4.000 DT)
    const refundRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: bleachItem.id, quantity: 2 }],
        cash_refunded: 4.000,
        reason: 'Customer bought too many'
      });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.total_refunded).toBe(4.000);
    expect(refundRes.body.sale_status).toBe('PARTIALLY_REFUNDED');

    // 3. Verify stock restored in DB (45 + 2 = 47)
    bleach = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-bleach');
    expect(bleach.stock_quantity).toBe(47);

    // 4. Verify sale_items quantity_refunded = 2
    const updatedSaleItem: any = db.prepare('SELECT quantity_refunded FROM sale_items WHERE id = ?').get(bleachItem.id);
    expect(updatedSaleItem.quantity_refunded).toBe(2);

    // 5. Verify sale status is PARTIALLY_REFUNDED
    const updatedSale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
    expect(updatedSale.status).toBe('PARTIALLY_REFUNDED');
  });

  it('targets specific debt ticket tied to sale_id for credit-reduction refunds, leaving older open tickets untouched', async () => {
    const db = getDb();

    // Older debt ticket for customer (50.000 DT from August)
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('tkt-old', 'TKT-OLD-001', 'cust-refund-test', '2026-08-01', 50.000, 50.000, 'UNPAID', '2026-08-01', '2026-08-01')
    `).run();

    // New Sale 2 on CREDIT for 30.000 DT (15x Bleach @ 2.000 DT)
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [{ product_id: 'prod-bleach', quantity: 15, unit_price: 2.000 }],
        credit_amount: 30.000,
        cash_paid: 0
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;

    // Ticket tied to Sale 2 is automatically created
    const sale2Ticket: any = db.prepare('SELECT id, remaining_amount, status FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
    expect(sale2Ticket).toBeDefined();
    expect(sale2Ticket.remaining_amount).toBe(30.000);

    const saleItem: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // Refund 5 units (10.000 DT) reducing credit
    const refundRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: saleItem.id, quantity: 5 }],
        credit_reduced: 10.000,
        reason: 'Faulty packaging on 5 bottles'
      });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.credit_reduced).toBe(10.000);

    // 1. Sale 2 ticket is reduced to 20.000 DT
    const updatedSale2Ticket: any = db.prepare('SELECT remaining_amount, status FROM customer_debt_tickets WHERE id = ?').get(sale2Ticket.id);
    expect(updatedSale2Ticket.remaining_amount).toBe(20.000);
    expect(updatedSale2Ticket.status).toBe('PARTIALLY_PAID');

    // 2. Older ticket remains 50.000 DT and UNTOUCHED (FIFO was NOT applied)
    const oldTicket: any = db.prepare('SELECT remaining_amount, status FROM customer_debt_tickets WHERE id = ?').get('tkt-old');
    expect(oldTicket.remaining_amount).toBe(50.000);
    expect(oldTicket.status).toBe('UNPAID');
  });

  it('supports multiple sequential partial refunds until sale becomes FULLY_REFUNDED', async () => {
    // 10 units @ 2.000 = 20.000 DT
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [{ product_id: 'prod-bleach', quantity: 10, unit_price: 2.000 }],
        cash_paid: 20.000,
        cash_tendered: 20.000
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;

    const db = getDb();
    const item: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // Refund 1: 4 units (8.000 DT)
    const ref1 = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 4 }],
        cash_refunded: 8.000,
        reason: 'First batch return'
      });

    expect(ref1.status).toBe(201);
    expect(ref1.body.sale_status).toBe('PARTIALLY_REFUNDED');

    // Refund 2: Remaining 6 units (12.000 DT)
    const ref2 = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 6 }],
        cash_refunded: 12.000,
        reason: 'Second batch return'
      });

    expect(ref2.status).toBe(201);
    expect(ref2.body.sale_status).toBe('FULLY_REFUNDED');

    const finalSale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
    expect(finalSale.status).toBe('FULLY_REFUNDED');

    // Stock fully restored (50 - 10 + 4 + 6 = 50)
    const bleach: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-bleach');
    expect(bleach.stock_quantity).toBe(50);
  });

  it('supports wallet credit payout on refund and credits customer wallet balance', async () => {
    // Sale of 10 Bleach @ 2.000 DT = 20 DT cash
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [{ product_id: 'prod-bleach', quantity: 10, unit_price: 2.000 }],
        cash_paid: 20.000,
        cash_tendered: 20.000
      });

    const saleId = saleRes.body.id;
    const db = getDb();
    const item: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // Customer has 0 wallet balance
    let cust: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-refund-test');
    expect(cust.wallet_balance).toBe(0);

    // Refund 5 units (10.000 DT) paid out as wallet credit
    const refundRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 5 }],
        wallet_refunded: 10.000,
        reason: 'Customer chose store credit'
      });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.wallet_refunded).toBe(10.000);

    // Customer wallet credited
    cust = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-refund-test');
    expect(cust.wallet_balance).toBe(10.000);

    // Verify GET /api/sales/:id/refunds returns this refund
    const listRes = await request(app).get(`/api/sales/${saleId}/refunds`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].wallet_refunded).toBe(10.000);
  });

  it('guarantees exact remaining amount is refunded on the last unit of a line without rounding loss', async () => {
    // 3 items @ 5.000 with 5.000 discount -> line_total = 10.000 DT (3.333333... DT effective each)
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        items: [{ is_quick_add: 1, quick_add_name: '3-for-10 Special', quantity: 3, unit_price: 5.000, discount_amount: 5.000 }],
        subtotal_ht: 8.403,
        tva_rate: 0.19,
        tva_amount: 1.597,
        total_ttc: 10.000,
        cash_paid: 10.000
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.sale.id;
    const db = getDb();
    const item: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // Refund unit 1: effectiveUnitPrice = 10 / 3 = 3.333 DT
    const r1 = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 1 }],
        cash_refunded: 3.333
      });
    expect(r1.status).toBe(201);
    expect(r1.body.total_refunded).toBe(3.333);

    // Refund unit 2: effectiveUnitPrice = 10 / 3 = 3.333 DT
    const r2 = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 1 }],
        cash_refunded: 3.333
      });
    expect(r2.status).toBe(201);
    expect(r2.body.total_refunded).toBe(3.333);

    // Refund unit 3 (last remaining unit): 10.000 - (3.333 + 3.333) = 3.334 DT
    const r3 = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: item.id, quantity: 1 }],
        cash_refunded: 3.334
      });
    expect(r3.status).toBe(201);
    expect(r3.body.total_refunded).toBe(3.334);
    expect(r3.body.sale_status).toBe('FULLY_REFUNDED');

    // Total of all 3 refunds equals 10.000 DT exactly
    const sumRefunds: any = db.prepare('SELECT SUM(total_refunded) as sum FROM refunds WHERE sale_id = ?').get(saleId);
    expect(sumRefunds.sum).toBe(10.000);
  });

  it('rejects cash refund with 400 when register session is closed, but links to open session and updates expected cash when open', async () => {
    const db = getDb();

    // 1. Create a cash sale
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [{ product_id: 'prod-bleach', quantity: 2, unit_price: 2.000 }],
        cash_paid: 4.000,
        cash_tendered: 4.000
      });
    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;
    const bleachItem: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // 2. Close the open session
    db.prepare("UPDATE register_sessions SET status = 'CLOSED' WHERE id = 'ses-refund-test'").run();

    // 3. Attempt cash refund with closed register -> 400
    const closedRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: bleachItem.id, quantity: 1 }],
        cash_refunded: 2.000
      });
    expect(closedRes.status).toBe(400);
    expect(closedRes.body.error).toContain('La caisse est fermée');

    // 4. Reopen register session
    db.prepare("UPDATE register_sessions SET status = 'OPEN' WHERE id = 'ses-refund-test'").run();

    // 5. Attempt cash refund again -> succeeds (201) and links to open session
    const openRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: bleachItem.id, quantity: 1 }],
        cash_refunded: 2.000
      });
    expect(openRes.status).toBe(201);

    const refundRow: any = db.prepare('SELECT session_id FROM refunds WHERE id = ?').get(openRes.body.id);
    expect(refundRow.session_id).toBe('ses-refund-test');
  });

  it('supports two open register sessions and accurately tracks expected_cash on the chosen session', async () => {
    const db = getDb();

    // 1. Session 1 is already seeded ('ses-refund-test', opening_cash 100.000).
    // Let's create Session 2 ('ses-mobile', opening_cash 50.000).
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('ses-mobile', 'SES-MOB-01', 'Mobile Counter', '2026-09-07 09:00:00', 50.000, 'OPEN')
    `).run();

    // 2. Make a sale on Session 1 for 40.000 DT cash (2x Degreaser @ 20.000 DT)
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        session_id: 'ses-refund-test',
        items: [{ product_id: 'prod-degreaser', quantity: 2, unit_price: 20.000 }],
        cash_paid: 40.000,
        cash_tendered: 40.000
      });
    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;
    const degreaserItem: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // Initial expected_cash check:
    // Session 1: 100 opening + 40 cash sales = 140.000 DT
    // Session 2: 50 opening + 0 cash sales = 50.000 DT
    const status1Before = await request(app).get('/api/register/sessions/ses-refund-test');
    expect(status1Before.body.live_cash_breakdown.expected_cash).toBe(140.000);

    const status2Before = await request(app).get('/api/register/sessions/ses-mobile');
    expect(status2Before.body.live_cash_breakdown.expected_cash).toBe(50.000);

    // 3. Process cash refund of 1 unit (20.000 DT) specifically from Session 2 (ses-mobile)
    const refundMobileRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        session_id: 'ses-mobile',
        items: [{ sale_item_id: degreaserItem.id, quantity: 1 }],
        cash_refunded: 20.000,
        reason: 'Refunded from mobile counter'
      });
    expect(refundMobileRes.status).toBe(201);

    // 4. Assert expected_cash after refunding on Session 2:
    // Session 1 expected_cash: still 140.000 DT (untouched!)
    // Session 2 expected_cash: 50 opening - 20 cash refund = 30.000 DT
    const status1After = await request(app).get('/api/register/sessions/ses-refund-test');
    expect(status1After.body.live_cash_breakdown.expected_cash).toBe(140.000);

    const status2After = await request(app).get('/api/register/sessions/ses-mobile');
    expect(status2After.body.live_cash_breakdown.expected_cash).toBe(30.000);

    // 5. Ambiguity test: if no session_id is provided, server defaults to sale's session (ses-refund-test)
    // Refund the remaining 1 unit (20.000 DT) without specifying session_id
    const refundDefaultRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: degreaserItem.id, quantity: 1 }],
        cash_refunded: 20.000
      });
    expect(refundDefaultRes.status).toBe(201);

    // Session 1 expected_cash: 140 - 20 = 120.000 DT
    // Session 2 expected_cash: still 30.000 DT
    const status1Final = await request(app).get('/api/register/sessions/ses-refund-test');
    expect(status1Final.body.live_cash_breakdown.expected_cash).toBe(120.000);

    const status2Final = await request(app).get('/api/register/sessions/ses-mobile');
    expect(status2Final.body.live_cash_breakdown.expected_cash).toBe(30.000);
  });

  it('honors refund_method CREDIT_REDUCTION to reduce open debt ticket on mixed cash+credit sale', async () => {
    const db = getDb();

    // 1. Create a mixed sale: 2x Degreaser @ 15.000 = 30 DT total (10 DT cash, 20 DT credit)
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-refund-test',
        items: [{ product_id: 'prod-degreaser', quantity: 2, unit_price: 15.000 }],
        cash_paid: 10.000,
        cash_tendered: 10.000,
        credit_amount: 20.000
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;

    // Verify debt ticket was created with 20 DT remaining
    const ticketBefore: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
    expect(ticketBefore).toBeDefined();
    expect(ticketBefore.remaining_amount).toBe(20.000);

    const degreaserItem: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ?').get(saleId);

    // 2. Process refund for 1 unit (15 DT) selecting refund_method: 'CREDIT_REDUCTION'
    const refundRes = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        refund_method: 'CREDIT_REDUCTION',
        items: [{ sale_item_id: degreaserItem.id, quantity: 1 }],
        reason: 'Client requested credit balance reduction'
      });

    expect(refundRes.status).toBe(201);
    expect(refundRes.body.credit_reduced).toBe(15.000);
    expect(refundRes.body.cash_refunded).toBe(0);

    // 3. Verify debt ticket remaining amount reduced from 20 DT to 5 DT
    const ticketAfter: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
    expect(ticketAfter.remaining_amount).toBe(5.000);
    expect(ticketAfter.status).toBe('PARTIALLY_PAID');
  });

  describe('REF-01: Global cart discount pro-rata refund allocation and 400 capping', () => {
    it('allocates global cart discount pro-rata on full return (20 DT items - 5 DT discount = 15 DT refund)', async () => {
      // 10x Bleach @ 2.000 = 20.000 DT, total_discount = 5.000 DT => total_ttc = 15.000 DT
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          customer_id: 'cust-refund-test',
          items: [{ product_id: 'prod-bleach', quantity: 10, unit_price: 2.000 }],
          total_discount: 5.000,
          cash_paid: 15.000,
          cash_tendered: 15.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const itemId = saleRes.body.items[0].id;

      // Full return of all 10 items
      const refundRes = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: itemId, quantity: 10 }],
          reason: 'Full return on discounted sale'
        });

      expect(refundRes.status).toBe(201);
      // Under old code, this was 20.000 DT (gross line_total), leaking 5 DT cash!
      // Must be exactly 15.000 DT
      expect(refundRes.body.total_refunded).toBe(15.000);
      expect(refundRes.body.cash_refunded).toBe(15.000);
    });

    it('allocates global cart discount pro-rata across partial returns summing to net total (15.000 DT)', async () => {
      // 2 items: 5x Bleach @ 2.000 = 10.000 DT, 1x Degreaser @ 10.000 = 10.000 DT. Total 20.000 DT.
      // Global discount = 5.000 DT. Total TTC = 15.000 DT.
      // Pro-rata: each line has 10 DT gross, so each line gets 2.500 DT discount => net 7.500 DT each.
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          customer_id: 'cust-refund-test',
          items: [
            { product_id: 'prod-bleach', quantity: 5, unit_price: 2.000 },
            { product_id: 'prod-degreaser', quantity: 1, unit_price: 10.000 }
          ],
          total_discount: 5.000,
          cash_paid: 15.000,
          cash_tendered: 15.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const bleachItemId = saleRes.body.items[0].id;
      const degreaserItemId = saleRes.body.items[1].id;

      // Partial return 1: return all bleach items (net should be 7.500 DT)
      const ref1 = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: bleachItemId, quantity: 5 }],
          reason: 'Partial return line 1'
        });
      expect(ref1.status).toBe(201);
      expect(ref1.body.total_refunded).toBe(7.500);

      // Partial return 2: return degreaser item (net should be 7.500 DT)
      const ref2 = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: degreaserItemId, quantity: 1 }],
          reason: 'Partial return line 2'
        });
      expect(ref2.status).toBe(201);
      expect(ref2.body.total_refunded).toBe(7.500);

      // Cumulative refunds exactly equal sale total_ttc (15.000 DT)
      expect(ref1.body.total_refunded + ref2.body.total_refunded).toBe(15.000);
    });

    it('correctly allocates discount on a reseller credit sale refunded via CREDIT_REDUCTION', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
        VALUES ('cust-reseller-ref', 'Reseller Discount Co', 'RESELLER', 10, 0, '2026-09-07', '2026-09-07')
      `).run();

      // 2x Degreaser @ 10.000 = 20.000 DT, global cart discount 5.000 DT => 15.000 DT credit sale
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          customer_id: 'cust-reseller-ref',
          items: [{ product_id: 'prod-degreaser', quantity: 2, unit_price: 10.000 }],
          total_discount: 5.000,
          credit_amount: 15.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const itemId = saleRes.body.items[0].id;

      // Debt ticket created with 15.000 DT remaining
      const ticketBefore: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
      expect(ticketBefore.remaining_amount).toBe(15.000);

      // Refund 1 unit: net should be 7.500 DT credit reduction
      const refRes = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          refund_method: 'CREDIT_REDUCTION',
          items: [{ sale_item_id: itemId, quantity: 1 }],
          reason: 'Reseller return 1 unit'
        });

      expect(refRes.status).toBe(201);
      expect(refRes.body.credit_reduced).toBe(7.500);

      const ticketAfter: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
      expect(ticketAfter.remaining_amount).toBe(7.500);
    });

    it('rejects with HTTP 400 when cumulative refunds would exceed sale.total_ttc', async () => {
      // 10 DT sale
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          customer_id: 'cust-refund-test',
          items: [{ product_id: 'prod-bleach', quantity: 5, unit_price: 2.000 }],
          cash_paid: 10.000,
          cash_tendered: 10.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const itemId = saleRes.body.items[0].id;

      // Refund all 5 units => 10 DT refunded
      const ref1 = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: itemId, quantity: 5 }]
        });
      expect(ref1.status).toBe(201);

      // Attempting to refund again on already fully refunded sale returns 400
      const ref2 = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: itemId, quantity: 1 }]
        });
      expect(ref2.status).toBe(400);
      expect(ref2.body.error).toBeDefined();
    });

    it('returns debt_ticket in GET /api/sales/:id and enforces remaining debt cap with wallet split (REF-02)', async () => {
      const db = getDb();

      // 1. Create a credit sale of 20.000 DT (2 x 10.000 DT item)
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          customer_id: 'cust-refund-test',
          items: [{ product_id: 'prod-bleach', quantity: 10, unit_price: 2.000 }],
          credit_amount: 20.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const itemId = saleRes.body.items[0].id;

      // 2. GET /api/sales/:id should include the debt ticket
      const getSaleRes = await request(app).get(`/api/sales/${saleId}`);
      expect(getSaleRes.status).toBe(200);
      expect(getSaleRes.body.debt_ticket).toBeDefined();
      expect(getSaleRes.body.debt_ticket.total_amount).toBe(20.000);
      expect(getSaleRes.body.debt_ticket.remaining_amount).toBe(20.000);

      // 3. Customer pays 15.000 DT towards debt, leaving 5.000 DT remaining debt
      const payRes = await request(app)
        .post('/api/customers/cust-refund-test/payments')
        .send({
          amount: 15.000,
          payment_method: 'CASH',
          notes: 'Partial payment on debt ticket'
        });
      expect(payRes.status).toBe(200);

      // Verify ticket now has remaining_amount = 5.000 DT
      const getSaleRes2 = await request(app).get(`/api/sales/${saleId}`);
      expect(getSaleRes2.body.debt_ticket).toBeDefined();
      expect(getSaleRes2.body.debt_ticket.remaining_amount).toBe(5.000);

      // 4. Customer returns 5 units (10.000 DT total refund).
      // Attempting to reduce credit by 10.000 DT must fail with HTTP 400 (cannot reduce below 0)
      const overCreditRef = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: itemId, quantity: 5 }],
          credit_reduced: 10.000
        });
      expect(overCreditRef.status).toBe(400);
      expect(overCreditRef.body.error).toContain('exceeds remaining ticket balance');

      // 5. Proper split: Cap credit_reduced at ticket remaining (5.000 DT), refund remaining 5.000 DT to WALLET
      const splitRef = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          items: [{ sale_item_id: itemId, quantity: 5 }],
          credit_reduced: 5.000,
          wallet_refunded: 5.000,
          reason: 'Return with split to remaining debt and wallet'
        });
      expect(splitRef.status).toBe(201);
      expect(splitRef.body.credit_reduced).toBe(5.000);
      expect(splitRef.body.wallet_refunded).toBe(5.000);

      // Debt ticket is now fully paid (remaining_amount = 0)
      const ticketFinal: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(saleId);
      expect(ticketFinal.remaining_amount).toBe(0.000);
      expect(ticketFinal.status).toBe('PAID');

      // Customer wallet balance increased by 5.000 DT
      const custFinal: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-refund-test');
      expect(custFinal.wallet_balance).toBe(5.000);
    });

    it('rejects duplicate sale_item_ids in refund request when merged quantity exceeds available (Item 1)', async () => {
      const db = getDb();

      // 1. Create a sale with quantity = 3 of prod-bleach + 1 of prod-degreaser (total 21.000 DT)
      const saleRes = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-refund-test',
          customer_id: 'cust-refund-test',
          items: [
            { product_id: 'prod-bleach', quantity: 3, unit_price: 2.000 },
            { product_id: 'prod-degreaser', quantity: 1, unit_price: 15.000 }
          ],
          cash_paid: 21.000,
          cash_tendered: 21.000
        });

      expect(saleRes.status).toBe(201);
      const saleId = saleRes.body.id;
      const itemId = saleRes.body.items[0].id;

      // Initial state before refund attempt
      const prodBefore: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-bleach');
      const stockBefore = prodBefore.stock_quantity;
      const sesBefore: any = db.prepare('SELECT expected_cash FROM register_sessions WHERE id = ?').get('ses-refund-test');
      const cashBefore = sesBefore.expected_cash;

      // 2. Attempt refund with same line twice: 2 + 2 = 4 on a quantity of 3
      const dupRefRes = await request(app)
        .post(`/api/sales/${saleId}/refund`)
        .send({
          session_id: 'ses-refund-test',
          items: [
            { sale_item_id: itemId, quantity: 2 },
            { sale_item_id: itemId, quantity: 2 }
          ]
        });

      // Must be rejected with HTTP 400
      expect(dupRefRes.status).toBe(400);

      // Verify stock, quantity_refunded and cash remain unchanged
      const prodAfter: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-bleach');
      expect(prodAfter.stock_quantity).toBe(stockBefore);

      const itemAfter: any = db.prepare('SELECT quantity_refunded FROM sale_items WHERE id = ?').get(itemId);
      expect(itemAfter.quantity_refunded).toBe(0);

      const sesAfter: any = db.prepare('SELECT expected_cash FROM register_sessions WHERE id = ?').get('ses-refund-test');
      expect(sesAfter.expected_cash).toBe(cashBefore);
    });
  });
});


