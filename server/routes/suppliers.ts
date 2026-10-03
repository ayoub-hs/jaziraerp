import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3, addMoney, multiplyMoney } from '../utils/money.js';
import { recordMaterialPriceHistory } from './materials.js';
import { allocateSupplierPayment } from '../services/debtService.js';

export const suppliersRouter = Router();
export const purchasesRouter = Router();
suppliersRouter.use('/purchases', purchasesRouter);

function generatePurchaseNumber(db: any): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `PO-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM purchases WHERE purchase_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

function generateSupplierTicketNumber(db: any): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `STKT-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM supplier_debt_tickets WHERE ticket_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// ==========================================
// Suppliers
// ==========================================

// GET /api/suppliers - list all suppliers with outstanding debt
suppliersRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { active = '1' } = req.query;
  let query = 'SELECT * FROM suppliers WHERE 1=1';
  if (active === '1') {
    query += ' AND (active = 1 OR active IS NULL)';
  }
  query += ' ORDER BY name ASC';
  const suppliers: any[] = db.prepare(query).all();

  const enriched = suppliers.map((s) => {
    const debtSummary: any = db.prepare(`
      SELECT
        COALESCE(SUM(remaining_amount), 0) as total_debt,
        COUNT(*) as open_ticket_count
      FROM supplier_debt_tickets
      WHERE supplier_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    `).get(s.id);

    return {
      ...s,
      total_debt: round3(debtSummary?.total_debt || 0),
      open_ticket_count: debtSummary?.open_ticket_count || 0
    };
  });

  res.json(enriched);
});

// GET /api/suppliers/:id - single supplier
suppliersRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const supplier: any = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);

  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }

  const debtSummary: any = db.prepare(`
    SELECT
      COALESCE(SUM(remaining_amount), 0) as total_debt,
      COUNT(*) as open_ticket_count
    FROM supplier_debt_tickets
    WHERE supplier_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
  `).get(supplier.id);

  const debtTickets = db.prepare(`
    SELECT * FROM supplier_debt_tickets
    WHERE supplier_id = ?
    ORDER BY date ASC, created_at ASC
  `).all(supplier.id);

  res.json({
    ...supplier,
    total_debt: round3(debtSummary?.total_debt || 0),
    open_ticket_count: debtSummary?.open_ticket_count || 0,
    debt_tickets: debtTickets
  });
});

