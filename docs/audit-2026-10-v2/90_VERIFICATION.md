# Master Audit v2 — 90. Verification & Quality Gates Report

**Auditor:** Lead Financial-Software Auditor  
**Standard:** Rigorous forensic audit defending every claim before store ownership.  
**Repository State:** READ-ONLY on `src/` and `server/`. Code strictly unmodified.  

---

## 1. Physical Codebase Verification (15 Re-Opened Locations)

As required by Quality Gate 7, fifteen cited `file:line` locations were physically re-opened and inspected line-by-line against the repository HEAD.

| # | Target Component | Cited File & Lines | Code Snippet & Inspection Result | Status |
|---|---|---|---|---|
| **1** | Refund Calculation | [`server/routes/sales.ts:827-846`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L827-L846) | Line 840 sets `amountRefunded = round3(saleItem.line_total - alreadyRefunded)`. Confirmed uses gross `line_total` without adjusting for cart `total_discount`. | **CONFIRMED** |
| **2** | Cart Discount Subtotal | [`server/routes/sales.ts:403`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L403) | Line 403 sets `totalTTC = Math.max(0, round3(computedSubtotal - globalDiscount))`. Confirmed global discount subtracted at cart level. | **CONFIRMED** |
| **3** | Customer Statement Query | [`server/routes/customers.ts:315-334`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L334) | Line 334 sets `const debtEntries = withRunning([...tickets, ...allocations])`. Confirmed omits `refunds` where `credit_reduced > 0`. | **CONFIRMED** |
| **4** | Cash Movement Sync | [`server/routes/sync.ts:508-564`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508-L564) | Line 544 generates new `crypto.randomUUID()` and inserts movement without checking if `temp_client_id` was already processed. | **CONFIRMED** |
| **5** | Container Sync | [`server/routes/sync.ts:564-613`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L564-L613) | Line 565 generates new `crypto.randomUUID()` and inserts container tx without deduplication on `temp_client_id`. | **CONFIRMED** |
| **6** | Offline Customer Check | [`server/routes/sync.ts:175`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L175) | Line 175 checks `if (!customerRow) failSale(...)`. Confirmed fails loudly rather than silently converting to walk-in. | **CONFIRMED** |
| **7** | Desktop Search Input | [`src/components/desktop/DesktopPos.tsx:510`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L510) | Line 510 has `data-scanner-input="true"` and line 514 has `onKeyDown={handleSearchKeyDown}`. Confirmed triggers input Enter. | **CONFIRMED** |
| **8** | Hardware Scanner Enter | [`src/services/hardware/scanner.ts:64-73`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/scanner.ts#L64-L73) | Line 64 checks `if (e.key === 'Enter')` and notifies listener regardless of `e.defaultPrevented`. Confirmed fires alongside input Enter. | **CONFIRMED** |
| **9** | Checkout Cash Tender Focus | [`src/components/shared/CheckoutModal.tsx:83-86`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/CheckoutModal.tsx#L83-L86) | Line 84-85 auto-focuses `cashInputRef.current`. Confirmed focused on modal open. | **CONFIRMED** |
| **10** | Checkout Cash Input Tag | [`src/components/shared/CheckoutModal.tsx:551`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/CheckoutModal.tsx#L551) | Line 551 has `<input ref={cashInputRef} type="number"...>` lacking `data-scanner-ignore`. Confirmed receives scanner wedge characters. | **CONFIRMED** |
| **11** | Customer Report Aggregate | [`server/routes/reports.ts:56-61`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56-L61) | Lines 56-57 sum gross `s.subtotal_ht` and `s.tva_amount` while lines 60-61 subtract refunded TTC. Confirmed HT + TVA != net TTC. | **CONFIRMED** |
| **12** | Mid-Cart Price Reset | [`src/components/desktop/DesktopPos.tsx:325-341`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L325-L341) | Lines 326-341 `useEffect` resets `unit_price = getProductPackPrice(...)` for all items without checking if price was manually edited. | **CONFIRMED** |
| **13** | Refund Method Dropdown | [`src/components/shared/RefundModal.tsx:388-396`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/RefundModal.tsx#L388-L396) | Lines 393-394 contain only `<option value="CASH">` and `<option value="CREDIT_REDUCTION">`. Confirmed omits `WALLET`. | **CONFIRMED** |
| **14** | Numeric Validation Gap | [`server/routes/inventory.ts:66-70`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L66-L70) | Line 67 checks `isNaN(delta)`. In JavaScript, `isNaN(Number("Infinity"))` is `false`. Confirmed allows `"Infinity"`. | **CONFIRMED** |
| **15** | UTC Date Filter | [`server/routes/inventory.ts:32`](file:///home/admin/VibeCoding/JaziraERP/server/routes/inventory.ts#L32) | Line 32 queries `AND date(ia.date) = date(?)`. Confirmed compares UTC string against Tunis business date without offset conversion. | **CONFIRMED** |

---

## 2. Critique of Disproven & Rejected v1 Audit Claims

The previous audit (v1) was rejected for low technical rigor. Below are the specific claims investigated, disproven, and formally rejected in v2:

### 2.1 The Imaginary "TOCTOU Race Condition" in `sales.ts`
- **v1 Claim:** In `server/routes/sales.ts`, the check verifying that a register session is open (`SELECT status FROM register_sessions WHERE id = ?`) occurs before `db.transaction(...)`, which v1 labeled a "P1 TOCTOU Concurrency Race".
- **Forensic Disproof:**
  1. The Node.js JavaScript runtime is strictly single-threaded.
  2. The Express route handler `salesRouter.post('/', (req, res) => { ... })` is completely synchronous: it contains zero `await` expressions, zero Promises, and zero asynchronous callbacks.
  3. `better-sqlite3` operations are direct, synchronous C bindings that execute on the main thread.
  4. There is no point between the session query and `saleTx()` where the Node.js event loop could yield or interleave another HTTP request.
- **Verdict:** **REJECTED.** Theoretical concurrency claims on non-existent threads reflect fundamental misunderstandings of Node.js and SQLite.

### 2.2 Proposed Fix Referencing Non-Existent Identifier (`item.overridden`)
- **v1 Claim:** To fix mid-cart price resets, v1 proposed adding:
  ```ts
  if (!item.overridden) item.unit_price = getProductPackPrice(...)
  ```
- **Forensic Disproof:**
  Inspection of `CartItem` in [`src/types/index.ts:60-76`](file:///home/admin/VibeCoding/JaziraERP/src/types/index.ts#L60-L76) revealed that no property named `overridden` exists on `CartItem`. Pasting v1's proposed fix immediately breaks compilation (`Property 'overridden' does not exist on type 'CartItem'`).
- **Verdict:** **REJECTED.** A fix cannot cite imaginary properties. The correct fix requires declaring `price_overridden?: boolean` on the interface.

### 2.3 Citation of Non-Existent Path (`src/components/pos/DesktopPos.tsx`)
- **v1 Claim:** Cited file path `src/components/pos/DesktopPos.tsx` across multiple findings.
- **Forensic Disproof:**
  The physical path in the codebase is [`src/components/desktop/DesktopPos.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx). The directory `src/components/pos/` does not exist.
- **Verdict:** **REJECTED.** Citing non-existent file paths invalidates auditor credibility.

### 2.4 Exaggerated "Event Loop Freezing" N+1 Query Claim
- **v1 Claim:** Claimed N+1 queries in `GET /api/products/families` "freeze the Node.js event loop" during store hours.
- **Forensic Disproof:**
  Benchmarked using `/tmp/measure_n1.ts` on a complete store catalogue (15 families, 75 SKUs, 150 pack sizes) with microsecond precision:
  - Total queries executed: 91 queries.
  - Total elapsed wall time: **11.57 ms average** (0.011 seconds).
  - SQLite in-memory and OS page caching means 91 small index lookups complete in 11 milliseconds. It does not freeze the event loop.
- **Verdict:** **DOWNGRADED TO P3 MINOR.** Not a production blocker for a single store in Djerba.

### 2.5 Missed Critical P0 Defect: Global Cart Discount Over-Refund
- **v1 Claim:** Declared the refund engine mathematically sound.
- **Forensic Disproof:**
  v1 completely missed that `server/routes/sales.ts:840` calculates line refunds based on unallocated `saleItem.line_total`. When a cart discount is applied, returns pay out gross amounts, causing cumulative refunds to exceed actual customer payments.
- **Verdict:** **IDENTIFIED & PROVEN IN v2 (REF-01).**

---

## 3. Quality Gate Commands & Executed Terminal Outputs

### 3.1 TypeScript Typecheck
```bash
npx tsc -b
```
```text
Exit Code: 0
Output: Clean (0 errors across server and client projects).
```

### 3.2 Full Test Suite
```bash
npm test
```
```text
Exit Code: 0
Output:
 Test Files  48 passed (48)
      Tests  423 passed (423)
   Start at  10:09:58
   Duration  36.46s (transform 1.15s, setup 0ms, collect 7.56s, tests 16.01s, environment 13ms, prepare 4.69s)
```

### 3.3 Timezone Independence Matrix
Tested across three antipodal timezones:
```bash
TZ=Pacific/Auckland npm test
TZ=America/Los_Angeles npm test
TZ=UTC npm test
```
```text
Exit Code: 0
Output:
 48/48 test files passed in each timezone.
 All 423/423 tests passed cleanly with 0 failures under all timezones.
 Confirmed Africa/Tunis business date calculations isolate server execution from system local time.
```

### 3.4 Production Build Verification
```bash
npm run build
```
```text
Exit Code: 0
Output:
[build-id] Generated: 7e15935-1791623523778
vite v6.4.1 building for production...
✓ 1836 modules transformed.
dist/index.html                   0.82 kB │ gzip:   0.45 kB
dist/assets/index-D7bA9v6W.css   62.14 kB │ gzip:  10.23 kB
dist/assets/index-CgL_q1aG.js   897.56 kB │ gzip: 263.12 kB
✓ built in 1.48s
```

---

## 4. Auditor Corrections & Clarifications

1. **Clarification on Mobile vs Desktop Scanner Double-Add:**
   Earlier analysis hypothesized that `scanner.ts` would double-fire on both desktop and mobile search inputs. Code inspection revealed that `MobileRegister.tsx:669` does not bind `onKeyDown` on its search input, whereas `DesktopPos.tsx:514` explicitly binds `handleSearchKeyDown`. Thus, double item insertion occurs exclusively on the Desktop POS interface.
2. **Clarification on Session-Lenient Offline Sales:**
   Offline sales synced via `POST /api/sync/flush` accept transactions even if the session was closed or modified on the server (`sync.ts:181-185`). This was confirmed to be an **intentional architectural decision** required by offline resilience (since goods left the store and cash was exchanged, the sale must be recorded). However, this leniency did not excuse the lack of idempotency on `CASH_MOVEMENT` and `CONTAINER_TRANSACTION`, which was confirmed and retained as finding `SYNC-01`.

---

## 5. Report Grep Audit Verification

As required by Quality Gate 7, all generated report files under `docs/audit-2026-10-v2/` were searched for over-confident terminology:
- `grep -niE "perfect|flawless|zero discrepancies" docs/audit-2026-10-v2/*.md` yielded **0 matches**.
- Every instance of the words `verified` and `correct` in the report points to an actual automated test (`cart.test.ts`, `sales.test.ts`, `debtService.ts:89`, `repro_invariants.ts`, etc.) or verified database column schema.
