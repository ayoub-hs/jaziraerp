import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Delivery Zones & Client Orders API — Real HTTP Integration Tests (Phase 1a Step 3)', () => {
  let customerId: string;
  let zoneId: string;
  let inactiveZoneId: string;
  let prodBleachId: string;
  let prodSoapId: string;

  beforeEach(() => {
    const db = resetTestDb();

    // Seed customer
    customerId = 'cust-ord-test';
    db.prepare(`
      INSERT INTO customers (id, name, phone, type, wallet_balance, created_at, updated_at)
      VALUES (?, 'Mounir Ben Salah', '98123456', 'WHOLESALE', 0, '2026-10-22', '2026-10-22')
    `).run(customerId);

    // Seed product family & products
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-ord', 'Nettoyage', 'Detergents', 'MANUFACTURED', '2026-10-22', '2026-10-22')
    `).run();

    prodBleachId = 'prod-ord-bleach';
    prodSoapId = 'prod-ord-soap';
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES
        (?, 'fam-ord', 'Eau de Javel 5L', '5L', '619000555001', 100, 4.000, 3.200, '2026-10-22', '2026-10-22'),
        (?, 'fam-ord', 'Savon Mains 5L', '5L', '619000555002', 80, 12.000, 10.000, '2026-10-22', '2026-10-22')
    `).run(prodBleachId, prodSoapId);

    // Seed delivery zones
    zoneId = 'zone-djerba';
    inactiveZoneId = 'zone-inactive';
    db.prepare(`
      INSERT INTO delivery_zones (id, name, min_order_amount, delivery_fee, delivery_days, active, created_at)
      VALUES
        (?, 'Djerba Midoun', 30.000, 5.000, 'ALL', 1, '2026-10-22'),
        (?, 'Zone Fermée', 50.000, 10.000, NULL, 0, '2026-10-22')
    `).run(zoneId, inactiveZoneId);
  });

  describe('Delivery Zones CRUD', () => {
    it('creates a new delivery zone with 201', async () => {
      const res = await request(app)
        .post('/api/delivery-zones')
        .send({
          name: 'Zarzis Ville',
          min_order_amount: 40.000,
          delivery_fee: 7.000,
          delivery_days: 'TUE,FRI',
          active: true
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Zarzis Ville');
      expect(res.body.min_order_amount).toBe(40.000);
      expect(res.body.delivery_fee).toBe(7.000);
      expect(res.body.active).toBe(1);
    });

    it('lists all delivery zones', async () => {
      const res = await request(app).get('/api/delivery-zones');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('updates a delivery zone', async () => {
      const res = await request(app)
        .put(`/api/delivery-zones/${zoneId}`)
        .send({
          min_order_amount: 35.000,
          delivery_fee: 6.000
        });

      expect(res.status).toBe(200);
      expect(res.body.min_order_amount).toBe(35.000);
      expect(res.body.delivery_fee).toBe(6.000);
    });

    it('deletes an unused delivery zone', async () => {
      const res = await request(app).delete(`/api/delivery-zones/${inactiveZoneId}`);
      expect(res.status).toBe(200);

      const check = await request(app).get('/api/delivery-zones');
      expect(check.body.find((z: any) => z.id === inactiveZoneId)).toBeUndefined();
    });
  });

  describe('Customer Credit Limit Editing', () => {
    it('allows updating credit_limit via PUT /api/customers/:id', async () => {
      const res = await request(app)
        .put(`/api/customers/${customerId}`)
        .send({ credit_limit: 500.000 });

      expect(res.status).toBe(200);
      expect(res.body.credit_limit).toBe(500.000);

      // Verify null reset
      const resetRes = await request(app)
        .put(`/api/customers/${customerId}`)
        .send({ credit_limit: null });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.credit_limit).toBeNull();
    });

    it('rejects negative credit_limit on customer PUT with 400', async () => {
      const res = await request(app)
        .put(`/api/customers/${customerId}`)
        .send({ credit_limit: -25 });

      expect(res.status).toBe(400);
    });
  });

  describe('Order Creation & Idempotency', () => {
    it('creates an order, recomputing prices and totals from catalog (ignores client tampering)', async () => {
      // Wholesale prices: Bleach = 3.200, Soap = 10.000
      // 10x Bleach = 32.000, 1x Soap = 10.000 -> subtotal = 42.000 DT (>= 30.000 DT min)
      // Delivery fee for Djerba = 5.000 DT -> total = 47.000 DT
      const res = await request(app)
        .post('/api/orders')
        .send({
          client_request_id: 'req-ord-001',
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '+216 98 123 456',
          delivery_address: 'Route touristique km 3, Midoun',
          delivery_zone_id: zoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [
            // Tampered prices and totals in request body
            { product_id: prodBleachId, quantity: 10, unit_price: 1.000, line_total: 10.000 },
            { product_id: prodSoapId, quantity: 1, unit_price: 2.000, line_total: 2.000 }
          ],
          subtotal_ttc: 12.000,
          total_ttc: 12.000
        });

      expect(res.status).toBe(201);
      expect(res.body.order_number).toMatch(/^ORD-\d{8}-\d{4}$/);
      expect(res.body.status).toBe('NEW');
      expect(res.body.source).toBe('MANUAL_ENTRY');
      expect(res.body.customer_phone).toBe('98123456'); // Normalized!
      expect(res.body.subtotal_ttc).toBe(42.000); // 32.000 + 10.000
      expect(res.body.delivery_fee).toBe(5.000);
      expect(res.body.total_ttc).toBe(47.000);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].unit_price_ttc).toBe(3.200);
      expect(res.body.items[0].line_total_ttc).toBe(32.000);
    });

    it('rejects order below zone minimum order amount with 400', async () => {
      // 2x Bleach = 6.400 DT (< 30.000 DT min)
      const res = await request(app)
        .post('/api/orders')
        .send({
          client_request_id: 'req-ord-below-min',
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '98123456',
          delivery_address: 'Midoun',
          delivery_zone_id: zoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [{ product_id: prodBleachId, quantity: 2 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('minimum');
    });

    it('rejects order targeting an inactive delivery zone with 400', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          client_request_id: 'req-ord-inactive-zone',
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '98123456',
          delivery_address: 'Zone Fermée',
          delivery_zone_id: inactiveZoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [{ product_id: prodSoapId, quantity: 6 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('inactive');
    });

    it('rejects order with invalid phone number with 400', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          client_request_id: 'req-ord-bad-phone',
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '12345', // Invalid
          delivery_address: 'Midoun',
          delivery_zone_id: zoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [{ product_id: prodSoapId, quantity: 4 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('téléphone');
    });

    it('requires idempotency key client_request_id on order creation', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '98123456',
          delivery_address: 'Midoun',
          delivery_zone_id: zoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [{ product_id: prodSoapId, quantity: 4 }]
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('idempotence');
    });

    it('replays stored response on identical client_request_id and payload', async () => {
      const payload = {
        client_request_id: 'req-ord-idem-same',
        customer_id: customerId,
        customer_name: 'Mounir Ben Salah',
        customer_phone: '98123456',
        delivery_address: 'Route Touristique',
        delivery_zone_id: zoneId,
        payment_preference: 'CASH_ON_DELIVERY',
        items: [{ product_id: prodSoapId, quantity: 4 }]
      };

      const res1 = await request(app).post('/api/orders').send(payload);
      expect(res1.status).toBe(201);
      const orderId1 = res1.body.id;

      // Replay identical request
      const res2 = await request(app).post('/api/orders').send(payload);
      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(orderId1);

      // Verify only 1 order exists in DB
      const db = getDb();
      const count = db.prepare('SELECT COUNT(*) as c FROM client_orders').get() as { c: number };
      expect(count.c).toBe(1);
    });

    it('rejects duplicate client_request_id with different payload with 409', async () => {
      const payload1 = {
        client_request_id: 'req-ord-idem-diff',
        customer_id: customerId,
        customer_name: 'Mounir Ben Salah',
        customer_phone: '98123456',
        delivery_address: 'Route Touristique',
        delivery_zone_id: zoneId,
        payment_preference: 'CASH_ON_DELIVERY',
        items: [{ product_id: prodSoapId, quantity: 4 }]
      };

      const res1 = await request(app).post('/api/orders').send(payload1);
      expect(res1.status).toBe(201);

      // Different payload under same key
      const payload2 = {
        ...payload1,
        delivery_address: 'Midoun Centre'
      };

      const res2 = await request(app).post('/api/orders').send(payload2);
      expect(res2.status).toBe(409);
    });
  });

  describe('Order State Machine & Editing', () => {
    let orderId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({
          client_request_id: `req-sm-${Date.now()}-${Math.random()}`,
          customer_id: customerId,
          customer_name: 'Mounir Ben Salah',
          customer_phone: '98123456',
          delivery_address: 'Midoun',
          delivery_zone_id: zoneId,
          payment_preference: 'CASH_ON_DELIVERY',
          items: [{ product_id: prodSoapId, quantity: 4 }]
        });
      expect(res.status).toBe(201);
      orderId = res.body.id;
    });

    it('allows valid state progression: NEW -> CONFIRMED -> PREPARING -> OUT_FOR_DELIVERY', async () => {
      const toConfirmed = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: 'CONFIRMED' });
      expect(toConfirmed.status).toBe(200);
      expect(toConfirmed.body.status).toBe('CONFIRMED');

      const toPreparing = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: 'PREPARING' });
      expect(toPreparing.status).toBe(200);
      expect(toPreparing.body.status).toBe('PREPARING');

      const toOut = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: 'OUT_FOR_DELIVERY' });
      expect(toOut.status).toBe(200);
      expect(toOut.body.status).toBe('OUT_FOR_DELIVERY');
    });

    it('rejects invalid state transition with 409 Conflict', async () => {
      // NEW -> OUT_FOR_DELIVERY is invalid (skips CONFIRMED and PREPARING)
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: 'OUT_FOR_DELIVERY' });
      expect(res.status).toBe(409);
    });

    it('rejects direct transition to DELIVERED via status patch (conversion required)', async () => {
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'CONFIRMED' });
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'PREPARING' });
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'OUT_FOR_DELIVERY' });

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .send({ status: 'DELIVERED' });
      expect(res.status).toBe(409);
    });

    it('cancels an order with reason from CONFIRMED', async () => {
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'CONFIRMED' });

      const res = await request(app)
        .post(`/api/orders/${orderId}/cancel`)
        .send({ reason: 'Client unreachable by phone' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.cancellation_reason).toBe('Client unreachable by phone');
    });

    it('rejects cancellation without reason with 400', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderId}/cancel`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('allows editing items and zone while order is NEW or CONFIRMED', async () => {
      // Edit at NEW: increase quantity of soap to 5 (50.000 DT + 5.000 DT fee = 55.000 DT)
      const res = await request(app)
        .put(`/api/orders/${orderId}`)
        .send({
          items: [{ product_id: prodSoapId, quantity: 5 }]
        });

      expect(res.status).toBe(200);
      expect(res.body.subtotal_ttc).toBe(50.000);
      expect(res.body.total_ttc).toBe(55.000);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].ordered_quantity).toBe(5);
    });

    it('blocks editing when order is in PREPARING or OUT_FOR_DELIVERY with 409', async () => {
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'CONFIRMED' });
      await request(app).patch(`/api/orders/${orderId}/status`).send({ status: 'PREPARING' });

      const res = await request(app)
        .put(`/api/orders/${orderId}`)
        .send({
          items: [{ product_id: prodSoapId, quantity: 10 }]
        });

      expect(res.status).toBe(409);
    });

    it('prevents deleting a delivery zone referenced by an existing order', async () => {
      const res = await request(app).delete(`/api/delivery-zones/${zoneId}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('associées');
    });
  });
});
