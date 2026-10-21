import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3, addMoney, multiplyMoney } from '../utils/money.js';
import { generateBarcode } from '../utils/barcode.js';
import { calculateFormulationCost, calculateProductUnitCost } from '../services/costingService.js';
import {
  requireFinitePositive,
  requireFiniteNonNegative,
  requireOptionalFiniteNonNegative,
  ValidationError,
  sanitizeErrorMessage
} from '../utils/validation.js';

export const productsRouter = Router();

// ==========================================
// Product Families
// ==========================================

// GET /api/products/families - list product families with SKUs and pack sizes
productsRouter.get('/families', (req: Request, res: Response) => {
  const db = getDb();
  const { active = '1' } = req.query;

  let familyQuery = `
    SELECT pf.*, f.name as formulation_name,
      (SELECT COUNT(*) FROM products p WHERE p.family_id = pf.id AND (p.active = 1 OR ? != '1')) as sku_count
    FROM product_families pf
    LEFT JOIN formulations f ON pf.formulation_id = f.id
  `;
  const famParams: any[] = [String(active)];

  if (active === '1') {
    familyQuery += ` WHERE pf.active = 1`;
  } else if (active === '0') {
    familyQuery += ` WHERE pf.active = 0`;
  }

  familyQuery += ` ORDER BY pf.name ASC`;
  const families: any[] = db.prepare(familyQuery).all(...famParams);

  const result = families.map((family) => {
    let prodQuery = `
      SELECT p.*,
        CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
      FROM products p
      WHERE p.family_id = ?
    `;
    const prodParams: any[] = [family.id];

    if (active === '1') {
      prodQuery += ` AND p.active = 1`;
    } else if (active === '0') {
      prodQuery += ` AND p.active = 0`;
    }

    prodQuery += ` ORDER BY p.size_label ASC, p.name ASC`;

    const products: any[] = db.prepare(prodQuery).all(...prodParams);

    const enrichedProducts = products.map((prod) => {
      const packSizes = db.prepare(`
        SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
      `).all(prod.id);
      return { ...prod, pack_sizes: packSizes };
    });

    return { ...family, products: enrichedProducts };
  });

  res.json(result);
});