// POST /api/suppliers - create supplier
suppliersRouter.post('/', (req: Request, res: Response) => {
  const { name, phone = null, address = null } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Supplier name is required.' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO suppliers (id, name, phone, address, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), phone, address, now, now);

  const created = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PUT /api/suppliers/:id - update supplier
suppliersRouter.put('/:id', (req: Request, res: Response) => {
  const { name, phone, address } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE suppliers
    SET name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    phone !== undefined ? phone : null,
    address !== undefined ? address : null,
    now,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/suppliers/:id - delete or soft-delete supplier
suppliersRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const supplier: any = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }

  // Check references: purchases, supplier_debt_tickets, raw_materials
  const hasPurchases: any = db.prepare('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?').get(req.params.id);
  const hasTickets: any = db.prepare('SELECT COUNT(*) as count FROM supplier_debt_tickets WHERE supplier_id = ?').get(req.params.id);
  const hasMaterials: any = db.prepare('SELECT COUNT(*) as count FROM raw_materials WHERE latest_supplier_id = ?').get(req.params.id);

  const isReferenced = (hasPurchases?.count > 0) || (hasTickets?.count > 0) || (hasMaterials?.count > 0);

  if (isReferenced) {
    db.prepare('UPDATE suppliers SET active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), req.params.id);
    res.json({ success: true, soft_deleted: true, id: req.params.id, message: 'Supplier deactivated (preserved in purchase & debt history)' });
  } else {
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
    res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Supplier deleted permanently' });
  }
});

// GET /api/suppliers/:id/tickets - list supplier debt tickets
suppliersRouter.get('/:id/tickets', (req: Request, res: Response) => {
  const db = getDb();
  const { status = 'OPEN' } = req.query;

  let query = `
    SELECT sdt.*, p.purchase_number
    FROM supplier_debt_tickets sdt
    LEFT JOIN purchases p ON sdt.purchase_id = p.id
    WHERE sdt.supplier_id = ?
  `;
  const params: any[] = [req.params.id];

  if (status === 'OPEN') {
    query += ` AND sdt.status IN ('UNPAID', 'PARTIALLY_PAID')`;
  } else if (status === 'PAID') {
    query += ` AND sdt.status = 'PAID'`;
  }

  query += ` ORDER BY sdt.date ASC, sdt.created_at ASC`;

  const tickets = db.prepare(query).all(...params);
  res.json(tickets);
});

// Handler for supplier debt payments
const handleSupplierPayment = (req: Request, res: Response) => {
  const { amount, payment_method = 'Cash', notes = '', date } = req.body;

  if (!amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'Payment amount must be greater than zero.' });
    return;
  }

  const db = getDb();
  try {
    const result = allocateSupplierPayment(db, {
      supplierId: req.params.id,
      amount: Number(amount),
      paymentMethod: payment_method,
      notes,
      date
    });

    const debtSummary: any = db.prepare(`
      SELECT COALESCE(SUM(remaining_amount), 0) as total_debt
      FROM supplier_debt_tickets
      WHERE supplier_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
    `).get(req.params.id);

    res.status(200).json({
      success: true,
      allocated: result.amount_allocated,
      remaining_balance: round3(debtSummary?.total_debt || 0),
      ...result
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

// POST /api/suppliers/:id/payments & /debt/repay & /pay-debt - record payment to supplier (FIFO oldest first)
suppliersRouter.post('/:id/payments', handleSupplierPayment);
suppliersRouter.post('/:id/debt/repay', handleSupplierPayment);
suppliersRouter.post('/:id/pay-debt', handleSupplierPayment);

// ==========================================
// Purchases (Raw Materials & Resale Goods)
// ==========================================

// GET /api/purchases - list purchases
purchasesRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const purchases = db.prepare(`
    SELECT p.*, s.name as supplier_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) as item_count,
      sdt.remaining_amount as debt_remaining,
      sdt.total_amount as debt_ticket_total,
      CASE 
        WHEN p.payment_status = 'PAID' THEN p.total_amount
        WHEN sdt.id IS NOT NULL THEN ROUND(p.total_amount - sdt.remaining_amount, 3)
        ELSE 0
      END as cash_paid,
      CASE
        WHEN p.payment_status = 'PAID' THEN 0
        WHEN sdt.id IS NOT NULL THEN sdt.remaining_amount
        ELSE p.total_amount
      END as debt_amount
    FROM purchases p
    JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN supplier_debt_tickets sdt ON sdt.purchase_id = p.id
    ORDER BY p.date DESC, p.created_at DESC
  `).all();

  res.json(purchases);
});

// GET /api/purchases/:id - single purchase details with items
purchasesRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const purchase: any = db.prepare(`
    SELECT p.*, s.name as supplier_name
    FROM purchases p
    JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!purchase) {
    res.status(404).json({ error: 'Purchase not found' });
    return;
  }

  const items = db.prepare(`
    SELECT pi.*,
      COALESCE(rm.name, pr.name) as item_name,
      COALESCE(rm.category, pr.size_label) as item_category_or_size,
      rm.unit as material_unit
    FROM purchase_items pi
    LEFT JOIN raw_materials rm ON pi.material_id = rm.id
    LEFT JOIN products pr ON pi.product_id = pr.id
    WHERE pi.purchase_id = ?
  `).all(req.params.id);

  res.json({ ...purchase, items });
});

// POST /api/purchases - record purchase (immediate stock increase, cash vs credit debt ticket)
purchasesRouter.post('/', (req: Request, res: Response) => {
  const {
    supplier_id,
    date = new Date().toISOString(),
    notes = '',
    items = []
  } = req.body;

  let rawItems = Array.isArray(items) ? [...items] : [];
  if (rawItems.length === 0 && req.body.item_id) {
    const itType = req.body.type === 'RESALE_PRODUCT' ? 'RESALE_PRODUCT' : 'RAW_MATERIAL';
    rawItems.push({
      item_type: itType,
      material_id: itType === 'RAW_MATERIAL' ? req.body.item_id : null,
      product_id: itType === 'RESALE_PRODUCT' ? req.body.item_id : null,
      quantity: req.body.quantity,
      unit_cost: req.body.unit_cost
    });
  }

  if (!supplier_id || rawItems.length === 0) {
    res.status(400).json({ error: 'supplier_id and at least one item are required.' });
    return;
  }

  const db = getDb();
  const supplier: any = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier_id);
  if (!supplier) {
    res.status(404).json({ error: 'Supplier not found' });
    return;
  }

  const purchaseId = crypto.randomUUID();
  const purchaseNumber = generatePurchaseNumber(db);
  const now = new Date().toISOString();

  let totalAmount = 0;
  const processedItems: any[] = [];

  for (const item of rawItems) {
    const qty = Number(item.quantity);
    const unitCost = round3(Number(item.unit_cost));
    const lineTotal = multiplyMoney(unitCost, qty);

    if (qty <= 0 || unitCost < 0) {
      res.status(400).json({ error: 'Quantity must be > 0 and unit_cost >= 0' });
      return;
    }

    const itemType = item.item_type || (item.material_id ? 'RAW_MATERIAL' : 'RESALE_PRODUCT');
    if (itemType !== 'RAW_MATERIAL' && itemType !== 'RESALE_PRODUCT') {
      res.status(400).json({ error: 'item_type must be RAW_MATERIAL or RESALE_PRODUCT' });
      return;
    }

    totalAmount = addMoney(totalAmount, lineTotal);
    processedItems.push({
      ...item,
      item_type: itemType,
      quantity: qty,
      unit_cost: unitCost,
      total_cost: lineTotal
    });
  }

  // Determine payment status & debt amount
  let payment_status = req.body.payment_status || 'PAID';
  const cashPaid = req.body.cash_paid !== undefined && req.body.cash_paid !== null
    ? Number(req.body.cash_paid)
    : null;

  if (cashPaid !== null) {
    if (cashPaid >= totalAmount) {
      payment_status = 'PAID';
    } else {
      payment_status = 'CREDIT';
    }
  }

  if (payment_status !== 'PAID' && payment_status !== 'CREDIT') {
    res.status(400).json({ error: 'payment_status must be PAID or CREDIT' });
    return;
  }

  let createdTicket: any = null;

  const purchaseTx = db.transaction(() => {
    // 1. Insert purchase record
    db.prepare(`
      INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      purchaseId,
      purchaseNumber,
      supplier_id,
      date,
      totalAmount,
      payment_status,
      notes,
      now
    );

    // 2. Insert items and update inventory immediately (single-step stock intake)
    const insertItem = db.prepare(`
      INSERT INTO purchase_items (id, purchase_id, item_type, material_id, product_id, quantity, unit_cost, total_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of processedItems) {
      const itemId = crypto.randomUUID();
      insertItem.run(
        itemId,
        purchaseId,
        item.item_type,
        item.material_id || null,
        item.product_id || null,
        item.quantity,
        item.unit_cost,
        item.total_cost
      );

      if (item.item_type === 'RAW_MATERIAL') {
        // Record price history and add raw material stock
        recordMaterialPriceHistory(db, {
          materialId: item.material_id,
          costPerUnit: item.unit_cost,
          supplierId: supplier_id,
          quantityAdded: item.quantity,
          date,
          purchaseId
        });
      } else if (item.item_type === 'RESALE_PRODUCT') {
        // Resale good: Add to product stock and update cost_reference
        db.prepare(`
          UPDATE products
          SET stock_quantity = stock_quantity + ?,
              cost_reference = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          item.quantity,
          item.unit_cost,
          now,
          item.product_id
        );
      }
    }

    // 3. If CREDIT purchase -> create open supplier debt ticket
    if (payment_status === 'CREDIT') {
      const ticketId = crypto.randomUUID();
      const ticketNumber = generateSupplierTicketNumber(db);
      const remainingAmount = cashPaid !== null
        ? round3(Math.max(0, totalAmount - cashPaid))
        : totalAmount;
      const initialStatus = remainingAmount < totalAmount ? 'PARTIALLY_PAID' : 'UNPAID';

      db.prepare(`
        INSERT INTO supplier_debt_tickets (
          id, ticket_number, supplier_id, purchase_id, date,
          total_amount, remaining_amount, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ticketId,
        ticketNumber,
        supplier_id,
        purchaseId,
        date,
        totalAmount,
        remainingAmount,
        initialStatus,
        now,
        now
      );

      createdTicket = {
        id: ticketId,
        ticket_number: ticketNumber,
        total_amount: totalAmount,
        remaining_amount: remainingAmount,
        status: initialStatus
      };
    }
  });

  purchaseTx();

  res.status(201).json({
    id: purchaseId,
    purchase_number: purchaseNumber,
    supplier_id,
    date,
    total_amount: totalAmount,
    payment_status,
    items: processedItems,
    debt_ticket: createdTicket
  });
});
