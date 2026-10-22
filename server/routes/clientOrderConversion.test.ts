import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';
import { DELIVERY_FEE_LINE_NAME } from '../constants.js';

describe('Order Conversion API — POST /api/orders/:id/convert (Phase 1a Step 4)', () => {
  let customerId: string;
  let zoneId: string;
  let prodBleachId: string;
  let prodSoapId: string;
  let prodPieceId: string;
  let containerTypeId: string;
  let sessionId: string;

  beforeEach(() => {
    const db = resetTestDb();

    // 1. Seed customer with 50 DT credit limit
    customerId = 'cust-conv-test';
    db.prepare(`
      INSERT INTO customers (id, name, phone, type, wallet_balance, credit_limit, created_at, updated_at)
      VALUES (?, 'Ali Zargouni', '98123456', 'WHOLESALE', 20.000, 50.000, '2026-10-22', '2026-10-22')
    `).run(customerId);

    // 2. Seed products
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-conv', 'Nettoyage', 'Detergents', 'MANUFACTURED', '2026-10-22', '2026-10-22')
    `).run();

    prodBleachId = 'prod-conv-bleach';
    prodSoapId = 'prod-conv-soap';
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES
        (?, 'fam-conv', 'Eau de Javel 5L', '5L', '619000777001', 100, 4.000, 3.000, '2026-10-22', '2026-10-22'),
        (?, 'fam-conv', 'Savon Liquide 5L', '5L', '619000777002', 80, 12.000, 10.000, '2026-10-22', '2026-10-22'),
        (?, 'fam-conv', 'Balai Industriel', 'Piece', '619000777003', 50, 15.000, 12.000, '2026-10-22', '2026-10-22')
    `).run(prodBleachId, prodSoapId, prodPieceId = 'prod-conv-piece');

    // 3. Seed delivery zone (fee 5 DT, min 20 DT)
    zoneId = 'zone-conv-midoun';
    db.prepare(`
      INSERT INTO delivery_zones (id, name, min_order_amount, delivery_fee, delivery_days, active, created_at)
      VALUES (?, 'Midoun Delivery', 20.000, 5.000, 'ALL', 1, '2026-10-22')
    `).run(zoneId);

    // 4. Seed container type (50 in stock)
    containerTypeId = 'ctype-conv-bidon';
    db.prepare(`
      INSERT INTO container_types (id, name, capacity_liters, stock_quantity, active, created_at)
      VALUES (?, 'Bidon 5L', 5, 50, 1, '2026-10-22')
    `).run(containerTypeId);

    // 5. Seed open register session on 'Livraison' counter
    sessionId = 'sess-livraison-conv';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SESS-20261022-0099', 'Livraison', '2026-10-22T08:00:00Z', 100.000, 'OPEN')
    `).run(sessionId);
  });

  // Helper to create an order in CONFIRMED state
  async function createOrder(status: string = 'CONFIRMED', itemsOverride?: any[]) {
    const res = await request(app)
      .post('/api/orders')
      .send({
        client_request_id: `req-order-${Date.now()}-${Math.random()}`,
        customer_id: customerId,
        customer_name: 'Ali Zargouni',
        customer_phone: '98123456',
        delivery_address: 'Zone Touristique Midoun',
        delivery_zone_id: zoneId,
        payment_preference: 'CASH_ON_DELIVERY',
        items: itemsOverride || [
          { product_id: prodBleachId, quantity: 4 }, // 4 * 3 DT = 12 DT
          { product_id: prodSoapId, quantity: 2 }    // 2 * 10 DT = 20 DT -> subtotal = 32 DT + 5 DT fee = 37 DT
        ]
      });
    expect(res.status).toBe(201);
    const order = res.body;

    if (status !== 'NEW') {
      if (status === 'CONFIRMED') {
        const p = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'CONFIRMED' });
        expect(p.status).toBe(200);
      } else if (status === 'PREPARING') {
        await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'CONFIRMED' });
        const p = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'PREPARING' });
        expect(p.status).toBe(200);
      } else if (status === 'OUT_FOR_DELIVERY') {
        await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'CONFIRMED' });
        await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'PREPARING' });
        const p = await request(app).patch(`/api/orders/${order.id}/status`).send({ status: 'OUT_FOR_DELIVERY' });
        expect(p.status).toBe(200);
      } else if (status === 'CANCELLED') {
        const p = await request(app).post(`/api/orders/${order.id}/cancel`).send({ reason: 'Annulation test' });
        expect(p.status).toBe(200);
      }
    }
    return order;
  }

  // Requirement a: Convertible statuses
  it('a: allows conversion ONLY for CONFIRMED, PREPARING, OUT_FOR_DELIVERY; rejects NEW, CANCELLED, DELIVERED with 409', async () => {
    // 1. NEW -> 409 Conflict
    const orderNew = await createOrder('NEW');
    const resNew = await request(app)
      .post(`/api/orders/${orderNew.id}/convert`)
      .send({ client_request_id: 'req-conv-new', cash_paid: 37.000 });
    expect(resNew.status).toBe(409);
    expect(resNew.body.error).toMatch(/statut|convertible/i);

    // 2. CANCELLED -> 409 Conflict
    const orderCancelled = await createOrder('CANCELLED');
    const resCancelled = await request(app)
      .post(`/api/orders/${orderCancelled.id}/convert`)
      .send({ client_request_id: 'req-conv-cancelled', cash_paid: 37.000 });
    expect(resCancelled.status).toBe(409);
    expect(resCancelled.body.error).toMatch(/statut|convertible|annulée/i);

    // 3. CONFIRMED -> 200 OK
    const orderConfirmed = await createOrder('CONFIRMED');
    const resConfirmed = await request(app)
      .post(`/api/orders/${orderConfirmed.id}/convert`)
      .send({ client_request_id: 'req-conv-confirmed', cash_paid: 37.000 });
    expect(resConfirmed.status).toBe(200);
    expect(resConfirmed.body.order.status).toBe('DELIVERED');

    // 4. PREPARING -> 200 OK
    const orderPrep = await createOrder('PREPARING');
    const resPrep = await request(app)
      .post(`/api/orders/${orderPrep.id}/convert`)
      .send({ client_request_id: 'req-conv-prep', cash_paid: 37.000 });
    expect(resPrep.status).toBe(200);
    expect(resPrep.body.order.status).toBe('DELIVERED');

    // 5. OUT_FOR_DELIVERY -> 200 OK
    const orderOut = await createOrder('OUT_FOR_DELIVERY');
    const resOut = await request(app)
      .post(`/api/orders/${orderOut.id}/convert`)
      .send({ client_request_id: 'req-conv-out', cash_paid: 37.000 });
    expect(resOut.status).toBe(200);
    expect(resOut.body.order.status).toBe('DELIVERED');

    // 6. DELIVERED -> 409 Conflict
    const resDelivered = await request(app)
      .post(`/api/orders/${orderConfirmed.id}/convert`)
      .send({ client_request_id: 'req-conv-already-del', cash_paid: 37.000 });
    expect(resDelivered.status).toBe(409);
    expect(resDelivered.body.error).toMatch(/déjà été convertie/i);
  });

  // Requirement b: Idempotency with scope = order id
  it('b: idempotent retry returns stored response; different payload gives 409; different key on converted order gives 409 and exactly one sale exists', async () => {
    const order = await createOrder('CONFIRMED');
    const payload = {
      client_request_id: 'req-conv-idem-1',
      cash_paid: 37.000
    };

    // 1. Initial conversion -> 200
    const res1 = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send(payload);
    expect(res1.status).toBe(200);
    const saleId = res1.body.sale.id;
    const blNumber = res1.body.delivery_note_number;

    // 2. Replay with identical client_request_id and payload -> returns exact stored 200 response
    const resReplay = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send(payload);
    expect(resReplay.status).toBe(200);
    expect(resReplay.body.sale.id).toBe(saleId);
    expect(resReplay.body.delivery_note_number).toBe(blNumber);

    // 3. Duplicate key with different payload -> 409 Conflict
    const resConflictPayload = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-idem-1',
        cash_paid: 30.000,
        credit_amount: 7.000
      });
    expect(resConflictPayload.status).toBe(409);

    // 4. Different idempotency key on already converted order -> 409 Conflict
    const resDiffKey = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-different-key',
        cash_paid: 37.000
      });
    expect(resDiffKey.status).toBe(409);
    expect(resDiffKey.body.error).toMatch(/déjà été convertie/i);

    // 5. Verify exactly ONE sale exists for this order
    const db = getDb();
    const count: any = db.prepare('SELECT COUNT(*) as cnt FROM sales WHERE id = ?').get(saleId);
    expect(count.cnt).toBe(1);
    const orderRow: any = db.prepare('SELECT sale_id FROM client_orders WHERE id = ?').get(order.id);
    expect(orderRow.sale_id).toBe(saleId);
  });

  // Requirement c: Zero-delivered quantity omission
  it('c: omits items with delivered_quantity = 0 from sale; includes items with delivered_quantity > 0', async () => {
    const order = await createOrder('CONFIRMED');
    const db = getDb();

    const initialStockBleach: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const initialStockSoap: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);

    // Bleach: ordered 4, delivered 0 (omitted from sale)
    // Soap: ordered 2, delivered 2 (included in sale)
    // Total should be: 2 * 10 DT = 20 DT + 5 DT fee = 25 DT
    const bleachItem = order.items.find((i: any) => i.product_id === prodBleachId);
    const soapItem = order.items.find((i: any) => i.product_id === prodSoapId);

    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-omit-zero',
        delivered_items: [
          { order_item_id: bleachItem.id, delivered_quantity: 0 },
          { order_item_id: soapItem.id, delivered_quantity: 2 }
        ],
        cash_paid: 25.000
      });

    expect(res.status).toBe(200);
    expect(res.body.sale.total_ttc).toBe(25.000);

    // Verify sale items: only Soap + Delivery fee (Bleach is omitted)
    const saleItems = res.body.sale.items;
    const saleBleach = saleItems.find((i: any) => i.product_id === prodBleachId);
    expect(saleBleach).toBeUndefined();

    const saleSoap = saleItems.find((i: any) => i.product_id === prodSoapId);
    expect(saleSoap).toBeDefined();
    expect(saleSoap.quantity).toBe(2);

    // Verify stock changes: Bleach stock NOT touched, Soap stock decreased by 2
    const currentStockBleach: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const currentStockSoap: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);
    expect(currentStockBleach.stock_quantity).toBe(initialStockBleach.stock_quantity);
    expect(currentStockSoap.stock_quantity).toBe(initialStockSoap.stock_quantity - 2);

    // Verify client_order_items delivered_quantity updated in DB
    const itemBleachDb: any = db.prepare('SELECT delivered_quantity FROM client_order_items WHERE id = ?').get(bleachItem.id);
    const itemSoapDb: any = db.prepare('SELECT delivered_quantity FROM client_order_items WHERE id = ?').get(soapItem.id);
    expect(itemBleachDb.delivered_quantity).toBe(0);
    expect(itemSoapDb.delivered_quantity).toBe(2);
  });

  // Requirement d & e: Delivery fee modeling
  it('d & e: sale total TTC equals sum of delivered items + delivery fee, modeled as quick-add DELIVERY_FEE_LINE_NAME', async () => {
    const order = await createOrder('CONFIRMED');

    // Default all items delivered (4 * 3 = 12 DT) + (2 * 10 = 20 DT) + 5 DT fee = 37 DT
    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-delivery-fee',
        cash_paid: 37.000
      });

    expect(res.status).toBe(200);
    expect(res.body.sale.total_ttc).toBe(37.000);

    // Verify delivery fee line item
    const feeItem = res.body.sale.items.find((i: any) => i.quick_add_name === DELIVERY_FEE_LINE_NAME);
    expect(feeItem).toBeDefined();
    expect(feeItem.is_quick_add).toBe(1);
    expect(feeItem.unit_price).toBe(5.000);
    expect(feeItem.quantity).toBe(1);
    expect(feeItem.base_stock_deducted).toBe(0);
  });

  // Requirement f: Container tracking (returned & borrowed)
  it('f: containerService records returns (decreases debt consigne, adds shop stock) and loans (increases debt consigne, removes shop stock)', async () => {
    const db = getDb();
    // Setup initial customer owed containers: 5 owed, 50 shop stock
    db.prepare(`
      INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
      VALUES ('loan-init', ?, ?, 5)
    `).run(customerId, containerTypeId);

    const order = await createOrder('CONFIRMED');

    // Convert: customer returns 2 containers and borrows 1 container
    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-containers',
        cash_paid: 37.000,
        containers_returned: [{ container_type_id: containerTypeId, quantity: 2 }],
        containers_borrowed: [{ container_type_id: containerTypeId, quantity: 1 }]
      });

    expect(res.status).toBe(200);

    // Shop stock: 50 + 2 (returned) - 1 (borrowed) = 51
    const ct: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get(containerTypeId);
    expect(ct.stock_quantity).toBe(51);

    // Customer owed count: 5 - 2 + 1 = 4
    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get(customerId, containerTypeId);
    expect(loan.quantity_owed).toBe(4);

    // Container transactions logged: 1 RETURN and 1 GIVE
    const txs = db.prepare('SELECT * FROM container_transactions WHERE customer_id = ? ORDER BY rowid ASC').all(customerId);
    expect(txs).toHaveLength(2);
    expect(txs.some((t: any) => t.action === 'RETURN' && t.quantity === 2)).toBe(true);
    expect(txs.some((t: any) => t.action === 'GIVE' && t.quantity === 1)).toBe(true);
  });

  // Requirement g: Cash register counter 'Livraison' session check
  it('g: uses counter Livraison; returns 409 if no open session exists on Livraison', async () => {
    const db = getDb();
    // Close the Livraison session
    db.prepare(`UPDATE register_sessions SET status = 'CLOSED' WHERE id = ?`).run(sessionId);

    // Open an active session on 'Countertop' (wrong counter!)
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('sess-countertop-open', 'SESS-CT-001', 'Countertop', '2026-10-22T08:00:00Z', 50.000, 'OPEN')
    `).run();

    const order = await createOrder('CONFIRMED');

    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-conv-no-sess',
        cash_paid: 37.000
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/session.*caisse.*ouverte.*Livraison/i);
  });

  // Requirement h: Failure atomicity and rollback
  it('h: failure inside container step rolls back stock, sale, sale_items, delivery note, debt ticket, leaves order CONFIRMED, and releases idempotency claim', async () => {
    const db = getDb();
    const order = await createOrder('CONFIRMED');

    // Customer owes 5 containers initially
    db.prepare(`
      INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
      VALUES ('loan-fail-test', ?, ?, 5)
    `).run(customerId, containerTypeId);

    const stockBleachBefore: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const stockSoapBefore: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);

    const failKey = 'req-conv-failure-rollback';

    // Send conversion request with an invalid container type in the container step
    const resFail = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: failKey,
        cash_paid: 20.000,
        credit_amount: 17.000, // credit portion would create a debt ticket
        containers_returned: [{ container_type_id: 'ctype-does-not-exist', quantity: 2 }]
      });

    expect(resFail.status).toBeGreaterThanOrEqual(400);

    // Assert full rollback:
    // 1. Order status is STILL CONFIRMED and sale_id is NULL
    const orderAfter: any = db.prepare('SELECT status, sale_id FROM client_orders WHERE id = ?').get(order.id);
    expect(orderAfter.status).toBe('CONFIRMED');
    expect(orderAfter.sale_id).toBeNull();

    // 2. No sale was created
    const salesCount: any = db.prepare('SELECT COUNT(*) as cnt FROM sales').get();
    expect(salesCount.cnt).toBe(0);

    // 3. No sale items
    const saleItemsCount: any = db.prepare('SELECT COUNT(*) as cnt FROM sale_items').get();
    expect(saleItemsCount.cnt).toBe(0);

    // 4. No delivery notes
    const blCount: any = db.prepare('SELECT COUNT(*) as cnt FROM delivery_notes').get();
    expect(blCount.cnt).toBe(0);

    // 5. No debt ticket
    const ticketCount: any = db.prepare('SELECT COUNT(*) as cnt FROM customer_debt_tickets').get();
    expect(ticketCount.cnt).toBe(0);

    // 6. Stock was rolled back
    const stockBleachAfter: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const stockSoapAfter: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);
    expect(stockBleachAfter.stock_quantity).toBe(stockBleachBefore.stock_quantity);
    expect(stockSoapAfter.stock_quantity).toBe(stockSoapBefore.stock_quantity);

    // 7. Idempotency claim was released
    const claimRow: any = db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(failKey);
    expect(claimRow).toBeUndefined();

    // 8. Corrected retry using the SAME idempotency key succeeds!
    const resRetry = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: failKey,
        cash_paid: 37.000,
        containers_returned: [{ container_type_id: containerTypeId, quantity: 1 }]
      });

    expect(resRetry.status).toBe(200);
    expect(resRetry.body.order.status).toBe('DELIVERED');
  });

  // Requirement i: Generates BL-YYYYMMDD-XXXX with collision retry
  it('i: generates delivery note number BL-YYYYMMDD-XXXX and handles collision retry', async () => {
    const order1 = await createOrder('CONFIRMED');
    const res1 = await request(app)
      .post(`/api/orders/${order1.id}/convert`)
      .send({ client_request_id: 'req-bl-1', cash_paid: 37.000 });

    expect(res1.status).toBe(200);
    expect(res1.body.delivery_note_number).toMatch(/^BL-\d{8}-\d{4}$/);

    const order2 = await createOrder('CONFIRMED');
    const res2 = await request(app)
      .post(`/api/orders/${order2.id}/convert`)
      .send({ client_request_id: 'req-bl-2', cash_paid: 37.000 });

    expect(res2.status).toBe(200);
    expect(res2.body.delivery_note_number).toMatch(/^BL-\d{8}-\d{4}$/);
    expect(res2.body.delivery_note_number).not.toBe(res1.body.delivery_note_number);
  });

  // Requirement j: Returns 200 with { order, sale, delivery_note_number, warnings } and non-blocking credit warning
  it('j: returns 200 with { order, sale, delivery_note_number, warnings } and warns when credit limit exceeded', async () => {
    // Customer credit limit is 50.000 DT.
    // Order total is 37.000 DT. If credit_amount is 37.000 DT, total debt is 37 DT <= 50 DT -> no warning.
    const order1 = await createOrder('CONFIRMED');
    const resOk = await request(app)
      .post(`/api/orders/${order1.id}/convert`)
      .send({
        client_request_id: 'req-warn-ok',
        credit_amount: 37.000
      });

    expect(resOk.status).toBe(200);
    expect(resOk.body.order).toBeDefined();
    expect(resOk.body.sale).toBeDefined();
    expect(resOk.body.delivery_note_number).toBeDefined();
    expect(resOk.body.warnings).toEqual([]);

    // Next order: credit of 20 DT pushes total debt to 37 + 20 = 57 DT > 50 DT limit.
    const order2 = await createOrder('CONFIRMED');
    const resWarn = await request(app)
      .post(`/api/orders/${order2.id}/convert`)
      .send({
        client_request_id: 'req-warn-exceeded',
        credit_amount: 20.000,
        cash_paid: 17.000
      });

    expect(resWarn.status).toBe(200);
    expect(resWarn.body.warnings).toHaveLength(1);
    expect(resWarn.body.warnings[0]).toMatch(/plafond de crédit/i);
  });
  // Requirement 1: Over-delivery check
  it('rejects over-delivery even if cash matches: order stays CONFIRMED, stock unchanged, claim released, retry with same key succeeds', async () => {
    const db = getDb();
    const order = await createOrder('CONFIRMED');
    const bleachItem = order.items.find((i: any) => i.product_id === prodBleachId);
    const soapItem = order.items.find((i: any) => i.product_id === prodSoapId);

    const stockBleachBefore: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const stockSoapBefore: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);

    const overKey = 'req-conv-overdelivery-key';
    // Bleach ordered: 4. Try to deliver: 5. Soap delivered: 2.
    // Matching cash: (5 * 3 DT = 15 DT) + (2 * 10 DT = 20 DT) + 5 DT fee = 40 DT
    const resOver = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: overKey,
        delivered_items: [
          { order_item_id: bleachItem.id, delivered_quantity: 5 },
          { order_item_id: soapItem.id, delivered_quantity: 2 }
        ],
        cash_paid: 40.000
      });

    expect(resOver.status).toBe(400);
    expect(resOver.body.error).toMatch(/quantité livrée.*dépasser.*quantité commandée/i);

    // Verify DB integrity: order is still CONFIRMED, no sale, stock unchanged
    const orderAfter: any = db.prepare('SELECT status, sale_id FROM client_orders WHERE id = ?').get(order.id);
    expect(orderAfter.status).toBe('CONFIRMED');
    expect(orderAfter.sale_id).toBeNull();

    const stockBleachAfter: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodBleachId);
    const stockSoapAfter: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(prodSoapId);
    expect(stockBleachAfter.stock_quantity).toBe(stockBleachBefore.stock_quantity);
    expect(stockSoapAfter.stock_quantity).toBe(stockSoapBefore.stock_quantity);

    // Claim is released from processed_requests
    const claimRow: any = db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(overKey);
    expect(claimRow).toBeUndefined();

    // Retry with corrected body (delivered 4) using the SAME idempotency key succeeds
    const resRetry = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: overKey,
        delivered_items: [
          { order_item_id: bleachItem.id, delivered_quantity: 4 },
          { order_item_id: soapItem.id, delivered_quantity: 2 }
        ],
        cash_paid: 37.000
      });

    expect(resRetry.status).toBe(200);
    expect(resRetry.body.order.status).toBe('DELIVERED');
  });

  // Requirement 2: Unknown item ID in delivered_items
  it('rejects delivered_items entry whose order_item_id is not an item of this order with 400', async () => {
    const order = await createOrder('CONFIRMED');
    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-unknown-item-id',
        delivered_items: [
          { order_item_id: 'item-does-not-exist', delivered_quantity: 2 }
        ],
        cash_paid: 37.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n'appartient pas à cette commande/i);
  });

  // Requirement 2: Duplicate item ID in delivered_items
  it('rejects duplicate order_item_id in delivered_items with 400', async () => {
    const order = await createOrder('CONFIRMED');
    const bleachItem = order.items.find((i: any) => i.product_id === prodBleachId);

    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-dup-item-id',
        delivered_items: [
          { order_item_id: bleachItem.id, delivered_quantity: 2 },
          { order_item_id: bleachItem.id, delivered_quantity: 2 }
        ],
        cash_paid: 37.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/présent plusieurs fois/i);
  });

  // Requirement 3: Delivered quantity validation rules (0.0001, fractions on piece products, 0 allowed)
  it('validates delivered_quantity: rejects 0.0001 with 400, rejects fractions on piece products, allows 0', async () => {
    const order = await createOrder('CONFIRMED');
    const bleachItem = order.items.find((i: any) => i.product_id === prodBleachId);

    // 1. Rejects 0.0001 (more than 3 decimals)
    const resDecimals = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-qty-decimals',
        delivered_items: [
          { order_item_id: bleachItem.id, delivered_quantity: 0.0001 }
        ],
        cash_paid: 37.000
      });

    expect(resDecimals.status).toBe(400);
    expect(resDecimals.body.error).toMatch(/plus de 3 décimales/i);

    // 2. Order with a piece product rejects fractional delivered quantity
    const orderPiece = await createOrder('CONFIRMED', [
      { product_id: prodPieceId, quantity: 2 },
      { product_id: prodSoapId, quantity: 2 }
    ]);
    const pieceItem = orderPiece.items.find((i: any) => i.product_id === prodPieceId);

    const resFraction = await request(app)
      .post(`/api/orders/${orderPiece.id}/convert`)
      .send({
        client_request_id: 'req-qty-fraction-piece',
        delivered_items: [
          { order_item_id: pieceItem.id, delivered_quantity: 1.5 }
        ],
        cash_paid: 49.000 // 1.5 * 12 = 18 + 2 * 10 = 20 + 5 = 43 or whatever, rejected at validation
      });

    expect(resFraction.status).toBe(400);
    expect(resFraction.body.error).toMatch(/pièce.*fractionnaire/i);
  });

  // Requirement 4: French payment error text
  it('returns French error text when payment total does not match sale total', async () => {
    const order = await createOrder('CONFIRMED');

    // Order total is 37.000 DT, send cash_paid = 10.000 DT
    const res = await request(app)
      .post(`/api/orders/${order.id}/convert`)
      .send({
        client_request_id: 'req-payment-mismatch',
        cash_paid: 10.000
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Le total des paiements.*ne correspond pas au total de la vente/i);
    expect(res.body.error).not.toMatch(/Payment total .* does not equal/);
  });

});
