import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, isUniqueViolation } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { calculateSessionExpectedCash } from '../services/registerService.js';
import { businessDateKey } from '../utils/businessDate.js';

export const registerRouter = Router();

function generateSessionNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `SES-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM register_sessions WHERE session_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// ==========================================
// Counters / Registers Management
// ==========================================

// GET /api/register/counters - list all counters
registerRouter.get('/counters', (req: Request, res: Response) => {
  const db = getDb();
  const activeOnly = req.query.active !== 'all';
  let query = 'SELECT * FROM counters';
  if (activeOnly) {
    query += ' WHERE is_active = 1';
  }
  query += ' ORDER BY name ASC';
  const counters = db.prepare(query).all();
  res.json(counters);
});

// POST /api/register/counters - create or reactivate counter
registerRouter.post('/counters', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Counter name is required.' });
    return;
  }
  const cleanName = name.trim();
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM counters WHERE LOWER(name) = LOWER(?)').get(cleanName);
  if (existing) {
    if (!existing.is_active) {
      db.prepare('UPDATE counters SET is_active = 1 WHERE id = ?').run(existing.id);
      const reactivated = db.prepare('SELECT * FROM counters WHERE id = ?').get(existing.id);
      res.status(200).json(reactivated);
      return;
    }
    res.status(400).json({ error: `Counter "${cleanName}" already exists.` });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO counters (id, name, is_active, created_at) VALUES (?, ?, 1, ?)').run(id, cleanName, now);
  const created = db.prepare('SELECT * FROM counters WHERE id = ?').get(id);
  res.status(201).json(created);
});

// DELETE /api/register/counters/:id - delete or deactivate counter
registerRouter.delete('/counters/:id', (req: Request, res: Response) => {
  const db = getDb();
  const counter: any = db.prepare('SELECT * FROM counters WHERE id = ?').get(req.params.id);
  if (!counter) {
    res.status(404).json({ error: 'Counter not found.' });
    return;
  }

  const sessionRef: any = db.prepare('SELECT COUNT(*) as count FROM register_sessions WHERE counter_name = ?').get(counter.name);
  if (sessionRef && sessionRef.count > 0) {
    db.prepare('UPDATE counters SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ message: `Counter "${counter.name}" deactivated because it has past sessions.`, soft_deleted: true });
    return;
  }

  db.prepare('DELETE FROM counters WHERE id = ?').run(req.params.id);
  res.json({ message: `Counter "${counter.name}" permanently deleted.`, soft_deleted: false });
});

// GET /api/register/current - get currently open session for counter
registerRouter.get('/current', (req: Request, res: Response) => {
  const db = getDb();
  const counterName = String(req.query.counter_name || 'Countertop');

  const session: any = db.prepare(`
    SELECT * FROM register_sessions
    WHERE counter_name = ? AND status = 'OPEN'
    ORDER BY opened_at DESC LIMIT 1
  `).get(counterName);

  if (!session) {
    res.json({ active_session: null });
    return;
  }

  const cashBreakdown = calculateSessionExpectedCash(db, session.id);
  res.json({
    active_session: {
      ...session,
      ...cashBreakdown
    },
    ...session,
    ...cashBreakdown
  });
});

// GET /api/register/open-sessions - list all currently open register sessions
registerRouter.get('/open-sessions', (req: Request, res: Response) => {
  const db = getDb();
  const sessions: any[] = db.prepare(`
    SELECT * FROM register_sessions
    WHERE status = 'OPEN'
    ORDER BY opened_at DESC
  `).all();

  const enriched = sessions.map(s => {
    const cashBreakdown = calculateSessionExpectedCash(db, s.id);
    return {
      ...s,
      ...cashBreakdown
    };
  });

  res.json(enriched);
});

// GET /api/register/active - get any active open session directly (optional ?counter_name filter)
registerRouter.get('/active', (req: Request, res: Response) => {
  const db = getDb();
  const counterName = req.query.counter_name ? String(req.query.counter_name) : null;

  let session: any;
  if (counterName) {
    session = db.prepare(`
      SELECT * FROM register_sessions
      WHERE status = 'OPEN' AND counter_name = ?
      ORDER BY opened_at DESC LIMIT 1
    `).get(counterName);
  } else {
    session = db.prepare(`
      SELECT * FROM register_sessions
      WHERE status = 'OPEN'
      ORDER BY opened_at DESC LIMIT 1
    `).get();
  }

  if (!session) {
    res.status(404).json({ error: 'No active session' });
    return;
  }

  const cashBreakdown = calculateSessionExpectedCash(db, session.id);
  res.json({
    ...session,
    ...cashBreakdown
  });
});

// POST /api/register/open - open a new register session
registerRouter.post('/open', (req: Request, res: Response) => {
  const { counter_name = 'Countertop', opening_cash = 0, notes = '' } = req.body;
  const db = getDb();

  // Check if counter already has an open session
  const existing: any = db.prepare(`
    SELECT id FROM register_sessions WHERE counter_name = ? AND status = 'OPEN'
  `).get(counter_name);

  if (existing) {
    res.status(400).json({
      error: `Counter "${counter_name}" already has an open session (ID: ${existing.id}). Close it first.`
    });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const floatCash = round3(Number(opening_cash) || 0);

  // The partial unique index idx_one_open_session_per_counter makes the
  // check-then-insert above atomic: a concurrent open for the same counter
  // fails here and maps to the same 400 instead of a 500.
  let sessionNumber = generateSessionNumber(db);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      db.prepare(`
        INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status, notes)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
      `).run(id, sessionNumber, counter_name, now, floatCash, notes);
      break;
    } catch (err: any) {
      if (!isUniqueViolation(err)) throw err;
      const clash: any = db.prepare(`
        SELECT id FROM register_sessions WHERE counter_name = ? AND status = 'OPEN' AND id != ?
      `).get(counter_name, id);
      if (clash) {
        res.status(400).json({
          error: `Counter "${counter_name}" already has an open session (ID: ${clash.id}). Close it first.`
        });
        return;
      }
      // Session-number clash: regenerate and retry.
      sessionNumber = generateSessionNumber(db);
      if (attempt === 2) throw err;
    }
  }

  const created: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(id);
  res.status(201).json(created);
});

// Handler for cash movement
const handleCashMovement = (req: Request, res: Response) => {
  const { session_id, type, amount, reason, date = new Date().toISOString() } = req.body;

  if (!session_id || !type || !amount || !reason) {
    res.status(400).json({ error: 'session_id, type (CASH_IN/CASH_OUT), amount, and reason are required.' });
    return;
  }

  if (type !== 'CASH_IN' && type !== 'CASH_OUT') {
    res.status(400).json({ error: 'type must be CASH_IN or CASH_OUT' });
    return;
  }

  const movementAmount = round3(Number(amount));
  if (movementAmount <= 0) {
    res.status(400).json({ error: 'amount must be greater than zero' });
    return;
  }

  const db = getDb();
  const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(session_id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (session.status !== 'OPEN') {
    res.status(400).json({ error: 'Cannot log cash movements on a closed session' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, session_id, date, type, movementAmount, reason.trim(), now);

  const created = db.prepare('SELECT * FROM register_cash_movements WHERE id = ?').get(id);
  const updatedCash = calculateSessionExpectedCash(db, session_id);

  res.status(201).json({
    movement: created,
    live_cash_status: updatedCash
  });
};

// POST /api/register/movement & /cash-movement - log cash in or cash out during session
registerRouter.post('/movement', handleCashMovement);
registerRouter.post('/cash-movement', handleCashMovement);

// POST /api/register/close - close register session with counted cash audit
registerRouter.post('/close', (req: Request, res: Response) => {
  const { notes = '' } = req.body;
  const session_id = req.body.session_id || req.body.sessionId;
  const counted_cash = req.body.counted_cash !== undefined
    ? req.body.counted_cash
    : req.body.closing_cash_counted;

  if (!session_id || counted_cash === undefined || counted_cash === null) {
    res.status(400).json({ error: 'session_id and counted_cash are required.' });
    return;
  }

  const db = getDb();
  const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(session_id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (session.status !== 'OPEN') {
    res.status(400).json({ error: 'Session is already closed' });
    return;
  }

  const cashAudit = calculateSessionExpectedCash(db, session_id);
  const countedRaw = Number(counted_cash);
  if (!Number.isFinite(countedRaw) || countedRaw < 0) {
    res.status(400).json({ error: 'counted_cash must be a finite non-negative number' });
    return;
  }
  const counted = round3(countedRaw);
  const difference = round3(counted - cashAudit.expected_cash);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE register_sessions
    SET closed_at = ?,
        counted_cash = ?,
        expected_cash = ?,
        difference = ?,
        status = 'CLOSED',
        notes = CASE WHEN ? != '' THEN ? ELSE notes END
    WHERE id = ?
  `).run(
    now,
    counted,
    cashAudit.expected_cash,
    difference,
    notes,
    notes,
    session_id
  );

  const closedSession = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(session_id) as any;
  res.json({
    ...closedSession,
    audit_breakdown: cashAudit
  });
});

