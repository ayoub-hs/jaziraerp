# Master Audit v2 — Executive Summary

**Project:** Al Jazira SHSP ERP / POS (Djerba, Tunisia)  
**Scope:** Single-operator detergent manufacturer & retail/wholesale distributor (1–3 devices: Desktop POS, Android Capacitor Register, Web Backoffice).  
**Mode:** READ-ONLY Master Audit. Application source code (`src/`, `server/`) strictly unmodified.  
**Baseline Quality Gates:**
- TypeScript: `npx tsc -b` exited with code 0 (0 compilation errors).
- Vitest Suite: 48/48 test files passed, 423/423 unit & integration tests passed.
- Timezone Isolation: 423/423 tests passed cleanly under `UTC`, `Pacific/Auckland`, and `America/Los_Angeles`.
- Production Build: `npm run build` completed successfully (897.56 kB bundle).

---

## 1. Top Ranked Issues

Every issue listed below has been verified against the physical codebase with reproduction commands and executed test outputs.

| Rank | ID | Severity | Component | File & Line | Summary |
|---|---|---|---|---|---|
| **1** | **REF-01** | **P0** | POS Returns & Refunds | [`server/routes/sales.ts:827-846`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L827-L846) | **Global Discount Refund Leak:** Refunding a sale with a global cart discount (`total_discount > 0`) refunds gross unallocated `saleItem.line_total`. Total cash refunded exceeds customer tender (reproduced: sale paid 15 DT refunded 20 DT). |
| **2** | **RES-01** | **P1** | Reseller Ledger | [`server/routes/customers.ts:315-334`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L334) | **Customer Statement Balance Mismatch:** Statement debt ledger omits credit-reducing refunds from `debtEntries`. Ledger running balance ends higher than the summary card balance (reproduced: ledger ends at 50 DT, summary shows 30 DT). |
| **3** | **SYNC-01** | **P1** | Offline Sync Engine | [`server/routes/sync.ts:508-613`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508-L613) | **Sync Replay Duplication:** Sync flush lacks deduplication on `temp_client_id` for `CASH_MOVEMENT` and `CONTAINER_TRANSACTION`. Network timeout retries duplicate cash drawer movements and container loans. |
| **4** | **POS-01** | **P1** | Desktop POS Scanner | [`src/components/desktop/DesktopPos.tsx:510`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L510), [`src/services/hardware/scanner.ts:64-73`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/scanner.ts#L64-L73) | **Scanner Double-Add in Search Box:** When desktop search input is focused, scanning a barcode triggers both the input's `onKeyDown` Enter and the global window listener, inserting 2 items per scan. |
| **5** | **POS-02** | **P1** | POS Checkout Modal | [`src/components/shared/CheckoutModal.tsx:83-86, 551-561`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/CheckoutModal.tsx#L83-L86) | **Barcode Pollution in Cash Tender:** Barcodes scanned while CheckoutModal is open land in the auto-focused `cashPaid` input. Trailing Enter submits a sale with billions in change due instead of adding the item. |
| **6** | **REP-01** | **P1** | Reporting Engine | [`server/routes/reports.ts:56-61, 167-172`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56-L61) | **Reports Mix Gross HT/TVA with Net TTC:** Reports sum pre-refund gross HT and TVA alongside net TTC. Arithmetic invariant fails: $\text{total\_ht} + \text{total\_tva} \ne \text{total\_ttc}$ on refunded sales (reproduced: 84.034 + 15.966 != 70.000). |
| **7** | **POS-03** | **P2** | POS Cart Pricing | [`src/components/desktop/DesktopPos.tsx:325-341`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L325-L341), [`src/components/mobile/MobileRegister.tsx:180-195`](file:///home/admin/VibeCoding/JaziraERP/src/components/mobile/MobileRegister.tsx#L180-L195) | **Mid-Cart Customer Selection Overwrites Custom Price:** Selecting or changing a customer mid-cart unconditionally overwrites negotiated manual line prices with catalog tier prices. |
| **8** | **REF-02** | **P2** | Returns UI | [`src/components/shared/RefundModal.tsx:388-396`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/RefundModal.tsx#L388-L396) | **Missing Wallet Refund Option:** RefundModal `<select>` only provides `CASH` and `CREDIT_REDUCTION`. If credit reduction is rejected on paid-down tickets, cashier cannot issue store credit (wallet). |
| **9** | **INV-01** | **P2** | Inventory Adjustments | [`server/routes/inventory.ts:66-70`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L66-L70) | **Infinity Input Wipes Stock to NULL:** `isNaN(delta)` permits `"Infinity"`. SQLite binds this as `NULL`, turning product or raw material `stock_quantity` into `NULL`. |
| **10** | **INV-02** | **P2** | Inventory Adjustments | [`server/routes/inventory.ts:32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L32) | **UTC Query Breaks Tunis Midnight Adjustments:** Uses SQLite `date(ia.date) = date(?)` on UTC timestamps rather than Tunis business day boundaries (`tunisDayRangeUTC`). |
| **11** | **MOB-01** | **P2** | Mobile Navigation | 26 Modals in [`src/components/shared/`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared) & [`src/components/backoffice/`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice) | **Missing Android Back Button Handlers:** Only `CheckoutModal` registers a hardware back handler. Tapping Android back on any other modal minimizes the app instead of closing the modal. |

---

## 2. Production Readiness Verdict

### **VERDICT: CONDITIONALLY READY PENDING 4 HOTFIXES**

**Core Architecture Assessment:**
- **Financial Correctness:** Positive and robust. SQLite synchronous ACID transactions prevent race conditions in single-threaded Node.js. Better-SQLite3 operations execute synchronously without concurrency leaks. TND 3-decimal rounding is consistently enforced (`round3` / `roundMoney`).
- **Reseller & B2B Debt:** FIFO debt retirement, overpayment auto-deposit to customer wallet, and separate debt vs wallet ledgers are structurally sound.
- **Hardware Integration:** ESC/POS raw byte thermal printing, WebSerial/pulse cash drawer triggers, and hardware wedge barcode listeners are operational.

**Blockers to Immediate Unsupervised Deployment:**
The system cannot be released to the store counter until the following 4 risks are addressed:
1. **Financial loss on returns:** `REF-01` leaks store money whenever a discounted cart is refunded.
2. **Reseller account disputes:** `RES-01` prints incorrect debt statement running balances for wholesale clients after returns.
3. **Register drawer cash corruption:** `SYNC-01` duplicates cash movements when Android sync flushes retry over fluctuating mobile network connectivity.
4. **Counter checkout confusion:** `POS-01` and `POS-02` insert phantom double items and allow barcodes to overwrite cash tender.

Applying the minimal fix order below addresses all P0 and P1 vulnerabilities in under 50 lines of code.

---

## 3. Strict 11-Line Minimal Fix Order

Every file path, line number, and identifier referenced below has been verified to exist in the codebase:

```text
1. server/routes/sales.ts:840 — Apportion sale.total_discount across lines or cap amountRefunded so cumulative total_refunded <= sale.total_ttc.
2. server/routes/customers.ts:333 — Add credit_reduced refunds to statement debtEntries so table running balance matches debt.final_balance.
3. server/routes/sync.ts:508,564 — Check action.temp_client_id against synced_from_client_id before inserting CASH_MOVEMENT and CONTAINER_TRANSACTION.
4. src/services/hardware/scanner.ts:64 — In handleKeyDown, check if (e.defaultPrevented) return; so Enter handled by search input does not double-fire.
5. src/components/shared/CheckoutModal.tsx:551 — Add data-scanner-ignore="true" to cashPaid input to prevent barcode keystrokes populating tender.
6. server/routes/reports.ts:56,167 — Subtract refunded HT and TVA from aggregated totals (ROUND(net_ttc / 1.19, 3)) so total_ht + total_tva == total_ttc.
7. src/types/index.ts:72 & src/components/desktop/DesktopPos.tsx:325 — Add price_overridden?: boolean to CartItem; skip unit_price reset when true.
8. src/components/shared/RefundModal.tsx:388 — Add <option value="WALLET">Wallet</option> to refundMethod select when sale.customer_id is present.
9. server/routes/inventory.ts:67 — Replace isNaN(delta) with !Number.isFinite(delta) to reject "Infinity" before database mutation.
10. server/routes/inventory.ts:32 — Replace date(ia.date) = date(?) with tunisDayRangeUTC(String(date)) boundary filtering.
11. src/components/shared/ & backoffice modals — Call registerBackHandler(onClose) in useEffect across modals to close on Android back press.
```
