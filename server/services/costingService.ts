import { round3, addMoney, multiplyMoney, divideMoney } from '../utils/money.js';

export interface FormulationItemCost {
  id: string;
  material_id: string;
  material_name: string;
  material_category: string;
  material_unit: string;
  quantity_required: number;
  unit_cost: number;
  item_total_cost: number;
}

export interface FormulationCostResult {
  formulation_id: string;
  formulation_name: string;
  base_yield_quantity: number;
  base_yield_unit: string;
  items: FormulationItemCost[];
  total_cost: number;
  cost_per_unit: number;
}

/**
 * Returns a Map of materialId -> unitCost for all raw materials.
 * The unit cost is the quantity-weighted average cost of the material's purchases
 * in the specified calendar year (default: current year).
 * If there are no purchases in the target year (or total quantity === 0),
 * it falls back to raw_materials.latest_purchase_cost.
 */
export function getMaterialUnitCosts(
  db: any,
  targetYear: number = new Date().getFullYear()
): Map<string, number> {
  const query = `
    SELECT 
      rm.id as material_id,
      rm.latest_purchase_cost,
      purchases_this_year.total_cost,
      purchases_this_year.total_quantity
    FROM raw_materials rm
    LEFT JOIN (
      SELECT 
        pi.material_id,
        SUM(pi.total_cost) as total_cost,
        SUM(pi.quantity) as total_quantity
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      WHERE pi.item_type = 'RAW_MATERIAL'
        AND pi.material_id IS NOT NULL
        AND SUBSTR(p.date, 1, 4) = ?
      GROUP BY pi.material_id
    ) purchases_this_year ON rm.id = purchases_this_year.material_id
  `;

  const rows: any[] = db.prepare(query).all(String(targetYear));
  const costMap = new Map<string, number>();

  for (const row of rows) {
    const qty = Number(row.total_quantity) || 0;
    const cost = Number(row.total_cost) || 0;

    if (qty > 0) {
      costMap.set(row.material_id, divideMoney(cost, qty));
    } else {
      costMap.set(row.material_id, round3(Number(row.latest_purchase_cost) || 0));
    }
  }

  return costMap;
}

/**
 * Returns the unit cost for a single material (thin wrapper around getMaterialUnitCosts).
 */
export function getMaterialUnitCost(
  db: any,
  materialId: string,
  targetYear: number = new Date().getFullYear()
): number {
  const costs = getMaterialUnitCosts(db, targetYear);
  if (costs.has(materialId)) {
    return costs.get(materialId)!;
  }
  const rm: any = db.prepare('SELECT latest_purchase_cost FROM raw_materials WHERE id = ?').get(materialId);
  return round3(Number(rm?.latest_purchase_cost) || 0);
}

/**
 * Calculates current formulation cost based on the latest purchase cost of all ingredients and packaging.
 */
export function calculateFormulationCost(
  db: any,
  formulationId: string,
  targetYear?: number
): FormulationCostResult {
  const formulation: any = db.prepare(`
    SELECT * FROM formulations WHERE id = ?
  `).get(formulationId);

  if (!formulation) {
    throw new Error(`Formulation not found: ${formulationId}`);
  }

  const items: any[] = db.prepare(`
    SELECT fi.id, fi.material_id, fi.quantity_required,
           rm.name as material_name, rm.category as material_category,
           rm.unit as material_unit
    FROM formulation_items fi
    JOIN raw_materials rm ON fi.material_id = rm.id
    WHERE fi.formulation_id = ?
    ORDER BY rm.category ASC, rm.name ASC
  `).all(formulationId);

  const unitCosts = getMaterialUnitCosts(db, targetYear);

  let totalCost = 0;
  const costedItems: FormulationItemCost[] = items.map((item) => {
    const unitCost = unitCosts.get(item.material_id) ?? 0;
    const itemTotal = round3(item.quantity_required * unitCost);
    totalCost = addMoney(totalCost, itemTotal);

    return {
      id: item.id,
      material_id: item.material_id,
      material_name: item.material_name,
      material_category: item.material_category,
      material_unit: item.material_unit,
      quantity_required: item.quantity_required,
      unit_cost: unitCost,
      item_total_cost: itemTotal
    };
  });

  const baseYield = formulation.base_yield_quantity > 0 ? formulation.base_yield_quantity : 1;
  const costPerUnit = divideMoney(totalCost, baseYield);

  return {
    formulation_id: formulation.id,
    formulation_name: formulation.name,
    base_yield_quantity: formulation.base_yield_quantity,
    base_yield_unit: formulation.base_yield_unit,
    items: costedItems,
    total_cost: totalCost,
    cost_per_unit: costPerUnit
  };
}

