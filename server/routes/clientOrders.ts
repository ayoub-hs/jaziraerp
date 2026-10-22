import { isUniqueViolation } from '../db/index.js';
import { DELIVERY_FEE_LINE_NAME } from '../constants.js';
import { generateDeliveryNoteNumber } from './sales.js';
import { recordContainerTransaction, NotFoundError } from '../services/containerService.js';
import { createSale, SaleError } from '../services/saleService.js';
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3, addMoney } from '../utils/money.js';
import { businessDateKey } from '../utils/businessDate.js';
import { normalizePhone } from '../utils/phone.js';
import { ValidationError, validateOrderQuantity } from '../utils/validation.js';
import { beginIdempotentRequest } from '../utils/idempotency.js';
import { completeRequest } from '../services/idempotencyService.js';
import { computeExpectedCatalogPrice } from '../services/saleService.js';

export class OrderError extends Error {
  public status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'OrderError';
    this.status = status;
  }
}

export const clientOrdersRouter = Router();

export function generateOrderNumber(db: any): string {
  const dateStr = businessDateKey();
  const prefix = `ORD-${dateStr}-`;
  const maxRow: any = db.prepare(`
    SELECT MAX(CAST(SUBSTR(order_number, ?) AS INTEGER)) as max_seq
    FROM client_orders
    WHERE order_number LIKE ?
  `).get(prefix.length + 1, `${prefix}%`);
  const seq = ((Number(maxRow?.max_seq) || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// Helper to calculate items and totals
export function prepareOrderItems(db: any, rawItems: any[], customer: any) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ValidationError('La commande doit contenir au moins un article.');
  }

  const itemsToInsert: any[] = [];
  let subtotal = 0;

  for (const item of rawItems) {
    if (!item.product_id) {
      throw new ValidationError("L'identifiant du produit est obligatoire pour chaque article.");
    }

    const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (!product) {
      throw new ValidationError(`Produit introuvable: ${item.product_id}`);
    }

    const qty = validateOrderQuantity(
      item.quantity ?? item.ordered_quantity,
      product,
      `quantité pour le produit "${product.name}"`
    );

    let packMultiplier = 1;
    let packSizeId: string | null = null;
    if (item.pack_size_id) {
      const ps: any = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ? AND product_id = ?').get(item.pack_size_id, product.id);
      if (!ps) {
        throw new ValidationError(`Conditionnement introuvable pour le produit: ${product.name}`);
      }
      packSizeId = ps.id;
      packMultiplier = Number(ps.multiplier) || 1;
    }

    let containerTypeId: string | null = null;
    if (item.container_type_id) {
      const ct: any = db.prepare('SELECT id FROM container_types WHERE id = ?').get(item.container_type_id);
      if (!ct) {
        throw new ValidationError(`Type de contenant introuvable: ${item.container_type_id}`);
      }
      containerTypeId = ct.id;
    }

    const catalogPrice = computeExpectedCatalogPrice(db, product, customer, packSizeId, packMultiplier);
    const unitPriceTtc = catalogPrice ?? Number(product.retail_price);
    const lineTotalTtc = round3(unitPriceTtc * qty);
    subtotal = addMoney(subtotal, lineTotalTtc);

    itemsToInsert.push({
      id: `item-${crypto.randomUUID()}`,
      product_id: product.id,
      pack_size_id: packSizeId,
      container_type_id: containerTypeId,
      ordered_quantity: qty,
      delivered_quantity: null,
      pack_multiplier: packMultiplier,
      unit_price_ttc: unitPriceTtc,
      catalog_unit_price_snapshot: unitPriceTtc,
      line_total_ttc: lineTotalTtc,
      notes: item.notes ? String(item.notes).trim() : null
    });
  }

  return { itemsToInsert, subtotalTtc: round3(subtotal) };
}

// Shared cancellation logic for POST /:id/cancel and PATCH /:id/status -> CANCELLED
export function cancelClientOrder(db: any, orderId: string, rawReason: unknown) {
  const order: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(orderId);
  if (!order) {
    throw new OrderError('Commande introuvable.', 404);
  }

  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    throw new OrderError(`Une commande au statut ${order.status} ne peut pas être annulée.`, 409);
  }

  if (typeof rawReason !== 'string' || !rawReason.trim()) {
    throw new OrderError("Le motif d'annulation est obligatoire.", 400);
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE client_orders
    SET status = 'CANCELLED',
        cancellation_reason = ?,
        updated_at = ?
    WHERE id = ?
  `).run(rawReason.trim(), now, order.id);

  return db.prepare('SELECT * FROM client_orders WHERE id = ?').get(order.id);
}

// GET /api/orders/pending-count - count of orders waiting for attention
clientOrdersRouter.get('/pending-count', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const row: any = db.prepare(`
      SELECT COUNT(*) as count FROM client_orders WHERE status IN ('NEW', 'CONFIRMED')
    `).get();
    res.json({ count: Number(row?.count) || 0 });
  } catch (err) {
    console.error('[clientOrders:pendingCount error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la récupération des commandes en attente.' });
  }
});

// GET /api/orders - list orders
clientOrdersRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, customer_id, delivery_zone_id, limit = '100', offset = '0' } = req.query;

    let query = `
      SELECT
        o.*,
        z.name as zone_name,
        c.name as registered_customer_name,
        (SELECT COUNT(*) FROM client_order_items WHERE order_id = o.id) as item_count
      FROM client_orders o
      LEFT JOIN delivery_zones z ON o.delivery_zone_id = z.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status && typeof status === 'string') {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        query += ' AND o.status = ?';
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        query += ` AND o.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
      }
    }

    if (customer_id && typeof customer_id === 'string') {
      query += ' AND o.customer_id = ?';
      params.push(customer_id);
    }

    if (delivery_zone_id && typeof delivery_zone_id === 'string') {
      query += ' AND o.delivery_zone_id = ?';
      params.push(delivery_zone_id);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit) || 100, Number(offset) || 0);

    const orders = db.prepare(query).all(...params);
    res.json(orders);
  } catch (err) {
    console.error('[clientOrders:list error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la récupération des commandes.' });
  }
});

// GET /api/orders/:id - get single order by ID or order_number
clientOrdersRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const order: any = db.prepare(`
      SELECT
        o.*,
        z.name as zone_name,
        z.delivery_fee as zone_delivery_fee,
        z.min_order_amount as zone_min_order_amount
      FROM client_orders o
      LEFT JOIN delivery_zones z ON o.delivery_zone_id = z.id
      WHERE o.id = ? OR o.order_number = ?
    `).get(req.params.id, req.params.id);

    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    const items = db.prepare(`
      SELECT
        i.*,
        p.name as product_name,
        p.size_label as product_size_label,
        p.barcode as product_barcode,
        ps.name as pack_size_name,
        ct.name as container_type_name
      FROM client_order_items i
      JOIN products p ON i.product_id = p.id
      LEFT JOIN product_pack_sizes ps ON i.pack_size_id = ps.id
      LEFT JOIN container_types ct ON i.container_type_id = ct.id
      WHERE i.order_id = ?
      ORDER BY i.rowid ASC
    `).all(order.id);

    res.json({
      ...order,
      items
    });
  } catch (err) {
    console.error('[clientOrders:get error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la récupération de la commande.' });
  }
});

// POST /api/orders - create manual entry order
clientOrdersRouter.post('/', (req: Request, res: Response) => {
  const db = getDb();

  // 1. Idempotency gate
  const rawRequestId = req.body?.client_request_id || req.body?.idempotency_key;
  if (!rawRequestId) {
    res.status(400).json({ error: "La clé d'idempotence (client_request_id) est obligatoire." });
    return;
  }
  req.body.client_request_id = rawRequestId;

  const idem = beginIdempotentRequest(db, req, res, 'CREATE_ORDER');
  if (idem.kind === 'REPLAYED') return;
  const requestId = idem.kind === 'CLAIMED' ? idem.requestId : null;

  try {
    const {
      customer_id = null,
      customer_name,
      customer_phone,
      delivery_address,
      delivery_zone_id,
      payment_preference = 'CASH_ON_DELIVERY',
      loan_containers_requested = 0,
      notes = null,
      items = []
    } = req.body;

    // Validate customer name & phone
    if (!customer_name || typeof customer_name !== 'string' || !customer_name.trim()) {
      res.status(400).json({ error: 'Le nom du client est obligatoire.' });
      return;
    }

    if (!customer_phone || typeof customer_phone !== 'string') {
      res.status(400).json({ error: 'Le numéro de téléphone est obligatoire.' });
      return;
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhone(customer_phone);
    } catch {
      res.status(400).json({ error: 'Numéro de téléphone invalide (8 chiffres requis).' });
      return;
    }

    if (!delivery_address || typeof delivery_address !== 'string' || !delivery_address.trim()) {
      res.status(400).json({ error: "L'adresse de livraison est obligatoire." });
      return;
    }

    // Validate zone
    if (!delivery_zone_id) {
      res.status(400).json({ error: 'La zone de livraison est obligatoire.' });
      return;
    }

    const zone: any = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(delivery_zone_id);
    if (!zone || zone.active !== 1) {
      res.status(400).json({ error: 'Zone de livraison introuvable ou inactive.' });
      return;
    }

    // Payment preference validation
    if (!['CASH_ON_DELIVERY', 'CREDIT_ACCOUNT'].includes(payment_preference)) {
      res.status(400).json({ error: 'Mode de paiement invalide (CASH_ON_DELIVERY ou CREDIT_ACCOUNT requis).' });
      return;
    }

    let customer: any = null;
    if (customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
      if (!customer) {
        res.status(400).json({ error: 'Client sélectionné introuvable.' });
        return;
      }
    } else if (payment_preference === 'CREDIT_ACCOUNT') {
      res.status(400).json({ error: 'Les commandes à crédit nécessitent un compte client.' });
      return;
    }

    // Compute prices and totals
    const prep = prepareOrderItems(db, items, customer);
    const preparedItems = prep.itemsToInsert;
    const subtotalTtc = prep.subtotalTtc;

    // Minimum order validation
    if (subtotalTtc < zone.min_order_amount) {
      res.status(400).json({
        error: `Le montant minimum de commande pour la zone ${zone.name} est de ${zone.min_order_amount.toFixed(3)} DT (actuel: ${subtotalTtc.toFixed(3)} DT).`
      });
      return;
    }

    const deliveryFee = round3(Number(zone.delivery_fee) || 0);
    const totalTtc = addMoney(subtotalTtc, deliveryFee);

    // Credit limit warning check
    let creditWarning = false;
    if (customer && customer.credit_limit !== null && payment_preference === 'CREDIT_ACCOUNT') {
      const openDebt: any = db.prepare(`
        SELECT COALESCE(SUM(remaining_amount), 0) as debt
        FROM customer_debt_tickets
        WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
      `).get(customer.id);

      const openOrders: any = db.prepare(`
        SELECT COALESCE(SUM(total_ttc), 0) as open_orders_total
        FROM client_orders
        WHERE customer_id = ? AND status IN ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY') AND payment_preference = 'CREDIT_ACCOUNT'
      `).get(customer.id);

      const totalExposure = addMoney(Number(openDebt?.debt) || 0, Number(openOrders?.open_orders_total) || 0);
      if (addMoney(totalExposure, totalTtc) > customer.credit_limit) {
        creditWarning = true;
      }
    }

    const orderId = `ord-${crypto.randomUUID()}`;
    const accessToken = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    let createdOrder: any = null;

    const createOrderTx = db.transaction(() => {
      const orderNumber = generateOrderNumber(db);

      db.prepare(`
        INSERT INTO client_orders (
          id, order_number, source, customer_id, customer_name, customer_phone,
          delivery_address, delivery_zone_id, subtotal_ttc, delivery_fee, total_ttc,
          payment_preference, loan_containers_requested, notes, status,
          idempotency_key, access_token, created_at, updated_at
        ) VALUES (
          ?, ?, 'MANUAL_ENTRY', ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, 'NEW',
          ?, ?, ?, ?
        )
      `).run(
        orderId, orderNumber, customer ? customer.id : null, customer_name.trim(), normalizedPhone,
        delivery_address.trim(), zone.id, subtotalTtc, deliveryFee, totalTtc,
        payment_preference, Math.max(0, Number(loan_containers_requested) || 0), notes ? String(notes).trim() : null,
        rawRequestId, accessToken, now, now
      );

      const insertItemStmt = db.prepare(`
        INSERT INTO client_order_items (
          id, order_id, product_id, pack_size_id, container_type_id,
          ordered_quantity, delivered_quantity, pack_multiplier, unit_price_ttc,
          catalog_unit_price_snapshot, line_total_ttc, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of preparedItems) {
        insertItemStmt.run(
          item.id, orderId, item.product_id, item.pack_size_id, item.container_type_id,
          item.ordered_quantity, item.delivered_quantity, item.pack_multiplier, item.unit_price_ttc,
          item.catalog_unit_price_snapshot, item.line_total_ttc, item.notes
        );
      }

      const insertedOrder: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(orderId);
      createdOrder = {
        ...insertedOrder,
        items: preparedItems,
        credit_warning: creditWarning
      };

      if (requestId) {
        completeRequest(db, requestId, {
          statusCode: 201,
          body: createdOrder,
          resourceId: orderId
        });
      }
    });

    createOrderTx();
    res.status(201).json(createdOrder);
  } catch (err: any) {
    if (err instanceof OrderError || err instanceof ValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[clientOrders:create error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la création de la commande.' });
  }
});

