import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, getDb, resetTestDb } from '../../tests/testApp.js';

interface Seed {
  familyId: string;
  productId: string;
  customerId: string;
  sessionId: string;
  supplierId: string;
  materialId: string;
}

async function seed(): Promise<Seed> {
  const fam = await request(app).post('/api/products/families').send({
    name: 'Idem Family', category: 'Detergents', type: 'MANUFACTURED'
  });
  const prod = await request(app).post('/api/products').send({
    family_id: fam.body.id,
    name: 'Idem Product',
    barcode: 'IDEM-001',
    stock_quantity: 100,
    retail_price: 10,
    wholesale_price: 8
  });
  const cust = await request(app).post('/api/customers').send({ name: 'Idem Customer', type: 'RETAIL' });
  const sess = await request(app).post('/api/register/open').send({ counter_name: 'Idem Counter', opening_cash: 100 });
  const sup = await request(app).post('/api/suppliers').send({ name: 'Idem Supplier' });
  const mat = await request(app).post('/api/materials').send({
    name: 'Idem Material', category: 'Surfactant', unit: 'kg', stock_quantity: 10
  });
  return {
    familyId: fam.body.id,
    productId: prod.body.id,
    customerId: cust.body.id,
    sessionId: sess.body.id,
    supplierId: sup.body.id,
    materialId: mat.body.id
  };
}

function saleBody(s: Seed, key: string, overrides: Record<string, unknown> = {}) {
  return {
    session_id: s.sessionId,
    customer_id: s.customerId,
    items: [{ product_id: s.productId, quantity: 1, unit_price: 10 }],
    cash_paid: 10,
    cash_tendered: 10,
    client_request_id: key,
    ...overrides
  };
}