// POST /api/products/families - create family (Manufactured or Resale)
productsRouter.post('/families', (req: Request, res: Response) => {
  const { name, category, type, formulation_id = null, image_url = null } = req.body;

  if (!name || !category || !type) {
    res.status(400).json({ error: 'Name, category, and type (MANUFACTURED or RESALE) are required.' });
    return;
  }

  if (type !== 'MANUFACTURED' && type !== 'RESALE') {
    res.status(400).json({ error: 'Type must be MANUFACTURED or RESALE' });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO product_families (id, name, category, type, formulation_id, image_url, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, name.trim(), category.trim(), type, formulation_id || null, image_url || null, now, now);

  const created = db.prepare('SELECT * FROM product_families WHERE id = ?').get(id);
  res.status(201).json(created);
});

// GET /api/products/families/:id - get single family with products
productsRouter.get('/families/:id', (req: Request, res: Response) => {
  const db = getDb();
  const family: any = db.prepare(`
    SELECT pf.*, f.name as formulation_name
    FROM product_families pf
    LEFT JOIN formulations f ON pf.formulation_id = f.id
    WHERE pf.id = ?
  `).get(req.params.id);

  if (!family) {
    res.status(404).json({ error: 'Family not found' });
    return;
  }

  const products: any[] = db.prepare(`
    SELECT p.*,
      CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM products p
    WHERE p.family_id = ? AND p.active = 1
    ORDER BY p.size_label ASC, p.name ASC
  `).all(family.id);

  const enrichedProducts = products.map((prod) => {
    const packSizes = db.prepare(`
      SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
    `).all(prod.id);
    return { ...prod, pack_sizes: packSizes };
  });

  res.json({ ...family, products: enrichedProducts });
});

// PUT /api/products/families/:id - update family
productsRouter.put('/families/:id', (req: Request, res: Response) => {
  const { name, category, type, formulation_id, image_url, active } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Family not found' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE product_families
    SET name = COALESCE(?, name),
        category = COALESCE(?, category),
        type = COALESCE(?, type),
        formulation_id = COALESCE(?, formulation_id),
        image_url = COALESCE(?, image_url),
        active = COALESCE(?, active),
        updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    category !== undefined ? category.trim() : null,
    type !== undefined ? type : null,
    formulation_id !== undefined ? formulation_id : null,
    image_url !== undefined ? image_url : null,
    active !== undefined ? Number(active) : null,
    now,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM product_families WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ==========================================
// Products (Liquid/Weight SKUs)
// ==========================================

// GET /api/products - list all SKUs with family details, pack sizes, and low-stock alerts
productsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { category, family_id, low_stock, search, active = '1' } = req.query;

  let query = `
    SELECT p.*, pf.name as family_name, pf.category as category, pf.type as product_type,
      pf.formulation_id, ct.name as container_type_name,
      CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    LEFT JOIN container_types ct ON p.container_type_id = ct.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (active === '1') {
    query += ` AND p.active = 1 AND pf.active = 1`;
  } else if (active === '0') {
    query += ` AND (p.active = 0 OR pf.active = 0)`;
  }

  if (category) {
    query += ` AND LOWER(pf.category) = LOWER(?)`;
    params.push(String(category));
  }

  if (family_id) {
    query += ` AND p.family_id = ?`;
    params.push(String(family_id));
  }

  if (low_stock === 'true' || low_stock === '1') {
    query += ` AND p.stock_quantity <= p.low_stock_threshold`;
  }

  if (search) {
    query += ` AND (LOWER(p.name) LIKE LOWER(?) OR LOWER(p.barcode) LIKE LOWER(?) OR LOWER(pf.name) LIKE LOWER(?))`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY pf.name ASC, p.size_label ASC, p.name ASC`;

  const products: any[] = db.prepare(query).all(...params);

  const enriched = products.map((prod) => {
    const packSizes = db.prepare(`
      SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
    `).all(prod.id);
    return { ...prod, pack_sizes: packSizes };
  });

  res.json(enriched);
});

// GET /api/products/lookup/:barcode - instant lookup for POS scanner
productsRouter.get('/lookup/:barcode', (req: Request, res: Response) => {
  const db = getDb();
  const barcode = req.params.barcode.trim();

  // 1. Direct SKU match
  const product: any = db.prepare(`
    SELECT p.*, pf.name as family_name, pf.category as category, pf.type as product_type,
      pf.formulation_id, ct.name as container_type_name,
      CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    LEFT JOIN container_types ct ON p.container_type_id = ct.id
    WHERE p.barcode = ? AND p.active = 1
  `).get(barcode);

  if (product) {
    const packSizes = db.prepare(`
      SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
    `).all(product.id);
    res.json({
      match_type: 'SKU',
      product: { ...product, pack_sizes: packSizes }
    });
    return;
  }

  // 2. Pack size barcode match
  const packSize: any = db.prepare(`
    SELECT * FROM product_pack_sizes WHERE barcode = ?
  `).get(barcode);

  if (packSize) {
    const parentProduct: any = db.prepare(`
      SELECT p.*, pf.name as family_name, pf.category as category, pf.type as product_type,
        pf.formulation_id, ct.name as container_type_name,
        CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
      FROM products p
      JOIN product_families pf ON p.family_id = pf.id
      LEFT JOIN container_types ct ON p.container_type_id = ct.id
      WHERE p.id = ? AND p.active = 1
    `).get(packSize.product_id);

    if (parentProduct) {
      const packSizes = db.prepare(`
        SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
      `).all(parentProduct.id);
      res.json({
        match_type: 'PACK_SIZE',
        matched_pack_size: packSize,
        product: { ...parentProduct, pack_sizes: packSizes }
      });
      return;
    }
  }

  res.status(404).json({ error: `No product found matching barcode ${barcode}` });
});

// GET /api/products/cost-preview - backoffice preview of manufactured product unit costs
productsRouter.get('/cost-preview', (req: Request, res: Response) => {
  const db = getDb();
  const products: any[] = db.prepare(`
    SELECT p.*, pf.name as family_name, pf.formulation_id
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    WHERE pf.type = 'MANUFACTURED' AND p.active = 1
    ORDER BY pf.name ASC, p.name ASC
  `).all();

  const preview = products.map((prod) => {
    if (prod.size_volume === null || prod.size_volume === undefined) {
      return {
        product_id: prod.id,
        product_name: prod.name,
        size_label: prod.size_label,
        size_volume: null,
        current_cost: prod.cost_reference,
        calculated_cost: null,
        status: 'size manquante'
      };
    }
    try {
      const costInfo = calculateProductUnitCost(db, prod.id);
      return {
        product_id: prod.id,
        product_name: prod.name,
        size_label: prod.size_label,
        size_volume: prod.size_volume,
        current_cost: prod.cost_reference,
        calculated_cost: costInfo.cost_per_finished_unit,
        status: 'ok'
      };
    } catch {
      return {
        product_id: prod.id,
        product_name: prod.name,
        size_label: prod.size_label,
        size_volume: prod.size_volume,
        current_cost: prod.cost_reference,
        calculated_cost: null,
        status: 'erreur'
      };
    }
  });

  res.json(preview);
});

function parseSuggestedVolume(label?: string | null, name?: string | null): number | null {
  const text = `${label || ''} ${name || ''}`.trim();
  if (!text) return null;

  if (/\bvrac\b/i.test(text)) {
    return 1.0;
  }

  const litreMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:l|litre|litres|lt|lts)\b/i);
  if (litreMatch) {
    const val = parseFloat(litreMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return round3(val);
  }

  const kgMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|kilos)\b/i);
  if (kgMatch) {
    const val = parseFloat(kgMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return round3(val);
  }

  const mlMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:ml)\b/i);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return round3(val / 1000);
  }

  const clMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:cl)\b/i);
  if (clMatch) {
    const val = parseFloat(clMatch[1].replace(',', '.'));
    if (Number.isFinite(val) && val > 0) return round3(val / 100);
  }

  return null;
}

