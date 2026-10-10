# Master Audit v2 — 10. Invariant Test Harness & Results

## 1. Harness Architecture & Methodology

The Invariant Test Harness (`docs/audit-2026-10-v2/scratch/invariant_harness.ts`) is a randomized property-testing suite built on a deterministic Mulberry32 PRNG. It generates interleaved sequences of real operations executed through the actual Express HTTP route handlers via `supertest` and Better-SQLite3 on an isolated temporary database (`/tmp/erp-invariant-test.sqlite`).

### Operations Generated
1. **Online POS Sales (`POST /api/sales`):**
   - Customer tiers: Walk-in (null), Retail, Wholesale, Reseller (10% and 15% negotiated discount).
   - Multi-item carts (1–3 lines), single items, container-tracked SKUs, and pack size multipliers (e.g. Carton of 12 pcs, Carton of 4 pcs).
   - Line discounts, global cart discounts (`total_discount`).
   - Split tender combinations: Cash, Customer Wallet (atomic balance validation), and Unpaid Credit tickets.
   - Exact tender vs over-tendered cash with server-calculated change due.
2. **Customer Debt Payments (`POST /api/customers/:id/payments`):**
   - FIFO allocation against open tickets (oldest first).
   - Partial payments, exact debt clearing, and overpayments automatically depositing surplus into the customer wallet (`OVERPAYMENT_DEPOSIT`).
3. **Customer Wallet Top-ups (`POST /api/customers/:id/wallet/topup`):**
   - Positive store credit deposits logged to ledger.
4. **Line-Item Partial & Full Returns (`POST /api/sales/:id/refund`):**
   - Partial quantities, full quantities, repeated refunds on the same sale.
   - Payout tender: CASH (active register session linked), WALLET, and CREDIT_REDUCTION.
5. **Supplier Purchases & Payments (`POST /api/purchases`, `POST /api/suppliers/:id/payments`):**
   - Cash and credit purchases of raw materials, FIFO debt retirement.
6. **Register Cash Movements (`POST /api/register/movement`):**
   - `CASH_IN` and `CASH_OUT` with reason auditing.
7. **Session Lifecycle:**
   - Active register sessions and counted cash closures.
8. **Inventory Adjustments (`POST /api/inventory/adjust`):**
   - Manual stock corrections (shrinkage, breakage).
9. **Offline Sync Flush & Network Replay (`POST /api/sync/flush`):**
   - Operations queued with temporary client IDs (`SALE`, `CASH_MOVEMENT`, `CONTAINER_TRANSACTION`, `PRICE_STOCK_EDIT`).
   - Replay idempotency: the exact same batch is re-sent to simulate network timeouts and client retries.

---

## 2. Invariants Evaluated

| Invariant | Description | Status | Failures (500 steps) |
|---|---|---|---|
| **I1** | **Refund Capping:** For every sale, $\sum \text{refunds.total\_refunded} \le \text{sale.total\_ttc}$. | **FAILED** | 97 occurrences |
| **I2** | **Sale Payment Parity:** For every sale, $\text{cash\_paid} + \text{wallet\_paid} + \text{credit\_amount} = \text{total\_ttc}$. | **PASSED** | 0 failures |
| **I3** | **Customer Debt & Statement Integrity:** $\sum \text{remaining\_amount} = \sum \text{tickets} - \sum \text{allocations} - \sum \text{credit\_reductions}$. Ledger running balance $==$ summary final balance. | **FAILED** | 816 occurrences |
| **I4** | **Wallet Ledger Balance:** $\text{wallet\_balance} = \sum \text{wallet\_txs} \ge 0$. Never negative. | **PASSED** | 0 failures |
| **I5** | **Register Expected Cash:** Raw row recomputation $==$ `registerService` figure for open and closed sessions. | **PASSED** | 0 failures |
| **I6** | **Stock Conservation:** Current stock $==$ opening $+$ purchases/adjustments $-$ sales $+$ restored returns. | **PASSED** | 0 failures |
| **I7** | **Report Net vs Gross Consistency:** Sum of report totals $==$ sales rows. $\text{HT} + \text{TVA} = \text{TTC}$ on gross and net basis. | **FAILED** | Confirmed |
| **I8** | **Offline Sync Idempotency:** Replaying any sync action $N$ times yields identical database state as once. | **FAILED** | 30 occurrences |
| **I9** | **Financial Precision:** All money values finite, clean 3 decimals (no floating artifacts), non-negative where required. | **PASSED** | 0 failures |
| **I10** | **Sequential Numbering:** Receipts, tickets, refunds sequential per Tunis day, zero collisions. | **PASSED** | 0 failures |

---

## 3. Shrunk Failing Sequences & Root-Cause Analysis

### 3.1 Failure I1: Refund on Sale with Global Cart Discount Exceeds Total Paid
- **Seed:** 424242 (First failure at Step 404; shrunk to 2-step minimal reproduction).
- **File & Line:** [`server/routes/sales.ts:827-846`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L827-L846)
- **Minimal Shrunk Sequence:**
  1. Sale of 2x Floor Cleaner @ 10.000 DT = 20.000 DT, with global cart discount `total_discount = 5.000 DT`. `total_ttc = 15.000 DT`. Cash paid = 15.000 DT.
  2. Customer returns both items (quantity 2).
  3. Server calculates refund amount using unallocated line total: `amountRefunded = saleItem.line_total = 20.000 DT`.
  4. Server issues a 20.000 DT cash refund on a sale where the customer only paid 15.000 DT!
