import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';

export const categoriesRouter = Router();

// GET /api/categories - list all categories with usage counts
categoriesRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();

  // 1. Fetch categories table entries
  const definedCategories: any[] = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();

  // 2. Fetch distinct categories from product_families
  const prodCatRows: any[] = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM product_families 
    WHERE active = 1 
    GROUP BY category
  `).all();
  const prodCatMap = new Map<string, number>();
  for (const r of prodCatRows) {
    prodCatMap.set(r.category.trim(), r.count);
  }

  // 3. Fetch distinct categories from raw_materials
  const matCatRows: any[] = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM raw_materials 
    WHERE (active = 1 OR active IS NULL) 
    GROUP BY category
  `).all();
  const matCatMap = new Map<string, number>();
  for (const r of matCatRows) {
    matCatMap.set(r.category.trim(), r.count);
  }

  // Merge everything into a comprehensive map
  const allNames = new Set<string>();
  for (const c of definedCategories) allNames.add(c.name.trim());
  for (const k of prodCatMap.keys()) allNames.add(k);
  for (const k of matCatMap.keys()) allNames.add(k);

  const usedIds = new Set<string>();
  const categories = Array.from(allNames).map(name => {
    const defined = definedCategories.find(c => c.name.toLowerCase() === name.toLowerCase());
    const prodCount = prodCatMap.get(name) || 0;
    const matCount = matCatMap.get(name) || 0;

    let type = defined ? defined.type : 'PRODUCT';
    if (prodCount > 0 && matCount > 0) type = 'BOTH';
    else if (matCount > 0 && prodCount === 0) type = 'MATERIAL';
    else if (prodCount > 0 && matCount === 0) type = 'PRODUCT';

    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item';
    let id = defined ? defined.id : `cat-${baseSlug}`;
    if (usedIds.has(id)) {
      id = `${id}-${baseSlug}`;
    }
    usedIds.add(id);

    return {
      id,
      name,
      type,
      product_count: prodCount,
      material_count: matCount,
      total_count: prodCount + matCount,
      created_at: defined ? defined.created_at : new Date().toISOString()
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  res.json(categories);
});

// POST /api/categories - define a new category
categoriesRouter.post('/', (req: Request, res: Response) => {
  const { name, type = 'PRODUCT' } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Category name is required.' });
    return;
  }
  const cleanName = name.trim();
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)').get(cleanName);
  if (existing) {
    res.status(400).json({ error: `Category "${cleanName}" already exists.` });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO categories (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
    id, cleanName, type, now
  );

  const created = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.status(201).json(created);
});

// PUT /api/categories/rename - rename category and cascade across product_families and raw_materials
categoriesRouter.put('/rename', (req: Request, res: Response) => {
  const { old_name, new_name, scope = 'ALL' } = req.body;
  if (!old_name || !old_name.trim() || !new_name || !new_name.trim()) {
    res.status(400).json({ error: 'old_name and new_name are required.' });
    return;
  }

  const oldClean = old_name.trim();
  const newClean = new_name.trim();
  if (oldClean.toLowerCase() === newClean.toLowerCase()) {
    res.status(400).json({ error: 'New category name must be different from old category name.' });
    return;
  }

  const db = getDb();
  const now = new Date().toISOString();

  const renameTransaction = db.transaction(() => {
    let updatedFamilies = 0;
    let updatedMaterials = 0;

    // 1. Update categories table if entry exists
    db.prepare(`
      UPDATE categories 
      SET name = ? 
      WHERE LOWER(name) = LOWER(?)
    `).run(newClean, oldClean);

    // 2. Cascade to product_families
    if (scope === 'ALL' || scope === 'PRODUCT') {
      const pfResult = db.prepare(`
        UPDATE product_families 
        SET category = ?, updated_at = ? 
        WHERE LOWER(category) = LOWER(?)
      `).run(newClean, now, oldClean);
      updatedFamilies = pfResult.changes;
    }

    // 3. Cascade to raw_materials
    if (scope === 'ALL' || scope === 'MATERIAL') {
      const rmResult = db.prepare(`
        UPDATE raw_materials 
        SET category = ?, updated_at = ? 
        WHERE LOWER(category) = LOWER(?)
      `).run(newClean, now, oldClean);
      updatedMaterials = rmResult.changes;
    }

    return { updatedFamilies, updatedMaterials };
  });

  try {
    const { updatedFamilies, updatedMaterials } = renameTransaction();
    res.json({
      success: true,
      old_name: oldClean,
      new_name: newClean,
      updated_product_families: updatedFamilies,
      updated_materials: updatedMaterials
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to rename category.' });
  }
});

// DELETE /api/categories/:name - delete unused category
categoriesRouter.delete('/:name', (req: Request, res: Response) => {
  const categoryName = decodeURIComponent(req.params.name).trim();
  const db = getDb();

  // Check references in product_families and raw_materials
  const prodRef: any = db.prepare('SELECT COUNT(*) as count FROM product_families WHERE LOWER(category) = LOWER(?) AND active = 1').get(categoryName);
  const matRef: any = db.prepare('SELECT COUNT(*) as count FROM raw_materials WHERE LOWER(category) = LOWER(?) AND (active = 1 OR active IS NULL)').get(categoryName);

  const totalUsed = (prodRef?.count || 0) + (matRef?.count || 0);
  if (totalUsed > 0) {
    res.status(400).json({
      error: `Cannot delete category "${categoryName}" because it is currently used by ${prodRef?.count || 0} product families and ${matRef?.count || 0} raw materials. Reassign or rename them first.`
    });
    return;
  }

  // Delete from categories table
  db.prepare('DELETE FROM categories WHERE LOWER(name) = LOWER(?)').run(categoryName);

  res.json({ message: `Category "${categoryName}" deleted successfully.` });
});
