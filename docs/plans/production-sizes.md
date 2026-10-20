# Design Plan — Production Batch Volume Scaling, Multi-Size Packaging & Cost Reference (Phase 3: F3, F4, F10)

**Document:** `docs/plans/production-sizes.md`  
**Status:** PROPOSED — AWAITING OPERATOR APPROVAL (No application code written)  
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

## 2. Binding Decisions (D2, D3, D4)

| # | Decision | Approved Rule |
|---|---|---|
| **D2** | Production batch volume & units | **Batch volume is authoritative for material scaling; units produced is authoritative for stock.** Derive one from the other using SKU size. If both are passed, assert they match within 0.001 tolerance; reject mismatches with 400. |
| **D3** | Packaging for multi-size products | **Allow formulation per SKU (`products.formulation_id`).** If null, fall back to family formulation. If family has multiple active SKUs and family formulation is used, display warning: *"Recette famille — vérifier les emballages pour ce format."* |
| **D4** | Cost reference calculation | **Manufactured `cost_reference` is auto-computed and read-only per SKU.** For resale, maintain manual cost. For existing data, provide a Backoffice preview/confirmation recalculation tool rather than silent historical rewrites. |

---

## 3. Data Model & Additive Schema Migrations

All schema changes adhere strictly to project non-negotiable rules: additive, idempotent, no destructive changes.

### 3.1 Migration in `server/db/index.ts`
Using the existing `ensureColumn` mechanism:
```ts
ensureColumn('production_batches', 'batch_volume', 'REAL');
ensureColumn('products', 'formulation_id', 'TEXT REFERENCES formulations(id)');
```