- **Reproduction Command & Output:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  ```text
  === TESTING I1: REFUND ON SALE WITH GLOBAL CART DISCOUNT ===
  Sale creation status: 201
  Sale total_ttc: 15, total_discount: 5
  Refund status: 201
  Refund response total_refunded: 20, cash_refunded: 20
  VERIFICATION: sale.total_ttc = 15 vs refunds sum = 20
  BUG CONFIRMED: sum(refunds.total_refunded) EXCEEDS sale.total_ttc by 5 DT!
  ```
- **Financial Impact:** Direct cash loss to the business. Whenever a cart discount was granted at checkout, a full return refunds the pre-discount gross price.

---

### 3.2 Failure I3: Customer Statement Ledger Omits Credit-Reduction Refunds
- **Seed:** 424242 (First failure at Step 19; shrunk to 2-step minimal reproduction).
- **File & Line:** [`server/routes/customers.ts:315-334`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L334)
- **Minimal Shrunk Sequence:**
  1. Credit sale: 5x @ 10.000 DT = 50.000 DT credit ticket created (`remaining_amount = 50.000 DT`).
  2. Customer returns 2 items with `CREDIT_REDUCTION` (20.000 DT).
  3. `customer_debt_tickets.remaining_amount` updates to 30.000 DT.
  4. Client requests `/api/customers/:id/statement`.
  5. The summary card shows `final_balance = 30.000 DT`.
  6. The `debtEntries` table only includes tickets and payment allocations. It has NO entry for the refund credit reduction. The table running balance ends at 50.000 DT.
- **Reproduction Command & Output:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  ```text
  === TESTING I3: CUSTOMER STATEMENT AFTER CREDIT-REDUCED REFUND ===
  Refund status: 201 credit_reduced: 20
  Statement debt summary final_balance: 30
  Statement debt entries count: 1
  Last debt entry running_balance: 50
  BUG CONFIRMED: Running balance in ledger table ( 50 ) does NOT match summary card ( 30 )!
  ```
- **Financial Impact:** Customer disputes. Wholesale resellers asking for a printed statement see an unsettled balance higher than what they actually owe.

---

### 3.3 Failure I8: Sync Replay Duplicate Execution (CASH_MOVEMENT & CONTAINER_TRANSACTION)
- **Seed:** 424242 (First failure at Step 21; shrunk to 1-operation replay reproduction).
- **File & Line:** [`server/routes/sync.ts:508-564`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L508-L564) & [`server/routes/sync.ts:564-613`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L564-L613)
- **Minimal Shrunk Sequence:**
  1. Send `POST /api/sync/flush` with `temp_client_id: 'offline-mov-001'`, `action_type: 'CASH_MOVEMENT'`, `amount: 25.000 DT`. First flush inserts movement.
  2. Send the exact same payload again to simulate network timeout retry.
  3. Server lacks deduplication on `temp_client_id` for cash movements; creates a second UUID and inserts a duplicate 25.000 DT movement.
  4. Same occurs for `CONTAINER_TRANSACTION`: duplicate return/loan applied.
- **Reproduction Command & Output:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  ```text
  === TESTING I8: SYNC REPLAY IDEMPOTENCY ===
  After first CASH_MOVEMENT sync: count = 1 sum = 25
  After REPLAY CASH_MOVEMENT sync: count = 2 sum = 50
  BUG CONFIRMED: CASH_MOVEMENT sync is NOT idempotent! Duplicate movement created on retry!
  After first CONTAINER sync: quantity_owed = 5 container stock = 95
  After REPLAY CONTAINER sync: quantity_owed = 10 container stock = 90
  BUG CONFIRMED: CONTAINER_TRANSACTION sync is NOT idempotent! Duplicate container loan applied on retry!
  ```
- **Financial Impact:** Drawer cash discrepancy on session close and corrupt container asset records whenever mobile network connectivity fluctuates during sync flush.

---

### 3.4 Failure I7: Tax & Sales Reports Display Gross HT/TVA Alongside Net TTC
- **File & Line:** [`server/routes/reports.ts:56-61, 167-172`](file:///home/admin/VibeCoding/JaziraERP/server/routes/reports.ts#L56-L61)
- **Minimal Shrunk Sequence:**
  1. Sale of 100.000 DT (HT = 84.034 DT, TVA = 15.966 DT).
  2. Refund 30.000 DT.
  3. `GET /api/reports/sales-by-customer` outputs:
     `total_ht = 84.034`, `total_tva = 15.966`, `total_ttc = 70.000`.
  4. $84.034 + 15.966 = 100.000 \ne 70.000$.
- **Reproduction Command & Output:**
  ```bash
  NODE_ENV=test DATABASE_PATH=/tmp/erp-repro-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
  ```
  ```text
  === TESTING I7: REPORTS GROSS HT/TVA VS NET TTC ===
  Report row:
    total_ht: 84.034
    total_tva: 15.966
    gross_ttc: 100
    refunded_amount: 30
    net_ttc: 70
    total_ttc: 70
  Arithmetic check: total_ht + total_tva = 100
  Reported total_ttc = 70
  BUG CONFIRMED: total_ht + total_tva ( 100 ) does NOT equal reported total_ttc ( 70 )!
  ```

---

## 4. Regression Test Suite Preservation
The invariant harness has been persisted at:
`docs/audit-2026-10-v2/scratch/invariant_harness.ts`
and the shrunk reproduction suite at:
`docs/audit-2026-10-v2/scratch/repro_invariants.ts`
Both can be re-run at any time using:
```bash
NODE_ENV=test DATABASE_PATH=/tmp/erp-test.sqlite npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts
```