// POST /api/products/backfill-size-preview - scan manufactured products with NULL size_volume & suggest candidate volumes
productsRouter.post('/backfill-size-preview', (req: Request, res: Response) => {
  const db = getDb();
  const rows: any[] = db.prepare(`
    SELECT p.id, p.name, p.size_label, p.size_volume, p.stock_quantity, p.cost_reference,
           pf.id as family_id, pf.name as family_name, pf.type as family_type
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    WHERE pf.type = 'MANUFACTURED' AND p.size_volume IS NULL
    ORDER BY p.name ASC
  `).all();

  const candidates = rows.map(r => {
    const suggested = parseSuggestedVolume(r.size_label, r.name);
    const stock = Number(r.stock_quantity) || 0;
    const cost = Number(r.cost_reference) || 0;
    const currentValuation = round3(stock * cost);
    return {
      id: r.id,
      name: r.name,
      family_id: r.family_id,
      family_name: r.family_name,
      size_label: r.size_label,
      size_volume: r.size_volume,
      suggested_size_volume: suggested,
      stock_quantity: stock,
      current_cost: round3(cost),
      current_valuation: currentValuation
    };
  });

  res.json({
    candidates,
    total_candidates: candidates.length
  });
});

// POST /api/products/backfill-size-confirm - update size_volume in one transaction, reporting valuation
productsRouter.post('/backfill-size-confirm', (req: Request, res: Response) => {
  const db = getDb();
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "La liste des articles à mettre à jour est requise." });
    return;
  }

  const validated: Array<{ id: string; size_volume: number }> = [];
  for (const it of items) {
    if (!it || typeof it.id !== 'string') {
      res.status(400).json({ error: "Identifiant d'article invalide." });
      return;
    }
    let vol: number;
    try {
      vol = requireFinitePositive(it.size_volume, "volume unitaire (size_volume)");
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
    const product: any = db.prepare(`
      SELECT p.*, pf.type as family_type
      FROM products p
      JOIN product_families pf ON p.family_id = pf.id
      WHERE p.id = ?
    `).get(it.id);

    if (!product) {
      res.status(404).json({ error: `Article introuvable : ${it.id}` });
      return;
    }
    if (product.family_type !== 'MANUFACTURED') {
      res.status(400).json({ error: `L'article "${product.name}" n'est pas de type FABRIQUÉ (MANUFACTURED).` });
      return;
    }
    if (product.size_volume !== null && product.size_volume !== undefined) {
      res.status(400).json({
        error: `L'article "${product.name}" a déjà un volume unitaire configuré (${product.size_volume} L). Le rattrapage ne s'applique qu'aux articles sans taille (size_volume NULL).`
      });
      return;
    }
    validated.push({ id: it.id, size_volume: round3(vol) });
  }

  const now = new Date().toISOString();
  let totalValuation = 0;

  const updateTx = db.transaction(() => {
    const updateStmt = db.prepare(`
      UPDATE products
      SET size_volume = ?, updated_at = ?
      WHERE id = ?
    `);

    for (const v of validated) {
      const prod: any = db.prepare('SELECT stock_quantity, cost_reference FROM products WHERE id = ?').get(v.id);
      const stock = Number(prod.stock_quantity) || 0;
      const cost = Number(prod.cost_reference) || 0;
      const lineVal = round3(stock * cost);
      totalValuation = round3(totalValuation + lineVal);

      updateStmt.run(v.size_volume, now, v.id);
    }
  });

  try {
    updateTx();
    res.json({
      success: true,
      updated_count: validated.length,
      total_valuation: totalValuation,
      valuation_unchanged: true
    });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// POST /api/products/batch-cost-preview - preview updated formulation+packaging unit cost & inventory valuation delta
productsRouter.post('/batch-cost-preview', (req: Request, res: Response) => {
  const db = getDb();
  const { product_ids } = req.body || {};

  let query = `
    SELECT p.id, p.name, p.size_label, p.size_volume, p.stock_quantity, p.cost_reference,
           pf.id as family_id, pf.name as family_name, pf.type as family_type, pf.formulation_id
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    WHERE pf.type = 'MANUFACTURED'
  `;
  const params: any[] = [];

  if (Array.isArray(product_ids) && product_ids.length > 0) {
    query += ` AND p.id IN (${product_ids.map(() => '?').join(',')})`;
    params.push(...product_ids);
  }

  query += ` ORDER BY p.name ASC`;

  const rows: any[] = db.prepare(query).all(...params);

  let totalCurrentValuation = 0;
  let totalProjectedValuation = 0;

  const items = rows.map(p => {
    const stock = Number(p.stock_quantity) || 0;
    const currentCost = Number(p.cost_reference) || 0;
    const currentValuation = round3(stock * currentCost);

    let status: 'ok' | 'size_manquante' | 'error' = 'ok';
    let calculatedCost: number | null = null;
    let bulkPart: number | null = null;
    let packagingPart: number | null = null;
    let warning: string | null = null;

    if (p.size_volume === null || p.size_volume === undefined) {
      status = 'size_manquante';
      warning = "Volume unitaire manquant (size_volume NULL)";
    } else {
      try {
        const costResult = calculateProductUnitCost(db, p.id);
        calculatedCost = costResult.cost_per_finished_unit;
        bulkPart = round3(costResult.cost_per_base_unit * costResult.size_volume);
        packagingPart = costResult.packaging_cost_per_unit;
      } catch (err: any) {
        status = 'error';
        warning = err.message || "Erreur de calcul du coût unitaire";
      }
    }

    const newValuation = calculatedCost !== null ? round3(stock * calculatedCost) : currentValuation;
    const deltaValuation = round3(newValuation - currentValuation);

    totalCurrentValuation = round3(totalCurrentValuation + currentValuation);
    totalProjectedValuation = round3(totalProjectedValuation + newValuation);

    return {
      id: p.id,
      name: p.name,
      family_id: p.family_id,
      family_name: p.family_name,
      size_label: p.size_label,
      size_volume: p.size_volume,
      stock_quantity: stock,
      current_cost: round3(currentCost),
      current_valuation: currentValuation,
      status,
      calculated_cost: calculatedCost,
      bulk_part: bulkPart,
      packaging_part: packagingPart,
      new_valuation: newValuation,
      delta_valuation: deltaValuation,
      warning
    };
  });

  res.json({
    items,
    total_products: items.length,
    total_current_valuation: totalCurrentValuation,
    total_projected_valuation: totalProjectedValuation,
    total_delta_valuation: round3(totalProjectedValuation - totalCurrentValuation)
  });
});

// POST /api/products/batch-cost-confirm - apply updated cost_reference in one transaction and report valuation delta
productsRouter.post('/batch-cost-confirm', (req: Request, res: Response) => {
  const db = getDb();
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "La liste des articles à mettre à jour est requise." });
    return;
  }

  // Pre-validate basic input structure
  for (const it of items) {
    if (!it || typeof it.id !== 'string') {
      res.status(400).json({ error: "Identifiant d'article invalide." });
      return;
    }
    try {
      requireFiniteNonNegative(it.new_cost, "nouveau coût (new_cost)");
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }

  const now = new Date().toISOString();
  let oldValuation = 0;
  let newValuation = 0;
  let updatedCount = 0;

  try {
    const updateTx = db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE products
        SET cost_reference = ?, updated_at = ?
        WHERE id = ?
      `);

      for (const it of items) {
        const clientCost = round3(Number(it.new_cost));
        const product: any = db.prepare(`
          SELECT p.*, pf.type as family_type
          FROM products p
          JOIN product_families pf ON p.family_id = pf.id
          WHERE p.id = ?
        `).get(it.id);

        if (!product) {
          throw new ValidationError(`Article introuvable : ${it.id}`);
        }
        if (product.family_type !== 'MANUFACTURED') {
          throw new ValidationError(`L'article "${product.name}" n'est pas de type FABRIQUÉ (MANUFACTURED).`);
        }
        if (product.size_volume === null || product.size_volume === undefined) {
          throw new ValidationError(
            `Impossible de mettre à jour le coût de l'article "${product.name}" : volume unitaire manquant (size manquante). Veuillez d'abord renseigner la taille.`
          );
        }

        // Recompute fresh unit cost on the server inside the transaction!
        const freshCostInfo = calculateProductUnitCost(db, product.id);
        const serverCost = round3(freshCostInfo.cost_per_finished_unit);

        // If client-sent new_cost differs from the fresh server value by > 0.001 -> reject with 409
        if (Math.abs(clientCost - serverCost) > 0.001) {
          const err: any = new Error(
            `Le coût de l'article "${product.name}" a changé ou ne correspond pas au calcul serveur (${clientCost.toFixed(3)} DT envoyé vs ${serverCost.toFixed(3)} DT calculé). Veuillez réactualiser l'aperçu avant de confirmer.`
          );
          err.code = 'COST_MISMATCH';
          err.statusCode = 409;
          throw err;
        }

        const stock = Number(product.stock_quantity) || 0;
        const oldCost = Number(product.cost_reference) || 0;
        const oldLineVal = round3(stock * oldCost);
        const newLineVal = round3(stock * serverCost); // Apply only server-computed values!

        oldValuation = round3(oldValuation + oldLineVal);
        newValuation = round3(newValuation + newLineVal);

        updateStmt.run(serverCost, now, product.id);
        updatedCount++;
      }
    });

    updateTx();

    res.json({
      success: true,
      updated_count: updatedCount,
      old_valuation: oldValuation,
      new_valuation: newValuation,
      delta_valuation: round3(newValuation - oldValuation)
    });
  } catch (err: any) {
    if (err.statusCode === 409 || err.code === 'COST_MISMATCH') {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof ValidationError || err.name === 'ValidationError') {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

// POST /api/products/preview-cost - live unit cost preview for manufactured products
productsRouter.post('/preview-cost', (req: Request, res: Response) => {
  const { family_id, size_volume, packaging_items = [] } = req.body;
  if (!family_id) {
    res.status(400).json({ error: 'La famille de produit est obligatoire.' });
    return;
  }
  const db = getDb();
  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(family_id);
  if (!family) {
    res.status(404).json({ error: 'Famille de produit introuvable.' });
    return;
  }
  if (family.type !== 'MANUFACTURED' || !family.formulation_id) {
    res.json({
      cost_per_finished_unit: 0,
      bulk_portion: 0,
      packaging_portion: 0,
      base_cost_per_unit: 0
    });
    return;
  }

  const formulationCost = calculateFormulationCost(db, family.formulation_id);
  const costPerBaseUnit = formulationCost.cost_per_unit;

  const isPieceUnit = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(formulationCost.base_yield_unit).toLowerCase());
  let sizeVol = 1.0;
  if (size_volume !== undefined && size_volume !== null && size_volume !== '') {
    try {
      sizeVol = requireFinitePositive(size_volume, 'volume unitaire (size_volume)');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  } else if (!isPieceUnit) {
    sizeVol = 1.0;
  }

  // Double-count guard
  const recipeHasPackaging = formulationCost.items.some(i =>
    ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category)
  );
  if (recipeHasPackaging && Array.isArray(packaging_items) && packaging_items.length > 0) {
    res.status(400).json({
      error: "Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte)."
    });
    return;
  }

  let packagingPortion = 0;
  if (Array.isArray(packaging_items)) {
    for (const item of packaging_items) {
      if (!item.material_id) continue;
      const mat: any = db.prepare('SELECT latest_purchase_cost FROM raw_materials WHERE id = ?').get(item.material_id);
      const uCost = mat ? (mat.latest_purchase_cost || 0) : 0;
      const q = typeof item.quantity_per_unit === 'number' ? item.quantity_per_unit : parseFloat(item.quantity_per_unit) || 0;
      if (q > 0) {
        packagingPortion = addMoney(packagingPortion, round3(q * uCost));
      }
    }
  }

  const bulkPortion = round3(multiplyMoney(costPerBaseUnit, sizeVol));
  const totalCost = round3(addMoney(bulkPortion, packagingPortion));

  res.json({
    cost_per_finished_unit: totalCost,
    bulk_portion: bulkPortion,
    packaging_portion: packagingPortion,
    base_cost_per_unit: costPerBaseUnit,
    base_yield_unit: formulationCost.base_yield_unit
  });
});

// GET /api/products/:id - single product details
productsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const product: any = db.prepare(`
    SELECT p.*, pf.name as family_name, pf.category as category, pf.type as product_type,
      pf.formulation_id, ct.name as container_type_name,
      CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
    FROM products p
    JOIN product_families pf ON p.family_id = pf.id
    LEFT JOIN container_types ct ON p.container_type_id = ct.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const packSizes = db.prepare(`
    SELECT * FROM product_pack_sizes WHERE product_id = ? ORDER BY multiplier ASC
  `).all(product.id);

  const packagingItems = db.prepare(`
    SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit, rm.latest_purchase_cost
    FROM product_packaging_items ppi
    JOIN raw_materials rm ON ppi.material_id = rm.id
    WHERE ppi.product_id = ?
    ORDER BY rm.name ASC
  `).all(product.id);

  res.json({ ...product, pack_sizes: packSizes, packaging_items: packagingItems });
});

// POST /api/products - create SKU under family
productsRouter.post('/', (req: Request, res: Response) => {
  const {
    family_id,
    name,
    size_label = null,
    size_volume = null,
    barcode = null,
    stock_quantity = 0,
    low_stock_threshold = 5,
    retail_price = 0,
    wholesale_price = 0,
    container_type_id = null
  } = req.body;

  if (!family_id) {
    res.status(400).json({ error: 'family_id is required.' });
    return;
  }

  const db = getDb();
  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(family_id);
  if (!family) {
    res.status(404).json({ error: 'Product family not found' });
    return;
  }

  let parsedRetail: number;
  let parsedWholesale: number;
  let parsedStock: number;
  let parsedThreshold: number;
  try {
    parsedRetail = requireFiniteNonNegative(retail_price, 'prix de détail (retail_price)', 0);
    parsedWholesale = requireFiniteNonNegative(wholesale_price, 'prix de gros (wholesale_price)', 0);
    parsedStock = stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== ''
      ? (typeof stock_quantity === 'number' ? stock_quantity : Number(stock_quantity))
      : 0;
    if (!Number.isFinite(parsedStock)) {
      throw new ValidationError('La quantité en stock doit être un nombre fini.');
    }
    parsedThreshold = low_stock_threshold !== undefined && low_stock_threshold !== null && low_stock_threshold !== ''
      ? requireFiniteNonNegative(low_stock_threshold, 'seuil de stock bas')
      : 5;
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  let parsedSizeVolume: number | null = null;
  if (family.type === 'MANUFACTURED') {
    if (family.formulation_id) {
      const formulation: any = db.prepare('SELECT * FROM formulations WHERE id = ?').get(family.formulation_id);
      if (formulation && ['L', 'kg', 'l'].includes(formulation.base_yield_unit)) {
        if (size_volume === undefined || size_volume === null || size_volume === '') {
          res.status(400).json({ error: "Le volume unitaire (size_volume) est obligatoire pour les produits fabriqués en litres/kilos." });
          return;
        }
      }
    }
  }

  if (size_volume !== undefined && size_volume !== null && size_volume !== '') {
    try {
      parsedSizeVolume = requireFinitePositive(size_volume, 'volume unitaire (size_volume)');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }

  const finalName = name && name.trim().length > 0 
    ? name.trim() 
    : (size_label ? `${family.name} - ${size_label}` : family.name);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const finalBarcode = barcode && barcode.trim().length > 0 ? barcode.trim() : generateBarcode();

  // Auto-calculate cost reference if manufactured and formulation exists
  let costReference = 0;
  if (family.type === 'MANUFACTURED' && family.formulation_id) {
    try {
      const costInfo = calculateProductUnitCost(db, {
        id,
        family_id,
        size_volume: parsedSizeVolume
      });
      costReference = costInfo.cost_per_finished_unit;
    } catch {
      costReference = 0;
    }
  }

  let explicitCost: number;
  try {
    if (family.type === 'MANUFACTURED' && family.formulation_id && req.body.allow_cost_override !== true) {
      // Modal default (e.g. 0.000) or client-sent cost is ignored for manufactured products unless explicitly overridden
      explicitCost = costReference;
    } else {
      const rawCost = req.body.cost_reference !== undefined 
        ? req.body.cost_reference 
        : (req.body.initial_cost !== undefined ? req.body.initial_cost : costReference);
      explicitCost = requireFiniteNonNegative(rawCost, 'coût de référence (cost_reference)', costReference);
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  const rawPackagingItems = req.body.packaging_items;
  const validatedPackaging: Array<{ material_id: string; quantity_per_unit: number }> = [];
  if (Array.isArray(rawPackagingItems) && rawPackagingItems.length > 0) {
    if (family.formulation_id) {
      const formulationCost = calculateFormulationCost(db, family.formulation_id);
      const recipeHasPackaging = formulationCost.items.some(i =>
        ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category)
      );
      if (recipeHasPackaging) {
        res.status(400).json({
          error: "Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte)."
        });
        return;
      }
    }

    const seenMaterialIds = new Set<string>();
    for (const item of rawPackagingItems) {
      if (!item.material_id) {
        res.status(400).json({ error: "L'article d'emballage est obligatoire." });
        return;
      }
      if (seenMaterialIds.has(item.material_id)) {
        res.status(409).json({ error: "Cet article d'emballage est déjà associé à ce produit." });
        return;
      }
      seenMaterialIds.add(item.material_id);

      const mat = db.prepare('SELECT id FROM raw_materials WHERE id = ?').get(item.material_id);
      if (!mat) {
        res.status(404).json({ error: 'Matière première introuvable.' });
        return;
      }

      let q: number;
      try {
        q = requireFinitePositive(item.quantity_per_unit, 'quantité par unité (quantity_per_unit)');
      } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
      }
      validatedPackaging.push({ material_id: item.material_id, quantity_per_unit: q });
    }
  }

  const insert = db.prepare(`
    INSERT INTO products (
      id, family_id, name, size_label, size_volume, barcode, stock_quantity,
      low_stock_threshold, cost_reference, retail_price, wholesale_price,
      container_type_id, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  try {
    insert.run(
      id,
      family_id,
      finalName,
      size_label ? size_label.trim() : null,
      parsedSizeVolume !== undefined ? parsedSizeVolume : null,
      finalBarcode,
      parsedStock,
      parsedThreshold,
      round3(explicitCost),
      round3(parsedRetail),
      round3(parsedWholesale),
      container_type_id || null,
      now,
      now
    );

    if (validatedPackaging.length > 0) {
      const insertPkg = db.prepare(`
        INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit)
        VALUES (?, ?, ?, ?)
      `);
      for (const item of validatedPackaging) {
        insertPkg.run(crypto.randomUUID(), id, item.material_id, item.quantity_per_unit);
      }

      if (family.type === 'MANUFACTURED' && family.formulation_id && req.body.allow_cost_override !== true) {
        try {
          const fullCost = calculateProductUnitCost(db, id).cost_per_finished_unit;
          db.prepare('UPDATE products SET cost_reference = ? WHERE id = ?').run(fullCost, id);
        } catch {}
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed: products.barcode')) {
      res.status(400).json({ error: `Barcode ${finalBarcode} already in use.` });
      return;
    }
    res.status(400).json({ error: sanitizeErrorMessage(err, 'Échec de la création du produit.') });
    return;
  }

  const created = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PUT /api/products/:id - update prices, barcode, thresholds, active status, cost reference
productsRouter.put('/:id', (req: Request, res: Response) => {
  const {
    name,
    size_label,
    size_volume,
    barcode,
    stock_quantity,
    low_stock_threshold,
    retail_price,
    wholesale_price,
    cost_reference,
    container_type_id,
    active
  } = req.body;

  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(existing.family_id);

  let validRetail: number | undefined;
  let validWholesale: number | undefined;
  let validCost: number | undefined;
  let validStock: number | undefined;
  let validThreshold: number | undefined;
  let validSizeVolume: number | undefined;

  try {
    validRetail = requireOptionalFiniteNonNegative(retail_price, 'prix de détail (retail_price)');
    validWholesale = requireOptionalFiniteNonNegative(wholesale_price, 'prix de gros (wholesale_price)');

    // Invariant: On MANUFACTURED products, do NOT silently overwrite cost_reference
    // Modal sends 0 by default, so ignore unless allow_cost_override === true
    if (family && family.type === 'MANUFACTURED') {
      if (req.body.allow_cost_override === true && cost_reference !== undefined) {
        validCost = requireFiniteNonNegative(cost_reference, 'coût de référence (cost_reference)');
      } else {
        validCost = undefined; // Retain existing cost_reference
      }
    } else {
      validCost = requireOptionalFiniteNonNegative(cost_reference, 'coût de référence (cost_reference)');
    }

    validThreshold = requireOptionalFiniteNonNegative(low_stock_threshold, 'seuil de stock bas');
    if (stock_quantity !== undefined && stock_quantity !== null && stock_quantity !== '') {
      const num = typeof stock_quantity === 'number' ? stock_quantity : Number(stock_quantity);
      if (!Number.isFinite(num)) {
        throw new ValidationError('La quantité en stock doit être un nombre fini.');
      }
      validStock = num;
    }
    if (size_volume !== undefined && size_volume !== null && size_volume !== '') {
      validSizeVolume = requireFinitePositive(size_volume, 'volume unitaire (size_volume)');
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  const now = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE products
      SET name = COALESCE(?, name),
          size_label = COALESCE(?, size_label),
          size_volume = COALESCE(?, size_volume),
          barcode = COALESCE(?, barcode),
          stock_quantity = COALESCE(?, stock_quantity),
          low_stock_threshold = COALESCE(?, low_stock_threshold),
          retail_price = COALESCE(?, retail_price),
          wholesale_price = COALESCE(?, wholesale_price),
          cost_reference = COALESCE(?, cost_reference),
          container_type_id = COALESCE(?, container_type_id),
          active = COALESCE(?, active),
          updated_at = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      size_label !== undefined ? size_label.trim() : null,
      validSizeVolume !== undefined ? validSizeVolume : null,
      barcode !== undefined ? barcode.trim() : null,
      validStock !== undefined ? validStock : null,
      validThreshold !== undefined ? validThreshold : null,
      validRetail !== undefined ? round3(validRetail) : null,
      validWholesale !== undefined ? round3(validWholesale) : null,
      validCost !== undefined ? round3(validCost) : null,
      container_type_id !== undefined ? container_type_id : null,
      active !== undefined ? Number(active) : null,
      now,
      req.params.id
    );
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed: products.barcode')) {
      res.status(400).json({ error: `Barcode already in use.` });
      return;
    }
    res.status(400).json({ error: sanitizeErrorMessage(err, 'Échec de la mise à jour du produit.') });
    return;
  }

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// ==========================================
// Pack Sizes (Multipliers sharing base piece stock)
// ==========================================

// POST /api/products/:id/pack-sizes - create pack size multiplier for an existing SKU
productsRouter.post('/:id/pack-sizes', (req: Request, res: Response) => {
  const { pack_label, multiplier, price_override = null, barcode = null } = req.body;

  if (!pack_label || !Number.isInteger(Number(multiplier)) || Number(multiplier) < 2) {
    res.status(400).json({ error: 'pack_label and an integer multiplier (≥ 2) are required.' });
    return;
  }

  if (price_override !== null && price_override !== undefined) {
    const override = Number(price_override);
    if (!Number.isFinite(override) || override <= 0) {
      res.status(400).json({ error: 'price_override must be a positive number (blank = no override).' });
      return;
    }
  }

  const db = getDb();
  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Parent product SKU not found' });
    return;
  }

  const id = crypto.randomUUID();
  const finalBarcode = barcode && barcode.trim().length > 0 ? barcode.trim() : generateBarcode('PACK');
  const price = price_override !== null && price_override !== undefined ? round3(Number(price_override)) : null;

  try {
    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, pack_label.trim(), Number(multiplier), price, finalBarcode);
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed: product_pack_sizes.barcode')) {
      res.status(400).json({ error: `Barcode ${finalBarcode} already in use.` });
      return;
    }
    throw err;
  }

  const created = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ?').get(id);
  res.status(201).json(created);
});

// DELETE /api/products/pack-sizes/:packId - delete a pack size multiplier
productsRouter.delete('/pack-sizes/:packId', (req: Request, res: Response) => {
  const db = getDb();
  const pack = db.prepare('SELECT * FROM product_pack_sizes WHERE id = ?').get(req.params.packId);
  if (!pack) {
    res.status(404).json({ error: 'Pack size not found' });
    return;
  }

  const linkedSales: any = db.prepare('SELECT COUNT(*) as count FROM sale_items WHERE pack_size_id = ?').get(req.params.packId);
  if (linkedSales && linkedSales.count > 0) {
    res.status(409).json({ error: 'Cannot delete pack size referenced in sales history' });
    return;
  }

  db.prepare('DELETE FROM product_pack_sizes WHERE id = ?').run(req.params.packId);
  res.json({ success: true, id: req.params.packId });
});

// ==========================================
// Product Packaging Items (Packaging BOM)
// ==========================================

// GET /api/products/:id/packaging - list packaging items for a product
productsRouter.get('/:id/packaging', (req: Request, res: Response) => {
  const db = getDb();
  const product: any = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Produit introuvable.' });
    return;
  }

  const items = db.prepare(`
    SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit, rm.latest_purchase_cost
    FROM product_packaging_items ppi
    JOIN raw_materials rm ON ppi.material_id = rm.id
    WHERE ppi.product_id = ?
    ORDER BY rm.name ASC
  `).all(req.params.id);

  res.json(items);
});

// POST /api/products/:id/packaging - add packaging item to a product
productsRouter.post('/:id/packaging', (req: Request, res: Response) => {
  const db = getDb();
  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Produit introuvable.' });
    return;
  }

  const { material_id, quantity_per_unit } = req.body;
  if (!material_id || String(material_id).trim().length === 0) {
    res.status(400).json({ error: "L'article d'emballage est obligatoire." });
    return;
  }

  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(product.family_id);
  if (!family || family.type !== 'MANUFACTURED') {
    res.status(400).json({ error: "Les articles d'emballage ne s'appliquent qu'aux produits de type FABRIQUÉ (MANUFACTURED)." });
    return;
  }

  const material: any = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(material_id);
  if (!material) {
    res.status(404).json({ error: 'Matière première introuvable.' });
    return;
  }

  if (!['bottle', 'cap', 'label', 'packaging'].includes(material.category)) {
    res.status(400).json({
      error: "La matière sélectionnée n'est pas un emballage valide (catégories autorisées : bottle, cap, label, packaging)."
    });
    return;
  }

  let qty: number;
  try {
    qty = requireFinitePositive(quantity_per_unit, 'quantité par unité (quantity_per_unit)');
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  // Check uniqueness for this product
  const existing = db.prepare('SELECT id FROM product_packaging_items WHERE product_id = ? AND material_id = ?').get(req.params.id, material_id);
  if (existing) {
    res.status(409).json({ error: "Cet article d'emballage est déjà associé à ce produit." });
    return;
  }

  // Double-count guard against family recipe
  if (family && family.formulation_id) {
    const formulationCost = calculateFormulationCost(db, family.formulation_id);
    const recipeHasPackaging = formulationCost.items.some(i =>
      ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category)
    );
    if (recipeHasPackaging) {
      res.status(400).json({
        error: "Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte)."
      });
      return;
    }
  }

  const itemId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO product_packaging_items (id, product_id, material_id, quantity_per_unit)
    VALUES (?, ?, ?, ?)
  `).run(itemId, req.params.id, material_id, qty);

  const created: any = db.prepare(`
    SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit, rm.latest_purchase_cost
    FROM product_packaging_items ppi
    JOIN raw_materials rm ON ppi.material_id = rm.id
    WHERE ppi.id = ?
  `).get(itemId);

  res.status(201).json(created);
});

// PUT /api/products/:id/packaging/:itemId - update packaging item quantity
productsRouter.put('/:id/packaging/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM product_packaging_items WHERE id = ? AND product_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Article d'emballage introuvable pour ce produit." });
    return;
  }

  let qty: number;
  try {
    qty = requireFinitePositive(req.body.quantity_per_unit, 'quantité par unité (quantity_per_unit)');
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  db.prepare('UPDATE product_packaging_items SET quantity_per_unit = ? WHERE id = ?').run(qty, req.params.itemId);

  const updated: any = db.prepare(`
    SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit, rm.latest_purchase_cost
    FROM product_packaging_items ppi
    JOIN raw_materials rm ON ppi.material_id = rm.id
    WHERE ppi.id = ?
  `).get(req.params.itemId);

  res.json(updated);
});

// DELETE /api/products/:id/packaging/:itemId - remove packaging item
productsRouter.delete('/:id/packaging/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM product_packaging_items WHERE id = ? AND product_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Article d'emballage introuvable pour ce produit." });
    return;
  }

  db.prepare('DELETE FROM product_packaging_items WHERE id = ?').run(req.params.itemId);

  res.json({ success: true, id: req.params.itemId });
});