// GET /api/register/sessions - list all register sessions history
registerRouter.get('/sessions', (req: Request, res: Response) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT rs.*,
      (SELECT COUNT(*) FROM register_cash_movements rcm WHERE rcm.session_id = rs.id) as movement_count,
      (SELECT COUNT(*) FROM sales s WHERE s.session_id = rs.id) as sale_count,
      (SELECT COALESCE(SUM(total_ttc), 0) FROM sales s WHERE s.session_id = rs.id) as sales_total
    FROM register_sessions rs
    ORDER BY rs.opened_at DESC
  `).all();

  res.json(sessions);
});

// GET /api/register/sessions/:id & /session/:id - get session details with movements and live cash breakdown
const handleGetSessionById = (req: Request, res: Response) => {
  const db = getDb();
  const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const cashBreakdown = calculateSessionExpectedCash(db, session.id);

  const movements = db.prepare(`
    SELECT * FROM register_cash_movements WHERE session_id = ? ORDER BY date ASC
  `).all(req.params.id);

  const sales = db.prepare(`
    SELECT id, receipt_number, date, total_ttc, cash_paid, wallet_paid, credit_amount, change_given, status
    FROM sales
    WHERE session_id = ?
    ORDER BY date DESC
  `).all(req.params.id);

  const sessionData = {
    ...session,
    ...cashBreakdown,
    closing_cash_counted: session.counted_cash,
    variance: session.difference
  };

  res.json({
    ...sessionData,
    session: sessionData,
    live_cash_breakdown: cashBreakdown,
    movements,
    sales
  });
};

registerRouter.get('/sessions/:id', handleGetSessionById);
registerRouter.get('/session/:id', handleGetSessionById);
