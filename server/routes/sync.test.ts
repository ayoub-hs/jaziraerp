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

  it('routes sync RETURN above owed count to failed unless correction=true', async () => {
    const ctRes = await request(app)
      .post('/api/containers/types')
      .send({ name: 'Sync Jerrycan', stock_quantity: 10 });
    const custRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Sync Container Client', type: 'RESELLER' });

    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sync-give-01',
            action_type: 'CONTAINER_TRANSACTION',
            payload: {
              customer_id: custRes.body.id,
              container_type_id: ctRes.body.id,
              action: 'GIVE',
              quantity: 2
            }
          }
        ]
      });
    expect(flushRes.body.reconciled).toHaveLength(1);

    const badFlush = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sync-return-over',
            action_type: 'CONTAINER_TRANSACTION',
            payload: {
              customer_id: custRes.body.id,
              container_type_id: ctRes.body.id,
              action: 'RETURN',
              quantity: 5
            }
          },
          {
            temp_client_id: 'temp-sync-return-fix',
            action_type: 'CONTAINER_TRANSACTION',
            payload: {
              customer_id: custRes.body.id,
              container_type_id: ctRes.body.id,
              action: 'RETURN',
              quantity: 5,
              correction: true
            }
          }
        ]
      });

    expect(badFlush.body.failed).toHaveLength(1);
    expect(badFlush.body.failed[0]).toMatchObject({
      temp_client_id: 'temp-sync-return-over',
      action_type: 'CONTAINER_TRANSACTION'
    });
    expect(badFlush.body.failed[0].reason).toMatch(/owed count/i);
    expect(badFlush.body.reconciled).toHaveLength(1);
    expect(badFlush.body.reconciled[0].temp_client_id).toBe('temp-sync-return-fix');
  });

  it('excludes deactivated products and families from GET /api/sync/pull', async () => {
    const famRes = await request(app)
      .post('/api/products/families')
      .send({ name: 'Pull Filter Fam', category: 'C', type: 'RESALE' });
    const prodRes = await request(app)
      .post('/api/products')
      .send({ family_id: famRes.body.id, name: 'Pull Filter Prod', stock_quantity: 5, retail_price: 10 });
    const fam2Res = await request(app)
      .post('/api/products/families')
      .send({ name: 'Pull Gone Fam', category: 'C', type: 'RESALE' });
    const prod2Res = await request(app)
      .post('/api/products')
      .send({ family_id: fam2Res.body.id, name: 'Pull Gone Prod', stock_quantity: 5, retail_price: 10 });

    // Deactivate one product and one whole family
    expect((await request(app).put(`/api/products/${prod2Res.body.id}`).send({ active: 0 })).status).toBe(200);
    expect((await request(app).put(`/api/products/families/${fam2Res.body.id}`).send({ active: 0 })).status).toBe(200);

    const pull = await request(app).get('/api/sync/pull');
    expect(pull.status).toBe(200);
    const productIds = pull.body.products.map((p: any) => p.id);
    expect(productIds).toContain(prodRes.body.id);
    expect(productIds).not.toContain(prod2Res.body.id);
    const familyIds = pull.body.families.map((f: any) => f.id);
    expect(familyIds).toContain(famRes.body.id);
    expect(familyIds).not.toContain(fam2Res.body.id);
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

  it('routes invalid SALE payments to failed/needs_review with a reason and never accepts them', async () => {
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sync-sum-mismatch',
            action_type: 'SALE',
            payload: {
              cash_paid: 5, // total is 10 -> sum mismatch
              cash_tendered: 5,
              items: [{ quick_add_name: 'Mismatch Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          },
          {
            temp_client_id: 'temp-sync-under-tendered',
            action_type: 'SALE',
            payload: {
              cash_paid: 10,
              cash_tendered: 4, // tendered < paid
              items: [{ quick_add_name: 'Under Tender Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          },
          {
            temp_client_id: 'temp-sync-negative',
            action_type: 'SALE',
            payload: {
              cash_paid: 11,
              wallet_paid: -1, // negative amount
              cash_tendered: 11,
              items: [{ quick_add_name: 'Negative Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          },
          {
            temp_client_id: 'temp-sync-bad-discount',
            action_type: 'SALE',
            payload: {
              cash_paid: 0,
              cash_tendered: 0,
              total_discount: 50, // exceeds 10 subtotal
              items: [{ quick_add_name: 'Discount Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          },
          {
            temp_client_id: 'temp-sync-nonfinite',
            action_type: 'SALE',
            payload: {
              cash_paid: 'not-a-number',
              cash_tendered: 10,
              items: [{ quick_add_name: 'NaN Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.reconciled).toHaveLength(0);
    expect(flushRes.body.failed).toHaveLength(5);
    for (const f of flushRes.body.failed) {
      expect(typeof f.reason).toBe('string');
      expect(f.reason.length).toBeGreaterThan(0);
    }

    const db = getDb();
    const count: any = db.prepare('SELECT COUNT(*) as c FROM sales').get();
    expect(count.c).toBe(0);
  });

  it('computes change server-side on sync flush and ignores client change_given', async () => {
    const flushRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'temp-sync-change-01',
            action_type: 'SALE',
            payload: {
              cash_paid: 10,
              cash_tendered: 15,
              change_given: 999, // must be ignored
              items: [{ quick_add_name: 'Change Item', unit_price: 10, quantity: 1, is_quick_add: 1 }]
            }
          }
        ]
      });

    expect(flushRes.status).toBe(200);
    expect(flushRes.body.reconciled).toHaveLength(1);

    const db = getDb();
    const sale: any = db.prepare('SELECT cash_paid, change_given FROM sales WHERE synced_from_client_id = ?').get('temp-sync-change-01');
    expect(sale.cash_paid).toBe(10);
    expect(sale.change_given).toBe(5);
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

  it('GET /api/sync/pull returns identical pack_sizes arrays for products with multiple, single, and no pack sizes', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    // 1. Create a product family
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-perf-test', 'Perf Family', 'Detergents', 'MANUFACTURED', ?, ?)
    `).run(now, now);

    // 2. Seed 3 products: prod-2packs, prod-1pack, prod-0packs
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES
        ('prod-2packs', 'fam-perf-test', 'Product With 2 Packs', '1L', '619000111222', 50, 4.0, 3.0, ?, ?),
        ('prod-1pack', 'fam-perf-test', 'Product With 1 Pack', '1L', '619000333444', 30, 4.0, 3.0, ?, ?),
        ('prod-0packs', 'fam-perf-test', 'Product With 0 Packs', '1L', '619000555666', 20, 4.0, 3.0, ?, ?)
    `).run(now, now, now, now, now, now);

    // 3. Seed pack sizes (prod-2packs has 2: Box 12, Box 6; inserted in reverse order to test multiplier ASC ordering)
    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode)
      VALUES
        ('ps-12', 'prod-2packs', 'Box of 12', 12, 45.0, '619000111223'),
        ('ps-6', 'prod-2packs', 'Pack of 6', 6, 23.0, '619000111224'),
        ('ps-4', 'prod-1pack', 'Pack of 4', 4, 15.0, '619000333445')
    `).run();

    // 4. Compute expected results using the baseline query pattern
    const expectedOldProd1PackSizes = db.prepare(
      'SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC'
    ).all('prod-2packs');
    const expectedOldProd2PackSizes = db.prepare(
      'SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC'
    ).all('prod-1pack');
    const expectedOldProd3PackSizes = db.prepare(
      'SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC'
    ).all('prod-0packs');

    // 5. Call GET /api/sync/pull
    const res = await request(app).get('/api/sync/pull');
    expect(res.status).toBe(200);

    const pullProd1 = res.body.products.find((p: any) => p.id === 'prod-2packs');
    const pullProd2 = res.body.products.find((p: any) => p.id === 'prod-1pack');
    const pullProd3 = res.body.products.find((p: any) => p.id === 'prod-0packs');

    expect(pullProd1).toBeDefined();
    expect(pullProd2).toBeDefined();
    expect(pullProd3).toBeDefined();

    // Assert pack_sizes arrays are identical to what the old code returned
    expect(pullProd1.pack_sizes).toEqual(expectedOldProd1PackSizes);
    expect(pullProd1.pack_sizes.length).toBe(2);
    expect(pullProd1.pack_sizes[0].multiplier).toBe(6);
    expect(pullProd1.pack_sizes[1].multiplier).toBe(12);

    expect(pullProd2.pack_sizes).toEqual(expectedOldProd2PackSizes);
    expect(pullProd2.pack_sizes.length).toBe(1);
    expect(pullProd2.pack_sizes[0].multiplier).toBe(4);

    expect(pullProd3.pack_sizes).toEqual(expectedOldProd3PackSizes);
    expect(pullProd3.pack_sizes).toEqual([]);
  });

  it('validates PRICE_STOCK_EDIT and rejects non-finite or negative values', async () => {
    // 0. Seed product
    const famRes = await request(app)
      .post('/api/products/families')
      .send({ name: 'Price Edit Family', category: 'Cleaning', type: 'MANUFACTURED' });
    const prodRes = await request(app)
      .post('/api/products')
      .send({
        family_id: famRes.body.id,
        name: 'Price Edit Item',
        stock_quantity: 10,
        retail_price: 5.0,
        wholesale_price: 4.0
      });
    const testProdId = prodRes.body.id;

    // 1. Attempt PRICE_STOCK_EDIT with invalid prices / stock
    const badEditRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'edit-bad-retail',
            action_type: 'PRICE_STOCK_EDIT',
            payload: {
              product_id: testProdId,
              retail_price: 'not-a-number'
            }
          },
          {
            temp_client_id: 'edit-neg-wholesale',
            action_type: 'PRICE_STOCK_EDIT',
            payload: {
              product_id: testProdId,
              wholesale_price: -10
            }
          },
          {
            temp_client_id: 'edit-nan-stock',
            action_type: 'PRICE_STOCK_EDIT',
            payload: {
              product_id: testProdId,
              stock_quantity: 'invalid-qty'
            }
          }
        ]
      });

    expect(badEditRes.status).toBe(200);
    expect(badEditRes.body.reconciled).toHaveLength(0);
    expect(badEditRes.body.failed).toHaveLength(3);

    // 2. Perform valid PRICE_STOCK_EDIT
    const goodEditRes = await request(app)
      .post('/api/sync/flush')
      .send({
        operations: [
          {
            temp_client_id: 'edit-good',
            action_type: 'PRICE_STOCK_EDIT',
            payload: {
              product_id: testProdId,
              retail_price: 6.500,
              wholesale_price: 5.000,
              stock_quantity: 120
            }
          }
        ]
      });

    expect(goodEditRes.status).toBe(200);
    expect(goodEditRes.body.reconciled).toHaveLength(1);
    expect(goodEditRes.body.failed).toHaveLength(0);

    const db = getDb();
    const prod: any = db.prepare('SELECT retail_price, wholesale_price, stock_quantity FROM products WHERE id = ?').get(testProdId);
    expect(prod.retail_price).toBe(6.500);
    expect(prod.wholesale_price).toBe(5.000);
    expect(prod.stock_quantity).toBe(120);
  });
});