// DELETE /api/products/families/:id - delete or soft-delete product family
productsRouter.delete('/families/:id', (req: Request, res: Response) => {
  const db = getDb();
  const family: any = db.prepare('SELECT * FROM product_families WHERE id = ?').get(req.params.id);
  if (!family) {
    res.status(404).json({ error: 'Product family not found' });
    return;
  }

  const hasProducts: any = db.prepare('SELECT COUNT(*) as count FROM products WHERE family_id = ?').get(req.params.id);
  const now = new Date().toISOString();
  if (hasProducts?.count > 0) {
    res.status(409).json({ error: 'Cannot delete product family with existing SKUs. Please deactivate the family or its SKUs instead.' });
    return;
  } else {
    db.prepare('DELETE FROM product_families WHERE id = ?').run(req.params.id);
    res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Family deleted permanently' });
  }
});

// DELETE /api/products/:id - delete product SKU
productsRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product SKU not found' });
    return;
  }

  // Check references: sale_items, production_batches, purchase_items, inventory_adjustments, refund_items
  const hasSales: any = db.prepare('SELECT COUNT(*) as count FROM sale_items WHERE product_id = ?').get(req.params.id);
  const hasBatches: any = db.prepare('SELECT COUNT(*) as count FROM production_batches WHERE target_product_id = ?').get(req.params.id);
  const hasPurchases: any = db.prepare('SELECT COUNT(*) as count FROM purchase_items WHERE product_id = ?').get(req.params.id);
  const hasAdjustments: any = db.prepare('SELECT COUNT(*) as count FROM inventory_adjustments WHERE product_id = ?').get(req.params.id);
  const hasRefunds: any = db.prepare(`
    SELECT COUNT(*) as count FROM refund_items ri
    JOIN sale_items si ON ri.sale_item_id = si.id
    WHERE si.product_id = ?
  `).get(req.params.id);

  const isReferenced = (hasSales?.count > 0) || (hasBatches?.count > 0) || (hasPurchases?.count > 0) || (hasAdjustments?.count > 0) || (hasRefunds?.count > 0);

  if (isReferenced) {
    res.status(409).json({ error: 'Cannot delete product referenced in sales, production batches, purchases, or inventory adjustments. Please deactivate it instead.' });
    return;
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Product deleted permanently' });
});

