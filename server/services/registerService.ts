import { round3, addMoney, subtractMoney } from '../utils/money.js';

export interface SessionCashBreakdown {
  session_id: string;
  opening_cash: number;
  cash_sales: number;
  cash_refunds: number;
  net_sales_cash: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
}

/**
 * Calculates expected cash for a register session.
 * Formula: Opening + Cash from Sales (including cash split portions minus change given)
 *         - Cash Refunds + Cash In - Cash Out
 * Note: Customer wallet top-ups are explicitly excluded from register cash tracking per spec.
 */
export function calculateSessionExpectedCash(db: any, sessionId: string): SessionCashBreakdown {
  const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(sessionId);
  if (!session) {
    throw new Error(`Register session not found: ${sessionId}`);
  }

  const openingCash = round3(session.opening_cash || 0);

  // 1. Cash received from sales (cash_paid is net applied cash)
  const salesCashRow: any = db.prepare(`
    SELECT COALESCE(SUM(cash_paid), 0) as total_cash_sales
    FROM sales
    WHERE session_id = ?
  `).get(sessionId);
  const cashSales = round3(salesCashRow?.total_cash_sales || 0);

  // 2. Cash paid out in refunds processed during this session
  const refundsCashRow: any = db.prepare(`
    SELECT COALESCE(SUM(cash_refunded), 0) as total_cash_refunds
    FROM refunds
    WHERE session_id = ?
  `).get(sessionId);
  const cashRefunds = round3(refundsCashRow?.total_cash_refunds || 0);

  const netSalesCash = subtractMoney(cashSales, cashRefunds);

  // 3. Cash In movements
  const cashInRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_cash_in
    FROM register_cash_movements
    WHERE session_id = ? AND type = 'CASH_IN'
  `).get(sessionId);
  const cashIn = round3(cashInRow?.total_cash_in || 0);

  // 4. Cash Out movements
  const cashOutRow: any = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_cash_out
    FROM register_cash_movements
    WHERE session_id = ? AND type = 'CASH_OUT'
  `).get(sessionId);
  const cashOut = round3(cashOutRow?.total_cash_out || 0);

  // Expected cash = Opening + Net Sales Cash + Cash In - Cash Out
  const expectedCash = round3(openingCash + netSalesCash + cashIn - cashOut);

  return {
    session_id: sessionId,
    opening_cash: openingCash,
    cash_sales: cashSales,
    cash_refunds: cashRefunds,
    net_sales_cash: netSalesCash,
    cash_in: cashIn,
    cash_out: cashOut,
    expected_cash: expectedCash
  };
}
