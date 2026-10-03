import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { allocateCustomerPayment, isTicketOverdue } from '../services/debtService.js';

export const customersRouter = Router();

// GET /api/customers - list all customers with debt, wallet balance, and overdue indicators
customersRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { search, type, active = '1' } = req.query;

  let query = `SELECT * FROM customers WHERE 1=1`;
  const params: any[] = [];

  if (active === '1') {
    query += ` AND (active = 1 OR active IS NULL)`;
  }

  if (type) {
    query += ` AND type = ?`;
    params.push(String(type));
  }

  if (search) {
    query += ` AND (LOWER(name) LIKE LOWER(?) OR LOWER(phone) LIKE LOWER(?))`;
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY name ASC`;

  const customers: any[] = db.prepare(query).all(...params);

  const enriched = customers.map((c) => {
    const debtSummary: any = db.prepare(`
      SELECT
        COALESCE(SUM(remaining_amount), 0) as total_debt,
        COUNT(*) as open_ticket_count
      FROM customer_debt_tickets
      WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    `).get(c.id);

    const oldestTicket: any = db.prepare(`
      SELECT date FROM customer_debt_tickets
      WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
      ORDER BY date ASC LIMIT 1
    `).get(c.id);

    const hasOverdue = oldestTicket ? isTicketOverdue(oldestTicket.date, 30) : false;

    return {
      ...c,
      total_debt: round3(debtSummary?.total_debt || 0),
      open_ticket_count: debtSummary?.open_ticket_count || 0,
      has_overdue_tickets: hasOverdue
    };
  });

  res.json(enriched);
});

// GET /api/customers/:id - customer details
customersRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);

  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const debtSummary: any = db.prepare(`
    SELECT
      COALESCE(SUM(remaining_amount), 0) as total_debt,
      COUNT(*) as open_ticket_count
    FROM customer_debt_tickets
    WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
  `).get(customer.id);

  const debtTickets = db.prepare(`
    SELECT * FROM customer_debt_tickets
    WHERE customer_id = ?
    ORDER BY date ASC, created_at ASC
  `).all(customer.id);

  res.json({
    ...customer,
    total_debt: round3(debtSummary?.total_debt || 0),
    open_ticket_count: debtSummary?.open_ticket_count || 0,
    debt_tickets: debtTickets
  });
});

// POST /api/customers - create customer
customersRouter.post('/', (req: Request, res: Response) => {
  const {
    name,
    phone = null,
    address = null,
    type = 'RETAIL',
    reseller_discount_percent = 0,
    wallet_balance = 0
  } = req.body;

  if (!name || !type) {
    res.status(400).json({ error: 'Name and type (RETAIL, WHOLESALE, RESSELER) are required.' });
    return;
  }

  const validTypes = ['RETAIL', 'WHOLESALE', 'RESELLER'];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: 'Invalid customer type' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const discount = Math.max(0, Math.min(100, Number(reseller_discount_percent) || 0));
  const wallet = round3(Number(wallet_balance) || 0);

  db.prepare(`
    INSERT INTO customers (id, name, phone, address, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), phone, address, type, discount, wallet, now, now);

  const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PUT /api/customers/:id - update customer info
