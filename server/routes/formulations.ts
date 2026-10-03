import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { calculateFormulationCost, calculateBatchRequirements } from '../services/costingService.js';

export const formulationsRouter = Router();

// GET /api/formulations - list all formulations with auto-calculated cost
formulationsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const rows: any[] = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM formulation_items fi WHERE fi.formulation_id = f.id) as item_count
    FROM formulations f
    ORDER BY f.name ASC
  `).all();

  const results = rows.map((f) => {
    try {
      const costInfo = calculateFormulationCost(db, f.id);
      return {
        ...f,
        total_cost: costInfo.total_cost,
        cost_per_unit: costInfo.cost_per_unit,
        total_batch_cost: costInfo.total_cost,
        cost_per_liter: costInfo.cost_per_unit
      };
    } catch {
      return {
        ...f,
        total_cost: 0,
        cost_per_unit: 0,
        total_batch_cost: 0,
        cost_per_liter: 0
      };
    }
  });

  res.json(results);
});

// GET /api/formulations/:id - get single formulation with itemized recipe costs
formulationsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const costInfo = calculateFormulationCost(db, req.params.id);
    const formulation: any = db.prepare('SELECT * FROM formulations WHERE id = ?').get(req.params.id);
    res.json({
      ...formulation,
      ...costInfo,
      total_batch_cost: costInfo.total_cost,
      cost_per_liter: costInfo.cost_per_unit
    });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Formulation not found' });
  }
});

// GET /api/formulations/:id/preview-batch - preview batch ingredient requirements & costing
formulationsRouter.get('/:id/preview-batch', (req: Request, res: Response) => {
  const db = getDb();
  const targetUnits = Number(req.query.target_units) || Number(req.query.target_batch_size) || 1;

  try {
    const preview = calculateBatchRequirements(db, req.params.id, targetUnits);
    res.json({
      ...preview,
      scale_factor: preview.scalingFactor,
      target_units: preview.targetOutputUnits
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/formulations - create formulation and its items
formulationsRouter.post('/', (req: Request, res: Response) => {
  const { name, notes = null, base_yield_quantity = 1, base_yield_unit = 'L', items = [] } = req.body;

  if (!name || !base_yield_unit) {
    res.status(400).json({ error: 'Name and base yield unit are required.' });
    return;
  }

  const yieldQty = Number(base_yield_quantity);
  if (yieldQty <= 0) {
    res.status(400).json({ error: 'Base yield quantity must be greater than zero.' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const insertFormulation = db.prepare(`
    INSERT INTO formulations (id, name, notes, base_yield_quantity, base_yield_unit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
    VALUES (?, ?, ?, ?)
  `);

  const createTx = db.transaction(() => {
    insertFormulation.run(id, name.trim(), notes, yieldQty, base_yield_unit.trim(), now, now);

    for (const item of items) {
      if (item.material_id && Number(item.quantity_required) > 0) {
        insertItem.run(
          crypto.randomUUID(),
          id,
          item.material_id,
          Number(item.quantity_required)
        );
      }
    }
  });

  createTx();

  const formulation: any = db.prepare('SELECT * FROM formulations WHERE id = ?').get(id);
  const costInfo = calculateFormulationCost(db, id);
  res.status(201).json({
    ...formulation,
    ...costInfo,
    total_batch_cost: costInfo.total_cost,
    cost_per_liter: costInfo.cost_per_unit
  });
});

// PUT /api/formulations/:id - update formulation and its items
formulationsRouter.put('/:id', (req: Request, res: Response) => {
  const { name, notes, base_yield_quantity, base_yield_unit, items } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM formulations WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Formulation not found' });
    return;
  }

  const now = new Date().toISOString();

  const updateTx = db.transaction(() => {
    db.prepare(`
      UPDATE formulations
      SET name = COALESCE(?, name),
          notes = COALESCE(?, notes),
          base_yield_quantity = COALESCE(?, base_yield_quantity),
          base_yield_unit = COALESCE(?, base_yield_unit),
          updated_at = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      notes !== undefined ? notes : null,
      base_yield_quantity !== undefined ? Number(base_yield_quantity) : null,
      base_yield_unit !== undefined ? base_yield_unit.trim() : null,
      now,
      req.params.id
    );

    if (Array.isArray(items)) {
      // Replace formulation items
      db.prepare('DELETE FROM formulation_items WHERE formulation_id = ?').run(req.params.id);
      const insertItem = db.prepare(`
        INSERT INTO formulation_items (id, formulation_id, material_id, quantity_required)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of items) {
        if (item.material_id && Number(item.quantity_required) > 0) {
          insertItem.run(
            crypto.randomUUID(),
            req.params.id,
            item.material_id,
            Number(item.quantity_required)
          );
        }
      }
    }
  });

  updateTx();

  const costInfo = calculateFormulationCost(db, req.params.id);
  res.json(costInfo);
});

// DELETE /api/formulations/:id - delete formulation
formulationsRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const linkedFamilies: any = db.prepare('SELECT COUNT(*) as count FROM product_families WHERE formulation_id = ?').get(req.params.id);
  if (linkedFamilies && linkedFamilies.count > 0) {
    res.status(400).json({ error: 'Cannot delete formulation linked to active product families' });
    return;
  }

  db.prepare('DELETE FROM formulations WHERE id = ?').run(req.params.id);
  res.json({ success: true, id: req.params.id });
});
