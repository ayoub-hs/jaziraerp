# Design Plan — Production Batch Volume Scaling, Multi-Size Packaging & Cost Reference (Phase 3: F3, F4, F10)

**Document:** `docs/plans/production-sizes.md`  
**Revision:** 2 (Incorporates Owner Facts, ONE Scaling Rule, ONE Costing Function, Numeric `products.size_volume`, and Diagnostic SQL)  
**Status:** PROPOSED — AWAITING OPERATOR APPROVAL (DOCS ONLY, NO APPLICATION CODE MODIFIED)  
**Target Baseline:** `596b712` (Phase 2 sealed and verified)

---

## 1. Problem Statement & Root Cause Analysis

### F3: Production batch volume is ignored; scaling is distorted for multi-size products
- **Current Behavior:** In [`server/routes/production.ts:66, 109`](server/routes/production.ts#L66-L109), `productionRouter.post('/batches')` receives `batch_volume_liters` from the client form ([`Backoffice.tsx:555`](src/components/backoffice/Backoffice.tsx#L555)), but ignores it completely. It passes `units_produced` directly as `targetOutputUnits` to `calculateBatchRequirements(db, formulation_id, units)`.
- **Distorted Scaling:** In [`server/services/costingService.ts:175-186`](server/services/costingService.ts#L175-L186), `scalingFactor = targetOutputUnits / baseYield`. For a 100 L base formula yielding 20 × 2 L bottles (40 L total):
  - `scalingFactor` evaluates to `20 / 100 = 0.2` instead of `40 / 100 = 0.4`.
  - Chemical consumption is halved (2 kg instead of 4 kg for a 10 kg/100 L recipe).
  - Total batch cost and unit cost are halved (10 DT total, 0.500 DT/unit instead of 20 DT total, 1.000 DT/unit).
  - Target SKU stock increases by +20, but stock valuation and inventory deduction are severely corrupted.
- **Missing Persistence & UI Bug:** `production_batches` table in [`server/db/schema.sql:115-126`](server/db/schema.sql#L115-L126) lacks a `batch_volume` column. Production batch history in [`Backoffice.tsx:1722`](src/components/backoffice/Backoffice.tsx#L1722) renders `{b.batch_volume_liters}L`, which displays literally as `undefinedL`.
- **Packaging Distortion:** A family formulation lists packaging for one format (e.g. 1 L bottle). When producing 2 L or 5 L SKUs under the same family, the engine currently deducts the 1 L packaging listed in the family formulation ([`production.ts:150-175`](server/routes/production.ts#L150-L175)).

### F4: Manufactured cost reference is unscaled and UI form overwrites with zero
- **Current Behavior:** In [`server/routes/products.ts:348-357`](server/routes/products.ts#L348-L357), `POST /api/products` computes `costReference = calculateFormulationCost(db, family.formulation_id).cost_per_unit`. For a 100 L formulation costing 50 DT (0.500 DT/L), a 5 L SKU gets `cost_reference = 0.500 DT` instead of `2.500 DT`.
- **UI Overwrite:** In [`CreateProductModal.tsx:65, 377, 437`](src/components/backoffice/CreateProductModal.tsx#L65), `costReference` state initializes to `'0.000'` and is unconditionally sent on creation and update. On the server ([`products.ts:373-376`](server/routes/products.ts#L373-L376)), `req.body.cost_reference !== undefined` evaluates to true (`0`), completely overriding the server calculation.
- **Stock Valuation Consequence:** Stock valuation multiplies `stock_quantity * cost_reference`. 10 units of 5 L liquid are valued at 5 DT (or 0 DT if created via UI) instead of 25 DT.

### F10: Negative stock warnings are suppressed in Backoffice UI
- **Current Behavior:** In [`server/routes/production.ts:227`](server/routes/production.ts#L227), the server returns `negative_stock_warnings: negativeStockWarnings`.
- **UI Bug:** In [`Backoffice.tsx:1629`](src/components/backoffice/Backoffice.tsx#L1629), the component inspects `batchResult.warnings`, which is `undefined`. Consequently, negative stock deficits are never rendered to the operator.

---

## 2. Owner Operational Facts & Core Decisions

### 2.1 Owner Facts (Answers to Q1 & Q2)
- **Fact 1 (Recipe Unit & Base Yield):** Bulk liquid recipes are formulated in Litres (`base_yield_unit = 'L'`). The base yield (`base_yield_quantity`) reflects the full batch/mixer capacity (e.g. **2000 L** for bulk detergent, or **100 L** for a standard formulation).
- **Fact 2 (Recipe Item Listing):** In any recipe, raw materials and packaging components are listed for the **whole base yield quantity** (not per bottle).
  - For a 100 L formulation producing 2L bottles, the base yield yields 50 bottles ($100 / 2 = 50$). The recipe lists: 10 kg chemical material, 50 bottles (2L), 50 caps, 50 labels.
  - For a 2000 L bulk chemical recipe (used for Vrac or bulk mixing): it lists bulk chemicals only (0 bottles, 0 caps, 0 labels).

### 2.2 Binding Architectural Decisions (D2, D3, D4)
- **D2 (Authoritative Sources):** Batch volume is authoritative for formulation scaling; units produced is authoritative for finished goods stock. Reconciled via numeric `products.size_volume`.
- **D3 (Formulation Hierarchy):** Support dedicated formulation per SKU (`products.formulation_id`). Fall back to `family.formulation_id`. If a family recipe has no packaging, packaging is not deducted and an informational warning is returned.
- **D4 (Cost Reference & No Silent Rewrites):** Manufactured `cost_reference` is auto-computed on creation using ONE volume-based function. `PUT /products/:id` must **NOT** silently recalculate cost. Historical data is updated only via an explicit Backoffice preview and confirmation endpoint.

---

## 3. Data Model & Additive Schema Migrations

All schema changes adhere strictly to project non-negotiable rules: additive, idempotent, no destructive commands.

### 3.1 New Columns via `ensureColumn` in `server/db/index.ts`
```ts
// 1. Numeric size volume in formulation base units (e.g. 1.5 for 1.5L, 2.0 for 2L, 5.0 for 5L, 1.0 for 1L/Vrac)
ensureColumn('products', 'size_volume', 'REAL');

// 2. Dedicated per-SKU formulation override
ensureColumn('products', 'formulation_id', 'TEXT REFERENCES formulations(id)');

// 3. Persisted batch volume in formulation base units
ensureColumn('production_batches', 'batch_volume', 'REAL');
```

### 3.2 Updates in `server/db/schema.sql` (for fresh database installations)
1. **`products` table ([schema.sql:87-102](server/db/schema.sql#L87-L102)):**
   ```sql
   CREATE TABLE IF NOT EXISTS products (
       id TEXT PRIMARY KEY,
       family_id TEXT NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
       formulation_id TEXT REFERENCES formulations(id), -- Per-SKU recipe override
       name TEXT NOT NULL,
       size_label TEXT,                                 -- Display label (e.g. "1.5L", "2L", "Pack of 6")
       size_volume REAL,                                -- Numeric volume in base units (e.g. 1.5, 2.0)
       barcode TEXT UNIQUE,
       stock_quantity REAL NOT NULL DEFAULT 0,
       low_stock_threshold REAL NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
       cost_reference REAL NOT NULL DEFAULT 0 CHECK (cost_reference >= 0),
       retail_price REAL NOT NULL DEFAULT 0 CHECK (retail_price >= 0),
       wholesale_price REAL NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
       container_type_id TEXT REFERENCES container_types(id),
       active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
   );
   ```
2. **`production_batches` table ([schema.sql:115-126](server/db/schema.sql#L115-L126)):**
   ```sql
   CREATE TABLE IF NOT EXISTS production_batches (
       id TEXT PRIMARY KEY,
       batch_number TEXT UNIQUE NOT NULL,
       date TEXT NOT NULL,
       formulation_id TEXT NOT NULL REFERENCES formulations(id),
       target_product_id TEXT NOT NULL REFERENCES products(id),
       batch_volume REAL,                              -- Volume in formulation base unit
       units_produced REAL NOT NULL CHECK (units_produced > 0),
       total_batch_cost REAL NOT NULL CHECK (total_batch_cost >= 0),
       cost_per_unit REAL NOT NULL CHECK (cost_per_unit >= 0),
       notes TEXT,
       created_at TEXT NOT NULL
   );
   ```

### 3.3 Rule for `products.size_volume` as Source of Truth
- **NO RUNTIME REGEX PARSING:** Application logic at runtime (production and costing) reads **only** numeric `products.size_volume`.
- **Default for Piece Items:** If `formulation.base_yield_unit === 'pcs'`, `size_volume` defaults to `1.0`.
- **Existing Rows & Backfill Suggestion:**
  - Existing rows have `size_volume = NULL`.
  - A Backoffice migration preview endpoint (`GET /api/products/backfill-preview`) parses `size_label` (e.g. "1.5L" $\rightarrow$ 1.5, "2L" $\rightarrow$ 2.0, "500ml" $\rightarrow$ 0.5) to present a **suggested `size_volume`** to the owner.
  - **The backfill is NEVER applied silently.** The owner reviews the table and confirms via `POST /api/products/backfill-confirm`.

---

## 4. The ONE Unified Scaling Rule (Proven with Numbers)

### 4.1 Mathematical Definition
For a production run of $U$ finished units targeting a product with numeric `size_volume` $V_{\text{sku}}$:
1. **Target Batch Volume:**
   $$V_{\text{batch}} = U \times V_{\text{sku}}$$
2. **Unified Scaling Factor ($S$):**
   $$S = \frac{V_{\text{batch}}}{\text{base\_yield\_quantity}} = \frac{U \times V_{\text{sku}}}{\text{base\_yield\_quantity}}$$
3. **Consumption of Line Items:**
   **Every single ingredient $i$ in the formulation (chemicals, bottles, caps, labels) scales by the exact same factor $S$:**
   $$\text{quantity\_consumed}_i = \text{round3}(Q_{\text{base}, i} \times S)$$
   $$\text{cost}_i = \text{round3}(\text{quantity\_consumed}_i \times \text{unit\_cost}_i)$$

### 4.2 Mathematical Proof (20 × 2 L Example)
- **Formulation:** 100 L Base Yield (`base_yield_quantity = 100`, `base_yield_unit = 'L'`).
- **Target SKU:** Dish Soap 2L (`size_volume = 2.0`).
- **Base Recipe Composition (for 100 L = 50 bottles of 2L):**
  - Chemical Raw Material: 10 kg @ 2.000 DT/kg = 20.000 DT
  - 2L Bottle: 50 pcs @ 0.400 DT/pc = 20.000 DT
  - Cap: 50 pcs @ 0.050 DT/pc = 2.500 DT
  - 2L Label: 50 pcs @ 0.150 DT/pc = 7.500 DT
  - **Base Formulation Total Cost:** $20 + 20 + 2.5 + 7.5 = \mathbf{50.000\text{ DT}}$
- **Production Execution ($U = 20$ units of 2L):**
  - $V_{\text{batch}} = 20 \times 2.0 = 40.0\text{ L}$.
  - Unified scaling factor: $S = 40.0 / 100.0 = \mathbf{0.4}$.
  - All items scale by $0.4$:
    - Chemical: $10\text{ kg} \times 0.4 = \mathbf{4.0\text{ kg}}$ (Cost: 8.000 DT)
    - 2L Bottles: $50\text{ pcs} \times 0.4 = \mathbf{20\text{ pcs}}$ (Cost: 8.000 DT)
    - Caps: $50\text{ pcs} \times 0.4 = \mathbf{20\text{ pcs}}$ (Cost: 1.000 DT)
    - Labels: $50\text{ pcs} \times 0.4 = \mathbf{20\text{ pcs}}$ (Cost: 3.000 DT)
  - **Total Batch Cost:** $8.000 + 8.000 + 1.000 + 3.000 = \mathbf{20.000\text{ DT}}$.
  - **Cost Per Unit:** $20.000 / 20 = \mathbf{1.000\text{ DT / bottle}}$.
  - **Stock Increase:** Exactly $+20$ units of 2L SKU.

*Result:* Exactly 20 bottles produced, exactly 20 packaging units consumed, exactly 4.0 kg chemical consumed. Zero discrepancy, ONE scaling factor.

---

## 5. ONE Unified Costing Function (Volume-Based, Per Finished Unit)

### 5.1 Function Specification
Used identically by:
1. `POST /api/products` (Manufactured product creation)
2. `GET /api/products/cost-preview` (Backoffice cost preview)
3. `POST /api/production/batches` (Production run execution)

```ts
export interface ProductCostResult {
  formulation_id: string;
  base_yield_quantity: number;
  base_yield_unit: string;
  base_recipe_total_cost: number;
  cost_per_base_unit: number; // e.g. Cost per Litre
  size_volume: number;
  cost_per_finished_unit: number; // in TND (3 decimals)
}

export function calculateProductUnitCost(
  db: any,
  product: { family_id: string; size_volume?: number | null; formulation_id?: string | null },
  targetYear: number = new Date().getFullYear()
): ProductCostResult {
  const family = db.prepare('SELECT * FROM product_families WHERE id = ?').get(product.family_id);
  if (!family || family.type !== 'MANUFACTURED') {
    throw new Error('Produit non fabriqué.');
  }

  const formulationId = product.formulation_id || family.formulation_id;
  if (!formulationId) {
    throw new Error('Aucune formule associée.');
  }

  const formulation = db.prepare('SELECT * FROM formulations WHERE id = ?').get(formulationId);
  if (!formulation) {
    throw new Error(`Formulation not found: ${formulationId}`);
  }

  // Calculate base formulation cost from latest/weighted purchase costs
  const baseYieldQty = formulation.base_yield_quantity > 0 ? formulation.base_yield_quantity : 1;
  const unitCosts = getMaterialUnitCosts(db, targetYear);
  const items = db.prepare('SELECT material_id, quantity_required FROM formulation_items WHERE formulation_id = ?').all(formulationId);

  let baseRecipeTotal = 0;
  for (const item of items) {
    const uCost = unitCosts.get(item.material_id) ?? 0;
    baseRecipeTotal = addMoney(baseRecipeTotal, round3(item.quantity_required * uCost));
  }

  const costPerBaseUnit = divideMoney(baseRecipeTotal, baseYieldQty);

  // Determine size volume
  let effectiveSizeVolume = product.size_volume;
  if (effectiveSizeVolume === undefined || effectiveSizeVolume === null) {
    if (formulation.base_yield_unit === 'pcs') {
      effectiveSizeVolume = 1.0;
    } else {
      // Must not guess: fallback to base unit cost with sizeVolume = 1
      effectiveSizeVolume = 1.0;
    }
  }

  // Dedicated SKU recipe guarantee:
  // Base yield in finished units = base_yield_quantity / size_volume
  // Cost per finished unit = baseRecipeTotal / baseUnits = costPerBaseUnit * size_volume
  const costPerFinishedUnit = round3(multiplyMoney(costPerBaseUnit, effectiveSizeVolume));

  return {
    formulation_id: formulation.id,
    base_yield_quantity: baseYieldQty,
    base_yield_unit: formulation.base_yield_unit,
    base_recipe_total_cost: baseRecipeTotal,
    cost_per_base_unit: costPerBaseUnit,
    size_volume: effectiveSizeVolume,
    cost_per_finished_unit: costPerFinishedUnit
  };
}
```

### 5.2 Test Assertion Tables

#### Table 1: Production Run (20 × 2 L Example)
*Formula: 100 L Base Yield, 10 kg LABSA @ 2.000 DT, 50 bottles 2L @ 0.400 DT, 50 caps @ 0.050 DT, 50 labels @ 0.150 DT.*

| Field | Input / Formula Value | Multiplier / Scale | Stored / Asserted Value | Unit |
|---|---|---|---|---|
| Target Product | Dish Soap 2L | — | `size_volume = 2.0` | L |
| Units Produced | `20` | — | `20` | pcs |
| Batch Volume | `40.0` | $20 \times 2.0$ | `40.0` | L |
| Scaling Factor ($S$) | $40.0 / 100.0$ | — | `0.4` | — |
| LABSA Consumed | `10.0` kg | $\times 0.4$ | `4.000` | kg |
| Bottle 2L Consumed | `50` pcs | $\times 0.4$ | `20` | pcs |
| Cap Consumed | `50` pcs | $\times 0.4$ | `20` | pcs |
| Label Consumed | `50` pcs | $\times 0.4$ | `20` | pcs |
| Total Batch Cost | 50.000 DT base | $\times 0.4$ | `20.000` | TND |
| **Cost Per Unit** | — | $20.000 / 20$ | **`1.000`** | TND |
| **New SKU Stock** | Previous: 0 | $+ 20$ | **`20`** | pcs |
| **New `cost_reference`** | Previous: 0 | Updated from batch | **`1.000`** | TND |

#### Table 2: Stock Valuation Comparison (10 × 5 L Example)
*Formula: 100 L Base Yield, Bulk Cost = 50.000 DT (0.500 DT/L). SKU: 5L (`size_volume = 5.0`). Current stock: 10 units.*

| Metric | Old Broken Code (Baseline) | New ONE Costing Function | Variance (Correction) |
|---|---|---|---|
| Formulation Cost Per Base Unit | 0.500 DT/L | 0.500 DT/L | 0.000 DT |
| SKU `size_volume` | Ignored (NULL) | `5.0` L | Explicit numeric |
| **SKU `cost_reference`** | **0.500 DT** (per Litre, unscaled) | **2.500 DT** ($5.0 \times 0.500$) | **+2.000 DT (+400%)** |
| Stock Quantity | 10 units | 10 units | 0 |
| **Total Stock Valuation** | **5.000 DT** | **25.000 DT** | **+20.000 DT** |
| If Created via Old UI Modal | **0.000 DT** (overwritten by modal default) | **2.500 DT** (computed server-side) | **+25.000 DT** |

---

## 6. Route Enforcement & No Silent Rewrites

### 6.1 `POST /api/products` (Create)
- For `MANUFACTURED` families:
  - If `cost_reference` is omitted or 0, compute automatically via `calculateProductUnitCost(db, { family_id, size_volume, formulation_id })`.
  - Accept explicit `cost_reference` only if `allow_cost_override === true` is passed.
- For `RESALE` families:
  - Keep existing behavior: accept explicit `cost_reference` or default to 0.

### 6.2 `PUT /api/products/:id` (Update) — STRICT RULE
- **MUST NOT SILENTLY RECOMPUTE `cost_reference`:**
  - An update to `retail_price`, `name`, `barcode`, or `low_stock_threshold` must leave `cost_reference` untouched.
  - An update to `size_volume` updates the column but does **not** change `cost_reference` automatically, preventing unexpected changes to historical accounting balances.

### 6.3 Backoffice Preview & Confirmation Endpoints
1. **`GET /api/products/cost-preview`:**
   - Read-only endpoint returning all manufactured products with:
     `{ product_id, name, size_label, size_volume, current_cost, calculated_cost, stock_quantity, current_valuation, new_valuation, variance }`.
2. **`POST /api/products/cost-preview/confirm`:**
   - Explicit confirmation endpoint called only when the owner reviews the preview table and clicks "Confirmer la mise à jour des coûts".
   - Executes inside a transaction, updating `cost_reference` for selected or all reviewed products.

---

## 7. Diagnostic Read-Only SQL (Run against Live/Test Database)

### 7.1 Pre-Migration Diagnostic Query (Current Database)
Lists all manufactured products, showing current cost reference and stock valuation:
```sql
WITH FormulationCosts AS (
  SELECT 
    fi.formulation_id,
    SUM(fi.quantity_required * COALESCE(rm.latest_purchase_cost, 0)) AS total_recipe_cost
  FROM formulation_items fi
  JOIN raw_materials rm ON fi.material_id = rm.id
  GROUP BY fi.formulation_id
)
SELECT 
  p.id,
  pf.name AS family_name,
  p.name AS product_name,
  p.size_label,
  p.stock_quantity,
  ROUND(p.cost_reference, 3) AS current_cost_reference,
  ROUND(p.stock_quantity * p.cost_reference, 3) AS current_stock_valuation,
  f.name AS formulation_name,
  f.base_yield_quantity,
  f.base_yield_unit,
  ROUND(COALESCE(fc.total_recipe_cost, 0), 3) AS base_recipe_total_cost,
  ROUND(COALESCE(fc.total_recipe_cost, 0) / f.base_yield_quantity, 3) AS cost_per_base_unit
FROM products p
JOIN product_families pf ON p.family_id = pf.id
LEFT JOIN formulations f ON pf.formulation_id = f.id
LEFT JOIN FormulationCosts fc ON f.id = fc.formulation_id
WHERE pf.type = 'MANUFACTURED'
ORDER BY pf.name ASC, p.name ASC;
```

### 7.2 Post-Migration Valuation Variance Query
Shows the exact valuation variance once `size_volume` is populated:
```sql
WITH FormulationCosts AS (
  SELECT 
    fi.formulation_id,
    SUM(fi.quantity_required * COALESCE(rm.latest_purchase_cost, 0)) AS total_recipe_cost
  FROM formulation_items fi
  JOIN raw_materials rm ON fi.material_id = rm.id
  GROUP BY fi.formulation_id
)
SELECT 
  p.id,
  p.name AS product_name,
  p.size_label,
  p.size_volume,
  p.stock_quantity,
  ROUND(p.cost_reference, 3) AS old_cost,
  ROUND(p.stock_quantity * p.cost_reference, 3) AS old_valuation,
  ROUND((COALESCE(fc.total_recipe_cost, 0) / f.base_yield_quantity) * COALESCE(p.size_volume, 1.0), 3) AS new_cost,
  ROUND(p.stock_quantity * ((COALESCE(fc.total_recipe_cost, 0) / f.base_yield_quantity) * COALESCE(p.size_volume, 1.0)), 3) AS new_valuation,
  ROUND(
    p.stock_quantity * ((COALESCE(fc.total_recipe_cost, 0) / f.base_yield_quantity) * COALESCE(p.size_volume, 1.0))
    - (p.stock_quantity * p.cost_reference),
    3
  ) AS valuation_variance
FROM products p
JOIN product_families pf ON p.family_id = pf.id
LEFT JOIN formulations f ON COALESCE(p.formulation_id, pf.formulation_id) = f.id
LEFT JOIN FormulationCosts fc ON f.id = fc.formulation_id
WHERE pf.type = 'MANUFACTURED'
ORDER BY valuation_variance DESC;
```

### 7.3 Historical Production Batches Diagnostic Query
Lists all historical production batches to inspect recorded volume and unit costs:
```sql
SELECT 
  pb.id,
  pb.batch_number,
  pb.date,
  p.name AS target_product_name,
  p.size_label,
  pb.units_produced,
  pb.cost_per_unit,
  pb.total_batch_cost,
  f.name AS formulation_name,
  f.base_yield_quantity,
  f.base_yield_unit
FROM production_batches pb
JOIN products p ON pb.target_product_id = p.id
JOIN formulations f ON pb.formulation_id = f.id
ORDER BY pb.date DESC, pb.created_at DESC;
```

---

## 8. Open Questions for the Owner

1. **Packaging in Bulk vs Dedicated Recipes:**
   For multi-size liquid products (1.5L, 2L), do you prefer to keep a single family recipe (pure bulk liquid) and let the system attach standard packaging items (bottle, cap, label) automatically, OR do you plan to create a dedicated recipe per SKU format in Backoffice? *(Plan default: supports both; dedicated SKU recipe takes precedence if configured)*.
2. **Pack of 6 Consumables:**
   When selling a Pack of 6 at the counter, the ERP deducts 6 bottles of 1.5L. Does the shop need stock tracking for carton boxes or plastic film rolls in raw materials, or are cartons/films treated as general shop operational expenses? *(Plan default: treated as operational expenses; pack size is a sales multiplier on bottle stock)*.
3. **Historical Batches Display:**
   Existing batches in `production_batches` have `batch_volume = NULL`. In the Backoffice history table, do you prefer displaying `—` (dash) for historical batches, or auto-deriving the estimated volume as `units_produced × size_volume`? *(Plan default: displays `units × size` if known, otherwise `—`)*.
4. **Negative Stock Deficit Action:**
   When stock of a raw chemical or packaging material goes negative during a production batch, the system warns the operator without blocking the batch. Is the current warning banner in Backoffice sufficient, or should it require an explicit checkbox acknowledgment ("Je confirme la production malgré le déficit")? *(Plan default: non-blocking warning banner with exact deficit per material)*.

---

## 9. Step-by-Step Test Plan & Planned Logical Commits

### Commit 1: Schema Migrations & Numeric Size Volume Support
- **Test First:** `server/db/schema.test.ts`
  - Asserts `products.size_volume`, `products.formulation_id`, and `production_batches.batch_volume` exist.
  - Asserts existing databases safely add columns via `ensureColumn` without data alteration.
- **Files:** `server/db/schema.sql`, `server/db/index.ts`.

### Commit 2: ONE Costing & Scaling Function (F3, F4)
- **Test First:** In `server/services/costingService.test.ts` and `server/routes/production.test.ts`:
  1. `calculateProductUnitCost` correctly computes 2.500 DT for 5L SKU and 1.000 DT for 2L SKU.
  2. Production batch (20 × 2 L) scales chemical to 4.0 kg and packaging to 20 units; batch cost = 20.000 DT, cost/unit = 1.000 DT.
  3. Mismatched volume / units returns 400.
- **Mutation Proof:** Break scaling factor $S = V_{\text{batch}} / \text{baseYield}$ to $U / \text{baseYield}$ $\rightarrow$ test fails with 2.0 kg instead of 4.0 kg.
- **Files:** `server/services/costingService.ts`, `server/routes/production.ts`.

### Commit 3: Product Routes & Prevent Silent Rewrites (F4)
- **Test First:** In `server/routes/products.test.ts`:
  1. `POST /api/products` computes `cost_reference = 2.500 DT` for manufactured 5L SKU.
  2. `PUT /api/products/:id` does NOT silently recompute `cost_reference`.
  3. `GET /api/products/cost-preview` returns old vs new valuation.
  4. `POST /api/products/cost-preview/confirm` updates cost references on confirmation.
- **Mutation Proof:** Revert auto-calc in POST $\rightarrow$ test fails. Revert guard in PUT $\rightarrow$ test fails.
- **Files:** `server/routes/products.ts`.

### Commit 4: Backoffice UI Corrections (F3, F10)
- **Test First:** In `src/components/backoffice/Backoffice.test.tsx`:
  1. Fix `undefinedL` display in production batch table.
  2. Render `negative_stock_warnings` correctly when returned by API.
  3. Stop `CreateProductModal` from overwriting cost with 0.000 for manufactured goods.
- **Files:** `Backoffice.tsx`, `CreateProductModal.tsx`, `BatchDetailModal.tsx`.

---

## 10. Rollback Strategy
1. **Schema:** All migrations are strictly additive with nullable columns. Reverting code leaves columns intact without breaking any queries.
2. **Data:** No historical `cost_reference` or `production_batches` rows are overwritten. Rollback of git commits restores prior baseline `596b712` completely.