describe('Online financial request idempotency', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('replays the same sale key once and rejects a changed payload', async () => {
    const s = await seed();
    const body = saleBody(s, 'idem-sale-0001');

    const first = await request(app).post('/api/sales').send(body);
    const second = await request(app).post('/api/sales').send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.receipt_number).toBe(first.body.receipt_number);
    expect(second.body.sale_id).toBe(first.body.sale_id);

    const db = getDb();
    expect((db.prepare('SELECT COUNT(*) AS c FROM sales').get() as any).c).toBe(1);
    const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(s.productId);
    expect(prod.stock_quantity).toBe(99);
    const row: any = db.prepare('SELECT status, action_type FROM processed_requests WHERE request_id = ?').get('idem-sale-0001');
    expect(row).toMatchObject({ status: 'COMPLETED', action_type: 'SALE' });

    const conflict = await request(app).post('/api/sales').send({
      ...body,
      cash_paid: 9,
      cash_tendered: 9
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((db.prepare('SELECT COUNT(*) AS c FROM sales').get() as any).c).toBe(1);
  });

  it('uses a different key for a legitimate second sale', async () => {
    const s = await seed();
    const first = await request(app).post('/api/sales').send(saleBody(s, 'idem-sale-0002'));
    const second = await request(app).post('/api/sales').send(saleBody(s, 'idem-sale-0003'));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.receipt_number).not.toBe(first.body.receipt_number);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM sales').get() as any).c).toBe(2);
  });

  it('replays a refund key after the item is already fully refunded', async () => {
    const s = await seed();
    const sale = await request(app).post('/api/sales').send({
      session_id: s.sessionId,
      items: [{ product_id: s.productId, quantity: 2, unit_price: 10 }],
      cash_paid: 20,
      cash_tendered: 20
    });
    const refundBody = {
      items: [{ sale_item_id: sale.body.items[0].id, quantity: 2 }],
      cash_refunded: 20,
      session_id: s.sessionId,
      reason: 'Idempotent return',
      client_request_id: 'idem-refund-0001'
    };

    const first = await request(app).post(`/api/sales/${sale.body.id}/refund`).send(refundBody);
    const second = await request(app).post(`/api/sales/${sale.body.id}/refund`).send(refundBody);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.refund_number).toBe(first.body.refund_number);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM refunds').get() as any).c).toBe(1);

    const conflict = await request(app).post(`/api/sales/${sale.body.id}/refund`).send({
      ...refundBody,
      cash_refunded: 10
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('replays customer and supplier debt payments once', async () => {
    const s = await seed();
    const sale = await request(app).post('/api/sales').send({
      session_id: s.sessionId,
      customer_id: s.customerId,
      items: [{ product_id: s.productId, quantity: 2, unit_price: 10 }],
      credit_amount: 20
    });
    expect(sale.status).toBe(201);

    const custPay = {
      amount: 10,
      payment_method: 'Cash',
      client_request_id: 'idem-cust-pay-0001'
    };
    const c1 = await request(app).post(`/api/customers/${s.customerId}/payments`).send(custPay);
    const c2 = await request(app).post(`/api/customers/${s.customerId}/payments`).send(custPay);
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM customer_payments').get() as any).c).toBe(1);

    const creditConflict = await request(app).post(`/api/customers/${s.customerId}/payments`).send({
      ...custPay,
      amount: 5
    });
    expect(creditConflict.status).toBe(409);

    const purchase = await request(app).post('/api/purchases').send({
      supplier_id: s.supplierId,
      items: [{ item_type: 'RAW_MATERIAL', material_id: s.materialId, quantity: 1, unit_cost: 20 }],
      payment_status: 'CREDIT'
    });
    expect(purchase.status).toBe(201);

    const supPay = {
      amount: 10,
      payment_method: 'Cash',
      client_request_id: 'idem-supplier-pay-0001'
    };
    const s1 = await request(app).post(`/api/suppliers/${s.supplierId}/payments`).send(supPay);
    const s2 = await request(app).post(`/api/suppliers/${s.supplierId}/payments`).send(supPay);
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    expect(s2.body.success).toBe(true);
    expect(s2.body.remaining_balance).toBe(10);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM supplier_payments').get() as any).c).toBe(1);

    const supplierConflict = await request(app).post(`/api/suppliers/${s.supplierId}/payments`).send({
      ...supPay,
      amount: 5
    });
    expect(supplierConflict.status).toBe(409);
  });

  it('replays a cash movement once and rejects a changed amount', async () => {
    const s = await seed();
    const movement = {
      session_id: s.sessionId,
      type: 'CASH_IN',
      amount: 20,
      reason: 'Idempotent float',
      client_request_id: 'idem-movement-0001'
    };
    const first = await request(app).post('/api/register/movement').send(movement);
    const second = await request(app).post('/api/register/movement').send(movement);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.movement.id).toBe(first.body.movement.id);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM register_cash_movements').get() as any).c).toBe(1);

    const conflict = await request(app).post('/api/register/movement').send({
      ...movement,
      amount: 10
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('reconciles an online sale that was queued after a lost response', async () => {
    const s = await seed();
    const online = await request(app).post('/api/sales').send(saleBody(s, 'idem-cross-sale-0001'));
    expect(online.status).toBe(201);

    const flush = await request(app).post('/api/sync/flush').send({
      operations: [{
        temp_client_id: 'temp_idem-cross-sale-0001',
        action_type: 'SALE',
        payload: {
          client_request_id: 'idem-cross-sale-0001',
          session_id: s.sessionId,
          customer_id: s.customerId,
          items: [{ product_id: s.productId, quantity: 1, unit_price: 10 }],
          cash_paid: 10,
          cash_tendered: 10
        }
      }]
    });

    expect(flush.status).toBe(200);
    expect(flush.body.failed).toEqual([]);
    expect(flush.body.reconciled).toHaveLength(1);
    expect(flush.body.reconciled[0].receipt_number).toBe(online.body.receipt_number);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM sales').get() as any).c).toBe(1);
  });

  it('reconciles an online cash movement that was queued after a lost response', async () => {
    const s = await seed();
    const online = await request(app).post('/api/register/movement').send({
      session_id: s.sessionId,
      type: 'CASH_IN',
      amount: 20,
      reason: 'Cross-path float',
      client_request_id: 'idem-cross-movement-0001'
    });
    expect(online.status).toBe(201);

    const flush = await request(app).post('/api/sync/flush').send({
      operations: [{
        temp_client_id: 'temp_idem-cross-movement-0001',
        action_type: 'CASH_MOVEMENT',
        payload: {
          client_request_id: 'idem-cross-movement-0001',
          session_id: s.sessionId,
          type: 'CASH_IN',
          amount: 20,
          reason: 'Cross-path float'
        }
      }]
    });

    expect(flush.status).toBe(200);
    expect(flush.body.failed).toEqual([]);
    expect(flush.body.reconciled).toHaveLength(1);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM register_cash_movements').get() as any).c).toBe(1);
  });

  it('releases a claim after validation failure so the same key can be retried', async () => {
    const s = await seed();
    const invalid = await request(app).post('/api/sales').send({
      session_id: s.sessionId,
      items: [],
      client_request_id: 'idem-sale-retry-0001'
    });
    expect(invalid.status).toBe(400);

    const valid = await request(app).post('/api/sales').send(saleBody(s, 'idem-sale-retry-0001'));
    expect(valid.status).toBe(201);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM sales').get() as any).c).toBe(1);
  });

  it('scopes a payment key to its customer so it cannot replay on another customer', async () => {
    const s = await seed();
    const other = await request(app).post('/api/customers').send({ name: 'Idem Other Customer', type: 'RETAIL' });
    await request(app).post('/api/sales').send({
      session_id: s.sessionId,
      customer_id: s.customerId,
      items: [{ product_id: s.productId, quantity: 2, unit_price: 10 }],
      credit_amount: 20
    });

    const payment = { amount: 5, payment_method: 'Cash', client_request_id: 'idem-scoped-payment-0001' };
    const first = await request(app).post(`/api/customers/${s.customerId}/payments`).send(payment);
    const second = await request(app).post(`/api/customers/${other.body.id}/payments`).send(payment);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const db = getDb();
    expect((db.prepare('SELECT COUNT(*) AS c FROM customer_payments WHERE customer_id = ?').get(s.customerId) as any).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS c FROM customer_payments WHERE customer_id = ?').get(other.body.id) as any).c).toBe(0);
  });

  it('rejects a refund payout that differs by one millime', async () => {
    const s = await seed();
    const sale = await request(app).post('/api/sales').send({
      session_id: s.sessionId,
      items: [{ product_id: s.productId, quantity: 2, unit_price: 10 }],
      cash_paid: 20,
      cash_tendered: 20
    });

    const refund = await request(app).post(`/api/sales/${sale.body.id}/refund`).send({
      items: [{ sale_item_id: sale.body.items[0].id, quantity: 2 }],
      cash_refunded: 20.001,
      session_id: s.sessionId
    });
    expect(refund.status).toBe(400);
    expect(refund.body.error).toMatch(/does not equal/i);
  });
});