// PATCH /api/orders/:id/status - update order status
clientOrdersRouter.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status: newStatus, cancellation_reason } = req.body;
    if (!newStatus) {
      res.status(400).json({ error: 'Le nouveau statut est obligatoire.' });
      return;
    }

    if (newStatus === 'CANCELLED') {
      const updated = cancelClientOrder(db, req.params.id, cancellation_reason);
      res.json(updated);
      return;
    }

    const order: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    // Conversion required to reach DELIVERED
    if (newStatus === 'DELIVERED') {
      res.status(409).json({ error: "La livraison doit être validée via l'encaissement et la conversion de la commande." });
      return;
    }

    // Allowed transitions state machine:
    // NEW -> CONFIRMED, CANCELLED
    // CONFIRMED -> PREPARING, CANCELLED
    // PREPARING -> OUT_FOR_DELIVERY, CANCELLED
    // OUT_FOR_DELIVERY -> CANCELLED
    const validTransitions: Record<string, string[]> = {
      NEW: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PREPARING', 'CANCELLED'],
      PREPARING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
      OUT_FOR_DELIVERY: ['CANCELLED'],
      DELIVERED: [],
      CANCELLED: []
    };

    const allowed = validTransitions[order.status] || [];
    if (!allowed.includes(newStatus)) {
      res.status(409).json({ error: `Transition d'état invalide de ${order.status} vers ${newStatus}.` });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE client_orders
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newStatus, now, order.id);

    const updated = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(order.id);
    res.json(updated);
  } catch (err: any) {
    if (err instanceof OrderError || err instanceof ValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[clientOrders:updateStatus error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la mise à jour du statut.' });
  }
});