export class ProductionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionValidationError';
  }
}

export interface ScaledBatchIngredient {
  material_id: string;
  material_name: string;
  material_unit: string;
  quantity_consumed: number;
  unit_cost: number;
  total_cost: number;
  current_stock: number;
  remaining_stock_after_batch: number;
}

export interface ProductCostResult {
  formulation_id: string;
  base_yield_quantity: number;
  base_yield_unit: string;
  base_recipe_total_cost: number;
  cost_per_base_unit: number; // e.g. Cost per Litre
  size_volume: number;
  packaging_cost_per_unit: number;
  cost_per_finished_unit: number; // in TND (3 decimals)
}

/**
 * ONE unified volume-based costing function per finished unit.
 * Used identically by: product create, cost preview, and production batch.
 */
export function calculateProductUnitCost(
  db: any,
  productInput: string | { id?: string; family_id: string; size_volume?: number | null },
  targetYear: number = new Date().getFullYear()
): ProductCostResult {
  let product: any;
  if (typeof productInput === 'string') {
    product = db.prepare('SELECT * FROM products WHERE id = ?').get(productInput);
    if (!product) {
      throw new ProductionValidationError(`Product not found: ${productInput}`);
    }
  } else {
    product = productInput;
  }

  const family = db.prepare('SELECT * FROM product_families WHERE id = ?').get(product.family_id);
  if (!family || family.type !== 'MANUFACTURED') {
    throw new ProductionValidationError('Le produit doit appartenir à une famille de type MANUFACTURED.');
  }

  const formulationId = family.formulation_id;
  if (!formulationId) {
    throw new ProductionValidationError('Aucune formule associée à cette famille de produit.');
  }

  const formulationCost = calculateFormulationCost(db, formulationId, targetYear);
  const baseYieldQty = formulationCost.base_yield_quantity > 0 ? formulationCost.base_yield_quantity : 1;
  const costPerBaseUnit = formulationCost.cost_per_unit; // Total formulation cost / baseYieldQty

  // Determine size_volume
  let sizeVolume: number;
  const isPieceUnit = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(formulationCost.base_yield_unit).toLowerCase());
  if (product.size_volume !== undefined && product.size_volume !== null && product.size_volume !== '') {
    sizeVolume = Number(product.size_volume);
    if (!Number.isFinite(sizeVolume) || sizeVolume <= 0) {
      throw new ProductionValidationError('Le volume unitaire (size_volume) doit être un nombre positif.');
    }
  } else if (isPieceUnit) {
    sizeVolume = 1.0;
  } else {
    throw new ProductionValidationError("Le volume unitaire (size_volume) est obligatoire pour les produits fabriqués en litres/kilos.");
  }

  // Check packaging items
  let packagingCostPerUnit = 0;
  const packagingItems: any[] = product.id
    ? db.prepare(`
        SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit
        FROM product_packaging_items ppi
        JOIN raw_materials rm ON ppi.material_id = rm.id
        WHERE ppi.product_id = ?
      `).all(product.id)
    : [];

  // Double-count guard:
  // If recipe has packaging items (bottle, cap, label, packaging) AND product has product_packaging_items:
  const recipeHasPackaging = formulationCost.items.some(i =>
    ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category)
  );
  if (recipeHasPackaging && packagingItems.length > 0) {
    throw new ProductionValidationError("Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte).");
  }

  const unitCosts = getMaterialUnitCosts(db, targetYear);
  for (const pkg of packagingItems) {
    const uCost = unitCosts.get(pkg.material_id) ?? 0;
    const lineCost = round3(pkg.quantity_per_unit * uCost);
    packagingCostPerUnit = addMoney(packagingCostPerUnit, lineCost);
  }

  const bulkPortion = round3(multiplyMoney(costPerBaseUnit, sizeVolume));
  const costPerFinishedUnit = round3(addMoney(bulkPortion, packagingCostPerUnit));

  return {
    formulation_id: formulationId,
    base_yield_quantity: baseYieldQty,
    base_yield_unit: formulationCost.base_yield_unit,
    base_recipe_total_cost: formulationCost.total_cost,
    cost_per_base_unit: costPerBaseUnit,
    size_volume: sizeVolume,
    packaging_cost_per_unit: packagingCostPerUnit,
    cost_per_finished_unit: costPerFinishedUnit
  };
}

