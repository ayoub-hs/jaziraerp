import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { calculateBatchRequirements } from '../services/costingService.js';

export const productionRouter = Router();

function generateBatchNumber(db: any): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `BAT-${dateStr}-`;
  const countRow: any = db.prepare(`
    SELECT COUNT(*) as cnt FROM production_batches WHERE batch_number LIKE ?
  `).get(`${prefix}%`);
  const seq = ((countRow?.cnt || 0) + 1).toString().padStart(4, '0');
  return `${prefix}${seq}`;
}

// GET /api/production/batches - list production batch history
productionRouter.get('/batches', (req: Request, res: Response) => {
  const db = getDb();
  const batches = db.prepare(`
    SELECT pb.*, f.name as formulation_name, p.name as target_product_name, p.size_label
    FROM production_batches pb
    JOIN formulations f ON pb.formulation_id = f.id
    JOIN products p ON pb.target_product_id = p.id
    ORDER BY pb.date DESC, pb.created_at DESC
  `).all();

  res.json(batches);
});

// GET /api/production/batches/:id - single batch details with materials consumed
productionRouter.get('/batches/:id', (req: Request, res: Response) => {
  const db = getDb();
  const batch: any = db.prepare(`
    SELECT pb.*, f.name as formulation_name, p.name as target_product_name, p.size_label
    FROM production_batches pb
    JOIN formulations f ON pb.formulation_id = f.id
    JOIN products p ON pb.target_product_id = p.id
    WHERE pb.id = ?
  `).get(req.params.id);

  if (!batch) {
    res.status(404).json({ error: 'Production batch not found' });
    return;
  }

  const materials = db.prepare(`
    SELECT mc.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit
    FROM production_batch_materials_consumed mc
    JOIN raw_materials rm ON mc.material_id = rm.id
    WHERE mc.batch_id = ?
  `).all(req.params.id);

  res.json({ ...batch, materials_consumed: materials });
});

// POST /api/production/batches - execute a production run
productionRouter.post('/batches', (req: Request, res: Response) => {
  const {
    formulation_id,
    target_product_id,
    units_produced,
    date = new Date().toISOString(),
    notes = '',
    batch_number
  } = req.body;

  if (!formulation_id || !target_product_id || !units_produced || Number(units_produced) <= 0) {
    res.status(400).json({ error: 'formulation_id, target_product_id, and units_produced (> 0) are required.' });
    return;
  }

  const db = getDb();
  const formulation: any = db.prepare('SELECT * FROM formulations WHERE id = ?').get(formulation_id);
  if (!formulation) {
    res.status(404).json({ error: 'Formulation not found' });
    return;
  }

  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(target_product_id);
  if (!product) {
    res.status(404).json({ error: 'Target product SKU not found' });
    return;
  }

  // Target product's family must be manufactured with this exact formulation.
  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(product.family_id);
  if (!family || family.type !== 'MANUFACTURED') {
    res.status(400).json({ error: 'Target product must belong to a MANUFACTURED family to run a production batch.' });
    return;
  }
  if (family.formulation_id !== formulation_id) {
    res.status(400).json({ error: 'Chosen formulation does not match the target product family formulation.' });
    return;
  }

  const units = Number(units_produced);
  const batchRequirements = calculateBatchRequirements(db, formulation_id, units);
  const finalBatchNumber = batch_number ? String(batch_number).trim() : generateBatchNumber(db);
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Track negative stock warnings without blocking
  const negativeStockWarnings: any[] = [];
  for (const ing of batchRequirements.ingredients) {
    if (ing.remaining_stock_after_batch < 0) {
      negativeStockWarnings.push({
        material_id: ing.material_id,
        material_name: ing.material_name,
        current_stock: ing.current_stock,
        quantity_required: ing.quantity_consumed,
        deficit: round3(Math.abs(ing.remaining_stock_after_batch)),
        unit: ing.material_unit
      });
    }
  }

  const executeTx = db.transaction(() => {
    // 1. Insert production batch record
    db.prepare(`
      INSERT INTO production_batches (
        id, batch_number, date, formulation_id, target_product_id,
        units_produced, total_batch_cost, cost_per_unit, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      batchId,
      finalBatchNumber,
      date,
      formulation_id,
      target_product_id,
      units,
      batchRequirements.totalBatchCost,
      batchRequirements.costPerUnit,
      notes,
      now
    );

    // 2. Deduct materials & packaging and insert consumed records
    const insertConsumed = db.prepare(`
      INSERT INTO production_batch_materials_consumed (
        id, batch_id, material_id, quantity_consumed, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deductMaterial = db.prepare(`
      UPDATE raw_materials
      SET stock_quantity = stock_quantity - ?,
          updated_at = ?
      WHERE id = ?
    `);

    for (const ing of batchRequirements.ingredients) {
      insertConsumed.run(
        crypto.randomUUID(),
        batchId,
        ing.material_id,
        ing.quantity_consumed,
        ing.unit_cost,
        ing.total_cost
      );

      deductMaterial.run(ing.quantity_consumed, now, ing.material_id);
    }

    // 3. Add finished goods to target product and update cost_reference
    db.prepare(`
      UPDATE products
      SET stock_quantity = stock_quantity + ?,
          cost_reference = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      units,
      batchRequirements.costPerUnit,
      now,
      target_product_id
    );
  });

  executeTx();

  const createdBatch: any = db.prepare(`
    SELECT pb.*, f.name as formulation_name, p.name as target_product_name, p.size_label, p.stock_quantity as new_stock_quantity
    FROM production_batches pb
    JOIN formulations f ON pb.formulation_id = f.id
    JOIN products p ON pb.target_product_id = p.id
    WHERE pb.id = ?
  `).get(batchId);

  const materialsConsumed = db.prepare(`
    SELECT mc.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit
    FROM production_batch_materials_consumed mc
    JOIN raw_materials rm ON mc.material_id = rm.id
    WHERE mc.batch_id = ?
  `).all(batchId);

  res.status(201).json({
    ...createdBatch,
    materials_consumed: materialsConsumed,
    negative_stock_warnings: negativeStockWarnings
  });
});
