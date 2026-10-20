import crypto from 'crypto';
import { isUniqueViolation } from '../db/index.js';
import { round3, addMoney, multiplyMoney, calculateTaxBreakdown } from '../utils/money.js';
import { calculateContainersNeeded } from '../utils/container.js';
import { businessDateKey } from '../utils/businessDate.js';
import { validateSalePayment } from '../utils/payments.js';
import { completeRequest } from './idempotencyService.js';

export class SaleError extends Error {
  public status: number;
  public body: any;

  constructor(status: number, body: any) {
    const message = typeof body === 'string' ? body : (body?.error || 'Sale Error');
    super(message);
    this.name = 'SaleError';
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}

export function generateReceiptNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `REC-${dateStr}-`;
  const maxRow: any = db.prepare(`
    SELECT MAX(CAST(SUBSTR(receipt_number, ?) AS INTEGER)) as max_seq
    FROM sales
    WHERE receipt_number LIKE ?
  `).get(prefix.length + 1, `${prefix}%`);
  const seq = ((Number(maxRow?.max_seq) || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

export function generateTicketNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `TKT-${dateStr}-`;
  const maxRow: any = db.prepare(`
    SELECT MAX(CAST(SUBSTR(ticket_number, ?) AS INTEGER)) as max_seq
    FROM customer_debt_tickets
    WHERE ticket_number LIKE ?
  `).get(prefix.length + 1, `${prefix}%`);
  const seq = ((Number(maxRow?.max_seq) || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

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

export interface CreateSaleItemInput {
  product_id?: string | null;
  is_quick_add?: boolean;
  quick_add_name?: string | null;
  name?: string;
  description?: string;
  pack_size_id?: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_amount?: number | string;
  loan_container?: boolean;
  container_type_id?: string | null;
}

export interface CreateSaleInput {
  session_id: string; // Already resolved, non-null, open session
  customer_id?: string | null;
  date?: string;
  items: CreateSaleItemInput[];
  total_discount?: number | string;
  cash_paid?: number | string;
  cash_tendered?: number | string;
  wallet_paid?: number | string;
  credit_amount?: number | string;
  /** Optional online idempotency claim, already inserted by the HTTP route. */
  request_id?: string | null;
}

export interface CreateSaleResult {
  id: string;
  sale_id: string;
  receipt_number: string;
  session_id: string | null;
  date: string;
  customer_id: string | null;
  subtotal_ht: number;
  tva_amount: number;
  total_ttc: number;
  cash_paid: number;
  wallet_paid: number;
  credit_amount: number;
  change_given: number;
  open_cash_drawer: boolean;
  should_kick_drawer: boolean;
  debt_ticket: any;
  container_loans: any[];
  items: any[];
  sale: any;
}

export function createSale(db: any, input: CreateSaleInput): CreateSaleResult {
  const {
    session_id,
    customer_id = null,
    date = new Date().toISOString(),
    items = [],
    total_discount = 0,
    cash_tendered = undefined,
    cash_paid = 0,
    wallet_paid = 0,
    credit_amount = 0,
    request_id = null
  } = input;

  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleError(400, { error: 'At least one line item is required' });
  }

  const now = new Date().toISOString();

  // Validate Register Session: Register must be open to process a sale
  if (!session_id) {
    throw new SaleError(400, {
      error: 'La caisse est fermée. Une session de caisse ouverte est obligatoire pour finaliser une vente. (Register is closed. An active open register session is required).'
    });
  }

  const session = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(session_id);
  if (!session) {
    throw new SaleError(400, { error: `Session de caisse introuvable: ${session_id}` });
  }

  if (session.status !== 'OPEN') {
    throw new SaleError(400, {
      error: 'La caisse est fermée. Une session de caisse ouverte est obligatoire pour finaliser une vente. (Register is closed. An active open register session is required).'
    });
  }

  // Validate Customer if provided
  let customer: any = null;
  if (customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) {
      throw new SaleError(404, { error: 'Selected customer not found' });
    }
  }

  // 1. Validate and calculate line items
  let computedSubtotal = 0;
  const processedItems: any[] = [];

  for (const item of items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new SaleError(400, { error: 'Quantity must be greater than 0' });
    }

    const unitPriceRaw = Number(item.unit_price);
    if (!Number.isFinite(unitPriceRaw) || unitPriceRaw < 0) {
      throw new SaleError(400, { error: 'unit_price must be a finite non-negative number' });
    }
    let unitPrice = round3(unitPriceRaw);

    const discountRaw = Number(item.discount_amount) || 0;
    if (!Number.isFinite(discountRaw) || discountRaw < 0) {
      throw new SaleError(400, { error: 'discount_amount must be a finite non-negative number' });
    }
    const discountAmount = round3(discountRaw);
    const lineTotal = round3(multiplyMoney(unitPrice, qty) - discountAmount);

    if (lineTotal < 0) {
      throw new SaleError(400, { error: 'Line total cannot be negative' });
    }

    let baseStockDeducted = qty;
    let packMultiplier = 1;
    let catalogUnitPrice: number | null = null;

    const resolvedQuickAddName = item.quick_add_name || item.description || item.name;
    if (item.is_quick_add) {
      if (!resolvedQuickAddName || String(resolvedQuickAddName).trim().length === 0) {
        throw new SaleError(400, { error: 'Quick-add items must have a name' });
      }
      baseStockDeducted = 0; // Quick add does not deduct inventory
    } else {
      if (!item.product_id) {
        throw new SaleError(400, { error: 'product_id is required for catalog items' });
      }
      const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
      if (!product) {
        throw new SaleError(404, { error: `Product not found: ${item.product_id}` });
      }

      if (item.pack_size_id) {
        const packSize: any = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ?').get(item.pack_size_id);
        if (!packSize) {
          throw new SaleError(400, { error: `Pack size not found: ${item.pack_size_id}` });
        }
        if (packSize.product_id !== item.product_id) {
          throw new SaleError(400, { error: `Pack size ${item.pack_size_id} does not belong to product ${item.product_id}` });
        }
        packMultiplier = packSize.multiplier;
        baseStockDeducted = qty * packMultiplier;
      }
      catalogUnitPrice = computeExpectedCatalogPrice(db, product, customer, item.pack_size_id, packMultiplier);
    }

    const loanContainer = Boolean(item.loan_container);
    if (loanContainer && !customer_id) {
      throw new SaleError(400, { error: 'Loaning a container requires selecting a customer.' });
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
    cash_paid: cash_paid as any,
    cash_tendered: cash_tendered as any,
    wallet_paid: wallet_paid as any,
    credit_amount: credit_amount as any
  });

  if (!payment.ok) {
    throw new SaleError(400, { error: payment.error });
  }

  const cashAmount = payment.cash_paid;
  const walletAmount = payment.wallet_paid;
  const creditAmount = payment.credit_amount;

  // 3. STRICT WALLET VALIDATION (Per User Instruction)
  if (walletAmount > 0) {
    if (!customer) {
      throw new SaleError(400, { error: 'Cannot pay with wallet without selecting a customer' });
    }

    const availableWallet = round3(customer.wallet_balance || 0);
    if (walletAmount > availableWallet) {
      throw new SaleError(400, {
        error: `Insufficient wallet balance. Requested: ${walletAmount.toFixed(3)} DT, Available: ${availableWallet.toFixed(3)} DT. Adjust wallet amount or pay difference with cash/credit.`
      });
    }
  }

  // 4. Validate Credit portion
  if (creditAmount > 0 && !customer) {
    throw new SaleError(400, { error: 'Credit sale (unpaid balance) requires selecting a customer' });
  }

  // 5. Change Due and Cash Drawer Kick (change computed server-side, never trusted)
  const changeGiven = payment.change_given;
  const openCashDrawer = cashAmount > 0; // Drawer kicks ONLY if sale includes cash

  const saleId = crypto.randomUUID();
  let receiptNumber = generateReceiptNumber(db);
  let createdTicket: any = null;
  const containerLoansCreated: any[] = [];

  const buildResult = (): CreateSaleResult => ({
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
      null,
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

    if (request_id) {
      completeRequest(db, request_id, {
        statusCode: 201,
        resourceId: saleId,
        body: buildResult()
      });
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
        throw new SaleError(400, { error: err.message.replace('INSUFFICIENT_WALLET: ', '') });
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

  return buildResult();
}