### 3.2 Updates in `server/db/schema.sql` (for fresh database installations)
1. **`products` table ([schema.sql:87-102](server/db/schema.sql#L87-L102)):**
   ```sql
   CREATE TABLE IF NOT EXISTS products (
       id TEXT PRIMARY KEY,
       family_id TEXT NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
       formulation_id TEXT REFERENCES formulations(id), -- Per-SKU recipe override
       name TEXT NOT NULL,
       size_label TEXT,
       ...
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

### 3.3 Effect on Existing Data
- **Existing `production_batches` rows:** `batch_volume` will be `NULL`. API responses and UI history will gracefully fall back to displaying `units_produced` or `NULL` without crashing or showing `undefinedL`.
- **Existing `products` rows:** `formulation_id` will be `NULL`. The system will continue to resolve to `family.formulation_id`.
- **Existing `cost_reference` values:** Historical cost references will **NOT** be automatically rewritten. A preview endpoint (`GET /api/products/cost-preview`) will show current vs. recalculated cost per SKU, requiring explicit owner confirmation before updating.

---

## 4. Volume, Size & Unit Derivation Rules (F3, D2)

### 4.1 Size Label Parser Helper (`server/utils/unitConversion.ts`)
We introduce a robust, deterministic helper `parseSizeMultiplier(sizeLabel: string | null, baseYieldUnit: string)`:
1. Normalize input: lowercase, strip whitespace.
2. If `baseYieldUnit === 'pcs'`: size factor is `1.0`.
3. If `baseYieldUnit === 'L'`:
   - Match regex `/^(\d+(?:[.,]\d+)?)\s*(l|litre|litres|ml|cl|dl)$/i`
   - Unit `l` / `litre`: factor = `value`
   - Unit `ml`: factor = `value / 1000`
   - Unit `cl`: factor = `value / 100`
   - Unit `dl`: factor = `value / 10`
4. If `baseYieldUnit === 'kg'`:
   - Match regex `/^(\d+(?:[.,]\d+)?)\s*(kg|kilo|g|gramme|grammes)$/i`
   - Unit `kg`: factor = `value`
   - Unit `g`: factor = `value / 1000`
5. If `sizeLabel` is empty, null, "piece", "pièce", "unité":
   - If `baseYieldUnit === 'pcs'`: factor = `1.0`
   - Else: cannot be safely parsed -> returns `null`.

### 4.2 Derivation & Validation in `POST /api/production/batches`
Given payload `{ formulation_id, target_product_id, batch_volume, batch_volume_liters, units_produced }`:
1. **Compatibility:** `declaredVolume = batch_volume ?? batch_volume_liters`.
2. **Formulation Resolution:**
   - Find target product: `product = SELECT * FROM products WHERE id = ?`.
   - Find target family: `family = SELECT * FROM product_families WHERE id = product.family_id`.
   - Target must be `MANUFACTURED`.
   - Effective formulation: `effectiveFormulationId = product.formulation_id || family.formulation_id`.
   - Assert `formulation_id === effectiveFormulationId`. If not, return 400: `"La recette choisie ne correspond pas à l'article cible."`
3. **Yield Unit & Factor:**
   - Let `baseUnit = formulation.base_yield_unit`.
   - `sizeFactor = parseSizeMultiplier(product.size_label, baseUnit)`.
4. **Reconciliation:**
   - **Case A: Both provided (`declaredVolume` and `units_produced`):**
     - If `sizeFactor !== null`:
       - `expectedVolume = round3(units_produced * sizeFactor)`.
       - If `Math.abs(declaredVolume - expectedVolume) > 0.001`:
         - Reject with 400: `"Incohérence : le volume déclaré (${declaredVolume} ${baseUnit}) ne correspond pas aux unités produites (${units_produced} × ${sizeFactor} = ${expectedVolume} ${baseUnit})."`
     - Authoritative volume for scaling: `finalVolume = declaredVolume`.
     - Authoritative units for stock: `finalUnits = units_produced`.
   - **Case B: Only `units_produced` provided:**
     - If `sizeFactor === null`:
       - Reject with 400: `"Le volume du lot est obligatoire lorsque le format de l'article ne peut pas être déduit automatiquement."`
     - `finalVolume = round3(units_produced * sizeFactor)`.
     - `finalUnits = units_produced`.
   - **Case C: Only `batch_volume` provided:**
     - If `sizeFactor === null`:
       - Reject with 400: `"Le nombre d'unités produites est obligatoire lorsque le format de l'article ne peut pas être déduit automatiquement."`
     - `finalUnits = round3(declaredVolume / sizeFactor)`.
     - `finalVolume = declaredVolume`.
   - **Case D: Neither provided:**
     - Reject with 400: `"Le volume du lot ou les unités produites doivent être spécifiés."`

---

## 5. Costing Service & Material Scaling (F3, D2, D3)

### 5.1 Formulation Scaling Logic (`server/services/costingService.ts`)
Refactor `calculateBatchRequirements(db, formulationId, batchVolume, unitsProduced, targetYear)`:
1. `formulation = calculateFormulationCost(db, formulationId, targetYear)`
2. `baseYield = formulation.base_yield_quantity`
3. `chemicalScalingFactor = batchVolume / baseYield`
4. Split items by category:
   - Chemical materials (`category NOT IN ('bottle', 'cap', 'label', 'packaging')`):
     - `quantity_consumed = round3(item.quantity_required * chemicalScalingFactor)`
   - Packaging materials (`category IN ('bottle', 'cap', 'label', 'packaging')`):
     - If product has specific formulation: packaging scales by `unitsProduced / baseYield` (or `unitsProduced * item.quantity_per_unit`).
     - If family formulation: scales by `unitsProduced / baseYield`.
5. Sum item costs using `addMoney` and `round3`.
6. `costPerUnit = divideMoney(totalBatchCost, unitsProduced)`.

### 5.2 Stock & Ledger Execution
In the transaction:
1. Insert `production_batches` with `batch_volume = finalVolume`, `units_produced = finalUnits`.
2. Insert `production_batch_materials_consumed` for all consumed ingredients with exact rounded quantities and costs.
3. Decrement `raw_materials.stock_quantity`.
4. Increment `products.stock_quantity = stock_quantity + finalUnits`.
5. Update `products.cost_reference = costPerUnit`.

---

## 6. Sku Cost Reference Calculation (F4, D4)

### 6.1 Cost Calculation Helper (`calculateSkuCostReference`)
In `server/services/costingService.ts`:
```ts
export function calculateSkuCostReference(
  db: any,
  product: { id?: string; size_label?: string | null; formulation_id?: string | null; family_id: string },
  targetYear?: number
): number {
  const family = db.prepare('SELECT * FROM product_families WHERE id = ?').get(product.family_id);
  if (!family || family.type !== 'MANUFACTURED') return 0;

  const formulationId = product.formulation_id || family.formulation_id;
  if (!formulationId) return 0;

  const formCost = calculateFormulationCost(db, formulationId, targetYear);
  if (product.formulation_id) {
    // Dedicated SKU recipe: cost per unit is directly formulation cost per unit
    return formCost.cost_per_unit;
  }

  // Family recipe fallback: scale bulk materials by size factor + packaging
  const sizeFactor = parseSizeMultiplier(product.size_label || null, formCost.base_yield_unit);
  if (sizeFactor === null) {
    return formCost.cost_per_unit;
  }

  // Bulk cost per base unit
  const bulkCost = formCost.items
    .filter(i => !['bottle', 'cap', 'label', 'packaging'].includes(i.material_category))
    .reduce((sum, i) => addMoney(sum, i.item_total_cost), 0);
  const bulkPerBaseUnit = divideMoney(bulkCost, formCost.base_yield_quantity);

  // Packaging cost per unit
  const packagingCost = formCost.items
    .filter(i => ['bottle', 'cap', 'label', 'packaging'].includes(i.material_category))
    .reduce((sum, i) => addMoney(sum, i.item_total_cost), 0);
  const packagingPerUnit = divideMoney(packagingCost, formCost.base_yield_quantity);

  return addMoney(round3(bulkPerBaseUnit * sizeFactor), packagingPerUnit);
}
```

### 6.2 Routes & UI Enforcement
1. **`POST /api/products` & `PUT /api/products/:id`:**
   - If family is `MANUFACTURED` and no `allow_cost_override === true` is passed:
     - Automatically compute `cost_reference = calculateSkuCostReference(...)`.
   - If `RESALE`: accept user provided `cost_reference`.
2. **`CreateProductModal.tsx`:**
   - Remove hardcoded `cost_reference = '0.000'` default overriding server calculation.
   - For manufactured items: render cost reference as read-only with note *"Calculé automatiquement d'après la formule et le format"*.
   - Only allow manual cost editing for `RESALE` products.

---

## 7. Backoffice UI Improvements & Bug Fixes (F3, F10)

1. **Fix `undefinedL` in Production History (`Backoffice.tsx:1722`):**
   - Change `{b.batch_volume_liters}L` to:
     ```tsx
     {b.batch_volume != null ? `${b.batch_volume} ${b.base_yield_unit || 'L'}` : '—'}
     ```
2. **Fix Negative Stock Warnings Rendering (`Backoffice.tsx:1629`):**
   - Correctly read `batchResult.negative_stock_warnings`:
     ```tsx
     {batchResult.negative_stock_warnings && batchResult.negative_stock_warnings.length > 0 && (
       <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs text-amber-900 space-y-1">
         <span className="font-bold flex items-center gap-1">
           <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
           Avertissements de déficit de stock (passé en négatif) :
         </span>
         {batchResult.negative_stock_warnings.map((w: any, i: number) => (
           <div key={i}>
             • {w.material_name} : requis {w.quantity_required} {w.unit}, disponible {w.current_stock} {w.unit} (déficit : {w.deficit} {w.unit})
           </div>
         ))}
       </div>
     )}
     ```
3. **Multi-Size Warning in Production Wizard:**
   - If the selected product uses a family formulation and the family has > 1 active SKUs:
     - Display informational banner: *"⚠️ Recette famille utilisée — vérifier la compatibilité des emballages pour le format ${size_label}."*
4. **Interactive Auto-Derivation in Wizard Form:**
   - Changing `Volume du lot` auto-populates `Unités produites = Volume / format`.
   - Changing `Unités produites` auto-populates `Volume du lot = Unités × format`.

---

## 8. Failure Modes & Mitigations

| Failure Mode | Risk | Mitigation |
|---|---|---|
| Unparseable size label (e.g. "Bidon Spécial") | Wrong scaling or division by zero | `parseSizeMultiplier` returns `null`. Requires explicit `batch_volume` and `units_produced` with 400 error if missing. |
| Mismatch between volume and units | Material under/over-deduction | Validates `Math.abs(volume - units * size) <= 0.001`; returns 400 if mismatched. |
| Zero or negative volume/units | Division by zero, negative production | Validated via `requireFinitePositive`. Rejects <= 0. |
| Insufficient raw materials stock | Stock goes negative | Allowed by design (non-blocking shop operation). Accurately reports `negative_stock_warnings` in API & UI. |
| Concurrent batch creation | Batch number collision | Retries up to 3 times on unique constraint violation; transactional atomic execution. |
| Historical batches missing `batch_volume` | UI crashes / renders `undefinedL` | Null-safe formatting `{b.batch_volume ?? '—'}`. |

---

## 9. Test Plan & Planned Logical Commits

We follow the strict Operating Loop: **failing test first**, **show failure**, **implement fix**, **show passing**, **mutation test proof (remove guard -> fail)**, **tsc/vitest/invariants/build verification**, **commit & push**.

### Commit 1: Schema migration & Unit Conversion Helper
- **Test First:** `server/utils/unitConversion.test.ts`
  - Tests parsing `1L`, `1.5L`, `500ml`, `5L`, `1kg`, `500g`, `pcs`.
  - Tests unparseable labels returning `null`.
  - Tests tolerance matching `isVolumeConsistent(units, volume, sizeFactor)`.
- **Implementation:** `server/utils/unitConversion.ts`, migration in `server/db/index.ts` and `server/db/schema.sql`.

### Commit 2: Production Scaling & Reconciliation (F3)
- **Test First:** In `server/routes/production.test.ts`:
  1. Produce 20 × 2 L bottles with 40 L batch volume -> consumes 4 kg material (not 2 kg), cost 20 DT, cost/unit 1.000 DT.
  2. Mismatched volume and units (e.g. 40 L for 10 × 2 L) -> 400 error in French.
  3. Derive volume from units when volume omitted.
  4. Derive units from volume when units omitted.
  5. Unparseable size without explicit volume -> 400 error.
  6. Dedicated SKU formulation precedence over family formulation.
- **Mutation Proof:** Remove 0.001 consistency check -> mismatch test fails; revert chemical scaling -> 20 x 2L test fails.
- **Implementation:** `server/services/costingService.ts`, `server/routes/production.ts`.

### Commit 3: Per-SKU Cost Reference & Prevention of UI Overwrite (F4)
- **Test First:** In `server/routes/products.test.ts`:
  1. Manufactured 5 L product under 100 L / 50 DT formula gets `cost_reference = 2.500 DT` (not 0.500 DT).
  2. Client-sent `cost_reference: 0` on manufactured product is ignored unless override flag is set.
  3. Resale product continues to accept manual `cost_reference`.
- **Mutation Proof:** Remove auto-calculation -> manufactured product gets 0 -> test fails.
- **Implementation:** `server/services/costingService.ts`, `server/routes/products.ts`.

### Commit 4: Backoffice UI Fixes (F3, F10)
- **Test First:** UI component unit tests in `src/components/backoffice/Backoffice.test.tsx`:
  1. Batch history renders volume with proper unit (no `undefinedL`).
  2. Negative stock warnings are displayed when returned in API response.
  3. Family formulation warning shown when multiple SKUs exist.
- **Implementation:** `Backoffice.tsx`, `CreateProductModal.tsx`, `BatchDetailModal.tsx`.

---

## 10. Rollback Strategy

1. **Database:** Migrations add nullable columns (`batch_volume`, `formulation_id`). Neither drops existing columns nor adds `NOT NULL` constraints without defaults. If code is reverted, existing database continues to function without schema modifications.
2. **Code:** Each commit is self-contained and atomic. Reverting git commits restores prior behavior cleanly.