// POST /api/orders/:id/cancel - cancel order with reason
clientOrdersRouter.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const updated = cancelClientOrder(db, req.params.id, req.body?.reason);
    res.json(updated);
  } catch (err: any) {
    if (err instanceof OrderError || err instanceof ValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[clientOrders:cancel error]', err);
    res.status(500).json({ error: "Une erreur interne est survenue lors de l'annulation de la commande." });
  }
});

// PUT /api/orders/:id - edit order at NEW or CONFIRMED
clientOrdersRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const order: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    if (!['NEW', 'CONFIRMED'].includes(order.status)) {
      res.status(409).json({ error: `Impossible de modifier une commande au statut ${order.status}.` });
      return;
    }

    const {
      customer_name,
      customer_phone,
      delivery_address,
      delivery_zone_id,
      payment_preference,
      loan_containers_requested,
      notes,
      items
    } = req.body;

    let activeZone: any;
    let deliveryFee: number;
    let zoneChanged = false;

    if (delivery_zone_id !== undefined && delivery_zone_id !== order.delivery_zone_id) {
      activeZone = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(delivery_zone_id);
      if (!activeZone || activeZone.active !== 1) {
        res.status(400).json({ error: 'Zone de livraison introuvable ou inactive.' });
        return;
      }
      deliveryFee = round3(Number(activeZone.delivery_fee) || 0);
      zoneChanged = true;
    } else {
      activeZone = db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(order.delivery_zone_id);
      if (!activeZone) {
        res.status(400).json({ error: 'Zone de livraison de la commande introuvable.' });
        return;
      }
      deliveryFee = round3(Number(order.delivery_fee) || 0);
      zoneChanged = false;
    }

    let normalizedPhone = order.customer_phone;
    if (customer_phone !== undefined) {
      try {
        normalizedPhone = normalizePhone(customer_phone);
      } catch {
        res.status(400).json({ error: 'Numéro de téléphone invalide (8 chiffres requis).' });
        return;
      }
    }

    let customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
    const newPaymentPref = payment_preference ?? order.payment_preference;
    if (newPaymentPref === 'CREDIT_ACCOUNT' && !customer) {
      res.status(400).json({ error: 'Les commandes à crédit nécessitent un compte client.' });
      return;
    }

    let preparedItems: any[] = [];
    let subtotalTtc = round3(Number(order.subtotal_ttc) || 0);

    if (items !== undefined) {
      const prep = prepareOrderItems(db, items, customer);
      preparedItems = prep.itemsToInsert;
      subtotalTtc = prep.subtotalTtc;

      if (subtotalTtc < activeZone.min_order_amount) {
        res.status(400).json({
          error: `Le montant minimum de commande pour la zone ${activeZone.name} est de ${activeZone.min_order_amount.toFixed(3)} DT (actuel: ${subtotalTtc.toFixed(3)} DT).`
        });
        return;
      }
    } else if (zoneChanged) {
      if (subtotalTtc < activeZone.min_order_amount) {
        res.status(400).json({
          error: `Le montant minimum de commande pour la zone ${activeZone.name} est de ${activeZone.min_order_amount.toFixed(3)} DT (actuel: ${subtotalTtc.toFixed(3)} DT).`
        });
        return;
      }
    }

    // Maintain consistent total: total = subtotal + fee
    const totalTtc = addMoney(subtotalTtc, deliveryFee);

    const now = new Date().toISOString();

    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE client_orders
        SET customer_name = COALESCE(?, customer_name),
            customer_phone = ?,
            delivery_address = COALESCE(?, delivery_address),
            delivery_zone_id = ?,
            subtotal_ttc = ?,
            delivery_fee = ?,
            total_ttc = ?,
            payment_preference = ?,
            loan_containers_requested = COALESCE(?, loan_containers_requested),
            notes = COALESCE(?, notes),
            updated_at = ?
        WHERE id = ?
      `).run(
        customer_name !== undefined ? customer_name.trim() : null,
        normalizedPhone,
        delivery_address !== undefined ? delivery_address.trim() : null,
        activeZone.id,
        subtotalTtc,
        deliveryFee,
        totalTtc,
        newPaymentPref,
        loan_containers_requested !== undefined ? Math.max(0, Number(loan_containers_requested) || 0) : null,
        notes !== undefined ? (notes ? String(notes).trim() : null) : null,
        now,
        order.id
      );

      if (items !== undefined) {
        db.prepare('DELETE FROM client_order_items WHERE order_id = ?').run(order.id);
        const insertItemStmt = db.prepare(`
          INSERT INTO client_order_items (
            id, order_id, product_id, pack_size_id, container_type_id,
            ordered_quantity, delivered_quantity, pack_multiplier, unit_price_ttc,
            catalog_unit_price_snapshot, line_total_ttc, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of preparedItems) {
          insertItemStmt.run(
            item.id, order.id, item.product_id, item.pack_size_id, item.container_type_id,
            item.ordered_quantity, item.delivered_quantity, item.pack_multiplier, item.unit_price_ttc,
            item.catalog_unit_price_snapshot, item.line_total_ttc, item.notes
          );
        }
      }
    });

    updateTx();

    const updatedOrder: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(order.id);
    const updatedItems = db.prepare('SELECT * FROM client_order_items WHERE order_id = ?').all(order.id);
    res.json({
      ...updatedOrder,
      items: updatedItems
    });
  } catch (err: any) {
    if (err instanceof OrderError || err instanceof ValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[clientOrders:update error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la modification de la commande.' });
  }
});


