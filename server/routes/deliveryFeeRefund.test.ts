import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';
import { DELIVERY_FEE_LINE_NAME } from '../constants.js';

describe('Delivery Fee Non-Refundable Guard — Real HTTP Integration Tests', () => {
  let saleId: string;
  let feeItemId: string;
  let prodItemId: string;

  beforeEach(async () => {
    const db = resetTestDb();

    // Seed customer
    db.prepare(`
      INSERT INTO customers (id, name, type, wallet_balance, created_at, updated_at)
      VALUES ('cust-fee-test', 'Sami Ben Ali', 'RETAIL', 0, '2026-10-22', '2026-10-22')
    `).run();

    // Seed product
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-fee', 'Cleaning', 'Detergents', 'MANUFACTURED', '2026-10-22', '2026-10-22')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-soap', 'fam-fee', 'Savon Liquide 1L', '1L', '619000444001', 50, 5.000, 4.000, '2026-10-22', '2026-10-22')
    `).run();

    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('ses-fee-test', 'SES-FEE-01', 'Livraison', '2026-10-22 08:00:00', 100.000, 'OPEN')
    `).run();

    // Create a sale with 2x Savon Liquide (10.000 DT) and 1x Delivery Fee (7.000 DT) = 17.000 DT total
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        customer_id: 'cust-fee-test',
        items: [
          { product_id: 'prod-soap', quantity: 2, unit_price: 5.000 },
          { is_quick_add: true, quick_add_name: DELIVERY_FEE_LINE_NAME, quantity: 1, unit_price: 7.000 }
        ],
        cash_paid: 17.000,
        cash_tendered: 17.000
      });

    expect(saleRes.status).toBe(201);
    saleId = saleRes.body.id;

    const prodRow: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?').get(saleId, 'prod-soap');
    const feeRow: any = db.prepare('SELECT id FROM sale_items WHERE sale_id = ? AND quick_add_name = ?').get(saleId, DELIVERY_FEE_LINE_NAME);

    expect(prodRow).toBeDefined();
    expect(feeRow).toBeDefined();

    prodItemId = prodRow.id;
    feeItemId = feeRow.id;
  });

  it('rejects refund targeting delivery fee via POST /api/sales/:id/refund with 400', async () => {
    const res = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: feeItemId, quantity: 1 }],
        cash_refunded: 7.000,
        reason: 'Client wants delivery fee back'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Les frais de livraison ne sont pas remboursables.');

    const db = getDb();
    const sale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
    expect(sale.status).toBe('COMPLETED');
  });

  it('rejects refund targeting delivery fee via POST /api/refunds with 400', async () => {
    const res = await request(app)
      .post('/api/refunds')
      .send({
        sale_id: saleId,
        items: [{ sale_item_id: feeItemId, quantity: 1 }],
        cash_refunded: 7.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Les frais de livraison ne sont pas remboursables.');
  });

  it('rejects mixed refund containing both normal item and delivery fee item entirely', async () => {
    const res = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [
          { sale_item_id: prodItemId, quantity: 1 },
          { sale_item_id: feeItemId, quantity: 1 }
        ],
        cash_refunded: 12.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Les frais de livraison ne sont pas remboursables.');

    // Verify product stock was not restored and sale is still COMPLETED
    const db = getDb();
    const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-soap');
    expect(prod.stock_quantity).toBe(48); // 50 - 2

    const sale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
    expect(sale.status).toBe('COMPLETED');
  });

  it('allows normal product refund on a sale that contains a delivery fee', async () => {
    const res = await request(app)
      .post(`/api/sales/${saleId}/refund`)
      .send({
        items: [{ sale_item_id: prodItemId, quantity: 1 }],
        cash_refunded: 5.000
      });

    expect(res.status).toBe(201);
    expect(res.body.total_refunded).toBe(5.000);
    expect(res.body.sale_status).toBe('PARTIALLY_REFUNDED');

    const db = getDb();
    const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-soap');
    expect(prod.stock_quantity).toBe(49); // 48 + 1
  });
});
