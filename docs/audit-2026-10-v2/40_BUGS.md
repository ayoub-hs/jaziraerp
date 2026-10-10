# Master Audit v2 — 40. Codebase Bug Inventory

## 1. Systematic Quality Checklist

| Audit Check | Status across Codebase | Detailed Notes |
|---|---|---|
| **Multi-Write Routes Inside Transactions** | **COMPLIANT** | All multi-table write handlers (`sales.ts`, `refunds`, `debtService.ts`, `accounting.ts`, `production.ts`, `suppliers.ts`, `inventory.ts`, `containers.ts`) wrap mutations in `db.transaction(() => { ... })()`. |
| **Numeric Input Finite Validation** | **NON-COMPLIANT** in `inventory.ts` | [`server/routes/inventory.ts:67`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L67) uses `isNaN(delta)` instead of `Number.isFinite(delta)`, allowing `"Infinity"` to wipe stock to `NULL`. (INV-01). |
| **Africa/Tunis Date Range Filtering** | **NON-COMPLIANT** in `inventory.ts` | [`server/routes/inventory.ts:32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L32) uses SQLite `date(ia.date) = date(?)` on UTC ISO strings instead of `tunisDayRangeUTC(day)`. (INV-02). |
| **SQL Aggregates Gross vs Net Mixing** | **NON-COMPLIANT** in `reports.ts` | [`server/routes/reports.ts:56, 167`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56) calculates `total_ht` and `total_tva` as gross pre-refund aggregates while `total_ttc` is net of refunds. (REP-01). |
| **Offline Sync Action Idempotency** | **NON-COMPLIANT** for Movements & Containers | [`server/routes/sync.ts:508, 564`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508) lack deduplication on `temp_client_id` for `CASH_MOVEMENT` and `CONTAINER_TRANSACTION`. (SYNC-01). |
| **Android Hardware Back Handlers** | **NON-COMPLIANT** across 26 Modals | Only `CheckoutModal.tsx` registers a back handler. 26 other modals lack handlers, causing the app to minimize on back press. (MOB-01). |
| **Bounded List Endpoints** | **COMPLIANT** | `sales.ts:107` bounds limit to $\min(\text{raw}, 500)$. `customers.ts`, `suppliers.ts`, `inventory.ts`, `register.ts` are bounded or naturally limited by single-store volume. |
| **N+1 Query Overhead** | **MEASURED & ACCEPTABLE** | Measured `GET /api/products/families` at 15 families, 75 SKUs, 150 pack sizes: **average latency 11.57 ms**. Does not freeze single-threaded event loop. |

---

## 2. Proven Bugs Catalog

### BUG-01: Refund with Global Cart Discount Refunds Gross Line Total (P0)
- **ID:** REF-01
- **Severity:** P0 (Wrong money / cash loss)
- **Area:** POS Returns & Refunds
- **File:Line:** [`server/routes/sales.ts:827-846`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L827-L846)
- **Input → Wrong Output:**
  - Input: Sale with item total 20.000 DT, global cart discount 5.000 DT (`total_ttc = 15.000 DT`). Customer returns both items.
  - Wrong output: Server calculates `amountRefunded = saleItem.line_total = 20.000 DT`. Register pays out 20.000 DT cash on a 15.000 DT purchase!
- **Reproduction:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  Output: `BUG CONFIRMED: sum(refunds.total_refunded) EXCEEDS sale.total_ttc by 5 DT!`
- **Smallest Fix:**
  In [`server/routes/sales.ts:840`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L840), apportion cart-level `total_discount` across lines or cap total cumulative refund at `sale.total_ttc`.
  Identifiers verified to exist: `saleItem.line_total`, `sale.total_ttc`, `sale.total_discount`.
- **Confidence:** Reproduced.

---

### BUG-02: Customer Statement Ledger Omits Credit-Reduction Refunds (P1)
- **ID:** RES-01
- **Severity:** P1 (Customer-facing ledger statement discrepancy)
- **Area:** Reseller Accounting / Customer Statement
- **File:Line:** [`server/routes/customers.ts:315-334`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L334)
- **Input → Wrong Output:**
  - Input: Customer has 50.000 DT credit ticket. Returns 20.000 DT items via `CREDIT_REDUCTION`.
  - Wrong Output: `customer_debt_tickets.remaining_amount` updates to 30.000 DT, but statement `debtEntries` table omits the credit reduction, showing a running balance ending at 50.000 DT while summary shows 30.000 DT.
- **Reproduction:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  Output: `BUG CONFIRMED: Running balance in ledger table ( 50 ) does NOT match summary card ( 30 )!`
- **Smallest Fix:**
  In [`server/routes/customers.ts:333`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L333), include credit-reduction refunds in `debtEntries`:
  ```ts
  const creditRefunds: any[] = db.prepare(`
    SELECT r.id, 'REFUND_CREDIT' as entry_type,
      'Remboursement ' || r.refund_number || ' → ' || cdt.ticket_number as reference,
      r.date, 0 as debit, r.credit_reduced as credit,
      'Réduction dette' as status, r.created_at
    FROM refunds r
    JOIN customer_debt_tickets cdt ON cdt.sale_id = r.sale_id
    WHERE cdt.customer_id = ? AND r.credit_reduced > 0
  `).all(req.params.id);
  const debtEntries = withRunning([...tickets, ...allocations, ...creditRefunds]);
  ```
  Identifiers verified to exist: `refunds.id`, `refunds.refund_number`, `refunds.credit_reduced`, `refunds.date`, `customer_debt_tickets.ticket_number`.
- **Confidence:** Reproduced.

---

### BUG-03: Sync Flush Lacks Idempotency for Cash Movements & Containers (P1)
- **ID:** SYNC-01
- **Severity:** P1 (Corrupt register cash and container ledger on sync retry)
- **Area:** Offline Sync
- **File:Line:** [`server/routes/sync.ts:508-564, 564-613`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508)
- **Input → Wrong Output:**
  - Input: Offline sync batch with `CASH_MOVEMENT` or `CONTAINER_TRANSACTION` retried after a network timeout.
  - Wrong Output: Replay inserts duplicate records into `register_cash_movements` and `container_transactions`, inflating cash and container balances.
- **Reproduction:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  Output: `BUG CONFIRMED: CASH_MOVEMENT sync is NOT idempotent! Duplicate movement created on retry! BUG CONFIRMED: CONTAINER_TRANSACTION sync is NOT idempotent! Duplicate container loan applied on retry!`
- **Smallest Fix:**
  Add `synced_from_client_id TEXT` column to `register_cash_movements` and `container_transactions`. Check `SELECT id FROM ... WHERE synced_from_client_id = ?` before inserting.
- **Confidence:** Reproduced.

---

### BUG-04: Barcode Scan with Search Input Focused Causes Double Insertion (P1)
- **ID:** POS-01
- **Severity:** P1 (Cashier operational friction / cart duplication)
- **Area:** Desktop POS Scanner
- **File:Line:** [`src/components/desktop/DesktopPos.tsx:510`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L510), [`src/services/hardware/scanner.ts:64-73`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/scanner.ts#L64)
- **Input → Wrong Output:**
  - Input: Hardware USB barcode scan while search `<input data-scanner-input="true">` is focused.
  - Wrong Output: Input's `onKeyDown` and window scanner listener both execute `addProductToCart`, inserting 2 units into the cart.
- **Reproduction:**
  ```bash
  npx tsx docs/audit-2026-10-v2/scratch/test_pos_scanner.ts
  ```
  Output: `TOTAL addProductToCart invocations for 1 scan: 2. BUG CONFIRMED: A single hardware barcode scan triggers TWO addProductToCart calls!`
- **Smallest Fix:**
  In [`src/services/hardware/scanner.ts:64`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/scanner.ts#L64), check `if (e.defaultPrevented) { this.buffer = ''; return; }`.
- **Confidence:** Reproduced.

---

### BUG-05: Barcode Landed in Checkout Cash Input Triggers Premature Sale (P1)
- **ID:** POS-02
- **Severity:** P1 (Erroneous sale finalized with billions in change due)
- **Area:** POS Checkout Modal
- **File:Line:** [`src/components/shared/CheckoutModal.tsx:83-86, 159-168, 551-561`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/CheckoutModal.tsx#L83-L86)
- **Input → Wrong Output:**
  - Input: Barcode scanned while `CheckoutModal` is open.
  - Wrong Output: Barcode digits fill `cashPaid`, and trailing Enter submits checkout immediately.
- **Reproduction:**
  ```bash
  npx tsx docs/audit-2026-10-v2/scratch/test_pos_scanner.ts
  ```
  Output: `Cash input polluted with barcode number: 619001234567. Premature checkout modal submit triggered: true. BUG CONFIRMED!`
- **Smallest Fix:**
  In `CheckoutModal.tsx`, cap maximum accepted cash tender and disallow submitting on barcode wedge keystroke bursts.
- **Confidence:** Reproduced.

---

### BUG-06: Sales Reports Show Gross HT & TVA Alongside Net TTC (P1)
- **ID:** REP-01
- **Severity:** P1 (Tax and sales accounting report distortion)
- **Area:** Reports
- **File:Line:** [`server/routes/reports.ts:56-61, 167-172`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56-L61)
- **Input → Wrong Output:**
  - Input: Sale of 100 DT (HT 84.034, TVA 15.966) partially refunded by 30 DT.
  - Wrong Output: Report shows `total_ht = 84.034`, `total_tva = 15.966`, `total_ttc = 70.000`. Column arithmetic fails: $84.034 + 15.966 \ne 70.000$.
- **Reproduction:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  Output: `BUG CONFIRMED: total_ht + total_tva ( 100 ) does NOT equal reported total_ttc ( 70 )!`
- **Smallest Fix:**
  In `reports.ts`, subtract refunded HT and TVA so `total_ht` and `total_tva` reflect the net position matching `total_ttc`.
- **Confidence:** Reproduced.

---

### BUG-07: Manual Price Edit Erased on Customer Selection (P2)
- **ID:** POS-03
- **Severity:** P2 (Cashier friction)
- **Area:** Desktop & Mobile POS
- **File:Line:** [`src/components/desktop/DesktopPos.tsx:325-341`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L325-L341), [`src/components/mobile/MobileRegister.tsx:180-195`](file:///home/admin/VibeCoding/JaziraERP/src/components/mobile/MobileRegister.tsx#L180-L195)
- **Input → Wrong Output:**
  - Cashier enters custom line price, then selects customer. `useEffect` overwrites `unit_price` with catalog tier price.
- **Smallest Fix:**
  Add `price_overridden?: boolean` to `CartItem` in [`src/types/index.ts:72`](file:///home/admin/VibeCoding/JaziraERP/src/types/index.ts#L72). Set `price_overridden: true` on manual edit; skip recalculation in `useEffect` when flag is true.
- **Confidence:** Code-traced.

---

### BUG-08: Missing Wallet Option in Refund Modal (P2)
- **ID:** REF-02
- **Severity:** P2 (Trapped cashier workflow on returns)
- **Area:** Returns / Refunds UI
- **File:Line:** [`src/components/shared/RefundModal.tsx:388-396`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/RefundModal.tsx#L388-L396)
- **Input → Wrong Output:**
  - When returning items from a sale where the debt ticket was paid or paid with wallet, `<select>` only offers `CASH` and `CREDIT_REDUCTION`. Cashier cannot issue store credit (wallet).
- **Smallest Fix:**
  Add `<option value="WALLET">Wallet (Solde Client)</option>` to the refund method select when `sale.customer_id` is present.
- **Confidence:** Code-traced.

---

### BUG-09: Infinity Input Bypasses Validation and Wipes Stock to NULL (P2)
- **ID:** INV-01
- **Severity:** P2 (Data corruption)
- **Area:** Inventory Adjustments
- **File:Line:** [`server/routes/inventory.ts:66-70`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L66-L70)
- **Input → Wrong Output:**
  - `POST /api/inventory/adjust` with `quantity_delta: "Infinity"`.
  - Passes `isNaN(delta)`. SQLite binds as `null`. Stock becomes `NULL`.
- **Reproduction:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-inf-test.sqlite npx tsx /tmp/test_infinity.ts
  ```
  Output: `Response status: 201, quantity_delta: null, new_stock: null. Stock became NULL!`
- **Smallest Fix:**
  In [`server/routes/inventory.ts:67`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L67), replace `isNaN(delta)` with `!Number.isFinite(delta)`.
- **Confidence:** Reproduced.

---

### BUG-10: Inventory Adjustments Log Uses UTC Date instead of Africa/Tunis (P2)
- **ID:** INV-02
- **Severity:** P2 (Timezone boundary filter bug)
- **Area:** Inventory
- **File:Line:** [`server/routes/inventory.ts:32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L32)
- **Input → Wrong Output:**
  - Adjustment logged between 00:00 and 01:00 Tunis time on day $D$. Querying `?date=D` yields no results because UTC date is $D-1$.
- **Smallest Fix:**
  Use `tunisDayRangeUTC(String(date))` range filtering.
- **Confidence:** Code-traced.

---

### BUG-11: Missing Android Hardware Back Button Handlers on 26 Modals (P2)
- **ID:** MOB-01
- **Severity:** P2 (Mobile navigation friction)
- **Area:** Capacitor Android Client
- **File:Line:** 26 modals under [`src/components/backoffice/`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice) and [`src/components/shared/`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared)
- **Input → Wrong Output:**
  - User taps Android hardware back button to dismiss modal. App minimizes to Android OS instead of closing modal.
- **Smallest Fix:**
  Register `registerBackHandler(() => { onClose(); return true; })` on modal mount.
- **Confidence:** Code-traced.

---

## 3. Missing Tests for Money-Critical Functions

1. **`server/routes/sales.ts:processRefund`**: Missing test asserting that refunding a sale with a global cart discount (`total_discount > 0`) does not refund more than `total_ttc`.
2. **`server/routes/customers.ts:statement`**: Missing test asserting that credit-reducing refunds appear as credit entries in `debtEntries` and that the last running balance matches `debt.final_balance`.
3. **`server/routes/sync.ts:flush`**: Missing idempotency retry test asserting that re-submitting an identical batch containing `CASH_MOVEMENT` and `CONTAINER_TRANSACTION` does not create duplicate database rows.