export function translateSaleError(message: string): string {
  if (!message) return 'Erreur lors de la validation de la vente.';

  // Payment total mismatch
  if (/Payment total.*does not equal sale total/i.test(message)) {
    const match = message.match(/Payment total \(([^)]+)\) does not equal sale total \(([^)]+)\)/i);
    if (match) {
      const paid = match[1];
      const total = match[2];
      return `Le total des paiements (${paid}) ne correspond pas au total de la vente (${total}).`;
    }
    return 'Le total des paiements ne correspond pas au total de la vente.';
  }

  // Non-negative / finite amount errors
  if (/must be non-negative/i.test(message)) {
    const field = message.split(' ')[0];
    return `Le montant "${field}" doit être un nombre positif ou nul.`;
  }
  if (/must be a finite number/i.test(message)) {
    const field = message.split(' ')[0];
    return `Le montant "${field}" doit être un nombre valide.`;
  }

  // Cash tendered less than cash paid
  if (/cannot be less than cash_paid/i.test(message)) {
    return 'Le montant reçu en espèces ne peut pas être inférieur au montant payé.';
  }

  // Insufficient wallet
  if (/Insufficient wallet balance/i.test(message)) {
    return 'Solde du portefeuille client insuffisant pour couvrir le montant demandé.';
  }

  if (/Cannot pay with wallet without selecting a customer/i.test(message)) {
    return 'Le paiement par portefeuille nécessite un compte client.';
  }

  if (/Credit sale.*requires selecting a customer/i.test(message)) {
    return 'La vente à crédit nécessite un compte client.';
  }

  if (/At least one line item is required/i.test(message)) {
    return 'La vente doit contenir au moins un article.';
  }

  return message;
}

