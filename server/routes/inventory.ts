import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { tunisDayRangeUTC, isFilterDay } from '../utils/businessDate.js';

export const inventoryRouter = Router();

// GET /api/inventory/adjustments - list manual stock adjustments audit log
inventoryRouter.get('/adjustments', (req: Request, res: Response) => {
  const db = getDb();
  const { item_type, date } = req.query;

  let query = `
    SELECT ia.*,
      COALESCE(rm.name, p.name) as item_name,
      COALESCE(rm.category, pf.category) as category,
      COALESCE(rm.unit, p.size_label) as unit_or_size
    FROM inventory_adjustments ia
    LEFT JOIN raw_materials rm ON ia.material_id = rm.id
    LEFT JOIN products p ON ia.product_id = p.id
    LEFT JOIN product_families pf ON p.family_id = pf.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (item_type) {
    query += ` AND ia.item_type = ?`;
    params.push(String(item_type));
  }

  if (date) {
    const day = String(date);
    if (isFilterDay(day)) {
      const range = tunisDayRangeUTC(day);
      query += ` AND ia.date >= ? AND ia.date < ?`;
      params.push(range.start, range.end);
    } else {
      query += ` AND date(ia.date) = date(?)`;
      params.push(day);
    }
  }

  query += ` ORDER BY ia.date DESC, ia.created_at DESC`;

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// POST /api/inventory/adjust & /api/inventory/adjustment - record manual stock adjustment (shrinkage, damage, miscount)
const handleAdjust = (req: Request, res: Response) => {
  const {
    item_type, // 'RAW_MATERIAL' or 'PRODUCT'
    item_id,
    material_id,
    product_id,
    quantity_delta,
    reason,
    date = new Date().toISOString()
  } = req.body;

  const itemId = item_id || material_id || product_id;

  if (!item_type || !itemId || quantity_delta === undefined || !reason) {
    res.status(400).json({ error: 'item_type, item_id (or material_id/product_id), quantity_delta, and reason are required' });
    return;
  }

  if (item_type !== 'RAW_MATERIAL' && item_type !== 'PRODUCT') {
    res.status(400).json({ error: 'item_type must be RAW_MATERIAL or PRODUCT' });
    return;
  }

  const delta = Number(quantity_delta);
  if (!Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: 'quantity_delta must be a non-zero number' });
    return;
  }

  const db = getDb();
  const adjustmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  let updatedStock = 0;

  const adjustTx = db.transaction(() => {
    if (item_type === 'RAW_MATERIAL') {
      const material: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(itemId);
      if (!material) {
        throw new Error(`Raw material not found: ${itemId}`);
      }

      db.prepare(`
        UPDATE raw_materials
        SET stock_quantity = stock_quantity + ?,
            updated_at = ?
        WHERE id = ?
      `).run(delta, now, itemId);

      db.prepare(`
        INSERT INTO inventory_adjustments (id, date, item_type, material_id, product_id, quantity_delta, reason, created_at)
        VALUES (?, ?, 'RAW_MATERIAL', ?, NULL, ?, ?, ?)
      `).run(adjustmentId, date, itemId, delta, reason.trim(), now);

      const refreshed: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(itemId);
      updatedStock = refreshed.stock_quantity;
    } else {
      const product: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(itemId);
      if (!product) {
        throw new Error(`Product SKU not found: ${itemId}`);
      }

      db.prepare(`
        UPDATE products
        SET stock_quantity = stock_quantity + ?,
            updated_at = ?
        WHERE id = ?
      `).run(delta, now, itemId);

      db.prepare(`
        INSERT INTO inventory_adjustments (id, date, item_type, material_id, product_id, quantity_delta, reason, created_at)
        VALUES (?, ?, 'PRODUCT', NULL, ?, ?, ?, ?)
      `).run(adjustmentId, date, itemId, delta, reason.trim(), now);

      const refreshed: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(itemId);
      updatedStock = refreshed.stock_quantity;
    }
  });

  try {
    adjustTx();
  } catch (err: any) {
    res.status(404).json({ error: err.message });
    return;
  }

  res.status(201).json({
    success: true,
    id: adjustmentId,
    item_type,
    item_id: itemId,
    quantity_delta: delta,
    reason: reason.trim(),
    new_stock: updatedStock,
    new_stock_quantity: updatedStock,
    date
  });
};

inventoryRouter.post('/adjust', handleAdjust);
inventoryRouter.post('/adjustment', handleAdjust);
inventoryRouter.post('/adjustments', handleAdjust);

// DELETE /api/inventory/adjustments/:id - rollback and delete stock adjustment
inventoryRouter.delete('/adjustments/:id', (req: Request, res: Response) => {
  const db = getDb();
  const adj: any = db.prepare('SELECT * FROM inventory_adjustments WHERE id = ?').get(req.params.id);
  if (!adj) {
    res.status(404).json({ error: 'Inventory adjustment not found' });
    return;
  }

  const now = new Date().toISOString();
  const rollbackTx = db.transaction(() => {
    if (adj.item_type === 'RAW_MATERIAL' && adj.material_id) {
      db.prepare(`
        UPDATE raw_materials
        SET stock_quantity = stock_quantity - ?,
            updated_at = ?
        WHERE id = ?
      `).run(adj.quantity_delta, now, adj.material_id);
    } else if (adj.item_type === 'PRODUCT' && adj.product_id) {
      db.prepare(`
        UPDATE products
        SET stock_quantity = stock_quantity - ?,
            updated_at = ?
        WHERE id = ?
      `).run(adj.quantity_delta, now, adj.product_id);
    }

    db.prepare('DELETE FROM inventory_adjustments WHERE id = ?').run(req.params.id);
  });

  try {
    rollbackTx();
    res.json({ success: true, id: req.params.id, message: 'Stock adjustment rolled back and deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
