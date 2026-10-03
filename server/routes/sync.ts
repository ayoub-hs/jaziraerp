import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3, addMoney, calculateTaxBreakdown } from '../utils/money.js';
import { calculateContainersNeeded } from '../utils/container.js';

export const syncRouter = Router();

function generateReceiptNumber(db: any): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `REC-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM sales WHERE receipt_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

function generateTicketNumber(db: any): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `TKT-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM customer_debt_tickets WHERE ticket_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// GET /api/sync/pull - pull master catalog and active state for local client replication
syncRouter.get('/pull', (req: Request, res: Response) => {
  const db = getDb();

  const products: any[] = db.prepare(`
    SELECT p.*, pf.name as family_name, pf.category as category, pf.type as product_type,
      CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    WHERE p.active = 1 AND pf.active = 1
    ORDER BY pf.name ASC, p.name ASC
  `).all();

  const enrichedProducts = products.map((prod) => {
    const packSizes = db.prepare(`
      SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
    `).all(prod.id);
    return { ...prod, pack_sizes: packSizes };
  });

  const customers: any[] = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
  const enrichedCustomers = customers.map((c) => {
    const debtSummary: any = db.prepare(`
      SELECT COALESCE(SUM(remaining_amount), 0) as total_debt, COUNT(*) as open_ticket_count
      FROM customer_debt_tickets
      WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    `).get(c.id);

    return {
      ...c,
      total_debt: round3(debtSummary?.total_debt || 0),
      open_ticket_count: debtSummary?.open_ticket_count || 0
    };
  });

  const containerTypes = db.prepare(`
    SELECT ct.*,
      COALESCE((SELECT SUM(ccl.quantity_owed) FROM customer_container_loans ccl WHERE ccl.container_type_id = ct.id), 0) as total_loaned_out
    FROM container_types ct
    ORDER BY ct.name ASC
  `).all();

  const openSessions = db.prepare("SELECT * FROM register_sessions WHERE status = 'OPEN'").all();

  res.json({
    products: enrichedProducts,
    customers: enrichedCustomers,
    container_types: containerTypes,
    open_sessions: openSessions,
    server_time: new Date().toISOString()
  });
});

