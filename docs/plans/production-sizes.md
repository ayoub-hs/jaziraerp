# Design Plan — Production Batch Volume Scaling, Multi-Size Packaging & Cost Reference (Phase 3: F3, F4, F10)

**Document:** `docs/plans/production-sizes.md`  
**Revision:** 3 (Owner Confirmed Workflow: Bulk Chemistry Formulation + `product_packaging_items` Table, Double-Count Guard, Numeric `size_volume`, No Runtime Regex, Verified Decimal POS)  
**Status:** APPROVED FOR EXECUTION (Proceeding through Commit 1 and Commit 2)  
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

## 2. Owner-Confirmed Operational Workflow

*(All currency figures and recipe quantities below, e.g. 1600 DT, 150 kg, 0.350 DT, are strictly **ILLUSTRATIVE** examples used for demonstration and test assertions).*

1. **One Bulk Recipe per Family (in Litres):**
   - The product family (e.g. *Liquide Vaisselle Citron*) is linked to one bulk formulation (`product_families.formulation_id`).
   - The recipe is formulated in Litres (e.g. `base_yield_quantity = 2000`, `base_yield_unit = 'L'`).
   - The recipe contains **chemistry only** (tensioactifs, parfum, colorant, sel, eau...). It contains **no bottles, caps, or labels**.
