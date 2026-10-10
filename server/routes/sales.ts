import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, isUniqueViolation } from '../db/index.js';
import { round3, addMoney, subtractMoney, multiplyMoney, calculateTaxBreakdown, calculateResellerPrice } from '../utils/money.js';
import { calculateContainersNeeded } from '../utils/container.js';
import { businessDateKey, tunisDayRangeUTC, isFilterDay } from '../utils/businessDate.js';
import { validateSalePayment } from '../utils/payments.js';

export const salesRouter = Router();

function generateReceiptNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `REC-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM sales WHERE receipt_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

function generateTicketNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `TKT-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM customer_debt_tickets WHERE ticket_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
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

  res.json({
    ...sale,
    debt_ticket: debtTicket ?? null,
    items: mappedItems,
    receipt: receiptFormat
  });
});

export function computeExpectedCatalogPrice(
  db: any,
  product: any,
  customer: any,
  packSizeId?: string | null,
  packMultiplier?: number | null
): number | null {
  if (!product) return null;

  let basePrice = Number(product.retail_price) || 0;
  if (customer) {
    if (customer.type === 'WHOLESALE') {
      basePrice = Number(product.wholesale_price) || 0;
    } else if (customer.type === 'RESELLER') {
      const discount = Math.max(0, Math.min(100, Number(customer.reseller_discount_percent) || 0));
      basePrice = (Number(product.wholesale_price) || 0) * ((100 - discount) / 100);
    }
  }

  let finalPrice = basePrice;
  if (packSizeId) {
    const packSize: any = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ?').get(packSizeId);
    if (packSize) {
      if (packSize.price_override !== null && packSize.price_override !== undefined && (!customer || customer.type === 'RETAIL')) {
        finalPrice = Number(packSize.price_override);
      } else {
        finalPrice = basePrice * (Number(packSize.multiplier) || 1);
      }
    } else if (packMultiplier && packMultiplier > 1) {
      finalPrice = basePrice * packMultiplier;
    }
  } else if (packMultiplier && packMultiplier > 1) {
    finalPrice = basePrice * packMultiplier;
  }

  return round3(finalPrice);
}

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
    credit_amount = 0,
    synced_from_client_id = null
  } = req.body;

  const rawSessionId = directSessionId || register_session_id || null;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one line item is required' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();

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

  const session_id = session.id;

  // Validate Customer if provided
  let customer: any = null;
  if (customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) {
      res.status(404).json({ error: 'Selected customer not found' });
      return;
    }
  }

  // 1. Validate and calculate line items
  let computedSubtotal = 0;
  const processedItems: any[] = [];

  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: 'Quantity must be greater than 0' });
      return;
    }

    const unitPriceRaw = Number(item.unit_price);
    if (!Number.isFinite(unitPriceRaw) || unitPriceRaw < 0) {
      res.status(400).json({ error: 'unit_price must be a finite non-negative number' });
      return;
    }
    let unitPrice = round3(unitPriceRaw);

    const discountRaw = Number(item.discount_amount) || 0;
    if (!Number.isFinite(discountRaw) || discountRaw < 0) {
      res.status(400).json({ error: 'discount_amount must be a finite non-negative number' });
      return;
    }
    const discountAmount = round3(discountRaw);
    const lineTotal = round3(multiplyMoney(unitPrice, qty) - discountAmount);

    if (lineTotal < 0) {
      res.status(400).json({ error: 'Line total cannot be negative' });
      return;
    }

    let baseStockDeducted = qty;
    let packMultiplier = 1;
    let catalogUnitPrice: number | null = null;

    const resolvedQuickAddName = item.quick_add_name || item.description || item.name;
    if (item.is_quick_add) {
      if (!resolvedQuickAddName || String(resolvedQuickAddName).trim().length === 0) {
        res.status(400).json({ error: 'Quick-add items must have a name' });
        return;
      }
      baseStockDeducted = 0; // Quick add does not deduct inventory
    } else {
      if (!item.product_id) {
        res.status(400).json({ error: 'product_id is required for catalog items' });
        return;
      }
      const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product) {
        res.status(404).json({ error: `Product not found: ${item.product_id}` });
        return;
      }

      if (item.pack_size_id) {
        const packSize: any = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ?').get(item.pack_size_id);
        if (!packSize) {
          res.status(400).json({ error: `Pack size not found: ${item.pack_size_id}` });
          return;
        }
        if (packSize.product_id !== item.product_id) {
          res.status(400).json({ error: `Pack size ${item.pack_size_id} does not belong to product ${item.product_id}` });
          return;
        }
        packMultiplier = packSize.multiplier;
        baseStockDeducted = qty * packMultiplier;
      }
      catalogUnitPrice = computeExpectedCatalogPrice(db, product, customer, item.pack_size_id, packMultiplier);
    }

    const loanContainer = Boolean(item.loan_container);
    if (loanContainer && !customer_id) {
      res.status(400).json({ error: 'Loaning a container requires selecting a customer.' });
      return;
    }

    const isOverridden = (catalogUnitPrice !== null && catalogUnitPrice !== undefined)
      ? round3(unitPrice) !== round3(catalogUnitPrice)
      : false;

    computedSubtotal = addMoney(computedSubtotal, lineTotal);
    processedItems.push({
      id: crypto.randomUUID(),
      product_id: item.product_id || null,
      is_quick_add: item.is_quick_add ? 1 : 0,
      quick_add_name: item.is_quick_add ? String(resolvedQuickAddName).trim() : null,
      pack_size_id: item.pack_size_id || null,
      pack_multiplier: packMultiplier,
      quantity: qty,
      quantity_refunded: 0,
      base_stock_deducted: baseStockDeducted,
      unit_price: unitPrice,
      catalog_unit_price: catalogUnitPrice,
      overridden: isOverridden,
      discount_amount: discountAmount,
      line_total: lineTotal,
      loan_container: loanContainer
    });
  }

  const globalDiscount = round3(Number(total_discount) || 0);
  const totalTTC = Math.max(0, round3(computedSubtotal - globalDiscount));
  const taxBreakdown = calculateTaxBreakdown(totalTTC, 0.19);

  // 2. Validate Payment Breakdown (shared with offline sync flush)
  const payment = validateSalePayment({
    total_ttc: totalTTC,
    subtotal: computedSubtotal,
    total_discount: globalDiscount,
    cash_paid,
    cash_tendered,
    wallet_paid,
    credit_amount
  });

  if (!payment.ok) {
    res.status(400).json({ error: payment.error });
    return;
  }

  const cashAmount = payment.cash_paid;
  const walletAmount = payment.wallet_paid;
  const creditAmount = payment.credit_amount;

  // 3. STRICT WALLET VALIDATION (Per User Instruction)
  if (walletAmount > 0) {
    if (!customer) {
      res.status(400).json({ error: 'Cannot pay with wallet without selecting a customer' });
      return;
    }

    const availableWallet = round3(customer.wallet_balance || 0);
    if (walletAmount > availableWallet) {
      res.status(400).json({
        error: `Insufficient wallet balance. Requested: ${walletAmount.toFixed(3)} DT, Available: ${availableWallet.toFixed(3)} DT. Adjust wallet amount or pay difference with cash/credit.`
      });
      return;
    }
  }

  // 4. Validate Credit portion
  if (creditAmount > 0 && !customer) {
    res.status(400).json({ error: 'Credit sale (unpaid balance) requires selecting a customer' });
    return;
  }

  // 5. Change Due and Cash Drawer Kick (change computed server-side, never trusted)
  const changeGiven = payment.change_given;
  const openCashDrawer = cashAmount > 0; // Drawer kicks ONLY if sale includes cash

  const saleId = crypto.randomUUID();
  let receiptNumber = generateReceiptNumber(db);
  let createdTicket: any = null;
  const containerLoansCreated: any[] = [];

  const saleTx = db.transaction(() => {
    // A. Deduct stock for catalog items
    const deductStock = db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity - ?,
          updated_at = ?
      WHERE id = ?
    `);

    for (const item of processedItems) {
      if (item.base_stock_deducted > 0 && item.product_id) {
        deductStock.run(item.base_stock_deducted, now, item.product_id);
      }
    }

    // B. Insert sale record
    db.prepare(`
      INSERT INTO sales (
        id, receipt_number, session_id, date, customer_id,
        subtotal_ht, tva_rate, tva_amount, total_ttc, total_discount,
        cash_paid, wallet_paid, credit_amount, change_given,
        status, synced_from_client_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(
      saleId,
      receiptNumber,
      session_id || null,
      date,
      customer_id || null,
      taxBreakdown.subtotalHT,
      0.19,
      taxBreakdown.tvaAmount,
      totalTTC,
      globalDiscount,
      cashAmount,
      walletAmount,
      creditAmount,
      changeGiven,
      synced_from_client_id,
      now
    );

    // C. Insert sale items
    const insertSaleItem = db.prepare(`
      INSERT INTO sale_items (
        id, sale_id, product_id, is_quick_add, quick_add_name,
        pack_size_id, pack_multiplier, quantity, quantity_refunded,
        base_stock_deducted, unit_price, catalog_unit_price, discount_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of processedItems) {
      insertSaleItem.run(
        item.id,
        saleId,
        item.product_id,
        item.is_quick_add,
        item.quick_add_name,
        item.pack_size_id,
        item.pack_multiplier,
        item.quantity,
        0,
        item.base_stock_deducted,
        item.unit_price,
        item.catalog_unit_price,
        item.discount_amount,
        item.line_total
      );
    }

    // D. Deduct Wallet Balance if used (atomic: re-checked INSIDE the tx so
    // concurrent sales cannot both pass the pre-check and overdraw).
    if (walletAmount > 0 && customer_id) {
      const deduct = db.prepare(`
        UPDATE customers
        SET wallet_balance = wallet_balance - ?,
            updated_at = ?
        WHERE id = ? AND wallet_balance >= ?
      `).run(walletAmount, now, customer_id, walletAmount);

      if (deduct.changes === 0) {
        throw new Error(
          `INSUFFICIENT_WALLET: Insufficient wallet balance. Requested: ${walletAmount.toFixed(3)} DT. Adjust wallet amount or pay difference with cash/credit.`
        );
      }

      db.prepare(`
        INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, reference_id, notes, created_at)
        VALUES (?, ?, ?, 'SALE_PAYMENT', ?, ?, 'POS Checkout wallet payment', ?)
      `).run(
        crypto.randomUUID(),
        customer_id,
        date,
        walletAmount,
        saleId,
        now
      );
    }

    // E. Create Open Debt Ticket if credit used
    if (creditAmount > 0 && customer_id) {
      const ticketId = crypto.randomUUID();
      const ticketNumber = generateTicketNumber(db);

      db.prepare(`
        INSERT INTO customer_debt_tickets (
          id, ticket_number, customer_id, sale_id, date,
          total_amount, remaining_amount, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)
      `).run(
        ticketId,
        ticketNumber,
        customer_id,
        saleId,
        date,
        creditAmount,
        creditAmount,
        now,
        now
      );

      createdTicket = {
        id: ticketId,
        ticket_number: ticketNumber,
        customer_id,
        sale_id: saleId,
        total_amount: creditAmount,
        remaining_amount: creditAmount,
        status: 'UNPAID'
      };
    }

    // F. Container loans for items with loan_container = true
    for (const item of processedItems) {
      if (item.loan_container && item.product_id && customer_id) {
        const prod: any = db.prepare(`
          SELECT p.container_type_id, p.size_label, p.name, ct.capacity_liters 
          FROM products p 
          LEFT JOIN container_types ct ON p.container_type_id = ct.id 
          WHERE p.id = ?
        `).get(item.product_id);
        const containerTypeId = item.container_type_id || (prod && prod.container_type_id);
        if (containerTypeId) {
          const ct: any = db.prepare('SELECT capacity_liters FROM container_types WHERE id = ?').get(containerTypeId);
          const capacityLiters = ct?.capacity_liters ?? prod?.capacity_liters ?? null;
          const cQty = calculateContainersNeeded(
            item.quantity,
            item.pack_multiplier,
            prod?.size_label,
            capacityLiters,
            prod?.name || item.quick_add_name
          );
          if (cQty > 0) {
            const txId = crypto.randomUUID();
            const loanId = crypto.randomUUID();

            // Log container transaction
            db.prepare(`
              INSERT INTO container_transactions (id, date, customer_id, container_type_id, action, quantity, notes, created_at)
              VALUES (?, ?, ?, ?, 'GIVE', ?, ?, ?)
            `).run(txId, date, customer_id, containerTypeId, cQty, `Prêt consigne vente ${receiptNumber}`, now);

            // Decrement shop container stock
            db.prepare(`
              UPDATE container_types
              SET stock_quantity = stock_quantity - ?
              WHERE id = ?
            `).run(cQty, containerTypeId);

            // Upsert customer container loan
            db.prepare(`
              INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(customer_id, container_type_id)
              DO UPDATE SET quantity_owed = quantity_owed + excluded.quantity_owed
            `).run(loanId, customer_id, containerTypeId, cQty);

            containerLoansCreated.push({
              transaction_id: txId,
              container_type_id: containerTypeId,
              quantity: cQty
            });
          }
        }
      }
    }
  });

  // Receipt numbers are COUNT(*)+1: on a concurrent duplicate-submit clash,
  // regenerate and retry instead of surfacing a 500.
  let saleCommitted = false;
  for (let attempt = 0; attempt < 3 && !saleCommitted; attempt++) {
    try {
      saleTx();
      saleCommitted = true;
    } catch (err: any) {
      if (err?.message?.startsWith('INSUFFICIENT_WALLET:')) {
        res.status(400).json({ error: err.message.replace('INSUFFICIENT_WALLET: ', '') });
        return;
      }
      if (isUniqueViolation(err) && attempt < 2) {
        receiptNumber = generateReceiptNumber(db);
        // Tx aborted, but JS-side collectors may hold partial entries: reset.
        createdTicket = null;
        containerLoansCreated.length = 0;
        continue;
      }
      throw err;
    }
  }

  res.status(201).json({
    id: saleId,
    sale_id: saleId,
    receipt_number: receiptNumber,
    session_id: session_id || null,
    date,
    customer_id,
    subtotal_ht: taxBreakdown.subtotalHT,
    tva_amount: taxBreakdown.tvaAmount,
    total_ttc: totalTTC,
    cash_paid: cashAmount,
    wallet_paid: walletAmount,
    credit_amount: creditAmount,
    change_given: changeGiven,
    open_cash_drawer: openCashDrawer,
    should_kick_drawer: openCashDrawer,
    debt_ticket: createdTicket,
    container_loans: containerLoansCreated,
    items: processedItems,
    sale: {
      id: saleId,
      sale_id: saleId,
      receipt_number: receiptNumber,
      session_id: session_id || null,
      date,
      customer_id,
      subtotal_ht: taxBreakdown.subtotalHT,
      tva_amount: taxBreakdown.tvaAmount,
      total_ttc: totalTTC,
      cash_paid: cashAmount,
      wallet_paid: walletAmount,
      credit_amount: creditAmount,
      change_given: changeGiven,
      open_cash_drawer: openCashDrawer,
      should_kick_drawer: openCashDrawer,
      debt_ticket: createdTicket,
      container_loans: containerLoansCreated,
      items: processedItems
    }
  });
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
    return { ...r, items };
  });

  res.json(enriched);
});

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

  const subtotal = round3(allSaleItems.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0));
  const globalDiscount = round3(Number(sale.total_discount) || 0);

  // Compute net line totals for all lines of the sale
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
        // Remainder on the last line
        lineDiscount = round3(globalDiscount - allocatedDiscountSum);
      } else {
        lineDiscount = round3(globalDiscount * (lineTotal / subtotal));
        allocatedDiscountSum = addMoney(allocatedDiscountSum, lineDiscount);
      }
      const netLineTotal = Math.max(0, round3(lineTotal - lineDiscount));
      netLineTotals.set(item.id, netLineTotal);
    }
  }

  let totalRefunded = 0;
  const processedRefundItems: any[] = [];

  // Check for duplicate sale_item_ids in refund request
  const seenSaleItemIds = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object' || !item.sale_item_id) {
      res.status(400).json({ error: 'Valid sale_item_id is required for every refund item' });
      return;
    }
    if (seenSaleItemIds.has(item.sale_item_id)) {
      res.status(400).json({ error: `Duplicate sale_item_id in refund request: ${item.sale_item_id}` });
      return;
    }
    seenSaleItemIds.add(item.sale_item_id);
  }

  for (const item of items) {
    const saleItem: any = allSaleItems.find(si => si.id === item.sale_item_id);

    if (!saleItem) {
      res.status(400).json({ error: `Sale line item not found: ${item.sale_item_id}` });
      return;
    }

    const qtyToRefund = Number(item.quantity);
    if (!Number.isFinite(qtyToRefund) || qtyToRefund <= 0) {
      res.status(400).json({
        error: `Invalid refund quantity for item ${saleItem.id}: ${item.quantity}`
      });
      return;
    }

    const availableToRefund = saleItem.quantity - saleItem.quantity_refunded;

    if (qtyToRefund > availableToRefund) {
      res.status(400).json({
        error: `Invalid refund quantity for item ${saleItem.id}. Requested: ${qtyToRefund}, Max available: ${availableToRefund}`
      });
      return;
    }

    if (Number.isInteger(saleItem.quantity) && !Number.isInteger(qtyToRefund)) {
      res.status(400).json({
        error: `Fractional refund quantity (${qtyToRefund}) is not allowed for integer-quantity item ${saleItem.id}`
      });
      return;
    }

    const netLineTotal = netLineTotals.get(saleItem.id) ?? round3(Number(saleItem.line_total) || 0);

    const alreadyRefundedRow: any = db.prepare(`
      SELECT COALESCE(SUM(amount_refunded), 0) as already_refunded
      FROM refund_items
      WHERE sale_item_id = ?
    `).get(saleItem.id);
    const alreadyRefunded = round3(alreadyRefundedRow?.already_refunded || 0);

    // For the last remaining quantity of a line, amountRefunded = netLineTotal - already_refunded; otherwise effective net unit price
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

    // Cap cumulative amount_refunded on each line at net line total
    if (addMoney(alreadyRefunded, amountRefunded) > netLineTotal) {
      amountRefunded = Math.max(0, round3(netLineTotal - alreadyRefunded));
    }

    totalRefunded = addMoney(totalRefunded, amountRefunded);
    processedRefundItems.push({
      sale_item: saleItem,
      quantity_refunded: qtyToRefund,
      amount_refunded: amountRefunded,
      stock_to_restore: saleItem.product_id ? qtyToRefund * (saleItem.pack_multiplier || 1) : 0
    });
  }

  // Over-refund cap: check cumulative refunds against sale.total_ttc
  const priorRefundsRow: any = db.prepare(`
    SELECT COALESCE(SUM(total_refunded), 0) as prior_refunded
    FROM refunds
    WHERE sale_id = ?
  `).get(sale.id);
  const priorRefunded = round3(priorRefundsRow?.prior_refunded || 0);

  if (addMoney(priorRefunded, totalRefunded) > sale.total_ttc) {
    res.status(400).json({
      error: `Le montant total remboursé (${round3(priorRefunded + totalRefunded).toFixed(3)} DT) dépasserait le total payé de la vente (${sale.total_ttc.toFixed(3)} DT).`
    });
    return;
  }

  // 2. Validate or auto-calculate payout methods equal total refunded
  let cashPayout = cash_refunded !== undefined ? round3(Number(cash_refunded) || 0) : null;
  let walletPayout = wallet_refunded !== undefined ? round3(Number(wallet_refunded) || 0) : null;
  let creditReduction = credit_reduced !== undefined ? round3(Number(credit_reduced) || 0) : null;

  if (cashPayout === null && walletPayout === null && creditReduction === null) {
    if (reqRefundMethod === 'CREDIT_REDUCTION' || req.body.refund_to_credit_debt || (!reqRefundMethod && sale.credit_amount > 0 && sale.cash_paid === 0)) {
      creditReduction = totalRefunded;
      cashPayout = 0;
      walletPayout = 0;
    } else if (reqRefundMethod === 'WALLET' || (!reqRefundMethod && sale.wallet_paid > 0 && sale.cash_paid === 0)) {
      walletPayout = totalRefunded;
      cashPayout = 0;
      creditReduction = 0;
    } else if (reqRefundMethod === 'CASH' || (!reqRefundMethod && sale.cash_paid > 0)) {
      cashPayout = totalRefunded;
      walletPayout = 0;
      creditReduction = 0;
    } else {
      cashPayout = totalRefunded;
      walletPayout = 0;
      creditReduction = 0;
    }
  } else {
    cashPayout = cashPayout || 0;
    walletPayout = walletPayout || 0;
    creditReduction = creditReduction || 0;
  }

  if (cashPayout < 0 || walletPayout < 0 || creditReduction < 0) {
    res.status(400).json({ error: 'Payout amounts cannot be negative' });
    return;
  }

  const totalPayout = round3(cashPayout + walletPayout + creditReduction);

  if (Math.abs(totalPayout - totalRefunded) > 0.005) {
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

  const refundId = crypto.randomUUID();
  let refundNumber = generateRefundNumber(db);
  let updatedTicketStatus: any = null;
  let newSaleStatus = 'PARTIALLY_REFUNDED';

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

  res.status(201).json({
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
}

// POST /api/sales/:id/refund - process line-item partial or full refund
salesRouter.post('/:id/refund', (req: Request, res: Response) => {
  processRefund(req.params.id, req, res);
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

refundsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(req.params.id);
  if (!refund) {
    res.status(404).json({ error: 'Refund not found' });
    return;
  }
  res.json(refund);
});

