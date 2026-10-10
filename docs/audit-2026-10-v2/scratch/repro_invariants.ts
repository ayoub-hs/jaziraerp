import os from 'os';
import path from 'path';
import crypto from 'crypto';

process.env.DATABASE_PATH = path.join(os.tmpdir(), 'erp-repro-test.sqlite');
process.env.NODE_ENV = 'test';

import { resetTestDb, app, request, getDb } from '../../../tests/testApp.js';
import { round3 } from '../../../server/utils/money.js';

async function testI1_GlobalDiscountRefund() {
  console.log('\n=== TESTING I1: REFUND ON SALE WITH GLOBAL CART DISCOUNT ===');
  const db = resetTestDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_families (id, name, category, type, created_at, updated_at)
    VALUES ('fam-1', 'Cleaners', 'Detergents', 'MANUFACTURED', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
    VALUES ('prod-1', 'fam-1', 'Floor Cleaner 1L', '1L', '619001', 100, 10.000, 8.000, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
    VALUES ('ses-1', 'SES-01', 'Countertop', ?, 200.000, 200.000, 'OPEN')
  `).run(now);

  // 1. Sale of 2x Floor Cleaner @ 10.000 = 20.000 DT, with cart discount = 5.000 DT. Total TTC = 15.000 DT.
  const saleRes = await request(app).post('/api/sales').send({
    session_id: 'ses-1',
    items: [{ product_id: 'prod-1', quantity: 2, unit_price: 10.000 }],
    total_discount: 5.000,
    cash_paid: 15.000,
    cash_tendered: 15.000
  });

  console.log('Sale creation status:', saleRes.status);
  console.log('Sale total_ttc:', saleRes.body.total_ttc, 'total_discount:', saleRes.body.total_discount);
  const saleId = saleRes.body.id;
  const saleItemId = saleRes.body.items[0].id;

  // 2. Customer returns both items (quantity 2)
  const refundRes = await request(app).post(`/api/sales/${saleId}/refund`).send({
    session_id: 'ses-1',
    refund_method: 'CASH',
    items: [{ sale_item_id: saleItemId, quantity: 2 }],
    reason: 'Defective batch'
  });

  console.log('Refund status:', refundRes.status);
  console.log('Refund response total_refunded:', refundRes.body.total_refunded, 'cash_refunded:', refundRes.body.cash_refunded);

  const saleAfter: any = db.prepare('SELECT total_ttc FROM sales WHERE id = ?').get(saleId);
  const refundRow: any = db.prepare('SELECT SUM(total_refunded) as sum_ref FROM refunds WHERE sale_id = ?').get(saleId);
  console.log('VERIFICATION: sale.total_ttc =', saleAfter.total_ttc, 'vs refunds sum =', refundRow.sum_ref);
  if (refundRow.sum_ref > saleAfter.total_ttc) {
    console.log('BUG CONFIRMED: sum(refunds.total_refunded) EXCEEDS sale.total_ttc by', round3(refundRow.sum_ref - saleAfter.total_ttc), 'DT!');
  } else {
    console.log('I1 held.');
  }
}

async function testI3_StatementCreditRefund() {
  console.log('\n=== TESTING I3: CUSTOMER STATEMENT AFTER CREDIT-REDUCED REFUND ===');
  const db = resetTestDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
    VALUES ('cust-credit', 'Société Ben Ali', 'RESELLER', 10, 0, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO product_families (id, name, category, type, created_at, updated_at)
    VALUES ('fam-1', 'Cleaners', 'Detergents', 'MANUFACTURED', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
    VALUES ('prod-1', 'fam-1', 'Floor Cleaner 1L', '1L', '619001', 100, 10.000, 8.000, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
    VALUES ('ses-1', 'SES-01', 'Countertop', ?, 200.000, 200.000, 'OPEN')
  `).run(now);

  // 1. Credit sale: 5x @ 10.000 = 50.000 DT (all on credit)
  const saleRes = await request(app).post('/api/sales').send({
    customer_id: 'cust-credit',
    session_id: 'ses-1',
    items: [{ product_id: 'prod-1', quantity: 5, unit_price: 10.000 }],
    cash_paid: 0,
    credit_amount: 50.000
  });

  const saleId = saleRes.body.id;
  const saleItemId = saleRes.body.items[0].id;
  console.log('Credit sale created, ticket_number:', saleRes.body.ticket?.ticket_number);

  // 2. Refund 2 items with CREDIT_REDUCTION (2 x 10 = 20.000 DT)
  const refundRes = await request(app).post(`/api/sales/${saleId}/refund`).send({
    session_id: 'ses-1',
    refund_method: 'CREDIT_REDUCTION',
    items: [{ sale_item_id: saleItemId, quantity: 2 }],
    reason: 'Customer return on credit'
  });

  console.log('Refund status:', refundRes.status, 'credit_reduced:', refundRes.body.credit_reduced);

  // 3. Fetch statement
  const stmtRes = await request(app).get('/api/customers/cust-credit/statement');
  const stmt = stmtRes.body;
  console.log('Statement debt summary final_balance:', stmt.debt.final_balance);
  console.log('Statement debt entries count:', stmt.debt.entries.length);
  const lastEntry = stmt.debt.entries[stmt.debt.entries.length - 1];
  console.log('Last debt entry running_balance:', lastEntry?.running_balance);

  if (lastEntry?.running_balance !== stmt.debt.final_balance) {
    console.log('BUG CONFIRMED: Running balance in ledger table (', lastEntry?.running_balance, ') does NOT match summary card (', stmt.debt.final_balance, ')!');
  } else {
    console.log('I3 held.');
  }
}

async function testI8_SyncIdempotency() {
  console.log('\n=== TESTING I8: SYNC REPLAY IDEMPOTENCY ===');
  const db = resetTestDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
    VALUES ('cust-sync', 'Client Sync', 'RETAIL', 0, 0, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
    VALUES ('ct-bidon', 'Bidon 5L', 5.0, 100, ?)
  `).run(now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
    VALUES ('ses-1', 'SES-01', 'Countertop', ?, 200.000, 200.000, 'OPEN')
  `).run(now);

  // A. Cash Movement replay
  const movOp = {
    temp_client_id: 'offline-mov-001',
    action_type: 'CASH_MOVEMENT',
    payload: {
      session_id: 'ses-1',
      type: 'CASH_IN',
      amount: 25.000,
      reason: 'Drawer top-up'
    }
  };

  await request(app).post('/api/sync/flush').send({ operations: [movOp] });
  const movCount1: any = db.prepare('SELECT COUNT(*) as cnt, SUM(amount) as s FROM register_cash_movements').get();
  console.log('After first CASH_MOVEMENT sync: count =', movCount1.cnt, 'sum =', movCount1.s);

  // Replay exact same operation
  await request(app).post('/api/sync/flush').send({ operations: [movOp] });
  const movCount2: any = db.prepare('SELECT COUNT(*) as cnt, SUM(amount) as s FROM register_cash_movements').get();
  console.log('After REPLAY CASH_MOVEMENT sync: count =', movCount2.cnt, 'sum =', movCount2.s);

  if (movCount2.cnt !== movCount1.cnt) {
    console.log('BUG CONFIRMED: CASH_MOVEMENT sync is NOT idempotent! Duplicate movement created on retry!');
  }

  // B. Container Transaction replay
  const containerOp = {
    temp_client_id: 'offline-cnt-001',
    action_type: 'CONTAINER_TRANSACTION',
    payload: {
      customer_id: 'cust-sync',
      container_type_id: 'ct-bidon',
      action: 'GIVE',
      quantity: 5,
      notes: 'Lending containers'
    }
  };

  await request(app).post('/api/sync/flush').send({ operations: [containerOp] });
  const loan1: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ?').get('cust-sync');
  const ctStock1: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon');
  console.log('After first CONTAINER sync: quantity_owed =', loan1?.quantity_owed, 'container stock =', ctStock1?.stock_quantity);

  // Replay exact same operation
  await request(app).post('/api/sync/flush').send({ operations: [containerOp] });
  const loan2: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ?').get('cust-sync');
  const ctStock2: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon');
  console.log('After REPLAY CONTAINER sync: quantity_owed =', loan2?.quantity_owed, 'container stock =', ctStock2?.stock_quantity);

  if (loan2?.quantity_owed !== loan1?.quantity_owed) {
    console.log('BUG CONFIRMED: CONTAINER_TRANSACTION sync is NOT idempotent! Duplicate container loan applied on retry!');
  }
}

async function testI7_ReportsGrossNetMismatch() {
  console.log('\n=== TESTING I7: REPORTS GROSS HT/TVA VS NET TTC ===');
  const db = resetTestDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_families (id, name, category, type, created_at, updated_at)
    VALUES ('fam-1', 'Cleaners', 'Detergents', 'MANUFACTURED', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
    VALUES ('prod-1', 'fam-1', 'Floor Cleaner 1L', '1L', '619001', 100, 10.000, 8.000, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
    VALUES ('ses-1', 'SES-01', 'Countertop', ?, 200.000, 200.000, 'OPEN')
  `).run(now);

  // 1. Sale: 10 items @ 10.000 = 100.000 DT TTC
  const saleRes = await request(app).post('/api/sales').send({
    session_id: 'ses-1',
    items: [{ product_id: 'prod-1', quantity: 10, unit_price: 10.000 }],
    cash_paid: 100.000,
    cash_tendered: 100.000
  });

  const saleId = saleRes.body.id;
  const saleItemId = saleRes.body.items[0].id;

  // 2. Refund 3 items (30.000 DT TTC)
  await request(app).post(`/api/sales/${saleId}/refund`).send({
    session_id: 'ses-1',
    refund_method: 'CASH',
    items: [{ sale_item_id: saleItemId, quantity: 3 }],
    reason: 'Partial return'
  });

  // 3. Check reports
  const repRes = await request(app).get('/api/reports/sales-by-customer');
  const row = repRes.body.customer_sales[0];
  console.log('Report row:');
  console.log('  total_ht:', row.total_ht);
  console.log('  total_tva:', row.total_tva);
  console.log('  gross_ttc:', row.gross_ttc);
  console.log('  refunded_amount:', row.refunded_amount);
  console.log('  net_ttc:', row.net_ttc);
  console.log('  total_ttc:', row.total_ttc);

  const htPlusTva = round3(row.total_ht + row.total_tva);
  console.log('Arithmetic check: total_ht + total_tva =', htPlusTva);
  console.log('Reported total_ttc =', row.total_ttc);

  if (Math.abs(htPlusTva - row.total_ttc) > 0.01) {
    console.log('BUG CONFIRMED: total_ht + total_tva (', htPlusTva, ') does NOT equal reported total_ttc (', row.total_ttc, ')! HT and TVA are gross, while total_ttc is net!');
  } else {
    console.log('I7 held.');
  }
}

async function main() {
  await testI1_GlobalDiscountRefund();
  await testI3_StatementCreditRefund();
  await testI8_SyncIdempotency();
  await testI7_ReportsGrossNetMismatch();
}

main().catch(console.error);
