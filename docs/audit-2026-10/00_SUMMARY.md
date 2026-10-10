# Master Audit 2026-10 — Executive Summary
**Project:** Al Jazira SHSP ERP / POS  
**Scope:** Single-operator manufacturer & distributor (detergents + consumer goods), Djerba, Tunisia (1–3 devices: Desktop POS, Android Capacitor Register, Backoffice).  
**Mode:** READ-ONLY Master Audit. Codebase strictly unmodified.  
**Baseline Tests:** Vitest test suite 48/48 test files, 423/423 tests passed (clean across UTC, Pacific/Auckland, and America/Los_Angeles). TypeScript `npx tsc -b` exited 0. Vite production build passed (897 kB bundle).

---

## 1. Top 15 Ranked Issues

The following 15 issues represent the most critical correctness, financial auditability, cashier operational friction, and data integrity risks discovered during the audit. Every finding has been personally verified against the codebase.

| Rank | ID | Sev | Component | File & Line | Summary |
|---|---|---|---|---|---|
| 1 | RES-01 | **P1** | Accounting / Ledger | [`server/routes/customers.ts:315-340`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L340) | **Customer Statement Ledger Omits Credit-Reduction Refunds:** When a credit sale receives a credit-reduced refund, `remaining_amount` on the debt ticket decreases, but no allocation/credit entry is added to `debtEntries`. The running balance table ends higher than the summary `final_balance` card. |
| 2 | SYNC-01 | **P1** | Offline Sync / Register | [`server/routes/sync.ts:508-613`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508-L613) | **Missing Idempotency on Cash Movements & Container Transactions:** Unlike `SALE` which deduplicates on `synced_from_client_id`, `CASH_MOVEMENT` and `CONTAINER_TRANSACTION` actions lack deduplication. Retrying a sync batch after a timeout duplicates drawer movements and container loans. |
| 3 | POS-01 | **P1** | POS / Scanner | [`src/components/pos/DesktopPos.tsx:510`](file:///home/admin/VibeCoding/JaziraERP/src/components/pos/DesktopPos.tsx#L510), [`src/services/hardware/scanner.ts:51`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/scanner.ts#L51) | **Double Item Insertion on Barcode Scan with Search Focused:** Search `<input>` has `data-scanner-input="true"` and an `onKeyDown` Enter listener. A hardware USB barcode scan triggers both the global wedge callback and the input's Enter event, inserting duplicate items. |
| 4 | POS-02 | **P1** | POS / Checkout Modal | [`src/components/shared/CheckoutModal.tsx:83-86, 160-168, 551-561`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/CheckoutModal.tsx#L83-L86) | **Scanning Barcode While Checkout Modal Open Triggers Premature Checkout:** `cashPaid` input auto-focuses on modal open without scanner isolation. A barcode scan types the barcode number into cash tendered, and trailing Enter triggers checkout with billions of millimes in change and an unsaved scanned item. |
| 5 | REP-01 | **P1** | Tax & Accounting Reports | [`server/routes/reports.ts:56-60, 167-172`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56-L60) | **Reports Show Gross HT & TVA Alongside Net TTC:** `total_ht` and `total_tva` sum gross pre-refund sales (`SUM(s.subtotal_ht)`), while `total_ttc` subtracts `r.total_refunded`. For refunded sales, `total_ht + total_tva != net_ttc`, distorting tax declarations. |
| 6 | POS-03 | **P1** | POS / Pricing | [`src/components/pos/DesktopPos.tsx:325-341`](file:///home/admin/VibeCoding/JaziraERP/src/components/pos/DesktopPos.tsx#L325-L341), [`src/components/mobile/MobileRegister.tsx:180-195`](file:///home/admin/VibeCoding/JaziraERP/src/components/mobile/MobileRegister.tsx#L180-L195) | **Attaching Customer Mid-Cart Erases Manual Price Overrides:** `useEffect` listening to `[selectedCustomer, products]` unconditionally overwrites `item.unit_price` with `getProductPackPrice(...)` without checking `item.overridden`. |
| 7 | REF-01 | **P2** | Returns / Refunds | [`src/components/shared/RefundModal.tsx:32, 384-396`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/RefundModal.tsx#L32), [`server/routes/sales.ts:925-943`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L925-L943) | **Refund Credit Reduction Lockout:** If an original credit ticket was already paid or partially paid down via customer payments, credit reduction is rejected (400). The refund modal does not offer Wallet refund or split tender, trapping the cashier. |
| 8 | INV-01 | **P2** | Inventory Validation | [`server/routes/inventory.ts:66-70`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L66-L70) | **Infinity Stock Corruption via `isNaN` Bypass:** Endpoint uses `isNaN(delta)` instead of `Number.isFinite(delta)`. Passing `"Infinity"` passes validation and executes `UPDATE stock_quantity = stock_quantity + Infinity`. |
| 9 | INV-02 | **P2** | Inventory Timezone | [`server/routes/inventory.ts:32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L32) | **UTC vs Africa/Tunis Discrepancy in Adjustments Log:** Uses SQLite `date(ia.date) = date(?)` on ISO UTC strings instead of `tunisDayRangeUTC()`. Adjustments between 23:00 UTC and 00:00 UTC (00:00-01:00 Tunis) appear under yesterday's date. |
| 10 | SAL-01 | **P2** | Concurrency / Register | [`server/routes/sales.ts:281, 457`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L281) | **TOCTOU Race on Register Session Close:** Register session status (`OPEN`) is checked outside the SQLite transaction. If another device closes the register session before commit, sale commits under a closed session, corrupting closed session Z-totals. |
| 11 | PROD-01 | **P2** | Backend Performance | [`server/routes/products.ts:37, 55`](file:///home/admin/VibeCoding/JaziraERP/server/routes/products.ts#L37) | **N+1 Query Loop in Product Families:** `GET /api/products/families` executes synchronous SQLite queries inside nested `.map()` loops (1 + F + F*P), causing 200+ synchronous queries that freeze the single-threaded Node event loop. |
| 12 | MOB-01 | **P2** | Mobile Navigation | [`src/components/backoffice/*Modal.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice), [`src/components/shared/*Modal.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared) | **Missing Android Hardware Back Button Handling:** 20+ modals fail to register back handlers (`registerBackHandler`). Pressing Android hardware back button minimizes the app or jumps to root instead of dismissing the modal. |
| 13 | FEAT-01 | **P2** | B2B Operations | Missing (`erp-spec.md` gap) | **Missing Quotes & Delivery Notes (Devis / Bon de Livraison):** Wholesale detergent customers in Tunisia require a printed "Bon de Livraison" (BL) on delivery and subsequent grouped billing. Currently only POS receipts exist. |
| 14 | FEAT-02 | **P2** | Hardware / Register | [`src/services/hardware/escpos.ts`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/escpos.ts) | **Missing Thermal ESC/POS Z-Report Printout:** Closing a session calculates expected and counted cash in the UI, but there is no 58mm/80mm thermal receipt generator to print the physical end-of-day slip for the cash envelope. |
| 15 | FEAT-03 | **P2** | Containers / Suppliers | [`server/db/schema.sql:260-280`](file:///home/admin/VibeCoding/JaziraERP/server/db/schema.sql#L260-L280) | **Missing Return of Empty Containers to Suppliers:** Container tracking tracks customer loans (bidons), but has no mechanism to return 1000L IBC tanks or 200L chemical drums back to raw material suppliers. |

---

## 2. Production Readiness Verdict

### **Verdict: CONDITIONALLY READY FOR CONTROLLED SINGLE-OPERATOR USE**

**Assessment Summary:**
- **Core Engine (Excellent):** The fundamentals of money math (Tunisian Millimes 3-decimals via `round3`), FIFO supplier and customer debt allocation, offline SQLite schema integrity, ESC/POS 58mm direct USB/Bluetooth printing, and Capacitor Android architecture are solid. The test suite passes 100% across multiple global timezones.
- **Why NOT Unconditionally Ready Yet:**
  1. **Cashier Speed Traps:** The two POS scanner focus collisions (double scan in search input and barcode pollution in checkout modal) can cause serious cashier panic during busy counter rushes.
  2. **Audit Ledger Drift:** The customer statement ledger currently diverges on credit refunds, confusing wholesale clients who request an account statement.
  3. **Offline Sync Replay Hazard:** If the Android register drops network midway through a sync flush, cash movements and container loans will duplicate upon reconnection.

Once the top 6 P1 items in the minimal fix order below are addressed, the system is fully robust for daily production in Djerba.

---

## 3. Strict 10-Line Minimal Fix Order

```bash
1. server/routes/customers.ts:334 — Include credit-reduction refunds as credit entries in statement `debtEntries` so running balance matches final_balance.
2. server/routes/sync.ts:508,564 — Add `synced_from_client_id` checks to CASH_MOVEMENT and CONTAINER_TRANSACTION sync handlers to ensure idempotency.
3. src/services/hardware/scanner.ts:51 — In `handleKeyDown`, ignore keystrokes when focused on any input that is NOT specifically an uncaptured scanner target, or isolate search input Enter.
4. src/components/shared/CheckoutModal.tsx:551 — Add `data-scanner-ignore="true"` or intercept wedge scans inside CheckoutModal to prevent barcodes filling `cashPaid`.
5. server/routes/reports.ts:56,167 — Net `total_ht` and `total_tva` by subtracting refunded HT and TVA (`ROUND(net_ttc / 1.19, 3)` and `net_ttc - net_ht`).
6. src/components/pos/DesktopPos.tsx:325 — Preserve manual price overrides (`if (!item.overridden) item.unit_price = getProductPackPrice(...)`) when customer changes.
7. src/components/shared/RefundModal.tsx:384 — Allow selecting WALLET as refund tender when credit reduction is rejected due to paid-down tickets.
8. server/routes/inventory.ts:66 — Replace `isNaN(delta)` with `Number.isFinite(delta) && delta !== 0` to block `Infinity`.
9. server/routes/inventory.ts:32 — Replace `date(ia.date) = date(?)` with `tunisDayRangeUTC(day)` filtering.
10. server/routes/sales.ts:457 — Re-verify `SELECT status FROM register_sessions WHERE id = ?` inside `saleTx` transaction to prevent TOCTOU closed session sales.
```