2. **SKUs Under the Family:**
   - **Vrac:** `size_volume = 1.0`, zero packaging. Sold by the litre (filling customer's bottle).
   - **1.5 L SKU:** `size_volume = 1.5`, has packaging items (1 bottle 1.5L + 1 bouchon + 1 étiquette 1.5L).
   - **2 L SKU:** `size_volume = 2.0`, has packaging items (1 bottle 2L + 1 bouchon + 1 étiquette 2L).
   - **Pack of 6 (1.5 L):** Sales multiplier on the 1.5 L bottle (`product_pack_sizes.multiplier = 6`). Sells 6 bottles from 1.5L piece stock.
3. **Packaging Model (`product_packaging_items`):**
   - Dedicated table attaching packaging materials directly to the product SKU.
   - Replaces the concept of "dedicated recipe per size": the family retains the bulk chemistry formula, while each finished SKU specifies its own packaging bill of materials.

---

## 3. Data Model & Schema Migrations

All schema modifications are additive, idempotent, and executed via `ensureColumn` and `CREATE TABLE IF NOT EXISTS` in [`server/db/index.ts:51-66`](server/db/index.ts#L51-L66) and [`server/db/schema.sql`](server/db/schema.sql).

### 3.1 New Additive Table: `product_packaging_items`
```sql
CREATE TABLE IF NOT EXISTS product_packaging_items (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
    quantity_per_unit REAL NOT NULL CHECK (quantity_per_unit > 0),
    UNIQUE (product_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_product_packaging_items_prod ON product_packaging_items(product_id);
```

### 3.2 Additive Columns
- **`products.size_volume REAL`:** Numeric volume in the base unit of the formulation (e.g. `1.5`, `2.0`, `1.0`). Nullable.
  - **MANDATORY INVARIANT:** A `MANUFACTURED` product with liquid/weight formulation (`base_yield_unit IN ('L', 'kg')`) **MUST NOT** have a `NULL` `size_volume` during production or costing. If `size_volume` is `NULL`, the server returns a French 400: `"Le volume unitaire (size_volume) est obligatoire pour les produits fabriqués en litres/kilos."` It **never** silently defaults to `1.0`.
  - For piece-based formulations (`base_yield_unit === 'pcs'`), `size_volume` may be `1.0`.
- **`production_batches.batch_volume REAL`:** Persisted batch volume in the formulation base unit.
- *(Note: `products.formulation_id` is dropped from the plan as per instructions; the family bulk formulation + `product_packaging_items` completely solves packaging per size).*

### 3.3 Rule for `products.size_volume` as Source of Truth
- **NO RUNTIME REGEX PARSING:** Production execution and cost calculation read strictly numeric `products.size_volume`.
- **Backfill Suggestion:** In Backoffice, a one-time migration preview shows suggested `size_volume` from `size_label` (e.g. "1.5L" $\rightarrow$ 1.5). It is **never applied silently** and requires explicit operator review and confirmation.

---

## 4. Packaging Scaling & Reconciliation Rules

### 4.1 Scaling Calculation
When producing $U$ finished units of product $P$ (`size_volume` $V_{\text{sku}}$):
1. **Batch Chemistry Volume:**
   $$V_{\text{batch}} = U \times V_{\text{sku}}$$
2. **Chemistry Scaling Factor ($S$):**
   $$S = \frac{V_{\text{batch}}}{\text{base\_yield\_quantity}} = \frac{U \times V_{\text{sku}}}{\text{base\_yield\_quantity}}$$
   Every raw material in the family formulation (chemical ingredients) scales by:
   $$\text{qty\_consumed}_{\text{chem}} = \text{round3}(Q_{\text{chem, base}} \times S)$$
3. **Packaging Scaling:**
   Every packaging item in `product_packaging_items` for product $P$ scales by:
   $$\text{qty\_consumed}_{\text{pkg}} = \text{round3}(U \times \text{quantity\_per\_unit})$$

### 4.2 The Double-Count Guard
- **Rule:** If the formulation contains materials with `raw_materials.category IN ('bottle', 'cap', 'label', 'packaging')` **AND** the target product has records in `product_packaging_items`:
  - The request is rejected with HTTP 400 and French message:
    `"Incohérence : la formule contient déjà des articles d'emballage alors que le produit a des emballages spécifiques configurés (risque de double décompte)."`
- **Legacy Compatibility:** If the product has **no** records in `product_packaging_items`, legacy formulations containing packaging materials continue to scale by volume fraction $S = V_{\text{batch}} / \text{base\_yield\_quantity}$.

### 4.3 Batch Reconciliation (The 4 Cases)
In `POST /api/production/batches`, given `declaredVolume = batch_volume ?? batch_volume_liters` and `units_produced`:
1. **Both Provided:**
   - If `Math.abs(declaredVolume - (units_produced * product.size_volume)) > 0.001`:
     - Reject with 400: `"Incohérence : le volume déclaré (${declaredVolume}) ne correspond pas aux unités produites (${units_produced} × ${product.size_volume} = ${expectedVolume})."`
   - Final volume = `declaredVolume`, Final units = `units_produced`.
2. **Units Only Provided:**
   - Final units = `units_produced`.
   - Final volume = `round3(units_produced * product.size_volume)`.
3. **Volume Only Provided:**
   - Final volume = `declaredVolume`.
   - Final units = `round3(declaredVolume / product.size_volume)`.
4. **Neither Provided:**
   - Reject with 400: `"Le volume du lot ou le nombre d'unités produites doit être spécifié."`

---

## 5. ONE Volume-Based Costing Function

### 5.1 Mathematical Specification
Used identically by:
1. `POST /api/products` (Manufactured product creation)
2. `GET /api/products/cost-preview` (Backoffice cost preview)
3. `POST /api/production/batches` (Production run execution)

$$\text{cost\_per\_unit} = \text{round3}(V_{\text{sku}} \times C_{\text{bulk\_per\_base\_unit}}) + \sum_{p \in \text{packaging}} \text{round3}(\text{quantity\_per\_unit}_p \times \text{unit\_cost}_p)$$
Where:
$$C_{\text{bulk\_per\_base\_unit}} = \frac{\sum_{m \in \text{recipe}} \text{round3}(Q_m \times \text{unit\_cost}_m)}{\text{base\_yield\_quantity}}$$

### 5.2 Illustrative Numbers & Test Assertion Tables

*(Figures below: bulk 0.800 DT/L, packaging costs 0.350 / 0.050 / 0.080 DT are illustrative test constants).*

#### Table 1: Costing Function Test Cases
| SKU | `size_volume` | Bulk Cost / L | Liquid Cost | Packaging Items | Packaging Cost | Total Cost Reference |
|---|---|---|---|---|---|---|
| **Vrac** | `1.0` | 0.800 DT | $1.0 \times 0.800 = 0.800$ | None | 0.000 DT | **`0.800` DT** |
| **1.5 L** | `1.5` | 0.800 DT | $1.5 \times 0.800 = 1.200$ | Bottle (0.350) + Cap (0.050) + Label (0.080) | 0.480 DT | **`1.680` DT** |
| **2 L** | `2.0` | 0.800 DT | $2.0 \times 0.800 = 1.600$ | Bottle (0.420) + Cap (0.050) + Label (0.090) | 0.560 DT | **`2.160` DT** |

#### Table 2: 20 × 2 L Production Execution Example (Asserted in Tests)
*Base Formulation: 100 L Base Yield, 10 kg Chemical RM @ 2.000 DT = 20.000 DT ($C_{\text{bulk}} = 0.200\text{ DT/L}$). Target: 20 units of 2L (`size_volume = 2.0`). Packaging: Bottle 2L (0.420) + Cap (0.050) + Label (0.090).*

| Field | Formula / Item Value | Multiplier / Scale Rule | Stored / Asserted Value | Unit |
|---|---|---|---|---|
| Batch Volume | $20 \times 2.0$ | Authoritative for chemistry | `40.0` | L |
| Chemistry Scale ($S$) | $40.0 / 100.0$ | Volume fraction | `0.4` | — |
| Chemical RM Consumed | 10.0 kg base | $10.0 \times 0.4$ | `4.000` | kg |
| Chemical Cost | 20.000 DT base | $20.000 \times 0.4$ | `8.000` | TND |
| 2L Bottle Consumed | 1 pc / unit | $20 \times 1$ | `20` | pcs |
| 2L Bottle Cost | 0.420 DT / pc | $20 \times 0.420$ | `8.400` | TND |
| Cap Consumed | 1 pc / unit | $20 \times 1$ | `20` | pcs |
| Cap Cost | 0.050 DT / pc | $20 \times 0.050$ | `1.000` | TND |
| 2L Label Consumed | 1 pc / unit | $20 \times 1$ | `20` | pcs |
| 2L Label Cost | 0.090 DT / pc | $20 \times 0.090$ | `1.800` | TND |
| Total Packaging Cost | — | $8.400 + 1.000 + 1.800$ | `11.200` | TND |
| **Total Batch Cost** | — | $8.000 + 11.200$ | **`19.200`** | TND |
| **Cost Per Unit** | — | $19.200 / 20$ | **`0.960`** | TND |
| **Finished Stock Added** | — | Units produced | **`+20`** | pcs |

---

## 6. Route Enforcement & Strict Invariants

1. **`POST /api/products` (Create):**
   - For `MANUFACTURED` products:
     - Require `size_volume` if formulation base unit is `'L'` or `'kg'`. If `NULL`, return 400: `"Le volume unitaire (size_volume) est obligatoire pour les produits fabriqués en litres/kilos."`
     - Auto-compute `cost_reference` via `calculateProductUnitCost`. Ignore client-sent cost unless `allow_cost_override === true`.
2. **`PUT /api/products/:id` (Update):**
   - **STRICT INVARIANT:** Must **NOT** silently recalculate `cost_reference`.
   - On `MANUFACTURED` products, client-sent `cost_reference` (such as the modal's default `0.000`) is **ignored** unless `allow_cost_override === true`.
3. **`GET /api/products/cost-preview`:**
   - Evaluates all manufactured products. If `size_volume IS NULL`, returns `{ status: "size manquante", calculated_cost: null }`.

---

## 7. POS Decimal Litres for Vrac (Verified in Codebase)

The codebase has been verified line-by-line; decimal litres for vrac checkout are **fully supported end-to-end**:
- **Database Schema:** [`server/db/schema.sql:93`](server/db/schema.sql#L93) defines `products.stock_quantity REAL NOT NULL DEFAULT 0`. [`server/db/schema.sql:353`](server/db/schema.sql#L353) defines `sale_items.quantity REAL NOT NULL` and line 355 defines `base_stock_deducted REAL NOT NULL`.
- **Server Validation:** [`server/services/saleService.ts:186-189`](server/services/saleService.ts#L186-L189) parses `const qty = Number(item.quantity)` and asserts `Number.isFinite(qty) && qty > 0`. Decimals like `2.5` or `3.75` pass without error.
- **Desktop UI Input:** [`src/components/desktop/DesktopPos.tsx:912-920`](src/components/desktop/DesktopPos.tsx#L912-L920) uses `BufferedNumberInput` with `step="0.001"` and `min={0.001}`.
- **Mobile UI Input:** [`src/components/mobile/MobileRegister.tsx:1348-1356`](src/components/mobile/MobileRegister.tsx#L1348-L1356) uses `BufferedNumberInput` with `step="0.001"` and `min={0.001}`.
- **Verdict:** VERIFIED. No changes to POS are needed or permitted.

---

## 8. Diagnostic Read-Only SQL Queries

### 8.1 Formulations with Packaging Materials (Double-Count Audit)
Lists existing formulations that contain packaging-category materials:
```sql
SELECT DISTINCT 
  f.id AS formulation_id, 
  f.name AS formulation_name, 
  rm.id AS material_id,
  rm.name AS material_name, 
  rm.category AS material_category,
  fi.quantity_required
FROM formulations f
JOIN formulation_items fi ON f.id = fi.formulation_id
JOIN raw_materials rm ON fi.material_id = rm.id
WHERE rm.category IN ('bottle', 'cap', 'label', 'packaging')
ORDER BY f.name, rm.name;
```

### 8.2 Products Valuation Diagnostics (Approximate SQL — Preview Endpoint is Authoritative)
```sql
SELECT 
  p.id,
  p.name AS product_name,
  p.size_label,
  p.size_volume,
  p.stock_quantity,
  ROUND(p.cost_reference, 3) AS current_cost,
  ROUND(p.stock_quantity * p.cost_reference, 3) AS current_valuation,
  CASE 
    WHEN p.size_volume IS NULL THEN 'size manquante'
    ELSE 'ok'
  END AS status
FROM products p
JOIN product_families pf ON p.family_id = pf.id
WHERE pf.type = 'MANUFACTURED'
ORDER BY p.name ASC;
```

---

## 9. Implementation Plan (Commit 1 & Commit 2)

### Commit 1: Schema Migrations (`products.size_volume`, `production_batches.batch_volume`, `product_packaging_items`)
- **Failing Test First:** `server/db/schema.test.ts` asserts columns and table exist.
- **Implementation:** Migration in `server/db/index.ts` and `server/db/schema.sql`.
- **Mutation Proof:** Revert `ensureColumn` $\rightarrow$ tests fail.
- **Verification:** `npx tsc -b`, `vitest`, `invariants`, `build`.
- **Commit & Push.**

### Commit 2: Unified Scaling & Costing Engine (F3, F4)
- **Failing Tests First:**
  1. `calculateProductUnitCost` asserts 0.800 (vrac), 1.680 (1.5L), 2.160 (2L).
  2. Production execution of 20 × 2 L consumes 4.0 kg chemical and 20 bottles/caps/labels.
  3. Double-count guard throws 400 when recipe has packaging and product has packaging items.
  4. 4 batch reconciliation cases (matching, mismatch > 0.001 $\rightarrow$ 400, units only, volume only, neither $\rightarrow$ 400).
  5. NULL `size_volume` on manufactured product $\rightarrow$ 400.
  6. `PUT /products` preserves `cost_reference` against modal-style `0.000` payload.
- **Implementation:** `server/services/costingService.ts`, `server/routes/production.ts`, `server/routes/products.ts`.
- **Mutation Proofs:** Break double-count guard $\rightarrow$ fail; break tolerance $\rightarrow$ fail; break NULL size guard $\rightarrow$ fail; break packaging sum $\rightarrow$ fail.
- **Verification:** Full suite verification.
- **Commit & Push.**
- **STOP for operator verification.**