// POST /api/sync/flush - execute queued offline operations in SQLite
syncRouter.post('/flush', (req: Request, res: Response) => {
  const { operations = [] } = req.body;

  if (!Array.isArray(operations) || operations.length === 0) {
    res.json({ success: true, processed_count: 0, reconciled: [] });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const reconciled: any[] = [];
  const failed: any[] = [];

  for (const op of operations) {
    const { temp_client_id, action_type, payload } = op;

    try {
      const opTx = db.transaction(() => {
        if (action_type === 'SALE') {
          const clientId = temp_client_id || payload?.temp_client_id;
          if (clientId) {
            const existingSale: any = db.prepare('SELECT id, receipt_number FROM sales WHERE synced_from_client_id = ?').get(clientId);
            if (existingSale) {
              reconciled.push({
                temp_client_id: clientId,
                action_type: 'SALE',
                server_id: existingSale.id,
                receipt_number: existingSale.receipt_number,
                status: 'SYNCED'
              });
              return;
            }
          }

          const walletAmount = round3(Number(payload.wallet_paid) || 0);
          if (walletAmount > 0) {
            if (!payload.customer_id) {
              failed.push({
                temp_client_id,
                action_type: 'SALE',
                reason: 'INSUFFICIENT_WALLET'
              });
              return;
            }
            const customer: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(payload.customer_id);
            const currentBalance = round3(customer?.wallet_balance || 0);
            if (!customer || currentBalance < walletAmount) {
              failed.push({
                temp_client_id,
                action_type: 'SALE',
                reason: 'INSUFFICIENT_WALLET'
              });
              return;
            }
          }

        const saleId = crypto.randomUUID();
        const receiptNumber = generateReceiptNumber(db);
        const date = payload.date || now;

        // Process line items
        let computedSubtotal = 0;
        const processedItems: any[] = [];

        for (const item of payload.items || []) {
          const qty = Number(item.quantity) || 1;
          const unitPrice = round3(Number(item.unit_price) || 0);
          const lineTotal = round3(unitPrice * qty - (Number(item.discount_amount) || 0));
          const packMultiplier = Number(item.pack_multiplier) || 1;
          const isQuickAdd = item.is_quick_add ? 1 : 0;
          const baseDeducted = isQuickAdd ? 0 : qty * packMultiplier;

          const resolvedQuickName = item.quick_add_name || item.description || item.name || null;
          computedSubtotal = addMoney(computedSubtotal, lineTotal);
          processedItems.push({
            id: crypto.randomUUID(),
            product_id: item.product_id || null,
            is_quick_add: isQuickAdd,
            quick_add_name: resolvedQuickName,
            pack_size_id: item.pack_size_id || null,
            pack_multiplier: packMultiplier,
            quantity: qty,
            base_stock_deducted: baseDeducted,
            unit_price: unitPrice,
            discount_amount: Number(item.discount_amount) || 0,
            line_total: lineTotal
          });

          // Deduct stock in SQLite (DOUBLE-SELLING RISK ACCEPTED: proceed into negative if needed)
          if (baseDeducted > 0 && item.product_id) {
            db.prepare(`
              UPDATE products
              SET stock_quantity = stock_quantity - ?,
                  updated_at = ?
              WHERE id = ?
            `).run(baseDeducted, now, item.product_id);
          }
        }

        const totalTTC = Math.max(0, round3(computedSubtotal - (Number(payload.total_discount) || 0)));
        const taxBreakdown = calculateTaxBreakdown(totalTTC, 0.19);
        const cashAmount = round3(Number(payload.cash_paid) || 0);
        const creditAmount = round3(Number(payload.credit_amount) || 0);

        // Resolve session_id safely to prevent FK failure
        let validSessionId: string | null = null;
        if (payload.session_id) {
          const sessRow = db.prepare('SELECT id FROM register_sessions WHERE id = ?').get(payload.session_id);
          if (sessRow) {
            validSessionId = payload.session_id;
          } else {
            const openSess: any = db.prepare("SELECT id FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
            validSessionId = openSess?.id || null;
          }
        }

        // Resolve customer_id safely
        let validCustomerId: string | null = null;
        if (payload.customer_id) {
          const custRow = db.prepare('SELECT id FROM customers WHERE id = ?').get(payload.customer_id);
          if (custRow) {
            validCustomerId = payload.customer_id;
          }
        }

        // Insert sale
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
          validSessionId,
          date,
          validCustomerId,
          taxBreakdown.subtotalHT,
          0.19,
          taxBreakdown.tvaAmount,
          totalTTC,
          Number(payload.total_discount) || 0,
          cashAmount,
          walletAmount,
          creditAmount,
          Number(payload.change_given) || 0,
          temp_client_id,
          now
        );

        // Insert items
        const insertItem = db.prepare(`
          INSERT INTO sale_items (
            id, sale_id, product_id, is_quick_add, quick_add_name,
            pack_size_id, pack_multiplier, quantity, quantity_refunded,
            base_stock_deducted, unit_price, discount_amount, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `);

        for (const item of processedItems) {
          insertItem.run(
            item.id,
            saleId,
            item.product_id,
            item.is_quick_add,
            item.quick_add_name,
            item.pack_size_id,
            item.pack_multiplier,
            item.quantity,
            item.base_stock_deducted,
            item.unit_price,
            item.discount_amount,
            item.line_total
          );
        }

        // Wallet deduction
        if (walletAmount > 0 && payload.customer_id) {
          db.prepare(`
            UPDATE customers SET wallet_balance = wallet_balance - ?, updated_at = ? WHERE id = ?
          `).run(walletAmount, now, payload.customer_id);

          db.prepare(`
            INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, reference_id, notes, created_at)
            VALUES (?, ?, ?, 'SALE_PAYMENT', ?, ?, 'Offline sale sync payment', ?)
          `).run(crypto.randomUUID(), payload.customer_id, date, walletAmount, saleId, now);
        }

        // Credit debt ticket
        let createdTicketNumber = null;
        if (creditAmount > 0 && payload.customer_id) {
          createdTicketNumber = generateTicketNumber(db);
          db.prepare(`
            INSERT INTO customer_debt_tickets (
              id, ticket_number, customer_id, sale_id, date,
              total_amount, remaining_amount, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)
          `).run(
            crypto.randomUUID(),
            createdTicketNumber,
            payload.customer_id,
            saleId,
            date,
            creditAmount,
            creditAmount,
            now,
            now
          );
        }

        // Process container loans for items with loan_container = true
        if (payload.customer_id && Array.isArray(payload.items)) {
          for (const item of payload.items) {
            if (item.loan_container && item.product_id) {
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
                  db.prepare(`
                    INSERT INTO container_transactions (id, date, customer_id, container_type_id, action, quantity, notes, created_at)
                    VALUES (?, ?, ?, ?, 'GIVE', ?, ?, ?)
                  `).run(crypto.randomUUID(), date, payload.customer_id, containerTypeId, cQty, `Prêt consigne vente ${receiptNumber}`, now);

                  db.prepare(`
                    UPDATE container_types
                    SET stock_quantity = stock_quantity - ?
                    WHERE id = ?
                  `).run(cQty, containerTypeId);

                  db.prepare(`
                    INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(customer_id, container_type_id)
                    DO UPDATE SET quantity_owed = quantity_owed + excluded.quantity_owed
                  `).run(crypto.randomUUID(), payload.customer_id, containerTypeId, cQty);
                }
              }
            }
          }
        }

        reconciled.push({
          temp_client_id,
          action_type: 'SALE',
          server_id: saleId,
          receipt_number: receiptNumber,
          ticket_number: createdTicketNumber,
          status: 'SYNCED'
        });
      } else if (action_type === 'CASH_MOVEMENT') {
        const movId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          movId,
          payload.session_id,
          payload.date || now,
          payload.type,
          round3(Number(payload.amount)),
          payload.reason,
          now
        );

        reconciled.push({
          temp_client_id,
          action_type: 'CASH_MOVEMENT',
          server_id: movId,
          status: 'SYNCED'
        });
      } else if (action_type === 'CONTAINER_TRANSACTION') {
        const txId = crypto.randomUUID();
        const { customer_id, container_type_id, action, quantity, notes } = payload;
        const qty = parseInt(quantity, 10);

        db.prepare(`
          INSERT INTO container_transactions (id, date, customer_id, container_type_id, action, quantity, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(txId, payload.date || now, customer_id, container_type_id, action, qty, notes || '', now);

        if (action === 'GIVE') {
          db.prepare('UPDATE container_types SET stock_quantity = stock_quantity - ? WHERE id = ?').run(qty, container_type_id);
          db.prepare(`
            INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(customer_id, container_type_id)
            DO UPDATE SET quantity_owed = quantity_owed + excluded.quantity_owed
          `).run(crypto.randomUUID(), customer_id, container_type_id, qty);
        } else if (action === 'RETURN') {
          db.prepare('UPDATE container_types SET stock_quantity = stock_quantity + ? WHERE id = ?').run(qty, container_type_id);
          db.prepare(`
            INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
            VALUES (?, ?, ?, 0)
            ON CONFLICT(customer_id, container_type_id)
            DO UPDATE SET quantity_owed = MAX(0, quantity_owed - ?)
          `).run(crypto.randomUUID(), customer_id, container_type_id, qty);
        }

        reconciled.push({
          temp_client_id,
          action_type: 'CONTAINER_TRANSACTION',
          server_id: txId,
          status: 'SYNCED'
        });
      } else if (action_type === 'PRICE_STOCK_EDIT') {
        const { product_id, retail_price, wholesale_price, stock_quantity } = payload;
        db.prepare(`
          UPDATE products
          SET retail_price = COALESCE(?, retail_price),
              wholesale_price = COALESCE(?, wholesale_price),
              stock_quantity = COALESCE(?, stock_quantity),
              updated_at = ?
          WHERE id = ?
        `).run(
          retail_price !== undefined ? round3(Number(retail_price)) : null,
          wholesale_price !== undefined ? round3(Number(wholesale_price)) : null,
          stock_quantity !== undefined ? Number(stock_quantity) : null,
          now,
          product_id
        );

        reconciled.push({
          temp_client_id,
          action_type: 'PRICE_STOCK_EDIT',
          product_id,
          status: 'SYNCED'
        });
      }
    });

    opTx();
  } catch (err: any) {
    failed.push({
      temp_client_id,
      action_type,
      reason: err.message || 'OP_FAILED'
    });
  }
}

res.json({
  success: true,
  processed_count: reconciled.length,
  reconciled,
  failed
});
});
