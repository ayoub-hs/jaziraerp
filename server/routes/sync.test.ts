import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, getDb, resetTestDb } from '../../tests/testApp.js';

describe('Offline Storage & Sync Engine Module (HTTP Routes)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('GET /api/sync/pull returns master catalog and active register state', async () => {
    const res = await request(app).get('/api/sync/pull');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(Array.isArray(res.body.customers)).toBe(true);
    expect(Array.isArray(res.body.container_types)).toBe(true);
    expect(Array.isArray(res.body.open_sessions)).toBe(true);
    expect(typeof res.body.server_time).toBe('string');
  });

  it('accepts double-selling the last unit from two offline counters without blocking (accepted risk)', async () => {
    // 1. Create family & product with stock = 1
    const famRes = await request(app)
      .post('/api/products/families')
      .send({
        name: 'Sync Test Family',
        category: 'Detergents',
        type: 'MANUFACTURED'
      });
    const familyId = famRes.body.id;

    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: familyId,
        name: 'Last Unit Item',
        size_label: '1L',
        barcode: '619000999111',
        stock_quantity: 1,
        retail_price: 10.000,
        wholesale_price: 8.000
      });
    const productId = prodRes.body.id;

    // 2. Create customer
    const custRes = await request(app)
      .post('/api/customers')
      .send({
        name: 'Offline Customer',
        type: 'RESELLER'
      });
    const customerId = custRes.body.id;

    // 3. Counter 1 & Counter 2 both sold the item offline. Now they flush to server.
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp_counter1_sale',
            action_type: 'SALE',
            payload: {
              customer_id: customerId,
              items: [{ product_id: productId, quantity: 1, unit_price: 10.000, pack_multiplier: 1 }],
              cash_paid: 10.000,
              date: '2026-09-07T10:00:00Z'
            }
          },
          {
            temp_client_id: 'temp_counter2_sale',
            action_type: 'SALE',
            payload: {
              customer_id: customerId,
              items: [{ product_id: productId, quantity: 1, unit_price: 10.000, pack_multiplier: 1 }],
              cash_paid: 10.000,
              date: '2026-09-07T10:05:00Z'
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.success).toBe(true);
    expect(flushRes.body.processed_count).toBe(2);

    // 4. Verify both sales exist in the DB
    const db = getDb();
    const sales = db.prepare('SELECT id, synced_from_client_id FROM sales').all();
    expect(sales.length).toBe(2);

    // 5. Verify stock dropped to -1 (recorded cleanly as deficit for manual resolution, NOT blocked)
    const updatedProd = await request(app).get(`/api/products/${productId}`);
    expect(updatedProd.body.stock_quantity).toBe(-1);
  });

  it('reconciles offline sales and generates official sequential numbers and tickets upon sync', async () => {
    // 1. Setup product & customer
    const famRes = await request(app)
      .post('/api/products/families')
      .send({ name: 'Fam', category: 'Detergents', type: 'RESALE' });
    const prodRes = await request(app)
      .post('/api/products')
      .send({ family_id: famRes.body.id, name: 'Prod', stock_quantity: 5, retail_price: 10.000 });
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Credit Customer', type: 'RESELLER' });

    // 2. Flush offline credit sale
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sync-ticket-01',
            action_type: 'SALE',
            payload: {
              customer_id: custRes.body.id,
              items: [{ product_id: prodRes.body.id, quantity: 1, unit_price: 10.000, pack_multiplier: 1 }],
              credit_amount: 10.000,
              total_discount: 0
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.reconciled.length).toBe(1);

    const reconciled = flushRes.body.reconciled[0];
    expect(reconciled.temp_client_id).toBe('temp-sync-ticket-01');
    expect(reconciled.receipt_number).toMatch(/^REC-/);
    expect(reconciled.ticket_number).toMatch(/^TKT-/);

    // 3. Verify debt ticket exists in DB with UNPAID status
    const db = getDb();
    const ticket: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(reconciled.server_id);
    expect(ticket).toBeDefined();
    expect(ticket.ticket_number).toBe(reconciled.ticket_number);
    expect(ticket.remaining_amount).toBe(10);
    expect(ticket.status).toBe('UNPAID');
  });

  it('syncs offline container transactions and updates customer loans and shop stock', async () => {
    // 1. Create container type with initial stock 10
    const ctRes = await request(app)
      .post('/api/containers/types')
      .send({ name: '10L Jerrycan', stock_quantity: 10 });
    const containerTypeId = ctRes.body.id;

    // 2. Create customer
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Container Client', type: 'RESELLER' });
    const customerId = custRes.body.id;

    // 3. Flush offline GIVE action: 3 containers
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-cont-01',
            action_type: 'CONTAINER_TRANSACTION',
            payload: {
              customer_id: customerId,
              container_type_id: containerTypeId,
              action: 'GIVE',
              quantity: 3,
              notes: 'Offline loan'
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.processed_count).toBe(1);

    // 4. Verify shop stock decremented to 7 via GET /api/containers/types
    const typesRes = await request(app).get('/api/containers/types');
    const ct = typesRes.body.find((t: any) => t.id === containerTypeId);
    expect(ct.stock_quantity).toBe(7);

    // 5. Verify customer loan balance is 3 via GET /api/containers/loans?customer_id=...
    const loansRes = await request(app).get(`/api/containers/loans?customer_id=${customerId}`);
    expect(loansRes.status).toBe(200);
    const loan = loansRes.body.find((l: any) => l.container_type_id === containerTypeId);
    expect(loan.quantity_owed).toBe(3);
  });

  it('idempotently skips and reconciles duplicate SALE op with existing synced_from_client_id', async () => {
    const salePayload = {
      cash_paid: 10,
      wallet_paid: 0,
      credit_amount: 0,
      items: [{ quick_add_name: 'Custom Service', unit_price: 10, quantity: 1, is_quick_add: 1 }]
    };

    const firstFlush = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sale-unique-123',
            action_type: 'SALE',
            payload: salePayload
          }
        ]
      });
    expect(firstFlush.status).toBe(200);
    expect(firstFlush.body.processed_count).toBe(1);
    const serverId = firstFlush.body.reconciled[0].server_id;

    // Second flush with the exact same temp_client_id
    const secondFlush = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sale-unique-123',
            action_type: 'SALE',
            payload: salePayload
          }
        ]
      });
    expect(secondFlush.status).toBe(200);
    expect(secondFlush.body.reconciled[0].server_id).toBe(serverId);
    expect(secondFlush.body.reconciled[0].status).toBe('SYNCED');

    // Confirm only 1 sale exists in database
    const db = getDb();
    const count: any = db.prepare('SELECT COUNT(*) as c FROM sales WHERE synced_from_client_id = ?').get('temp-sale-unique-123');
    expect(count.c).toBe(1);
  });

  it('rejects sync sale with INSUFFICIENT_WALLET and leaves other ops unaffected', async () => {
    // Create customer with 5 DT wallet
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Poor Customer', type: 'RESELLER' });
    const customerId = custRes.body.id;

    // Top up 5 DT
    await request(app)
      .post(`/api/customers/${customerId}/wallet/top-up`)
      .send({ amount: 5 });

    // Flush batch with 1 failing wallet sale and 1 valid cash sale
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sale-overdraw',
            action_type: 'SALE',
            payload: {
              customer_id: customerId,
              cash_paid: 0,
              wallet_paid: 20, // Exceeds 5 DT balance
              credit_amount: 0,
              items: [{ quick_add_name: 'Overdraw Item', unit_price: 20, quantity: 1, is_quick_add: 1 }]
            }
          },
          {
            temp_client_id: 'temp-sale-valid-cash',
            action_type: 'SALE',
            payload: {
              cash_paid: 10,
              wallet_paid: 0,
              credit_amount: 0,
              items: [{ quick_add_name: 'Cash Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.failed).toHaveLength(1);
    expect(flushRes.body.failed[0]).toMatchObject({
      temp_client_id: 'temp-sale-overdraw',
      action_type: 'SALE',
      reason: 'INSUFFICIENT_WALLET'
    });
    expect(flushRes.body.reconciled).toHaveLength(1);
    expect(flushRes.body.reconciled[0].temp_client_id).toBe('temp-sale-valid-cash');

    // Customer wallet remains intact at 5 DT
    const db = getDb();
    const cust: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(customerId);
    expect(cust.wallet_balance).toBe(5);

    // Overdrawn sale was not created
    const failedSale = db.prepare('SELECT id FROM sales WHERE synced_from_client_id = ?').get('temp-sale-overdraw');
    expect(failedSale).toBeUndefined();
  });

  it('inserts an inventory_adjustments record when PRICE_STOCK_EDIT changes stock_quantity', async () => {
    // 1. Create a product with initial stock 10
    const famRes = await request(app)
      .post('/api/products/families')
      .send({ name: 'Stock Edit Family', category: 'Cleaning', type: 'MANUFACTURED' });
    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: famRes.body.id,
        name: 'Stock Edit Item',
        stock_quantity: 10,
        retail_price: 5.0,
        wholesale_price: 4.0
      });
    const productId = prodRes.body.id;

    // 2. Sync flush PRICE_STOCK_EDIT changing stock from 10 to 25
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-edit-stock-1',
            action_type: 'PRICE_STOCK_EDIT',
            payload: {
              product_id: productId,
              stock_quantity: 25
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.processed_count).toBe(1);

    // 3. Verify product stock is 25
    const db = getDb();
    const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId);
    expect(prod.stock_quantity).toBe(25);

    // 4. Verify inventory_adjustments has a row with delta 15 and reason SYNC_PRICE_STOCK_EDIT
    const adj: any = db.prepare('SELECT * FROM inventory_adjustments WHERE product_id = ?').get(productId);
    expect(adj).toBeDefined();
    expect(adj.quantity_delta).toBe(15);
    expect(adj.reason).toBe('SYNC_PRICE_STOCK_EDIT');
    expect(adj.item_type).toBe('PRODUCT');
  });
});



