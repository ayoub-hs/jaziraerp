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
});
