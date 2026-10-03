import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3, addMoney, subtractMoney, multiplyMoney } from '../utils/money.js';

export const accountingRouter = Router();

// POST /api/accounting/expenses - record general expense (rent, utilities, fuel, etc.)
accountingRouter.post('/expenses', (req: Request, res: Response) => {
  const {
    category,
    amount,
    payment_source = 'REGISTER_CASH', // 'REGISTER_CASH' or 'BANK_OTHER'
    session_id = null,
    description = '',
    date = new Date().toISOString()
  } = req.body;

  if (!category || !amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'category and amount (> 0) are required' });
    return;
  }

  const validSources = ['REGISTER_CASH', 'BANK_OTHER'];
  if (!validSources.includes(payment_source)) {
    res.status(400).json({ error: 'payment_source must be REGISTER_CASH or BANK_OTHER' });
    return;
  }

  const db = getDb();
  const expenseId = crypto.randomUUID();
  const expenseAmount = round3(Number(amount));
  const now = new Date().toISOString();

  const expenseTx = db.transaction(() => {
    // 1. Insert expense record
    db.prepare(`
      INSERT INTO general_expenses (id, date, category, amount, payment_source, session_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      expenseId,
      date,
      category.trim(),
      expenseAmount,
      payment_source,
      session_id || null,
      description ? description.trim() : null,
      now
    );

    // 2. If paid from register cash and session is provided, auto-record CASH_OUT movement
    if (payment_source === 'REGISTER_CASH' && session_id) {
      const session: any = db.prepare('SELECT status FROM register_sessions WHERE id = ?').get(session_id);
      if (session && session.status === 'OPEN') {
        db.prepare(`
          INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
          VALUES (?, ?, ?, 'CASH_OUT', ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          session_id,
          date,
          expenseAmount,
          `Expense: ${category.trim()}${description ? ' - ' + description.trim() : ''}`,
          now
        );
      }
    }
  });

  expenseTx();

  const created = db.prepare('SELECT * FROM general_expenses WHERE id = ?').get(expenseId);
  res.status(201).json(created);
});

