import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allocateCustomerPayment, isTicketOverdue } from '../services/debtService.js';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Customers, Debt Tickets & Wallet Module', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);

    // Seed customer
    db.prepare(`
      INSERT INTO customers (id, name, phone, address, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
      VALUES ('cust-reseller-1', 'Ben Salem Cleaners', '+216 98 123 456', 'Sfax', 'RESELLER', 15, 0, '2026-01-01', '2026-01-01')
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('creates an open ticket with correct amount, date, and UNPAID status', () => {
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('tkt-1', 'TKT-20260907-0001', 'cust-reseller-1', '2026-09-07', 45.500, 45.500, 'UNPAID', '2026-09-07', '2026-09-07')
    `).run();

    const ticket: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-1');
    expect(ticket.total_amount).toBe(45.500);
    expect(ticket.remaining_amount).toBe(45.500);
    expect(ticket.status).toBe('UNPAID');
    expect(ticket.customer_id).toBe('cust-reseller-1');
  });

  it('applies partial payment on a single ticket, updating remaining amount and status to PARTIALLY_PAID', () => {
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('tkt-1', 'TKT-001', 'cust-reseller-1', '2026-09-01', 50.000, 50.000, 'UNPAID', '2026-09-01', '2026-09-01')
    `).run();

    // Pay 20 DT
    const result = allocateCustomerPayment(db, {
      customerId: 'cust-reseller-1',
      amount: 20.000,
      paymentMethod: 'Cash',
      notes: 'Partial payment'
    });

    expect(result.amount_allocated).toBe(20.000);
    expect(result.overpayment_wallet_credit).toBe(0);

    const ticket: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-1');
    expect(ticket.remaining_amount).toBe(30.000); // 50 - 20 = 30
    expect(ticket.status).toBe('PARTIALLY_PAID');
  });

  it('allocates payment across multiple open tickets in FIFO (oldest-first) order', () => {
    // Ticket 1: 10.000 DT (Jan 10)
    // Ticket 2: 10.000 DT (Feb 10)
    // Ticket 3: 10.000 DT (Mar 10)
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES
        ('tkt-old', 'TKT-001', 'cust-reseller-1', '2026-01-10', 10.000, 10.000, 'UNPAID', '2026-01-10', '2026-01-10'),
        ('tkt-mid', 'TKT-002', 'cust-reseller-1', '2026-02-10', 10.000, 10.000, 'UNPAID', '2026-02-10', '2026-02-10'),
        ('tkt-new', 'TKT-003', 'cust-reseller-1', '2026-03-10', 10.000, 10.000, 'UNPAID', '2026-03-10', '2026-03-10')
    `).run();

    // Pay 25.000 DT
    const result = allocateCustomerPayment(db, {
      customerId: 'cust-reseller-1',
      amount: 25.000,
      paymentMethod: 'Cash'
    });

    expect(result.amount_allocated).toBe(25.000);
    expect(result.tickets_affected.length).toBe(3);

    const t1: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-old');
    const t2: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-mid');
    const t3: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-new');

    // Ticket 1: Paid in full (10 DT) -> remaining 0, PAID
    expect(t1.remaining_amount).toBe(0);
    expect(t1.status).toBe('PAID');

    // Ticket 2: Paid in full (10 DT) -> remaining 0, PAID
    expect(t2.remaining_amount).toBe(0);
    expect(t2.status).toBe('PAID');

    // Ticket 3: Partially paid (5 DT) -> remaining 5 DT, PARTIALLY_PAID
    expect(t3.remaining_amount).toBe(5.000);
    expect(t3.status).toBe('PARTIALLY_PAID');
  });

  it('auto-deposits surplus overpayment into customer wallet', () => {
    // Single ticket of 20.000 DT
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('tkt-single', 'TKT-200', 'cust-reseller-1', '2026-09-01', 20.000, 20.000, 'UNPAID', '2026-09-01', '2026-09-01')
    `).run();

    // Customer gives 30.000 DT (surplus 10.000 DT)
    const result = allocateCustomerPayment(db, {
      customerId: 'cust-reseller-1',
      amount: 30.000,
      paymentMethod: 'Cash'
    });

    expect(result.amount_allocated).toBe(20.000);
    expect(result.overpayment_wallet_credit).toBe(10.000);

    // Ticket is fully paid
    const t: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE id = ?').get('tkt-single');
    expect(t.status).toBe('PAID');
    expect(t.remaining_amount).toBe(0);

    // Customer wallet balance is credited with 10.000 DT
    const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-reseller-1');
    expect(customer.wallet_balance).toBe(10.000);

    // Wallet transaction recorded
    const walletTx: any = db.prepare('SELECT * FROM customer_wallet_transactions WHERE customer_id = ?').get('cust-reseller-1');
    expect(walletTx.type).toBe('OVERPAYMENT_DEPOSIT');
    expect(walletTx.amount).toBe(10.000);
  });

  it('correctly detects overdue tickets (>30 days)', () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    expect(isTicketOverdue(oldDate, 30)).toBe(true);
    expect(isTicketOverdue(freshDate, 30)).toBe(false);
  });

  it('enforces no credit limit: allows unlimited open tickets for resellers', () => {
    // Add 10 open tickets totaling 10,000 DT
    for (let i = 1; i <= 10; i++) {
      db.prepare(`
        INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
        VALUES (?, ?, 'cust-reseller-1', '2026-09-01', 1000.000, 1000.000, 'UNPAID', '2026-09-01', '2026-09-01')
      `).run(`tkt-bulk-${i}`, `TKT-BULK-${i}`);
    }

    const totalDebt: any = db.prepare(`
      SELECT SUM(remaining_amount) as sum FROM customer_debt_tickets WHERE customer_id = 'cust-reseller-1'
    `).get();

    expect(totalDebt.sum).toBe(10000.000);
  });

  it('handles wallet top-up and tracks statement history', () => {
    // Top up 50 DT
    db.prepare(`
      INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, notes, created_at)
      VALUES ('wtx-1', 'cust-reseller-1', '2026-09-07', 'TOP_UP', 50.000, 'Cash float top up', '2026-09-07')
    `).run();

    db.prepare(`
      UPDATE customers SET wallet_balance = wallet_balance + 50.000 WHERE id = 'cust-reseller-1'
    `).run();

    const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-reseller-1');
    expect(customer.wallet_balance).toBe(50.000);
  });

  it('logs opening wallet as TOP_UP "Solde initial" so the statement ledger matches', async () => {
    resetTestDb();
    const res = await request(app)
      .post('/api/customers')
      .send({ name: 'Opening Wallet Client', type: 'RETAIL', wallet_balance: 20.0 });
    expect(res.status).toBe(201);
    expect(res.body.wallet_balance).toBe(20.0);

    const tx: any = getDb()
      .prepare("SELECT * FROM customer_wallet_transactions WHERE customer_id = ? AND type = 'TOP_UP'")
      .get(res.body.id);
    expect(tx).toBeDefined();
    expect(tx.amount).toBe(20.0);
    expect(tx.notes).toBe('Solde initial');

    // Statement ledger wallet balance (credits minus debits) equals customers.wallet_balance
    const statement = await request(app).get(`/api/customers/${res.body.id}/statement`);
    expect(statement.status).toBe(200);
    const walletLines = statement.body.wallet.entries;
    const ledgerBalance = walletLines.reduce((sum: number, l: any) => sum + (l.credit || 0) - (l.debit || 0), 0);
    expect(Math.round(ledgerBalance * 1000) / 1000).toBe(res.body.wallet_balance);

    // No register cash movement was created
    const movements: any[] = getDb().prepare('SELECT * FROM register_cash_movements').all();
    expect(movements).toHaveLength(0);
    resetTestDb();
  });

  it('splits the statement into debt and wallet ledgers matching total_debt and wallet_balance', async () => {
    resetTestDb();
    const db = getDb();

    // Customer + open session + product for the wallet sale
    const custRes = await request(app).post('/api/customers').send({ name: 'Ledger Client', type: 'RETAIL' });
    const customerId = custRes.body.id;
    await request(app).post('/api/register/open').send({ counter_name: 'Countertop', opening_cash: 100 });
    const famRes = await request(app).post('/api/products/families').send({ name: 'Ledger Fam', category: 'C', type: 'RESALE' });
    const prodRes = await request(app).post('/api/products').send({ family_id: famRes.body.id, name: 'Ledger Prod', stock_quantity: 100, retail_price: 60 });

    // Debt ticket of 27
    db.prepare(`
      INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at)
      VALUES ('tkt-27', 'TKT-27', ?, '2026-09-07T10:00:00Z', 27.000, 27.000, 'UNPAID', '2026-09-07T10:00:00Z', '2026-09-07T10:00:00Z')
    `).run(customerId);

    // Payment of 37 = 27 applied to the ticket + 10 overpayment to wallet
    const payRes = await request(app).post(`/api/customers/${customerId}/payments`).send({ amount: 37.000 });
    expect(payRes.status).toBe(200);

    // Top-up 100, then wallet sale of 54
    expect((await request(app).post(`/api/customers/${customerId}/wallet/top-up`).send({ amount: 100.000 })).status).toBe(201);
    const saleRes = await request(app).post('/api/sales').send({
      customer_id: customerId,
      items: [{ product_id: prodRes.body.id, quantity: 1, unit_price: 54.000 }],
      wallet_paid: 54.000,
      cash_paid: 0
    });
    expect(saleRes.status).toBe(201);

    const statement = await request(app).get(`/api/customers/${customerId}/statement`);
    expect(statement.status).toBe(200);

    // Debt ledger: ticket 27 in, only 27 applied out -> 0
    expect(statement.body.debt.final_balance).toBe(0);
    const debtRefs = statement.body.debt.entries.map((e: any) => [e.entry_type, e.debit, e.credit]);
    expect(debtRefs).toContainEqual(['TICKET', 27, 0]);
    expect(debtRefs).toContainEqual(['PAYMENT', 0, 27]);
    expect(statement.body.debt.entries.some((e: any) => e.entry_type === 'PAYMENT' && e.credit === 37)).toBe(false);

    // Wallet ledger: 10 overpayment + 100 top-up in, 54 sale out -> 56
    expect(statement.body.wallet.final_balance).toBe(56);
    const walletRefs = statement.body.wallet.entries.map((e: any) => [e.reference, e.credit, e.debit]);
    expect(walletRefs).toContainEqual(['OVERPAYMENT_DEPOSIT', 10, 0]);
    expect(walletRefs).toContainEqual(['TOP_UP', 100, 0]);
    expect(walletRefs).toContainEqual(['SALE_PAYMENT', 0, 54]);

    // Final balances equal the customer record
    const customer = await request(app).get(`/api/customers/${customerId}`);
    expect(customer.body.total_debt).toBe(0);
    expect(customer.body.wallet_balance).toBe(56);
    expect(statement.body.debt.final_balance).toBe(customer.body.total_debt);
    expect(statement.body.wallet.final_balance).toBe(customer.body.wallet_balance);
    resetTestDb();
  });

  it('shows the opening-wallet Solde initial TOP_UP in the wallet ledger', async () => {
    resetTestDb();
    const res = await request(app).post('/api/customers').send({ name: 'Initial Ledger', type: 'RETAIL', wallet_balance: 20 });
    const statement = await request(app).get(`/api/customers/${res.body.id}/statement`);
    const initials = statement.body.wallet.entries.filter((e: any) => e.reference === 'TOP_UP' && e.status === 'Solde initial');
    expect(initials).toHaveLength(1);
    expect(initials[0].credit).toBe(20);
    expect(statement.body.wallet.final_balance).toBe(20);
    resetTestDb();
  });

  it('RES-01: statement debt ledger running balance matches summary final_balance after sale, refund, payment, second refund', async () => {
    resetTestDb();
    const db = getDb();

    // 1. Setup customer, open register session, product
    const custRes = await request(app).post('/api/customers').send({ name: 'Wholesale Statement Client', type: 'WHOLESALE' });
    const customerId = custRes.body.id;
    await request(app).post('/api/register/open').send({ counter_name: 'Countertop', opening_cash: 100 });
    const famRes = await request(app).post('/api/products/families').send({ name: 'Statement Fam', category: 'Detergents', type: 'MANUFACTURED' });
    const prodRes = await request(app).post('/api/products').send({ family_id: famRes.body.id, name: 'Statement Prod', stock_quantity: 100, retail_price: 50, wholesale_price: 50 });
    const prodId = prodRes.body.id;

    // Step A: Credit sale of 2 units @ 50 DT = 100 DT
    const saleRes = await request(app).post('/api/sales').send({
      customer_id: customerId,
      items: [{ product_id: prodId, quantity: 2, unit_price: 50.000 }],
      credit_amount: 100.000
    });
    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;
    const saleItemId = saleRes.body.items[0].id;

    // Step B: Refund 1 (1 unit = 50 DT) via CREDIT_REDUCTION
    const ref1Res = await request(app).post(`/api/sales/${saleId}/refund`).send({
      refund_method: 'CREDIT_REDUCTION',
      items: [{ sale_item_id: saleItemId, quantity: 1 }],
      reason: 'First return'
    });
    expect(ref1Res.status).toBe(201);
    expect(ref1Res.body.credit_reduced).toBe(50.000);

    // Step C: Payment of 20 DT
    const payRes = await request(app).post(`/api/customers/${customerId}/payments`).send({
      amount: 20.000,
      payment_method: 'Cash',
      notes: 'Partial payment'
    });
    expect(payRes.status).toBe(200);

    // Step D: Second Refund of remaining unit partially (e.g. 0.2 quantity or another sale with refund)
    // Create second sale of 1 unit @ 50 DT credit
    const sale2Res = await request(app).post('/api/sales').send({
      customer_id: customerId,
      items: [{ product_id: prodId, quantity: 1, unit_price: 50.000 }],
      credit_amount: 50.000
    });
    expect(sale2Res.status).toBe(201);
    const sale2Id = sale2Res.body.id;
    const sale2ItemId = sale2Res.body.items[0].id;

    // Second refund: refund 1 unit from sale 2 (50 DT) via CREDIT_REDUCTION
    const ref2Res = await request(app).post(`/api/sales/${sale2Id}/refund`).send({
      refund_method: 'CREDIT_REDUCTION',
      items: [{ sale_item_id: sale2ItemId, quantity: 1 }],
      reason: 'Second return'
    });
    expect(ref2Res.status).toBe(201);
    expect(ref2Res.body.credit_reduced).toBe(50.000);

    // Fetch statement
    const statement = await request(app).get(`/api/customers/${customerId}/statement`);
    expect(statement.status).toBe(200);

    // Summary final_balance:
    // Sale 1 (100) - Refund 1 (50) - Pay (20) = 30 DT
    // Sale 2 (50) - Refund 2 (50) = 0 DT
    // Total remaining debt = 30 DT
    expect(statement.body.debt.final_balance).toBe(30.000);

    // Under old code, debt.entries omitted credit_reduced refunds, so running_balance ended at 130 DT!
    const entries = statement.body.debt.entries;
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.running_balance).toBe(statement.body.debt.final_balance);

    // Check that REFUND_CREDIT entries exist with credit > 0
    const refundCreditEntries = entries.filter((e: any) => e.entry_type === 'REFUND_CREDIT');
    expect(refundCreditEntries).toHaveLength(2);
    expect(refundCreditEntries[0].credit).toBe(50.000);
    expect(refundCreditEntries[1].credit).toBe(50.000);

    resetTestDb();
  });
});