customersRouter.put('/:id', (req: Request, res: Response) => {
  const { name, phone, address, type, reseller_discount_percent } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE customers
    SET name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        type = COALESCE(?, type),
        reseller_discount_percent = COALESCE(?, reseller_discount_percent),
        updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    phone !== undefined ? phone : null,
    address !== undefined ? address : null,
    type !== undefined ? type : null,
    reseller_discount_percent !== undefined ? Number(reseller_discount_percent) : null,
    now,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// GET /api/customers/:id/tickets - list customer debt tickets
customersRouter.get('/:id/tickets', (req: Request, res: Response) => {
  const db = getDb();
  const { status = 'OPEN' } = req.query;

  let query = `SELECT * FROM customer_debt_tickets WHERE customer_id = ?`;
  const params: any[] = [req.params.id];

  if (status === 'OPEN') {
    query += ` AND status IN ('UNPAID', 'PARTIALLY_PAID')`;
  } else if (status === 'PAID') {
    query += ` AND status = 'PAID'`;
  }

  query += ` ORDER BY date ASC, created_at ASC`;

  const tickets: any[] = db.prepare(query).all(...params);

  const enriched = tickets.map((t) => {
    const diffMs = Date.now() - new Date(t.date).getTime();
    const ageDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    const isOverdue = t.status !== 'PAID' && ageDays >= 30;

    return {
      ...t,
      age_days: ageDays,
      is_overdue: isOverdue
    };
  });

  res.json(enriched);
});

// Handler for customer debt payments
const handleCustomerPayment = (req: Request, res: Response) => {
  const { amount, payment_method = 'Cash', notes = '', date } = req.body;

  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    return;
  }

  const db = getDb();
  try {
    const result = allocateCustomerPayment(db, {
      customerId: req.params.id,
      amount: Number(amount),
      paymentMethod: payment_method,
      notes,
      date
    });
    res.status(200).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// POST /api/customers/:id/payments & /debt/repay & /pay-debt - record debt payment (FIFO allocation)
customersRouter.post('/:id/payments', handleCustomerPayment);
customersRouter.post('/:id/debt/repay', handleCustomerPayment);
customersRouter.post('/:id/pay-debt', handleCustomerPayment);

// Handler for wallet top up
const handleWalletTopUp = (req: Request, res: Response) => {
  const { amount, notes = '', date = new Date().toISOString() } = req.body;

  const topUpAmount = round3(Number(amount) || 0);
  if (topUpAmount <= 0) {
    res.status(400).json({ error: 'Top up amount must be greater than zero.' });
    return;
  }

  const db = getDb();
  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  const now = new Date().toISOString();
  const txId = crypto.randomUUID();

  const topUpTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, notes, created_at)
      VALUES (?, ?, ?, 'TOP_UP', ?, ?, ?)
    `).run(txId, req.params.id, date, topUpAmount, notes, now);

    db.prepare(`
      UPDATE customers
      SET wallet_balance = wallet_balance + ?,
          updated_at = ?
      WHERE id = ?
    `).run(topUpAmount, now, req.params.id);
  });

  topUpTx();

  const updated: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(req.params.id);
  res.status(201).json({
    transaction_id: txId,
    customer_id: req.params.id,
    top_up_amount: topUpAmount,
    new_wallet_balance: updated.wallet_balance
  });
};

// POST /api/customers/:id/wallet/top-up & /wallet-topup - add store credit to wallet
customersRouter.post('/:id/wallet/top-up', handleWalletTopUp);
customersRouter.post('/:id/wallet-topup', handleWalletTopUp);

// GET /api/customers/:id/statement - transaction ledger history
customersRouter.get('/:id/statement', (req: Request, res: Response) => {
  const db = getDb();

  // Fetch tickets
  const tickets: any[] = db.prepare(`
    SELECT id, 'TICKET' as entry_type, ticket_number as reference, date, total_amount as debit, 0 as credit, status, created_at
    FROM customer_debt_tickets
    WHERE customer_id = ?
  `).all(req.params.id);

  // Fetch payments
  const payments: any[] = db.prepare(`
    SELECT id, 'PAYMENT' as entry_type, payment_method as reference, date, 0 as debit, amount as credit, notes as status, created_at
    FROM customer_payments
    WHERE customer_id = ?
  `).all(req.params.id);

  // Fetch wallet txs
  const walletTxs: any[] = db.prepare(`
    SELECT id, 'WALLET' as entry_type, type as reference, date,
      CASE WHEN type IN ('TOP_UP', 'OVERPAYMENT_DEPOSIT', 'REFUND_CREDIT') THEN amount ELSE 0 END as credit,
      CASE WHEN type = 'SALE_PAYMENT' THEN amount ELSE 0 END as debit,
      notes as status, created_at
    FROM customer_wallet_transactions
    WHERE customer_id = ?
  `).all(req.params.id);

  const combined = [...tickets, ...payments, ...walletTxs].sort((a, b) => {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  res.json(combined);
});

// DELETE /api/customers/:id - delete or soft-delete customer
customersRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }

  // Check references: sales, customer_debt_tickets, customer_container_loans
  const hasSales: any = db.prepare('SELECT COUNT(*) as count FROM sales WHERE customer_id = ?').get(req.params.id);
  const hasTickets: any = db.prepare('SELECT COUNT(*) as count FROM customer_debt_tickets WHERE customer_id = ?').get(req.params.id);
  const hasLoans: any = db.prepare('SELECT COUNT(*) as count FROM customer_container_loans WHERE customer_id = ?').get(req.params.id);

  const isReferenced = (hasSales?.count > 0) || (hasTickets?.count > 0) || (hasLoans?.count > 0);

  if (isReferenced) {
    db.prepare('UPDATE customers SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
    res.json({ success: true, soft_deleted: true, id: req.params.id, message: 'Customer deactivated (preserved in sales & debt history)' });
  } else {
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Customer deleted permanently' });
  }
});
