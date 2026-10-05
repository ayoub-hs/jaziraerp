import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { getMaterialUnitCosts, getMaterialUnitCost } from '../services/costingService.js';

export const materialsRouter = Router();

export interface MaterialPriceRecordOptions {
  materialId: string;
  costPerUnit: number;
  supplierId?: string | null;
  quantityAdded?: number;
  date?: string;
  purchaseId?: string | null;
}

/**
 * Service function to update a material's stock and record price history.
 * Called directly when purchasing or adjusting materials.
 */
export function recordMaterialPriceHistory(
  db: any,
  options: MaterialPriceRecordOptions
) {
  const date = options.date || new Date().toISOString();
  const cost = round3(options.costPerUnit);
  const now = new Date().toISOString();

  const historyId = crypto.randomUUID();

  // Record price history
  db.prepare(`
    INSERT INTO material_price_history (id, material_id, supplier_id, cost_per_unit, date, purchase_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    historyId,
    options.materialId,
    options.supplierId || null,
    cost,
    date,
    options.purchaseId || null
  );

  // Update raw_material latest_purchase_cost, latest_supplier_id, and optionally stock_quantity
  if (options.quantityAdded !== undefined && options.quantityAdded !== 0) {
    db.prepare(`
      UPDATE raw_materials
      SET stock_quantity = stock_quantity + ?,
          latest_purchase_cost = ?,
          latest_supplier_id = COALESCE(?, latest_supplier_id),
          updated_at = ?
      WHERE id = ?
    `).run(
      options.quantityAdded,
      cost,
      options.supplierId || null,
      now,
      options.materialId
    );
  } else {
    db.prepare(`
      UPDATE raw_materials
      SET latest_purchase_cost = ?,
          latest_supplier_id = COALESCE(?, latest_supplier_id),
          updated_at = ?
      WHERE id = ?
    `).run(
      cost,
      options.supplierId || null,
      now,
      options.materialId
    );
  }
}

// GET /api/materials - list all materials with supplier name and low stock flag
materialsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { category, low_stock, search, active = '1' } = req.query;

  let query = `
    SELECT m.*, s.name as latest_supplier_name,
      CASE WHEN m.stock_quantity <= m.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM raw_materials m
    LEFT JOIN suppliers s ON m.latest_supplier_id = s.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (active === '1') {
    query += ` AND (m.active = 1 OR m.active IS NULL)`;
  }

  if (category) {
    query += ` AND LOWER(m.category) = LOWER(?)`;
    params.push(String(category));
  }

  if (low_stock === 'true' || low_stock === '1') {
    query += ` AND m.stock_quantity <= m.low_stock_threshold`;
  }

  if (search) {
    query += ` AND (LOWER(m.name) LIKE LOWER(?) OR LOWER(m.category) LIKE LOWER(?))`;
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY m.name ASC`;

  const rows = db.prepare(query).all(...params);
  const unitCosts = getMaterialUnitCosts(db);
  const enriched = rows.map((m: any) => ({
    ...m,
    current_cost_per_unit: unitCosts.get(m.id) ?? round3(Number(m.latest_purchase_cost) || 0)
  }));
  res.json(enriched);
});

// GET /api/materials/:id - get single material with recent history
materialsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const material: any = db.prepare(`
    SELECT m.*, s.name as latest_supplier_name,
      CASE WHEN m.stock_quantity <= m.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM raw_materials m
    LEFT JOIN suppliers s ON m.latest_supplier_id = s.id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const history = db.prepare(`
    SELECT h.*, s.name as supplier_name
    FROM material_price_history h
    LEFT JOIN suppliers s ON h.supplier_id = s.id
    WHERE h.material_id = ?
    ORDER BY h.date DESC
  `).all(req.params.id);

  const unitCost = getMaterialUnitCost(db, req.params.id);

  res.json({
    ...material,
    current_cost_per_unit: unitCost,
    price_history: history
  });
});

// POST /api/materials - create raw material or packaging
materialsRouter.post('/', (req: Request, res: Response) => {
  const {
    name,
    category,
    unit,
    stock_quantity = 0,
    latest_supplier_id = null,
    latest_purchase_cost = 0,
    low_stock_threshold = 0
  } = req.body;

  if (!name || !category || !unit) {
    res.status(400).json({ error: 'Name, category, and unit are required.' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cost = round3(Number(latest_purchase_cost) || 0);
  const stock = Number(stock_quantity || req.body.initial_stock) || 0;
  const threshold = Number(low_stock_threshold) || 0;

  const insert = db.prepare(`
    INSERT INTO raw_materials (
      id, name, category, unit, stock_quantity, latest_supplier_id,
      latest_purchase_cost, low_stock_threshold, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    id,
    name.trim(),
    category.trim(),
    unit.trim(),
    stock,
    latest_supplier_id,
    cost,
    threshold,
    now,
    now
  );

  // If initial cost or supplier provided, record in history
  if (cost > 0 || latest_supplier_id) {
    recordMaterialPriceHistory(db, {
      materialId: id,
      costPerUnit: cost,
      supplierId: latest_supplier_id,
      date: now
    });
  }

  const created = db.prepare(`
    SELECT m.*, s.name as latest_supplier_name
    FROM raw_materials m
    LEFT JOIN suppliers s ON m.latest_supplier_id = s.id
    WHERE m.id = ?
  `).get(id);

  res.status(201).json(created);
});

// PUT /api/materials/:id - update material metadata
materialsRouter.put('/:id', (req: Request, res: Response) => {
  const { name, category, unit, low_stock_threshold, latest_supplier_id } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE raw_materials
    SET name = COALESCE(?, name),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        low_stock_threshold = COALESCE(?, low_stock_threshold),
        latest_supplier_id = COALESCE(?, latest_supplier_id),
        updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    category !== undefined ? category.trim() : null,
    unit !== undefined ? unit.trim() : null,
    low_stock_threshold !== undefined ? Number(low_stock_threshold) : null,
    latest_supplier_id !== undefined ? latest_supplier_id : null,
    now,
    req.params.id
  );

  if (req.body.latest_purchase_cost !== undefined && Number(req.body.latest_purchase_cost) >= 0) {
    recordMaterialPriceHistory(db, {
      materialId: req.params.id,
      costPerUnit: Number(req.body.latest_purchase_cost),
      supplierId: latest_supplier_id !== undefined ? latest_supplier_id : existing.latest_supplier_id,
      date: now
    });
  }

  const updated = db.prepare(`
    SELECT m.*, s.name as latest_supplier_name
    FROM raw_materials m
    LEFT JOIN suppliers s ON m.latest_supplier_id = s.id
    WHERE m.id = ?
  `).get(req.params.id);

  res.json(updated);
});

// GET /api/materials/:id/history & /:id/price-history - price history trend
const getMaterialHistory = (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT h.*, s.name as supplier_name
    FROM material_price_history h
    LEFT JOIN suppliers s ON h.supplier_id = s.id
    WHERE h.material_id = ?
    ORDER BY h.date ASC
  `).all(req.params.id);

  res.json(rows);
};

materialsRouter.get('/:id/history', getMaterialHistory);
materialsRouter.get('/:id/price-history', getMaterialHistory);

// DELETE /api/materials/:id - delete or soft-delete raw material
materialsRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const material: any = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(req.params.id);
  if (!material) {
    res.status(404).json({ error: 'Material not found' });
    return;
  }

  // Check references: formulation_items, production_batch_materials_consumed, purchase_items, inventory_adjustments
  const hasFormulas: any = db.prepare('SELECT COUNT(*) as count FROM formulation_items WHERE material_id = ?').get(req.params.id);
  const hasBatches: any = db.prepare('SELECT COUNT(*) as count FROM production_batch_materials_consumed WHERE material_id = ?').get(req.params.id);
  const hasPurchases: any = db.prepare('SELECT COUNT(*) as count FROM purchase_items WHERE material_id = ?').get(req.params.id);
  const hasAdjustments: any = db.prepare('SELECT COUNT(*) as count FROM inventory_adjustments WHERE material_id = ?').get(req.params.id);

  const isReferenced = (hasFormulas?.count > 0) || (hasBatches?.count > 0) || (hasPurchases?.count > 0) || (hasAdjustments?.count > 0);

  if (isReferenced) {
    res.status(409).json({ error: 'Cannot delete raw material referenced in formulations, production batches, purchases, or inventory adjustments' });
    return;
  }

  db.prepare('DELETE FROM raw_materials WHERE id = ?').run(req.params.id);
  res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Material deleted permanently' });
});
