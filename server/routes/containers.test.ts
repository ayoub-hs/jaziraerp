import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

describe('Returnable Containers Module — Real HTTP Integration Tests', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // Seed customer
    db.prepare(`
      INSERT INTO customers (id, name, type, created_at, updated_at)
      VALUES ('cust-cont-1', 'Béchir Cleaning Agency', 'WHOLESALE', '2026-09-07', '2026-09-07')
    `).run();

    // Seed container types
    db.prepare(`
      INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
      VALUES
        ('ct-10l', '10L Jerrycan Blue', 10, 15, '2026-09-07'),
        ('ct-20l', '20L Jerrycan Yellow', 20, 10, '2026-09-07')
    `).run();
  });

  it('giving a container decreases shop stock and increases customer owed count via POST /api/containers/transactions', async () => {
    // Give 3x 10L Jerrycans to customer
    const res = await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-10l',
        action: 'GIVE',
        quantity: 3,
        notes: 'Bulk delivery loan'
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.action).toBe('GIVE');
    expect(res.body.quantity).toBe(3);

    // Verify DB state
    const db = getDb();
    const type: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-10l');
    expect(type.stock_quantity).toBe(12); // 15 - 3 = 12

    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-cont-1', 'ct-10l');
    expect(loan.quantity_owed).toBe(3);

    // Verify loans list endpoint
    const listRes = await request(app).get('/api/containers/loans?customer_id=cust-cont-1');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].quantity_owed).toBe(3);
  });

  it('does NOT block giving a container if shop stock is 0 (informational tracking only)', async () => {
    const db = getDb();
    // Set 20L Jerrycan stock to 0
    db.prepare(`UPDATE container_types SET stock_quantity = 0 WHERE id = 'ct-20l'`).run();

    // Give 2x 20L Jerrycans when stock is 0
    const res = await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-20l',
        action: 'GIVE',
        quantity: 2
      });

    expect(res.status).toBe(201);

    // Decreased into negative (-2) without blocking
    const type: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-20l');
    expect(type.stock_quantity).toBe(-2);

    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-cont-1', 'ct-20l');
    expect(loan.quantity_owed).toBe(2);
  });

  it('customer returning containers decreases their owed count and increases shop stock via real endpoint', async () => {
    // 1. Give 5 containers first
    await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-10l',
        action: 'GIVE',
        quantity: 5
      });

    // 2. Return 3 of the 5 containers
    const res = await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-10l',
        action: 'RETURN',
        quantity: 3
      });

    expect(res.status).toBe(201);
    expect(res.body.action).toBe('RETURN');

    // Shop stock was 15 - 5 + 3 = 13
    const db = getDb();
    const type: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-10l');
    expect(type.stock_quantity).toBe(13);

    // Customer still owes 2 (5 - 3 = 2)
    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-cont-1', 'ct-10l');
    expect(loan.quantity_owed).toBe(2);
  });

  it('rejects RETURN quantity above the customer owed count unless correction=true', async () => {
    const db = getDb();

    // Customer owes 2 of ct-10l
    await request(app)
      .post('/api/containers/transactions')
      .send({ customer_id: 'cust-cont-1', container_type_id: 'ct-10l', action: 'GIVE', quantity: 2 })
      .expect(201);

    // Return 5 of 2 owed -> 400, nothing changes
    const res = await request(app)
      .post('/api/containers/transactions')
      .send({ customer_id: 'cust-cont-1', container_type_id: 'ct-10l', action: 'RETURN', quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/owed count/i);

    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-cont-1', 'ct-10l');
    expect(loan.quantity_owed).toBe(2);

    // Same return with correction=true -> accepted
    const corrected = await request(app)
      .post('/api/containers/transactions')
      .send({ customer_id: 'cust-cont-1', container_type_id: 'ct-10l', action: 'RETURN', quantity: 5, correction: true });
    expect(corrected.status).toBe(201);
    expect(corrected.body.customer_quantity_owed).toBe(0);
  });

  it('tracks multiple container types independently per customer via real endpoints', async () => {
    // Customer takes 4 of 10L and 2 of 20L
    await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-10l',
        action: 'GIVE',
        quantity: 4
      });

    await request(app)
      .post('/api/containers/transactions')
      .send({
        customer_id: 'cust-cont-1',
        container_type_id: 'ct-20l',
        action: 'GIVE',
        quantity: 2
      });

    const listRes = await request(app).get('/api/containers/loans?customer_id=cust-cont-1');
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);

    const loan10 = listRes.body.find((l: any) => l.container_type_id === 'ct-10l');
    const loan20 = listRes.body.find((l: any) => l.container_type_id === 'ct-20l');
    expect(loan10.quantity_owed).toBe(4);
    expect(loan20.quantity_owed).toBe(2);
  });

  it('ensures sales with customer-owned containers do not touch container loan records', async () => {
    const db = getDb();
    const initialLoans = db.prepare('SELECT * FROM customer_container_loans WHERE customer_id = ?').all('cust-cont-1');
    expect(initialLoans.length).toBe(0);

    // When a sale is rung up with customer-owned container, container_transactions is not touched
    const txCount: any = db.prepare('SELECT COUNT(*) as cnt FROM container_transactions WHERE customer_id = ?').get('cust-cont-1');
    expect(txCount.cnt).toBe(0);
  });
});