// GET /api/accounting/expenses - list expenses
accountingRouter.get('/expenses', (req: Request, res: Response) => {
  const db = getDb();
  const { category, start_date, end_date } = req.query;

  let query = `SELECT * FROM general_expenses WHERE 1=1`;
  const params: any[] = [];

  if (category) {
    query += ` AND LOWER(category) = LOWER(?)`;
    params.push(String(category));
  }

  if (start_date) {
    query += ` AND date(date) >= date(?)`;
    params.push(String(start_date));
  }

  if (end_date) {
    query += ` AND date(date) <= date(?)`;
    params.push(String(end_date));
  }

  query += ` ORDER BY date DESC, created_at DESC`;

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// DELETE /api/accounting/expenses/:id - delete general expense
accountingRouter.delete('/expenses/:id', (req: Request, res: Response) => {
  const db = getDb();
  const exp: any = db.prepare('SELECT * FROM general_expenses WHERE id = ?').get(req.params.id);
  if (!exp) {
    res.status(404).json({ error: 'Expense not found' });
    return;
  }

  db.prepare('DELETE FROM general_expenses WHERE id = ?').run(req.params.id);
  res.json({ success: true, id: req.params.id, message: 'Expense deleted' });
});

// GET /api/accounting/cash-flow - simple cash-flow ledger: Money In vs Money Out
accountingRouter.get('/cash-flow', (req: Request, res: Response) => {
  const db = getDb();
  const { start_date, end_date } = req.query;

  let dateFilter = '';
  const params: any[] = [];

  if (start_date && end_date) {
    dateFilter = ` AND date(date) BETWEEN date(?) AND date(?)`;
    params.push(String(start_date), String(end_date));
  } else if (start_date) {
    dateFilter = ` AND date(date) >= date(?)`;
    params.push(String(start_date));
  } else if (end_date) {
    dateFilter = ` AND date(date) <= date(?)`;
    params.push(String(end_date));
  }

  // --- MONEY IN ---
  // 1. Cash received from sales (cash_paid is net applied cash)
  const salesCashRow: any = db.prepare(`
    SELECT COALESCE(SUM(cash_paid), 0) as total
    FROM sales
    WHERE 1=1 ${dateFilter}
  `).get(...params);
  const salesCashIn = round3(salesCashRow?.total || 0);

  // 2. Customer debt repayments
  const custPaymentsRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM customer_payments
    WHERE 1=1 ${dateFilter}
  `).get(...params);
  const debtPaymentsIn = round3(custPaymentsRow?.total || 0);

  // 3. Customer wallet top-ups
  const walletTopUpsRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM customer_wallet_transactions
    WHERE type = 'TOP_UP' ${dateFilter}
  `).get(...params);
  const walletTopUpsIn = round3(walletTopUpsRow?.total || 0);

  const totalMoneyIn = round3(salesCashIn + debtPaymentsIn + walletTopUpsIn);

  // --- MONEY OUT ---
  // 1. Direct cash purchases
  const cashPurchasesRow: any = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as total
    FROM purchases
    WHERE payment_status = 'PAID' ${dateFilter}
  `).get(...params);
  const purchasesOut = round3(cashPurchasesRow?.total || 0);

  // 2. Supplier debt repayments
  const supplierPaymentsRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM supplier_payments
    WHERE 1=1 ${dateFilter}
  `).get(...params);
  const supplierDebtPaidOut = round3(supplierPaymentsRow?.total || 0);

  // 3. General expenses (rent, utilities, etc.)
  const generalExpensesRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM general_expenses
    WHERE 1=1 ${dateFilter}
  `).get(...params);
  const expensesOut = round3(generalExpensesRow?.total || 0);

  // 4. Cash refunds
  const refundsRow: any = db.prepare(`
    SELECT COALESCE(SUM(cash_refunded), 0) as total
    FROM refunds
    WHERE 1=1 ${dateFilter}
  `).get(...params);
  const cashRefundsOut = round3(refundsRow?.total || 0);

  const totalMoneyOut = round3(purchasesOut + supplierDebtPaidOut + expensesOut + cashRefundsOut);
  const netCashFlow = round3(totalMoneyIn - totalMoneyOut);

  res.json({
    total_inflow: totalMoneyIn,
    total_outflow: totalMoneyOut,
    money_in: {
      sales_cash: salesCashIn,
      customer_debt_repayments: debtPaymentsIn,
      wallet_top_ups: walletTopUpsIn,
      total_in: totalMoneyIn
    },
    money_out: {
      paid_purchases: purchasesOut,
      supplier_debt_repayments: supplierDebtPaidOut,
      general_expenses: expensesOut,
      cash_refunds: cashRefundsOut,
      total_out: totalMoneyOut
    },
    net_cash_flow: netCashFlow
  });
});

// GET /api/accounting/stock-valuation - stock valuation at cost
accountingRouter.get('/stock-valuation', (req: Request, res: Response) => {
  const db = getDb();

  // 1. Raw Materials & Packaging valuation
  const materials: any[] = db.prepare(`
    SELECT id, name, category, unit, stock_quantity, latest_purchase_cost,
      ROUND(stock_quantity * latest_purchase_cost, 3) as line_valuation
    FROM raw_materials
    WHERE stock_quantity > 0
    ORDER BY category ASC, name ASC
  `).all();

  let rawMaterialsTotal = 0;
  for (const m of materials) {
    rawMaterialsTotal = addMoney(rawMaterialsTotal, m.line_valuation || 0);
  }

  // 2. Finished Goods (Products) valuation
  const products: any[] = db.prepare(`
    SELECT p.id, p.name, p.size_label, pf.category, p.stock_quantity, p.cost_reference,
      ROUND(p.stock_quantity * p.cost_reference, 3) as line_valuation
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    WHERE p.stock_quantity > 0 AND p.active = 1
    ORDER BY pf.category ASC, p.name ASC
  `).all();

  let finishedGoodsTotal = 0;
  for (const p of products) {
    finishedGoodsTotal = addMoney(finishedGoodsTotal, p.line_valuation || 0);
  }

  const totalValuation = round3(rawMaterialsTotal + finishedGoodsTotal);

  res.json({
    raw_materials_valuation: rawMaterialsTotal,
    finished_goods_valuation: finishedGoodsTotal,
    total_stock_valuation: totalValuation,
    total_inventory_valuation: totalValuation,
    raw_materials_count: materials.length,
    products_count: products.length,
    materials,
    products
  });
});