// POST /api/orders/:id/convert - convert client order into sale and delivery note
clientOrdersRouter.post('/:id/convert', (req: Request, res: Response) => {
  const db = getDb();

  // 1. Idempotency gate with scope = order id
  const rawRequestId = req.body?.client_request_id || req.body?.idempotency_key;
  if (!rawRequestId) {
    res.status(400).json({ error: "La clé d'idempotence (client_request_id) est obligatoire." });
    return;
  }
  req.body.client_request_id = rawRequestId;

  const idem = beginIdempotentRequest(db, req, res, 'CONVERT_ORDER', req.params.id);
  if (idem.kind === 'REPLAYED') return;
  const requestId = idem.kind === 'CLAIMED' ? idem.requestId : null;

  try {
    // 2. Lookup order
    const order: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Commande introuvable.' });
      return;
    }

    // 3. Status checks:
    // Order already converted
    if (order.sale_id !== null) {
      res.status(409).json({ error: 'Cette commande a déjà été convertie en vente.' });
      return;
    }

    // Only CONFIRMED, PREPARING, OUT_FOR_DELIVERY are convertible
    const CONVERTIBLE_STATUSES = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'];
    if (!CONVERTIBLE_STATUSES.includes(order.status)) {
      res.status(409).json({
        error: `Impossible de convertir une commande au statut ${order.status}. Seules les commandes aux statuts CONFIRMED, PREPARING ou OUT_FOR_DELIVERY peuvent être converties.`
      });
      return;
    }

    // 4. Register session check: counter 'Livraison' must have an OPEN session
    let resolvedSessionId: string;
    if (req.body?.register_session_id) {
      const session: any = db.prepare('SELECT * FROM register_sessions WHERE id = ?').get(req.body.register_session_id);
      if (!session || session.status !== 'OPEN' || session.counter_name !== 'Livraison') {
        res.status(409).json({ error: 'Aucune session de caisse ouverte pour le comptoir Livraison.' });
        return;
      }
      resolvedSessionId = session.id;
    } else {
      const session: any = db.prepare(`
        SELECT * FROM register_sessions
        WHERE counter_name = 'Livraison' AND status = 'OPEN'
        ORDER BY opened_at DESC LIMIT 1
      `).get();
      if (!session) {
        res.status(409).json({ error: 'Aucune session de caisse ouverte pour le comptoir Livraison.' });
        return;
      }
      resolvedSessionId = session.id;
    }

    // 5. Customer & Guest validation
    let customer: any = null;
    if (order.customer_id) {
      customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
    } else {
      // Guest order
      if ((Number(req.body?.wallet_paid) || 0) > 0 || (Number(req.body?.credit_amount) || 0) > 0) {
        res.status(400).json({ error: 'Les clients sans compte ne peuvent pas payer par crédit ou portefeuille.' });
        return;
      }
      if (
        (Array.isArray(req.body?.containers_returned) && req.body.containers_returned.length > 0) ||
        (Array.isArray(req.body?.containers_borrowed) && req.body.containers_borrowed.length > 0) ||
        (Array.isArray(req.body?.containers_loaned) && req.body.containers_loaned.length > 0)
      ) {
        res.status(400).json({ error: 'Le suivi des consignes nécessite un compte client.' });
        return;
      }
    }

    // 6. Item Quantities & Delivery Reconciliation
    const orderItems: any[] = db.prepare('SELECT * FROM client_order_items WHERE order_id = ? ORDER BY rowid ASC').all(order.id);
    const orderItemMap = new Map<string, any>(orderItems.map(item => [item.id, item]));

    const productMap = new Map<string, any>();
    for (const item of orderItems) {
      if (!productMap.has(item.product_id)) {
        const prod = db.prepare('SELECT id, name, size_label FROM products WHERE id = ?').get(item.product_id);
        productMap.set(item.product_id, prod);
      }
    }

    const deliveredMap = new Map<string, number>();

    if (req.body?.delivered_items !== undefined) {
      if (!Array.isArray(req.body.delivered_items)) {
        res.status(400).json({ error: 'delivered_items doit être une liste.' });
        return;
      }

      const seenIds = new Set<string>();

      for (const di of req.body.delivered_items) {
        const itemId = di?.order_item_id || di?.id;
        if (!itemId || typeof itemId !== 'string') {
          res.status(400).json({ error: "L'identifiant de l'article (order_item_id) est obligatoire." });
          return;
        }

        // Requirement 2: Any delivered_items entry whose order_item_id is not an item of this order gives 400
        if (!orderItemMap.has(itemId)) {
          res.status(400).json({ error: `L'article "${itemId}" n'appartient pas à cette commande.` });
          return;
        }

        // Requirement 2: Duplicate ids in the array give 400
        if (seenIds.has(itemId)) {
          res.status(400).json({ error: `L'article "${itemId}" est présent plusieurs fois dans les articles livrés.` });
          return;
        }
        seenIds.add(itemId);

        const orderItem = orderItemMap.get(itemId)!;
        const product = productMap.get(orderItem.product_id) || { name: 'Produit', size_label: null };

        const rawQty = di.delivered_quantity;
        if (rawQty === undefined || rawQty === null || rawQty === '') {
          res.status(400).json({ error: `La quantité livrée pour l'article "${itemId}" est obligatoire.` });
          return;
        }

        let dQty: number;
        // Requirement 3: Delivered quantities go through validateOrderQuantity rules; 0 stays allowed as a refusal.
        if (rawQty === 0 || rawQty === '0' || Number(rawQty) === 0) {
          dQty = 0;
        } else {
          try {
            dQty = validateOrderQuantity(rawQty, product, `quantité livrée pour le produit "${product.name}"`);
          } catch (valErr: any) {
            res.status(400).json({ error: valErr.message });
            return;
          }
        }

        // Requirement 1: delivered_quantity greater than the line's ordered_quantity gives 400 (French)
        if (dQty > Number(orderItem.ordered_quantity)) {
          res.status(400).json({
            error: `La quantité livrée (${dQty}) ne peut pas dépasser la quantité commandée (${orderItem.ordered_quantity}) pour le produit "${product.name}".`
          });
          return;
        }

        deliveredMap.set(itemId, dQty);
      }
    }

    const saleItems: any[] = [];
    const itemUpdates: Array<{ id: string; delivered_quantity: number }> = [];

    for (const orderItem of orderItems) {
      const deliveredQty = deliveredMap.has(orderItem.id)
        ? deliveredMap.get(orderItem.id)!
        : Number(orderItem.ordered_quantity);

      itemUpdates.push({ id: orderItem.id, delivered_quantity: deliveredQty });

      if (deliveredQty > 0) {
        saleItems.push({
          product_id: orderItem.product_id,
          pack_size_id: orderItem.pack_size_id,
          quantity: deliveredQty,
          unit_price: round3(Number(orderItem.unit_price_ttc)),
          discount_amount: 0
        });
      }
    }

    // Append delivery fee if > 0
    const deliveryFee = round3(Number(order.delivery_fee) || 0);
    if (deliveryFee > 0) {
      saleItems.push({
        is_quick_add: true,
        quick_add_name: DELIVERY_FEE_LINE_NAME,
        quantity: 1,
        unit_price: deliveryFee,
        discount_amount: 0
      });
    }

    if (saleItems.length === 0) {
      res.status(400).json({ error: 'Aucun article livré et aucun frais de livraison: la commande ne peut pas être convertie.' });
      return;
    }

    // Expected total TTC = sum of line items + delivery fee
    let expectedTotalTtc = 0;
    for (const item of saleItems) {
      expectedTotalTtc = addMoney(expectedTotalTtc, round3(Number(item.unit_price) * Number(item.quantity)));
    }
    expectedTotalTtc = round3(expectedTotalTtc);

    // 7. Payment breakdown
    const hasExplicitPayment =
      req.body?.cash_paid !== undefined ||
      req.body?.wallet_paid !== undefined ||
      req.body?.credit_amount !== undefined;

    let cashPaid = 0;
    let walletPaid = 0;
    let creditAmount = 0;
    let cashTendered = 0;

    if (hasExplicitPayment) {
      cashPaid = round3(Number(req.body.cash_paid) || 0);
      walletPaid = round3(Number(req.body.wallet_paid) || 0);
      creditAmount = round3(Number(req.body.credit_amount) || 0);
      cashTendered = req.body.cash_tendered !== undefined ? round3(Number(req.body.cash_tendered) || 0) : cashPaid;
    } else {
      if (order.payment_preference === 'CREDIT_ACCOUNT' && customer) {
        creditAmount = expectedTotalTtc;
      } else {
        cashPaid = expectedTotalTtc;
        cashTendered = expectedTotalTtc;
      }
    }

    const now = new Date().toISOString();
    let responsePayload: any = null;

    // 8. Outer transaction wrapping ALL steps
    const convertTx = db.transaction(() => {
      // A. Update delivered_quantity in client_order_items
      const updateItemStmt = db.prepare('UPDATE client_order_items SET delivered_quantity = ? WHERE id = ?');
      for (const update of itemUpdates) {
        updateItemStmt.run(update.delivered_quantity, update.id);
      }

      // B. Create Sale
      const saleResult = createSale(db, {
        session_id: resolvedSessionId,
        customer_id: order.customer_id,
        date: now,
        items: saleItems,
        cash_paid: cashPaid,
        cash_tendered: cashTendered,
        wallet_paid: walletPaid,
        credit_amount: creditAmount
      });

      // C. Generate Delivery Note (BL-YYYYMMDD-XXXX) with collision retry
      let noteNumber = generateDeliveryNoteNumber(db);
      let noteCreated = false;
      let noteRow: any = null;
      for (let attempt = 0; attempt < 3 && !noteCreated; attempt++) {
        try {
          const noteId = `bl-${crypto.randomUUID()}`;
          db.prepare(`
            INSERT INTO delivery_notes (id, sale_id, number, created_at)
            VALUES (?, ?, ?, ?)
          `).run(noteId, saleResult.id, noteNumber, now);
          noteRow = { id: noteId, sale_id: saleResult.id, number: noteNumber, created_at: now };
          noteCreated = true;
        } catch (err: any) {
          if (isUniqueViolation(err) && attempt < 2) {
            noteNumber = generateDeliveryNoteNumber(db);
            continue;
          }
          throw err;
        }
      }

      // D. Process Container Returns & Loans via containerService.recordContainerTransaction
      if (Array.isArray(req.body?.containers_returned)) {
        for (const ret of req.body.containers_returned) {
          recordContainerTransaction(db, {
            customer_id: order.customer_id!,
            container_type_id: ret.container_type_id,
            action: 'RETURN',
            quantity: ret.quantity,
            notes: `Retour consigne commande ${order.order_number}`
          });
        }
      }

      const borrowedList = req.body?.containers_borrowed || req.body?.containers_loaned;
      if (Array.isArray(borrowedList)) {
        for (const loan of borrowedList) {
          recordContainerTransaction(db, {
            customer_id: order.customer_id!,
            container_type_id: loan.container_type_id,
            action: 'GIVE',
            quantity: loan.quantity,
            notes: `Prêt consigne commande ${order.order_number}`
          });
        }
      }

      // E. Update client_orders: status = 'DELIVERED', sale_id = saleResult.id
      db.prepare(`
        UPDATE client_orders
        SET status = 'DELIVERED',
            sale_id = ?,
            delivered_by = COALESCE(?, delivered_by),
            updated_at = ?
        WHERE id = ?
      `).run(saleResult.id, req.body?.delivered_by || null, now, order.id);

      // F. Re-query updated order and items
      const updatedOrder: any = db.prepare('SELECT * FROM client_orders WHERE id = ?').get(order.id);
      const updatedItems = db.prepare('SELECT * FROM client_order_items WHERE order_id = ?').all(order.id);

      // G. Non-blocking credit warning check
      const warnings: string[] = [];
      if (customer && customer.credit_limit !== null && creditAmount > 0) {
        const openDebt: any = db.prepare(`
          SELECT COALESCE(SUM(remaining_amount), 0) as debt
          FROM customer_debt_tickets
          WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
        `).get(customer.id);
        const debtTotal = Number(openDebt?.debt) || 0;
        if (debtTotal > customer.credit_limit) {
          warnings.push(
            `Plafond de crédit dépassé pour le client ${customer.name} (encours: ${debtTotal.toFixed(3)} DT, plafond: ${customer.credit_limit.toFixed(3)} DT).`
          );
        }
      }

      responsePayload = {
        order: {
          ...updatedOrder,
          items: updatedItems
        },
        sale: saleResult.sale,
        delivery_note_number: noteRow.number,
        warnings
      };

      // H. Idempotency completion inside same transaction
      if (requestId) {
        completeRequest(db, requestId, {
          statusCode: 200,
          body: responsePayload,
          resourceId: order.id
        });
      }
    });

    convertTx();
    res.status(200).json(responsePayload);
  } catch (err: any) {
    if (err instanceof SaleError) {
      const rawMsg = typeof err.body === 'string' ? err.body : err.body?.error;
      const frenchMsg = translateSaleError(rawMsg);
      res.status(err.status).json({ error: frenchMsg });
      return;
    }
    if (err instanceof OrderError || err instanceof ValidationError || err instanceof NotFoundError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[clientOrders:convert error]', err);
    res.status(500).json({ error: 'Une erreur interne est survenue lors de la conversion de la commande.' });
  }
});
