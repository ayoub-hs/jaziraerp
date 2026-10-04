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
 * Calculates raw material unit costs as the quantity-weighted average of the current calendar year's purchases:
 *   unit_cost(material) = round3( SUM(pi.total_cost) / SUM(pi.quantity) )
 * for raw material purchases in currentYear (defaults to server's current calendar year).
 * If a material has no purchases in currentYear (or total quantity === 0), falls back to raw_materials.latest_purchase_cost.
 */
export function getMaterialUnitCosts(db: any, currentYear: number = new Date().getFullYear()): Map<string, number> {
  const yearStr = String(currentYear);
  const rows: any[] = db.prepare(`
    SELECT 
      rm.id,
      rm.latest_purchase_cost,
      COALESCE(p_summary.total_cost, 0) as total_purchased_cost,
      COALESCE(p_summary.total_qty, 0) as total_purchased_qty
    FROM raw_materials rm
    LEFT JOIN (
      SELECT 
        pi.material_id,
        SUM(pi.total_cost) as total_cost,
        SUM(pi.quantity) as total_qty
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      WHERE pi.item_type = 'RAW_MATERIAL'
        AND substr(p.date, 1, 4) = ?
      GROUP BY pi.material_id
    ) p_summary ON rm.id = p_summary.material_id
  `).all(yearStr);

  const costMap = new Map<string, number>();
  for (const row of rows) {
    if (row.total_purchased_qty > 0) {
      costMap.set(row.id, divideMoney(row.total_purchased_cost, row.total_purchased_qty));
    } else {
      costMap.set(row.id, round3(Number(row.latest_purchase_cost) || 0));
    }
  }

  return costMap;
}

/**
 * Returns the quantity-weighted average unit cost for a single material in currentYear,
 * falling back to raw_materials.latest_purchase_cost.
 */
export function getMaterialUnitCost(db: any, materialId: string, currentYear: number = new Date().getFullYear()): number {
  const costs = getMaterialUnitCosts(db, currentYear);
  if (costs.has(materialId)) {
    return costs.get(materialId)!;
  }
  const rm: any = db.prepare('SELECT latest_purchase_cost FROM raw_materials WHERE id = ?').get(materialId);
  return round3(Number(rm?.latest_purchase_cost) || 0);
}

/**
 * Calculates current formulation cost based on the quantity-weighted average purchase cost of all ingredients and packaging.
 */
export function calculateFormulationCost(db: any, formulationId: string): FormulationCostResult {
  const formulation: any = db.prepare(`
    SELECT * FROM formulations WHERE id = ?
  `).get(formulationId);

  if (!formulation) {
    throw new Error(`Formulation not found: ${formulationId}`);
  }

  const items: any[] = db.prepare(`
    SELECT fi.id, fi.material_id, fi.quantity_required,
           rm.name as material_name, rm.category as material_category,
           rm.unit as material_unit, rm.latest_purchase_cost as unit_cost
    FROM formulation_items fi
    JOIN raw_materials rm ON fi.material_id = rm.id
    WHERE fi.formulation_id = ?
    ORDER BY rm.category ASC, rm.name ASC
  `).all(formulationId);

  let totalCost = 0;
  const costedItems: FormulationItemCost[] = items.map((item) => {
    const unitCost = round3(item.unit_cost || 0);
    const itemTotal = multiplyMoney(unitCost, item.quantity_required);
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

/**
 * Scales a formulation to calculate required materials and expected cost for a specific target production output.
 */
export function calculateBatchRequirements(
  db: any,
  formulationId: string,
  targetOutputUnits: number
): {
  targetOutputUnits: number;
  scalingFactor: number;
  totalBatchCost: number;
  costPerUnit: number;
  ingredients: ScaledBatchIngredient[];
} {
  const formulationCost = calculateFormulationCost(db, formulationId);
  const baseYield = formulationCost.base_yield_quantity;
  const scalingFactor = targetOutputUnits / baseYield;

  let totalBatchCost = 0;
  const ingredients: ScaledBatchIngredient[] = formulationCost.items.map((item) => {
    const rawMaterial: any = db.prepare('SELECT stock_quantity FROM raw_materials WHERE id = ?').get(item.material_id);
    const currentStock = rawMaterial ? rawMaterial.stock_quantity : 0;

    const scaledQty = round3(item.quantity_required * scalingFactor);
    const scaledItemTotal = multiplyMoney(item.unit_cost, scaledQty);
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

  const costPerUnit = targetOutputUnits > 0 ? divideMoney(totalBatchCost, targetOutputUnits) : 0;

  return {
    targetOutputUnits,
    scalingFactor,
    totalBatchCost,
    costPerUnit,
    ingredients
  };
}
