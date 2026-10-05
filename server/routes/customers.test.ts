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
    const walletLines = statement.body.filter((l: any) => l.entry_type === 'WALLET');
    const ledgerBalance = walletLines.reduce((sum: number, l: any) => sum + (l.credit || 0) - (l.debit || 0), 0);
    expect(Math.round(ledgerBalance * 1000) / 1000).toBe(res.body.wallet_balance);

    // No register cash movement was created
    const movements: any[] = getDb().prepare('SELECT * FROM register_cash_movements').all();
    expect(movements).toHaveLength(0);
    resetTestDb();
  });
});