export interface BatchRequirementsOptions {
  batchVolume?: number | null;
  targetProductId?: string | null;
  year?: number;
}

/**
 * Scales a formulation to calculate required materials and expected cost for a specific target production output.
 */
export function calculateBatchRequirements(
  db: any,
  formulationId: string,
  targetOutputUnits?: number | null,
  options?: BatchRequirementsOptions
): {
  targetOutputUnits: number;
  batchVolume: number;
  scalingFactor: number;
  totalBatchCost: number;
  costPerUnit: number;
  ingredients: ScaledBatchIngredient[];
} {
  const declaredBatchVolume = options?.batchVolume !== undefined ? options.batchVolume : null;
  const targetProductId = options?.targetProductId !== undefined ? options.targetProductId : null;
  const year = options?.year;

  const formulationCost = calculateFormulationCost(db, formulationId, year);
  const baseYield = formulationCost.base_yield_quantity > 0 ? formulationCost.base_yield_quantity : 1;

  if (targetProductId) {
    const product: any = db.prepare('SELECT * FROM products WHERE id = ?').get(targetProductId);
    if (!product) {
      throw new ProductionValidationError(`Target product SKU not found: ${targetProductId}`);
    }

    let sizeVolume: number;
    const isPieceUnit = ['pcs', 'piece', 'pieces', 'unit', 'unite', 'unites'].includes(String(formulationCost.base_yield_unit).toLowerCase());
    if (product.size_volume !== null && product.size_volume !== undefined && product.size_volume !== '') {
      sizeVolume = Number(product.size_volume);
      if (!Number.isFinite(sizeVolume) || sizeVolume <= 0) {
        throw new ProductionValidationError('Le volume unitaire (size_volume) doit être un nombre positif.');
      }
    } else if (isPieceUnit) {
      sizeVolume = 1.0;
    } else {
      throw new ProductionValidationError("Le volume unitaire (size_volume) est obligatoire pour les produits fabriqués en litres/kilos.");
    }

    const hasUnits = targetOutputUnits !== undefined && targetOutputUnits !== null && !isNaN(Number(targetOutputUnits)) && Number(targetOutputUnits) > 0;
    const hasVol = declaredBatchVolume !== undefined && declaredBatchVolume !== null && !isNaN(Number(declaredBatchVolume)) && Number(declaredBatchVolume) > 0;

    let finalUnits: number;
    let finalVol: number;

    if (hasUnits && hasVol) {
      const units = Number(targetOutputUnits);
      const vol = Number(declaredBatchVolume);
      const expectedVol = round3(units * sizeVolume);
      if (Math.abs(vol - expectedVol) > 0.001) {
        throw new ProductionValidationError(`Incohérence : le volume déclaré (${vol}) ne correspond pas aux unités produites (${units} × ${sizeVolume} = ${expectedVol}).`);
      }
      finalUnits = units;
      finalVol = vol;
    } else if (hasUnits) {
      finalUnits = Number(targetOutputUnits);
      finalVol = round3(finalUnits * sizeVolume);
    } else if (hasVol) {
      finalVol = Number(declaredBatchVolume);
      finalUnits = round3(finalVol / sizeVolume);
    } else {
      throw new ProductionValidationError("Le volume du lot ou le nombre d'unités produites doit être spécifié.");
    }

    const packagingItems: any[] = db.prepare(`
      SELECT ppi.*, rm.name as material_name, rm.category as material_category, rm.unit as material_unit
      FROM product_packaging_items ppi
      JOIN raw_materials rm ON ppi.material_id = rm.id
      WHERE ppi.product_id = ?
    `).all(targetProductId);

    const recipeHasPackaging = formulationCost.items.some(i =>
      ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category)
    );
    if (recipeHasPackaging && packagingItems.length > 0) {
      throw new ProductionValidationError("Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte).");
    }

    const scalingFactor = finalVol / baseYield;
    let totalBatchCost = 0;
    const ingredients: ScaledBatchIngredient[] = [];

    // Recipe chemistry items
    const chemistryItems = packagingItems.length > 0
      ? formulationCost.items.filter(i => !['bottle', 'cap', 'label', 'packaging'].includes(i.material_category))
      : formulationCost.items;

    for (const item of chemistryItems) {
      const rawMaterial: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(item.material_id);
      const currentStock = rawMaterial ? rawMaterial.stock_quantity : 0;
      const scaledQty = round3(item.quantity_required * scalingFactor);
      const scaledItemTotal = round3(scaledQty * item.unit_cost);
      totalBatchCost = addMoney(totalBatchCost, scaledItemTotal);

      ingredients.push({
        material_id: item.material_id,
        material_name: item.material_name,
        material_unit: item.material_unit,
        quantity_consumed: scaledQty,
        unit_cost: item.unit_cost,
        total_cost: scaledItemTotal,
        current_stock: currentStock,
        remaining_stock_after_batch: currentStock - scaledQty
      });
    }

    // Product packaging items
    const unitCosts = getMaterialUnitCosts(db, year);
    for (const pkg of packagingItems) {
      const rawMaterial: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(pkg.material_id);
      const currentStock = rawMaterial ? rawMaterial.stock_quantity : 0;
      const pkgQty = round3(finalUnits * pkg.quantity_per_unit);
      const uCost = unitCosts.get(pkg.material_id) ?? 0;
      const pkgTotal = round3(pkgQty * uCost);
      totalBatchCost = addMoney(totalBatchCost, pkgTotal);

      ingredients.push({
        material_id: pkg.material_id,
        material_name: pkg.material_name,
        material_unit: pkg.material_unit,
        quantity_consumed: pkgQty,
        unit_cost: uCost,
        total_cost: pkgTotal,
        current_stock: currentStock,
        remaining_stock_after_batch: currentStock - pkgQty
      });
    }

    const costPerUnit = finalUnits > 0 ? divideMoney(totalBatchCost, finalUnits) : 0;

    return {
      targetOutputUnits: finalUnits,
      batchVolume: finalVol,
      scalingFactor,
      totalBatchCost,
      costPerUnit,
      ingredients
    };
  }

  // Fallback for callers that don't pass targetProductId (pure formulation tests)
  const finalUnits = Number(targetOutputUnits) || 1;
  const finalVol = declaredBatchVolume ? Number(declaredBatchVolume) : finalUnits;
  const scalingFactor = declaredBatchVolume ? (finalVol / baseYield) : (finalUnits / baseYield);

  let totalBatchCost = 0;
  const ingredients: ScaledBatchIngredient[] = formulationCost.items.map((item) => {
    const rawMaterial: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(item.material_id);
    const currentStock = rawMaterial ? rawMaterial.stock_quantity : 0;

    const scaledQty = round3(item.quantity_required * scalingFactor);
    const scaledItemTotal = round3(scaledQty * item.unit_cost);
    totalBatchCost = addMoney(totalBatchCost, scaledItemTotal);

    return {
      material_id: item.material_id,
      material_name: item.material_name,
      material_unit: item.material_unit,
      quantity_consumed: scaledQty,
      unit_cost: item.unit_cost,
      total_cost: scaledItemTotal,
      current_stock: currentStock,
      remaining_stock_after_batch: currentStock - scaledQty
    };
  });

  const costPerUnit = finalUnits > 0 ? divideMoney(totalBatchCost, finalUnits) : 0;

  return {
    targetOutputUnits: finalUnits,
    batchVolume: finalVol,
    scalingFactor,
    totalBatchCost,
    costPerUnit,
    ingredients
  };
}
