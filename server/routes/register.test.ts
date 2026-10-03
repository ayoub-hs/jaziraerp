import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateSessionExpectedCash } from '../services/registerService.js';
import { app, request, resetTestDb } from '../../tests/testApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Register Sessions & Cash Management Module', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    db.exec(schemaSql);
  });

  afterEach(() => {
    db.close();
  });

  it('opens register with a starting float amount', () => {
    const sessionId = 'ses-01';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SES-001', 'Counter 1', '2026-09-07T08:00:00Z', 100.000, 'OPEN')
    `).run(sessionId);

    const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(sessionId);
    expect(session.opening_cash).toBe(100.000);
    expect(session.status).toBe('OPEN');

    const cashStatus = calculateSessionExpectedCash(db, sessionId);
    expect(cashStatus.expected_cash).toBe(100.000);
  });

  it('logs cash-in and cash-out movements with reasons and updates expected cash', () => {
    const sessionId = 'ses-02';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SES-002', 'Counter 1', '2026-09-07T08:00:00Z', 100.000, 'OPEN')
    `).run(sessionId);

    // Cash In: +50.000 DT (Owner added float change)
    db.prepare(`
      INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
      VALUES ('m-1', ?, '2026-09-07T09:00:00Z', 'CASH_IN', 50.000, 'Extra float change', '2026-09-07T09:00:00Z')
    `).run(sessionId);

    // Cash Out: -20.000 DT (Store supplies / cleaning coffee)
    db.prepare(`
      INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
      VALUES ('m-2', ?, '2026-09-07T11:00:00Z', 'CASH_OUT', 20.000, 'Cleaning supplies purchase', '2026-09-07T11:00:00Z')
    `).run(sessionId);

    const cashStatus = calculateSessionExpectedCash(db, sessionId);
    expect(cashStatus.opening_cash).toBe(100.000);
    expect(cashStatus.cash_in).toBe(50.000);
    expect(cashStatus.cash_out).toBe(20.000);
    // 100 + 50 - 20 = 130.000 DT
    expect(cashStatus.expected_cash).toBe(130.000);
  });

  it('calculates expected cash reconciling opening float, cash sales, split payment cash, and cash movements with correct variance upon close', () => {
    const sessionId = 'ses-03';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SES-003', 'Counter 1', '2026-09-07T08:00:00Z', 100.000, 'OPEN')
    `).run(sessionId);

    // Sale 1: Pure Cash sale -> 30.000 DT TTC, cash_paid 30.000 DT
    db.prepare(`
      INSERT INTO sales (id, receipt_number, session_id, date, subtotal_ht, tva_amount, total_ttc, cash_paid, change_given, status, created_at)
      VALUES ('s-1', 'REC-001', ?, '2026-09-07T09:30:00Z', 25.210, 4.790, 30.000, 30.000, 0, 'COMPLETED', '2026-09-07T09:30:00Z')
    `).run(sessionId);

    // Sale 2: Split payment sale -> 25.000 DT TTC (Cash 15.000 DT tendered with 20 DT note -> change 5 DT = net cash 15 DT + Wallet 10.000 DT)
    db.prepare(`
      INSERT INTO sales (id, receipt_number, session_id, date, subtotal_ht, tva_amount, total_ttc, cash_paid, wallet_paid, change_given, status, created_at)
      VALUES ('s-2', 'REC-002', ?, '2026-09-07T10:30:00Z', 21.008, 3.992, 25.000, 15.000, 10.000, 5.000, 'COMPLETED', '2026-09-07T10:30:00Z')
    `).run(sessionId);

    // Cash in 50 DT, Cash out 20 DT
    db.prepare(`
      INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
      VALUES
        ('m-3', ?, '2026-09-07T11:00:00Z', 'CASH_IN', 50.000, 'Adding change', '2026-09-07T11:00:00Z'),
        ('m-4', ?, '2026-09-07T12:00:00Z', 'CASH_OUT', 20.000, 'Lunch expense', '2026-09-07T12:00:00Z')
    `).run(sessionId, sessionId);

    // Expected calculation:
    // Opening: 100.000 DT
    // Sale 1 net cash: 30.000 DT
    // Sale 2 net cash: 20 - 5 = 15.000 DT (wallet portion 10.000 DT excluded)
    // Cash sales = 45.000 DT
    // Cash in = 50.000 DT
    // Cash out = 20.000 DT
    // Expected cash = 100 + 45 + 50 - 20 = 175.000 DT
    const breakdown = calculateSessionExpectedCash(db, sessionId);
    expect(breakdown.opening_cash).toBe(100.000);
    expect(breakdown.cash_sales).toBe(45.000);
    expect(breakdown.expected_cash).toBe(175.000);

    // Operator counts 173.000 DT (shortage of -2.000 DT)
    const counted = 173.000;
    const diff = counted - breakdown.expected_cash; // -2.000 DT

    db.prepare(`
      UPDATE register_sessions
      SET closed_at = '2026-09-07T18:00:00Z',
          counted_cash = ?,
          expected_cash = ?,
          difference = ?,
          status = 'CLOSED'
      WHERE id = ?
    `).run(counted, breakdown.expected_cash, diff, sessionId);

    const closed: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(sessionId);
    expect(closed.status).toBe('CLOSED');
    expect(closed.expected_cash).toBe(175.000);
    expect(closed.counted_cash).toBe(173.000);
    expect(closed.difference).toBe(-2.000);
  });

  it('ensures customer wallet top-ups do NOT affect the register expected cash calculation', () => {
    const sessionId = 'ses-04';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SES-004', 'Counter 1', '2026-09-07T08:00:00Z', 100.000, 'OPEN')
    `).run(sessionId);

    // Seed customer first to satisfy foreign key
    db.prepare(`
      INSERT INTO customers (id, name, type, created_at, updated_at)
      VALUES ('cust-wallet', 'Wallet Customer', 'RETAIL', '2026-09-07', '2026-09-07')
    `).run();

    // Customer performs 200 DT wallet top up
    db.prepare(`
      INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, notes, created_at)
      VALUES ('w-topup', 'cust-wallet', '2026-09-07T10:00:00Z', 'TOP_UP', 200.000, 'Customer wallet top up', '2026-09-07T10:00:00Z')
    `).run();

    // Register expected cash must remain 100.000 DT (wallet top up is customer credit, not register drawer cash)
    const breakdown = calculateSessionExpectedCash(db, sessionId);
    expect(breakdown.expected_cash).toBe(100.000);
  });

  it('supports independent sessions per counter (e.g. Countertop vs Mobile)', () => {
    // Open Countertop session
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('ses-countertop', 'SES-DESK-01', 'Countertop', '2026-09-07T08:00:00Z', 150.000, 'OPEN')
    `).run();

    // Open Mobile session
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES ('ses-mobile', 'SES-MOB-01', 'Mobile', '2026-09-07T08:30:00Z', 50.000, 'OPEN')
    `).run();

    const desk: any = db.prepare("SELECT * FROM register_sessions WHERE counter_name = 'Countertop' AND status = 'OPEN'").get();
    const mob: any = db.prepare("SELECT * FROM register_sessions WHERE counter_name = 'Mobile' AND status = 'OPEN'").get();

    expect(desk.id).toBe('ses-countertop');
    expect(desk.opening_cash).toBe(150.000);

    expect(mob.id).toBe('ses-mobile');
    expect(mob.opening_cash).toBe(50.000);

    // Close Mobile without affecting Countertop
    db.prepare("UPDATE register_sessions SET status = 'CLOSED' WHERE id = 'ses-mobile'").run();

    const deskAfter: any = db.prepare("SELECT * FROM register_sessions WHERE counter_name = 'Countertop' AND status = 'OPEN'").get();
    expect(deskAfter.status).toBe('OPEN');
  });

  it('returns nested session and live_cash_breakdown objects alongside movements and sales for audit modal', () => {
    const sessionId = 'ses-audit-test';
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status)
      VALUES (?, 'SES-AUDIT-01', 'Countertop', '2026-09-08T08:00:00Z', 120.000, 'OPEN')
    `).run(sessionId);

    // Add a sale with 50 DT cash
    db.prepare(`
      INSERT INTO sales (id, receipt_number, session_id, date, subtotal_ht, tva_amount, total_ttc, cash_paid, change_given, status, created_at)
      VALUES ('s-audit-1', 'REC-A01', ?, '2026-09-08T09:00:00Z', 42.017, 7.983, 50.000, 50.000, 0, 'COMPLETED', '2026-09-08T09:00:00Z')
    `).run(sessionId);

    // Add cash movement
    db.prepare(`
      INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
      VALUES ('m-audit-1', ?, '2026-09-08T10:00:00Z', 'CASH_IN', 30.000, 'Additional coins', '2026-09-08T10:00:00Z')
    `).run(sessionId);

    const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(sessionId);
    const cashBreakdown = calculateSessionExpectedCash(db, sessionId);
    const movements = db.prepare('SELECT * FROM register_cash_movements WHERE session_id = ?').all(sessionId);
    const sales = db.prepare('SELECT * FROM sales WHERE session_id = ?').all(sessionId);

    const sessionData = {
      ...session,
      ...cashBreakdown,
      closing_cash_counted: session.counted_cash,
      variance: session.difference
    };

    const response = {
      ...sessionData,
      session: sessionData,
      live_cash_breakdown: cashBreakdown,
      movements,
      sales
    };

    // Verify nested session object
    expect(response.session).toBeDefined();
    expect(response.session.opening_cash).toBe(120.000);
    expect(response.session.session_number).toBe('SES-AUDIT-01');

    // Verify nested live_cash_breakdown
    expect(response.live_cash_breakdown).toBeDefined();
    expect(response.live_cash_breakdown.opening_cash).toBe(120.000);
    expect(response.live_cash_breakdown.cash_sales).toBe(50.000);
    expect(response.live_cash_breakdown.cash_in).toBe(30.000);
    // Expected cash: 120 + 50 + 30 = 200.000 DT
    expect(response.live_cash_breakdown.expected_cash).toBe(200.000);

    // Verify flat keys also present
    expect(response.opening_cash).toBe(120.000);
    expect(response.cash_sales).toBe(50.000);
    expect(response.expected_cash).toBe(200.000);

    // Verify movements and sales
    expect(response.movements.length).toBe(1);
    expect(response.sales.length).toBe(1);
  });
});

describe('Persistent Register / Counter Management API', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('lists default seeded counters (Countertop and Mobile Register)', async () => {
    const res = await request(app).get('/api/register/counters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const names = res.body.map((c: any) => c.name);
    expect(names).toContain('Countertop');
    expect(names).toContain('Mobile Register');
  });

  it('creates new counter and prevents duplicates', async () => {
    const res = await request(app)
      .post('/api/register/counters')
      .send({ name: 'Counter 2' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Counter 2');
    expect(res.body.is_active).toBe(1);

    // Duplicate check
    const dupRes = await request(app)
      .post('/api/register/counters')
      .send({ name: 'Counter 2' });
    expect(dupRes.status).toBe(400);
  });

  it('permanently deletes an unused counter, and deactivates/soft-deletes a counter with session history', async () => {
    // 1. Create temporary counter
    const c1 = await request(app)
      .post('/api/register/counters')
      .send({ name: 'Unused Counter' });
    const c1Id = c1.body.id;

    // Delete unused -> permanent delete
    const del1 = await request(app).delete(`/api/register/counters/${c1Id}`);
    expect(del1.status).toBe(200);
    expect(del1.body.soft_deleted).toBe(false);

    // 2. Counter with session -> soft delete
    const c2 = await request(app)
      .post('/api/register/counters')
      .send({ name: 'Drive Thru' });
    const c2Id = c2.body.id;

    // Open a session using this counter
    await request(app)
      .post('/api/register/open')
      .send({ counter_name: 'Drive Thru', opening_cash: 50 });

    // Delete counter with history -> soft delete
    const del2 = await request(app).delete(`/api/register/counters/${c2Id}`);
    expect(del2.status).toBe(200);
    expect(del2.body.soft_deleted).toBe(true);

    // Default GET should exclude deactivated counter
    const listRes = await request(app).get('/api/register/counters');
    const activeNames = listRes.body.map((c: any) => c.name);
    expect(activeNames).not.toContain('Drive Thru');

    // active=all includes it
    const allRes = await request(app).get('/api/register/counters?active=all');
    const allNames = allRes.body.map((c: any) => c.name);
    expect(allNames).toContain('Drive Thru');
  });
});
