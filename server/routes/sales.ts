import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, isUniqueViolation } from '../db/index.js';
import { round3, addMoney, subtractMoney, toMillimes } from '../utils/money.js';
import { businessDateKey, tunisDayRangeUTC, isFilterDay } from '../utils/businessDate.js';
import { beginIdempotentRequest } from '../utils/idempotency.js';
import { completeRequest } from '../services/idempotencyService.js';
import {
  SaleError,
  createSale,
  generateReceiptNumber,
  generateTicketNumber,
  computeExpectedCatalogPrice
} from '../services/saleService.js';

export {
  SaleError,
  createSale,
  generateReceiptNumber,
  generateTicketNumber,
  computeExpectedCatalogPrice
} from '../services/saleService.js';
export type { CreateSaleInput, CreateSaleItemInput, CreateSaleResult } from '../services/saleService.js';

export const salesRouter = Router();

export function generateDeliveryNoteNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `BL-${dateStr}-`;
  const maxRow: any = db.prepare(`
    SELECT MAX(CAST(SUBSTR(number, ?) AS INTEGER)) as max_seq
    FROM delivery_notes
    WHERE number LIKE ?
  `).get(prefix.length + 1, `${prefix}%`);
  const seq = ((Number(maxRow?.max_seq) || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// GET /api/sales - list sales
salesRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { session_id, customer_id, date, status, search, from, to, from_date, to_date, start_date, end_date } = req.query;

  let query = `
    SELECT s.*, c.name as customer_name, c.type as customer_type,
      rs.session_number, rs.counter_name,
      (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN register_sessions rs ON s.session_id = rs.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (session_id) {
    query += ` AND s.session_id = ?`;
    params.push(String(session_id));
  }

  if (customer_id) {
    query += ` AND s.customer_id = ?`;
    params.push(String(customer_id));
  }

  if (date) {
    // Business-day filter: compare against the Tunis local date via UTC range.
    const day = String(date);
    if (isFilterDay(day)) {
      const range = tunisDayRangeUTC(day);
      query += ` AND s.date >= ? AND s.date < ?`;
      params.push(range.start, range.end);
    } else {
      query += ` AND date(s.date) = date(?)`;
      params.push(day);
    }
  }

  const startDate = from_date || start_date || from;
  if (startDate) {
    const day = String(startDate);
    if (isFilterDay(day)) {
      query += ` AND s.date >= ?`;
      params.push(tunisDayRangeUTC(day).start);
    } else {
      query += ` AND date(s.date) >= date(?)`;
      params.push(day);
    }
  }

  const endDate = to_date || end_date || to;
  if (endDate) {
    const day = String(endDate);
    if (isFilterDay(day)) {
      query += ` AND s.date < ?`;
      params.push(tunisDayRangeUTC(day).end);
    } else {
      query += ` AND date(s.date) <= date(?)`;
      params.push(day);
    }
  }

  if (status) {
    query += ` AND s.status = ?`;
    params.push(String(status));
  }

  if (search) {
    query += ` AND (s.receipt_number LIKE ? OR c.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY s.date DESC, s.created_at DESC`;

  const rawLimit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 25;
  const limit = (!isNaN(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 500) : 25;
  query += ` LIMIT ${limit}`;

  if (req.query.offset !== undefined) {
    const rawOffset = parseInt(String(req.query.offset), 10);
    const offset = (!isNaN(rawOffset) && rawOffset >= 0) ? rawOffset : 0;
    query += ` OFFSET ${offset}`;
  }

  const sales = db.prepare(query).all(...params);
  res.json(sales);
});

// GET /api/sales/:id - get single sale with full receipt & A4 invoice breakdown
salesRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const sale: any = db.prepare(`
    SELECT s.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.type as customer_type,
      rs.session_number
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN register_sessions rs ON s.session_id = rs.id
    WHERE s.id = ? OR s.receipt_number = ?
  `).get(req.params.id, req.params.id);

  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  const items = db.prepare(`
    SELECT si.*, p.name as catalog_product_name, p.size_label, p.barcode as product_barcode,
      pps.pack_label, pps.barcode as pack_barcode
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    LEFT JOIN product_pack_sizes pps ON si.pack_size_id = pps.id
    WHERE si.sale_id = ?
  `).all(sale.id);

  const mappedItems = items.map((si: any) => {
    const isOverridden = (si.catalog_unit_price !== null && si.catalog_unit_price !== undefined)
      ? round3(Number(si.unit_price)) !== round3(Number(si.catalog_unit_price))
      : false;
    return {
      ...si,
      catalog_unit_price: si.catalog_unit_price ?? null,
      overridden: isOverridden,
      name: si.is_quick_add ? si.quick_add_name : (si.catalog_product_name || 'Article'),
      description: si.is_quick_add ? si.quick_add_name : (si.catalog_product_name || 'Article'),
      total_line: si.line_total
    };
  });

  // Shop header details
  const shopNameRow: any = db.prepare("SELECT value FROM settings WHERE key = 'shop_name'").get();
  const shopSubtitleRow: any = db.prepare("SELECT value FROM settings WHERE key = 'shop_subtitle'").get();
  const shopAddressRow: any = db.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
  const shopPhoneRow: any = db.prepare("SELECT value FROM settings WHERE key = 'shop_phone'").get();
  const shopTaxRow: any = db.prepare("SELECT value FROM settings WHERE key = 'tax_id'").get();

  const receiptFormat = {
    shop_name: shopNameRow?.value || 'Société Al Jazira SHSP',
    shop_subtitle: shopSubtitleRow?.value || '',
    shop_address: shopAddressRow?.value || '',
    shop_phone: shopPhoneRow?.value || '',
    shop_tax_id: shopTaxRow?.value || '',
    receipt_number: sale.receipt_number,
    date: sale.date,
    customer_name: sale.customer_name || 'Walk-in Retail Customer',
    items: mappedItems.map((i: any) => ({
      name: i.name,
      description: i.description,
      size_label: i.size_label,
      pack_label: i.pack_label,
      quantity: i.quantity,
      unit_price: i.unit_price,
      catalog_unit_price: i.catalog_unit_price ?? null,
      overridden: i.overridden,
      discount_amount: i.discount_amount || 0,
      line_total: i.line_total,
      total_line: i.line_total
    })),
    subtotal_ht: sale.subtotal_ht,
    tva_rate: '19%',
    tva_amount: sale.tva_amount,
    total_discount: sale.total_discount || 0,
    total_ttc: sale.total_ttc,
    cash_paid: sale.cash_paid,
    change_given: sale.change_given,
    wallet_paid: sale.wallet_paid,
    credit_amount: sale.credit_amount
  };

  const debtTicket = db.prepare(`
    SELECT * FROM customer_debt_tickets WHERE sale_id = ? ORDER BY date DESC LIMIT 1
  `).get(sale.id);

  const deliveryNote = db.prepare(`
    SELECT * FROM delivery_notes WHERE sale_id = ?
  `).get(sale.id);

  res.json({
    ...sale,
    debt_ticket: debtTicket ?? null,
    delivery_note: deliveryNote ?? null,
    items: mappedItems,
    receipt: receiptFormat
  });
});

// POST /api/sales/:id/delivery-note - generate or retrieve persistent delivery note
salesRouter.post('/:id/delivery-note', (req: Request, res: Response) => {
  const db = getDb();
  const sale: any = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  const existing = db.prepare('SELECT * FROM delivery_notes WHERE sale_id = ?').get(sale.id);
  if (existing) {
    res.status(200).json(existing);
    return;
  }

  const now = new Date().toISOString();
  const noteId = `bl-${crypto.randomUUID()}`;
  let noteNumber = generateDeliveryNoteNumber(db);
  let noteCommitted = false;
  let noteRow: any = null;

  for (let attempt = 0; attempt < 3 && !noteCommitted; attempt++) {
    try {
      db.prepare(`
        INSERT INTO delivery_notes (id, sale_id, number, created_at)
        VALUES (?, ?, ?, ?)
      `).run(noteId, sale.id, noteNumber, now);
      noteRow = {
        id: noteId,
        sale_id: sale.id,
        number: noteNumber,
        created_at: now
      };
      noteCommitted = true;
    } catch (err: any) {
      const checkAgain = db.prepare('SELECT * FROM delivery_notes WHERE sale_id = ?').get(sale.id);
      if (checkAgain) {
        res.status(200).json(checkAgain);
        return;
      }
      if (isUniqueViolation(err) && attempt < 2) {
        noteNumber = generateDeliveryNoteNumber(db);
        continue;
      }
      throw err;
    }
  }

  res.status(201).json(noteRow);
});

// GET /api/sales/:id/delivery-note - fetch delivery note for a sale
salesRouter.get('/:id/delivery-note', (req: Request, res: Response) => {
  const db = getDb();
  const sale: any = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  const note = db.prepare('SELECT * FROM delivery_notes WHERE sale_id = ?').get(sale.id);
  if (!note) {
    res.status(404).json({ error: 'Delivery note not found' });
    return;
  }

  res.json(note);
});

// POST /api/sales - process POS checkout with split tender, wallet validation, and drawer kick
salesRouter.post('/', (req: Request, res: Response) => {
  const {
    session_id: directSessionId = null,
    register_session_id = null,
    customer_id = null,
    date = new Date().toISOString(),
    items = [],
    total_discount = 0,
    cash_tendered = undefined,
    cash_paid = 0,
    wallet_paid = 0,
    credit_amount = 0
  } = req.body;

  const rawSessionId = directSessionId || register_session_id || null;

  const db = getDb();
  const idem = beginIdempotentRequest(db, req, res, 'SALE');
  if (idem.kind === 'REPLAYED') return;
  const requestId = idem.kind === 'CLAIMED' ? idem.requestId : null;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' });
    return;
  }

  // Validate Register Session: Register must be open to process a sale
  let session: any = null;
  if (rawSessionId) {
    session = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(rawSessionId);
    if (!session) {
      res.status(400).json({ error: `Session de caisse introuvable: ${rawSessionId}` });
      return;
    }
  } else {
    // If session_id not explicitly sent, check for an active open session
    session = db.prepare("SELECT * FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
  }

  if (!session || session.status !== 'OPEN') {
    res.status(400).json({
      error: 'La caisse est fermée. Une session de caisse ouverte est obligatoire pour finaliser une vente. (Register is closed. An active open register session is required).'
    });
    return;
  }

  try {
    const result = createSale(db, {
      session_id: session.id,
      customer_id,
      date,
      items,
      total_discount,
      cash_paid,
      cash_tendered,
      wallet_paid,
      credit_amount,
      request_id: requestId
    });
    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof SaleError) {
      res.status(err.status).json(err.body);
      return;
    }
    throw err;
  }
});

function generateRefundNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `REF-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM refunds WHERE refund_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// GET /api/sales/:id/refunds - list all refunds for a sale
salesRouter.get('/:id/refunds', (req: Request, res: Response) => {
  const db = getDb();
  const sale: any = db.prepare('SELECT id FROM sales WHERE id = ? OR receipt_number = ?').get(req.params.id, req.params.id);
  const targetSaleId = sale ? sale.id : req.params.id;

  const refunds: any[] = db.prepare(`
    SELECT r.*, rs.session_number
    FROM refunds r
    LEFT JOIN register_sessions rs ON r.session_id = rs.id
    WHERE r.sale_id = ?
    ORDER BY r.date DESC, r.created_at DESC
  `).all(targetSaleId);

  const enriched = refunds.map((r) => {
    const items = db.prepare(`
      SELECT ri.*, si.product_id, si.quick_add_name, p.name as product_name
      FROM refund_items ri
      JOIN sale_items si ON ri.sale_item_id = si.id
      LEFT JOIN products p ON si.product_id = p.id
      WHERE ri.refund_id = ?
    `).all(r.id);

    // Derive refund_method for backwards compatibility
    let derivedMethod = 'CASH';
    const hasCash = (Number(r.cash_refunded) || 0) > 0;
    const hasWallet = (Number(r.wallet_refunded) || 0) > 0;
    const hasCredit = (Number(r.credit_reduced) || 0) > 0;
    const countMethods = (hasCash ? 1 : 0) + (hasWallet ? 1 : 0) + (hasCredit ? 1 : 0);
    if (countMethods > 1) {
      derivedMethod = 'MIXED';
    } else if (hasCredit) {
      derivedMethod = 'CREDIT_REDUCTION';
    } else if (hasWallet) {
      derivedMethod = 'WALLET';
    } else if (hasCash) {
      derivedMethod = 'CASH';
    }

    return {
      ...r,
      refund_amount: r.total_refunded,
      refund_method: r.refund_method || derivedMethod,
      items
    };
  });

  res.json(enriched);
});

export interface RefundCapacities {
  open_debt: number;
  max_cash: number;
  max_wallet: number;
  prior_refunded: number;
  prior_cash: number;
  prior_wallet: number;
  prior_credit: number;
  debt_paid_on_ticket: number;
  actual_paid: number;
}

export interface RefundAllocation {
  credit_reduced: number;
  cash_refunded: number;
  wallet_refunded: number;
}

export function computeRefundCapacities(db: any, sale: any): RefundCapacities {
  const priorRefundsRow: any = db.prepare(`
    SELECT
      COALESCE(SUM(total_refunded), 0) as prior_refunded,
      COALESCE(SUM(cash_refunded), 0) as prior_cash,
      COALESCE(SUM(wallet_refunded), 0) as prior_wallet,
      COALESCE(SUM(credit_reduced), 0) as prior_credit
    FROM refunds
    WHERE sale_id = ?
  `).get(sale.id);

  const priorTotal = round3(Number(priorRefundsRow?.prior_refunded) || 0);
  const priorCash = round3(Number(priorRefundsRow?.prior_cash) || 0);
  const priorWallet = round3(Number(priorRefundsRow?.prior_wallet) || 0);
  const priorCredit = round3(Number(priorRefundsRow?.prior_credit) || 0);

  const targetTicket: any = db.prepare(`
    SELECT * FROM customer_debt_tickets
    WHERE sale_id = ?
  `).get(sale.id);

  let openDebt = 0;
  let debtPaidOnTicket = 0;

  if (targetTicket) {
    if (['UNPAID', 'PARTIALLY_PAID'].includes(targetTicket.status)) {
      openDebt = round3(Number(targetTicket.remaining_amount) || 0);
    }
    const allocRow: any = db.prepare(`
      SELECT COALESCE(SUM(amount_allocated), 0) as debt_paid
      FROM customer_payment_allocations
      WHERE ticket_id = ?
    `).get(targetTicket.id);
    debtPaidOnTicket = round3(Number(allocRow?.debt_paid) || 0);
  }

  const actualPaid = round3((Number(sale.cash_paid) || 0) + (Number(sale.wallet_paid) || 0) + debtPaidOnTicket);
  const priorCashAndWallet = round3(priorCash + priorWallet);
  const maxRefundableMoney = Math.max(0, round3(actualPaid - priorCashAndWallet));

  const maxCash = Math.max(0, round3((Number(sale.cash_paid) || 0) - priorCash));
  const maxWallet = sale.customer_id ? maxRefundableMoney : 0;

  return {
    open_debt: openDebt,
    max_cash: maxCash,
    max_wallet: maxWallet,
    prior_refunded: priorTotal,
    prior_cash: priorCash,
    prior_wallet: priorWallet,
    prior_credit: priorCredit,
    debt_paid_on_ticket: debtPaidOnTicket,
    actual_paid: actualPaid
  };
}

export function suggestRefundAllocation(
  totalRefunded: number,
  capacities: RefundCapacities
): RefundAllocation {
  const creditReduced = Math.min(totalRefunded, capacities.open_debt);
  const remainder = round3(totalRefunded - creditReduced);
  const cashRefunded = Math.min(remainder, capacities.max_cash);
  const remainder2 = round3(remainder - cashRefunded);
  const walletRefunded = Math.min(remainder2, capacities.max_wallet);

  return {
    credit_reduced: round3(creditReduced),
    cash_refunded: round3(cashRefunded),
    wallet_refunded: round3(walletRefunded)
  };
}

export function computeNetLineTotals(allSaleItems: any[], globalDiscount: number): Map<string, number> {
  const subtotal = round3(allSaleItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0));
  const netLineTotals = new Map<string, number>();

  if (globalDiscount <= 0 || subtotal <= 0) {
    for (const item of allSaleItems) {
      netLineTotals.set(item.id, round3(Number(item.line_total) || 0));
    }
  } else {
    let allocatedDiscountSum = 0;
    for (let i = 0; i < allSaleItems.length; i++) {
      const item = allSaleItems[i];
      const lineTotal = round3(Number(item.line_total) || 0);
      let lineDiscount: number;
      if (i === allSaleItems.length - 1) {
        lineDiscount = round3(globalDiscount - allocatedDiscountSum);
      } else {
        lineDiscount = round3(globalDiscount * (lineTotal / subtotal));
        allocatedDiscountSum = addMoney(allocatedDiscountSum, lineDiscount);
      }
      const netLineTotal = Math.max(0, round3(lineTotal - lineDiscount));
      netLineTotals.set(item.id, netLineTotal);
    }
  }

  return netLineTotals;
}

export function calculateRefundItems(
  db: any,
  allSaleItems: any[],
  netLineTotals: Map<string, number>,
  requestedItems: Array<{ sale_item_id: string; quantity: number | string }>
): { totalRefunded: number; processedItems: any[]; error?: string } {
  let totalRefunded = 0;
  const processedItems: any[] = [];
  const seenSaleItemIds = new Set<string>();

  for (const item of requestedItems) {
    if (!item || typeof item !== 'object' || !item.sale_item_id) {
      return { totalRefunded: 0, processedItems: [], error: 'Valid sale_item_id is required for every refund item' };
    }
    if (seenSaleItemIds.has(item.sale_item_id)) {
      return { totalRefunded: 0, processedItems: [], error: `Duplicate sale_item_id in refund request: ${item.sale_item_id}` };
    }
    seenSaleItemIds.add(item.sale_item_id);

    const saleItem = allSaleItems.find(si => si.id === item.sale_item_id);
    if (!saleItem) {
      return { totalRefunded: 0, processedItems: [], error: `Sale line item not found: ${item.sale_item_id}` };
    }

    const qtyToRefund = Number(item.quantity);
    if (!Number.isFinite(qtyToRefund) || qtyToRefund <= 0) {
      return { totalRefunded: 0, processedItems: [], error: `Invalid refund quantity for item ${saleItem.id}: ${item.quantity}` };
    }

    const availableToRefund = saleItem.quantity - (saleItem.quantity_refunded || 0);
    if (qtyToRefund > availableToRefund) {
      return { totalRefunded: 0, processedItems: [], error: `Invalid refund quantity for item ${saleItem.id}. Requested: ${qtyToRefund}, Max available: ${availableToRefund}` };
    }

    if (Number.isInteger(saleItem.quantity) && !Number.isInteger(qtyToRefund)) {
      return { totalRefunded: 0, processedItems: [], error: `Fractional refund quantity (${qtyToRefund}) is not allowed for integer-quantity item ${saleItem.id}` };
    }

    const netLineTotal = netLineTotals.get(saleItem.id) ?? round3(Number(saleItem.line_total) || 0);

    const alreadyRefundedRow: any = db.prepare(`
      SELECT COALESCE(SUM(amount_refunded), 0) as already_refunded
      FROM refund_items
      WHERE sale_item_id = ?
    `).get(saleItem.id);
    const alreadyRefunded = round3(alreadyRefundedRow?.already_refunded || 0);

    let amountRefunded: number;
    if (qtyToRefund === availableToRefund) {
      amountRefunded = Math.max(0, round3(netLineTotal - alreadyRefunded));
    } else {
      const effectiveUnitPrice = netLineTotal / saleItem.quantity;
      amountRefunded = round3(effectiveUnitPrice * qtyToRefund);
      const maxPossibleForLine = Math.max(0, round3(netLineTotal - alreadyRefunded));
      if (amountRefunded > maxPossibleForLine) {
        amountRefunded = maxPossibleForLine;
      }
    }

    if (addMoney(alreadyRefunded, amountRefunded) > netLineTotal) {
      amountRefunded = Math.max(0, round3(netLineTotal - alreadyRefunded));
    }

    totalRefunded = addMoney(totalRefunded, amountRefunded);
    processedItems.push({
      sale_item: saleItem,
      sale_item_id: saleItem.id,
      quantity_refunded: qtyToRefund,
      amount_refunded: amountRefunded,
      stock_to_restore: saleItem.product_id ? qtyToRefund * (saleItem.pack_multiplier || 1) : 0
    });
  }

  return { totalRefunded, processedItems };
}

export function previewRefund(saleId: string, req: Request, res: Response) {
  const db = getDb();
  const sale: any = db.prepare('SELECT * FROM sales WHERE id = ? OR receipt_number = ?').get(saleId, saleId);
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  const allSaleItems: any[] = db.prepare(`
    SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC
  `).all(sale.id);

  const capacities = computeRefundCapacities(db, sale);

  let requestedItems = req.body?.items;
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    requestedItems = allSaleItems
      .filter(si => (si.quantity - (si.quantity_refunded || 0)) > 0)
      .map(si => ({
        sale_item_id: si.id,
        quantity: round3(si.quantity - (si.quantity_refunded || 0))
      }));
  }

  const globalDiscount = round3(Number(sale.total_discount) || 0);
  const netLineTotals = computeNetLineTotals(allSaleItems, globalDiscount);

  const calc = calculateRefundItems(db, allSaleItems, netLineTotals, requestedItems);
  if (calc.error) {
    res.status(400).json({ error: calc.error });
    return;
  }

  const suggestedAllocation = suggestRefundAllocation(calc.totalRefunded, capacities);

  res.json({
    sale_id: sale.id,
    total_refunded: calc.totalRefunded,
    items: calc.processedItems.map(i => ({
      sale_item_id: i.sale_item_id,
      quantity_refunded: i.quantity_refunded,
      amount_refunded: i.amount_refunded,
      stock_restored: i.stock_to_restore
    })),
    capacities,
    suggested_allocation: suggestedAllocation
  });
}

// Process line-item partial or full refund
export function processRefund(saleId: string, req: Request, res: Response) {
  const {
    session_id: directSessionId = null,
    register_session_id = null,
    items = [],
    refund_method: reqRefundMethod = null,
    cash_refunded,
    wallet_refunded,
    credit_reduced,
    reason = '',
    date = new Date().toISOString()
  } = req.body;

  const db = getDb();

  const idem = beginIdempotentRequest(db, req, res, 'REFUND', saleId);
  if (idem.kind === 'REPLAYED') return;
  const requestId = idem.kind === 'CLAIMED' ? idem.requestId : null;

  const sale: any = db.prepare('SELECT * FROM sales WHERE id = ? OR receipt_number = ?').get(saleId, saleId);
  if (!sale) {
    res.status(404).json({ error: 'Sale not found' });
    return;
  }

  if (sale.status === 'FULLY_REFUNDED') {
    res.status(400).json({ error: 'Sale is already fully refunded' });
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one line item must be refunded' });
    return;
  }

  // Register session resolution
  const openSessions: any[] = db.prepare("SELECT * FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC").all();
  let session: any = null;
  const rawSessionId = directSessionId || register_session_id || null;

  if (rawSessionId) {
    session = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(rawSessionId);
    if (!session) {
      res.status(400).json({ error: `Session de caisse introuvable: ${rawSessionId}` });
      return;
    }
  } else if (openSessions.length === 1) {
    session = openSessions[0];
  } else if (openSessions.length > 1) {
    // If original sale session is currently open, default to it
    const saleSession = openSessions.find(s => s.id === sale.session_id);
    if (saleSession) {
      session = saleSession;
    }
  }

  const now = new Date().toISOString();

  // 1. Calculate and validate item refunds with pro-rata discount allocation
  const allSaleItems: any[] = db.prepare(`
    SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC
  `).all(sale.id);

  const globalDiscount = round3(Number(sale.total_discount) || 0);
  const netLineTotals = computeNetLineTotals(allSaleItems, globalDiscount);

  const calc = calculateRefundItems(db, allSaleItems, netLineTotals, items);
  if (calc.error) {
    res.status(400).json({ error: calc.error });
    return;
  }

  const totalRefunded = calc.totalRefunded;
  const processedRefundItems = calc.processedItems;

  const capacities = computeRefundCapacities(db, sale);

  if (addMoney(capacities.prior_refunded, totalRefunded) > sale.total_ttc) {
    res.status(400).json({
      error: `Le montant total remboursé (${round3(capacities.prior_refunded + totalRefunded).toFixed(3)} DT) dépasserait le total payé de la vente (${sale.total_ttc.toFixed(3)} DT).`
    });
    return;
  }

  // 2. Validate or auto-calculate payout methods equal total refunded
  const hasExplicitPayout = (
    cash_refunded !== undefined ||
    wallet_refunded !== undefined ||
    credit_reduced !== undefined
  );

  let cashPayout: number;
  let walletPayout: number;
  let creditReduction: number;

  if (!hasExplicitPayout) {
    const suggested = suggestRefundAllocation(totalRefunded, capacities);
    creditReduction = suggested.credit_reduced;
    cashPayout = suggested.cash_refunded;
    walletPayout = suggested.wallet_refunded;
  } else {
    cashPayout = round3(Number(cash_refunded) || 0);
    walletPayout = round3(Number(wallet_refunded) || 0);
    creditReduction = round3(Number(credit_reduced) || 0);
  }

  if (cashPayout < 0 || walletPayout < 0 || creditReduction < 0) {
    res.status(400).json({ error: 'Payout amounts cannot be negative' });
    return;
  }

  const totalPayout = round3(cashPayout + walletPayout + creditReduction);

  if (toMillimes(totalPayout) !== toMillimes(totalRefunded)) {
    res.status(400).json({
      error: `Payout total (${totalPayout.toFixed(3)} DT) does not equal refunded item total (${totalRefunded.toFixed(3)} DT). Cash: ${cashPayout}, Wallet: ${walletPayout}, Credit: ${creditReduction}`
    });
    return;
  }

  // Wallet refunds need a customer ledger: never silently drop the payout on
  // walk-in sales (total_refunded would still be recorded).
  if (walletPayout > 0 && !sale.customer_id) {
    res.status(400).json({ error: 'Cannot refund to wallet: sale has no customer. Refund to cash instead.' });
    return;
  }

  // 3. TARGETED CREDIT REDUCTION: Must reduce the specific ticket tied to THIS sale_id
  let targetTicket: any = null;
  if (creditReduction > 0) {
    targetTicket = db.prepare(`
      SELECT * FROM customer_debt_tickets
      WHERE sale_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    `).get(sale.id);

    if (!targetTicket) {
      res.status(400).json({
        error: `Cannot reduce credit: no open debt ticket found tied to this sale (Sale ID: ${sale.id}).`
      });
      return;
    }

    if (creditReduction > targetTicket.remaining_amount) {
      res.status(400).json({
        error: `Credit reduction (${creditReduction.toFixed(3)} DT) exceeds remaining ticket balance (${targetTicket.remaining_amount.toFixed(3)} DT).`
      });
      return;
    }
  }

  // Check remaining goods value vs remaining debt
  const willAllItemsBeRefunded = allSaleItems.every(si => {
    const itemInThisRefund = processedRefundItems.find(p => p.sale_item.id === si.id);
    const additionalQty = itemInThisRefund ? itemInThisRefund.quantity_refunded : 0;
    return round3((si.quantity_refunded || 0) + additionalQty) >= si.quantity;
  });
  const isFullRefund = willAllItemsBeRefunded || addMoney(capacities.prior_refunded, totalRefunded) >= sale.total_ttc;
  const remainingDebt = round3(capacities.open_debt - creditReduction);
  const remainingGoodsValue = Math.max(0, round3(sale.total_ttc - capacities.prior_refunded - totalRefunded));

  // FULLY_REFUNDED invariant: A fully refunded sale must never leave an open debt ticket
  if (isFullRefund && remainingDebt > 0) {
    res.status(400).json({
      error: `Une vente intégralement remboursée (FULLY_REFUNDED) ne peut pas conserver un ticket de dette ouvert. La dette restante (${remainingDebt.toFixed(3)} DT) doit être réduite en priorité.`
    });
    return;
  }

  // Open debt on this sale cannot exceed the value of retained goods
  if (remainingDebt > remainingGoodsValue) {
    const minRequiredCreditReduction = round3(capacities.open_debt - remainingGoodsValue);
    res.status(400).json({
      error: `La dette restante (${remainingDebt.toFixed(3)} DT) ne peut pas dépasser la valeur des articles conservés (${remainingGoodsValue.toFixed(3)} DT). Le ticket de dette doit être réduit d'au moins ${minRequiredCreditReduction.toFixed(3)} DT en priorité.`
    });
    return;
  }

  // Cap cash refund by cash actually tendered at checkout minus prior cash refunds
  if (cashPayout > capacities.max_cash) {
    res.status(400).json({
      error: `Le montant remboursé en espèces (${cashPayout.toFixed(3)} DT) dépasse la capacité d'espèces de la vente (${capacities.max_cash.toFixed(3)} DT). La dette réglée hors-caisse ne peut être remboursée depuis le tiroir-caisse.`
    });
    return;
  }

  // Total cash + wallet cannot exceed what was actually paid into the store
  const maxPaidRefundable = Math.max(0, round3(capacities.actual_paid - (capacities.prior_cash + capacities.prior_wallet)));
  if (round3(cashPayout + walletPayout) > maxPaidRefundable) {
    res.status(400).json({
      error: `Le montant total remboursé en espèces et portefeuille (${round3(cashPayout + walletPayout).toFixed(3)} DT) dépasse la capacité payée pour cette vente (${maxPaidRefundable.toFixed(3)} DT).`
    });
    return;
  }

  // Cash refunds require an active open register session
  if (cashPayout > 0) {
    if (openSessions.length === 0) {
      res.status(400).json({
        error: 'La caisse est fermée. Une session de caisse ouverte est obligatoire pour effectuer un remboursement en espèces. (An active open register session is required for cash refunds).'
      });
      return;
    }
    if (!session) {
      res.status(400).json({
        error: 'Plusieurs sessions de caisse sont ouvertes. Veuillez sélectionner la caisse effectuant le remboursement en espèces. (Multiple sessions are open; please specify session_id).'
      });
      return;
    }
    if (session.status !== 'OPEN') {
      res.status(400).json({
        error: `La session de caisse sélectionnée (${session.session_number}) est fermée.`
      });
      return;
    }
  }

  const refundId = crypto.randomUUID();
  let refundNumber = generateRefundNumber(db);
  let updatedTicketStatus: any = null;
  let newSaleStatus = 'PARTIALLY_REFUNDED';

  const buildRefundResult = () => ({
    id: refundId,
    refund_number: refundNumber,
    sale_id: sale.id,
    date,
    total_refunded: totalRefunded,
    cash_refunded: cashPayout,
    wallet_refunded: walletPayout,
    credit_reduced: creditReduction,
    sale_status: newSaleStatus,
    target_ticket_updated: updatedTicketStatus,
    items: processedRefundItems.map(i => ({
      sale_item_id: i.sale_item.id,
      quantity_refunded: i.quantity_refunded,
      amount_refunded: i.amount_refunded,
      stock_restored: i.stock_to_restore
    }))
  });

  const refundTx = db.transaction(() => {
    // A. Insert refund record
    db.prepare(`
      INSERT INTO refunds (
        id, refund_number, sale_id, date, total_refunded,
        cash_refunded, wallet_refunded, credit_reduced,
        reason, session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      refundId,
      refundNumber,
      sale.id,
      date,
      totalRefunded,
      cashPayout,
      walletPayout,
      creditReduction,
      reason,
      session ? session.id : null,
      now
    );

    // B. Insert refund items, update sale_items, restore product stock
    const insertRefundItem = db.prepare(`
      INSERT INTO refund_items (id, refund_id, sale_item_id, quantity_refunded, amount_refunded)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateSaleItem = db.prepare(`
      UPDATE sale_items
      SET quantity_refunded = quantity_refunded + ?
      WHERE id = ?
    `);

    const restoreStock = db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity + ?,
          updated_at = ?
      WHERE id = ?
    `);

    for (const item of processedRefundItems) {
      insertRefundItem.run(
        crypto.randomUUID(),
        refundId,
        item.sale_item.id,
        item.quantity_refunded,
        item.amount_refunded
      );

      updateSaleItem.run(item.quantity_refunded, item.sale_item.id);

      if (item.stock_to_restore > 0 && item.sale_item.product_id) {
        restoreStock.run(item.stock_to_restore, now, item.sale_item.product_id);
      }
    }

    // C. Payout handling: Wallet credit
    if (walletPayout > 0 && sale.customer_id) {
      db.prepare(`
        UPDATE customers
        SET wallet_balance = wallet_balance + ?,
            updated_at = ?
        WHERE id = ?
      `).run(walletPayout, now, sale.customer_id);

      db.prepare(`
        INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, reference_id, notes, created_at)
        VALUES (?, ?, ?, 'REFUND_CREDIT', ?, ?, 'Refund store credit deposit', ?)
      `).run(
        crypto.randomUUID(),
        sale.customer_id,
        date,
        walletPayout,
        refundId,
        now
      );
    }

    // D. Payout handling: Credit reduction on the sale-specific ticket
    if (creditReduction > 0 && targetTicket) {
      const newRemaining = round3(targetTicket.remaining_amount - creditReduction);
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

      db.prepare(`
        UPDATE customer_debt_tickets
        SET remaining_amount = ?,
            status = ?,
            updated_at = ?
        WHERE id = ?
      `).run(newRemaining, newStatus, now, targetTicket.id);

      updatedTicketStatus = {
        ticket_id: targetTicket.id,
        ticket_number: targetTicket.ticket_number,
        previous_remaining: targetTicket.remaining_amount,
        new_remaining: newRemaining,
        status: newStatus
      };
    }

    // E. Determine if sale is FULLY_REFUNDED or PARTIALLY_REFUNDED
    const allItems: any[] = db.prepare(`
      SELECT quantity, quantity_refunded FROM sale_items WHERE sale_id = ?
    `).all(sale.id);

    const isFullRefund = allItems.every(i => i.quantity_refunded >= i.quantity);
    newSaleStatus = isFullRefund ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';

    db.prepare(`
      UPDATE sales SET status = ? WHERE id = ?
    `).run(newSaleStatus, sale.id);

    if (requestId) {
      completeRequest(db, requestId, {
        statusCode: 201,
        resourceId: refundId,
        body: buildRefundResult()
      });
    }
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      refundTx();
      break;
    } catch (err: any) {
      if (isUniqueViolation(err) && attempt < 2) {
        // Tx aborted: reset tx-assigned outputs (processedRefundItems is only
        // read inside the tx, so it stays intact for the retry).
        refundNumber = generateRefundNumber(db);
        updatedTicketStatus = null;
        newSaleStatus = 'PARTIALLY_REFUNDED';
        continue;
      }
      throw err;
    }
  }

  res.status(201).json(buildRefundResult());
}

// POST /api/sales/:id/refund - process line-item partial or full refund
salesRouter.post('/:id/refund', (req: Request, res: Response) => {
  processRefund(req.params.id, req, res);
});

// GET and POST /api/sales/:id/refund/preview - read-only refund calculation
salesRouter.get('/:id/refund/preview', (req: Request, res: Response) => {
  previewRefund(req.params.id, req, res);
});

salesRouter.post('/:id/refund/preview', (req: Request, res: Response) => {
  previewRefund(req.params.id, req, res);
});

// Refunds router mounted at /api/refunds
export const refundsRouter = Router();

refundsRouter.post('/', (req: Request, res: Response) => {
  const saleId = req.body.sale_id;
  if (!saleId) {
    res.status(400).json({ error: 'sale_id is required' });
    return;
  }
  processRefund(saleId, req, res);
});

refundsRouter.post('/preview', (req: Request, res: Response) => {
  const saleId = req.body.sale_id;
  if (!saleId) {
    res.status(400).json({ error: 'sale_id is required' });
    return;
  }
  previewRefund(saleId, req, res);
});

refundsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.params.id);
  if (!refund) {
    res.status(404).json({ error: 'Refund not found' });
    return;
  }
  res.json(refund);
});

