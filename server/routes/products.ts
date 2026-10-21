import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
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

  res.json({ ...product, pack_sizes: packSizes });
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

