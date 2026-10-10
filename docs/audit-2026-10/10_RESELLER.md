# Scope A — Reseller Flow, Debts, FIFO & Reconciliation Audit
**Project:** Al Jazira SHSP ERP / POS  
**Scope:** Reseller pricing, debt tickets, FIFO payment allocation, refunds on credit sales, reports reconciliation, offline sync.  
**Target Environment:** Single-operator manufacturer-distributor in Djerba, Tunisia (1–3 devices, TND millimes, Africa/Tunis business date).

---

## 1. Reseller Pricing Mechanics

### 1.1 Formula Parity: Client vs Server
The reseller pricing computation is verified across frontend and backend implementations:
- **Client Implementation:** [`src/utils/cart.ts:50-57`](file:///home/admin/VibeCoding/JaziraERP/src/utils/cart.ts#L50-L57) in `getProductPackPrice`:
  ```typescript
  if (customer && customer.type === 'RESELLER' && customer.reseller_discount_percent) {
    basePrice = roundMoney(
      basePrice * ((100 - Number(customer.reseller_discount_percent)) / 100)
    );
  }
  ```
- **Server Implementation:** [`server/routes/sales.ts:207-214`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L207-L214) in `computeExpectedCatalogPrice`:
  ```typescript
  if (customer && customer.type === 'RESELLER' && customer.reseller_discount_percent) {
    const discount = Number(customer.reseller_discount_percent) || 0;
    expectedUnitPrice = round3(
      (Number(product.wholesale_price) || 0) * ((100 - discount) / 100)
    );
  }
  ```
- **Parity Verdict:** **PERFECT MATCH**. Both client and server start with `product.wholesale_price`, multiply by `(100 - discount) / 100`, and round to 3 decimal places using Tunisian millimes precision.

### 1.2 Pack Size Multipliers vs Price Overrides
Pack sizes define a `multiplier` and an optional `price_override` (used for retail bundle discounts, e.g. 1 bottle = 3.000 DT, 12-pack retail box = 30.000 DT instead of 36.000 DT).
- **Rule Verification:** Does a pack's retail `price_override` override a reseller's negotiated discount?
- In both [`cart.ts:68-71`](file:///home/admin/VibeCoding/JaziraERP/src/utils/cart.ts#L68-L71) and [`sales.ts:228-233`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L228-L233):
  ```typescript
  if (pack && customer && (customer.type === 'WHOLESALE' || customer.type === 'RESELLER')) {
    // Wholesale/reseller customers buy at wholesale base * multiplier; pack price_override is for retail only
    return roundMoney(basePrice * pack.multiplier);
  }
  ```
- **Verdict:** **CORRECT**. Resellers always receive their negotiated unit price multiplied by the pack quantity. Retail bundle specials never accidentally raise or override a reseller's discount.

### 1.3 Rounding Order and Precision
- Both client (`roundMoney`) and server (`round3`) use `Math.round((val + Number.EPSILON) * 1000) / 1000`.
- Rounding occurs at each intermediate step:
  1. `unit_price` = round3(wholesale * (100 - discount) / 100)
  2. `line_total` = round3(unit_price * quantity - line_discount)
  3. `subtotal` = round3(sum of line totals)
  4. `total_ttc` = round3(subtotal - cart_discount)
- Tested across edge fractional millimes (e.g., 0.001 to 99.999 DT); zero drift observed.

### 1.4 Price Override Erasure Bug (**P1**)
- **Files:** [`src/components/pos/DesktopPos.tsx:325-341`](file:///home/admin/VibeCoding/JaziraERP/src/components/pos/DesktopPos.tsx#L325-L341) and [`src/components/mobile/MobileRegister.tsx:180-195`](file:///home/admin/VibeCoding/JaziraERP/src/components/mobile/MobileRegister.tsx#L180-L195).
- **Behavior:** When the cashier changes the selected customer mid-cart, a `useEffect` hook fires:
  ```typescript
  useEffect(() => {
    setCartItems(prev => prev.map(item => {
      if (item.is_quick_add || !item.product_id) return item;
      const product = products.find(p => p.id === item.product_id);
      if (!product) return item;
      const pack = product.pack_sizes?.find(ps => ps.id === item.pack_size_id);
      const newUnitPrice = getProductPackPrice(product, selectedCustomer, pack, item.pack_multiplier || 1);
      return { ...item, unit_price: newUnitPrice, line_total: roundMoney(newUnitPrice * item.quantity - item.discount_amount) };
    }));
  }, [selectedCustomer, products]);
  ```
- **Flaw:** If the cashier explicitly used the price override button to set a negotiated unit price for an item (e.g. 8.500 DT instead of 9.000 DT), attaching a customer or switching customers unconditionally overwrites `item.unit_price`, erasing the cashier's override without confirmation.
- **Minimal Fix:** Add `if (item.overridden) return item;` before recalculating `newUnitPrice`.

### 1.5 Offline Price Cache Staleness
- In offline mode, the client reads products and customer discount percentages cached in IndexedDB.
- If the owner updates a reseller's discount percentage on the backoffice while the mobile register is offline, sales queued on the mobile register use the cached unit price.
- In [`server/routes/sync.ts:323-368`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L323-L368), the server intentionally accepts the client's `unit_price` so that the printed paper receipt given to the customer matches the server transaction. The server computes `catalog_unit_price` solely for variance tracking (`overridden = 1`). This is the correct, legally safe design for offline retail.

---

## 2. Debt Tickets & Split Payments

### 2.1 Ticket Creation and Invariants
- Whenever a sale is completed with `credit_amount > 0` (and `customer_id` is present), a debt ticket is generated in [`server/routes/sales.ts:561-591`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L561-L591) and [`server/routes/sync.ts:433-463`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L433-L463):
  - `total_amount = credit_amount`
  - `remaining_amount = credit_amount`
  - `status = 'UNPAID'`
- Numbering follows `TKT-YYYY-MM-DD-xxxx` using atomic retry loops on SQLite unique violations (`sales.ts:648`).
- **Dynamic Invariant:** Customer debt is **never stored as a denormalized column** on the `customers` table. The customer's total outstanding debt is always dynamically computed via:
  ```sql
  SELECT COALESCE(SUM(remaining_amount), 0) as total_debt
  FROM customer_debt_tickets
  WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
  ```
  This eliminates any risk of schema drift between ticket balances and customer total debt.

### 2.2 Split Payments
- A sale may be split across **Cash + Customer Wallet + Credit Ticket**.
- Validated shared utility [`server/utils/payments.ts:99-105`](file:///home/admin/VibeCoding/JaziraERP/server/utils/payments.ts#L99-L105):
  ```typescript
  const paidSum = round3(cashPaid + walletPaid + creditAmount);
  if (Math.abs(paidSum - total) > 0.0005) {
    return fail(`Payment sum (${paidSum.toFixed(3)}) does not match total TTC (${total.toFixed(3)})`);
  }
  ```
- If a customer pays with wallet, the wallet balance is atomically deducted inside the SQLite transaction using `WHERE wallet_balance >= ?` (`sales.ts:534`), preventing overdraw.

---

## 3. FIFO Payment Allocation

### 3.1 Allocation Algorithm Correctness
- Customer debt repayments are processed in [`server/services/debtService.ts:45-135`](file:///home/admin/VibeCoding/JaziraERP/server/services/debtService.ts#L45-L135) in `allocateCustomerPayment`:
  ```sql
  SELECT * FROM customer_debt_tickets
  WHERE customer_id = ? AND status IN ('UNPAID', 'PARTIALLY_PAID')
  ORDER BY date ASC, created_at ASC
  ```
- Tickets are paid strictly oldest-first.
- When an allocation pays off a ticket (`remaining_amount == 0`), status transitions from `UNPAID` or `PARTIALLY_PAID` to `PAID`.
- When an allocation only partially covers a ticket, `remaining_amount = remaining_amount - allocated`, and status transitions to `PARTIALLY_PAID`.

### 3.2 Overpayments Routed to Wallet
- If a customer owes 45.000 DT across open tickets and pays 100.000 DT in cash:
  - All tickets are paid in full (`remaining_amount = 0`, status = `PAID`).
  - Remaining 55.000 DT is automatically deposited into `customer_wallet_transactions` with `type = 'OVERPAYMENT_DEPOSIT'` (`debtService.ts:125-131`).
  - `customers.wallet_balance` increments by 55.000 DT.
  - Zero money is lost or left unaccounted.

---

## 4. Refunds on Reseller Sales

### 4.1 Proportional Line Discounts & Last-Unit Rounding
When refunding an item that had a discount during the original sale:
- In [`server/routes/sales.ts:842-845`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L842-L845):
  ```typescript
  const effectiveUnitPrice = round3(saleItem.line_total / saleItem.quantity);
  const refundLineTotal = round3(effectiveUnitPrice * qtyToRefund);
  ```
- To protect against fractional millimes loss (e.g. 20.000 DT line with 3 units = 6.6666... DT/unit), when the last remaining unit is refunded, the system refunds `saleItem.line_total - previous_refunds`, ensuring the total refunded matches the line total down to 0.000 DT.

### 4.2 Refund on Paid or Partially Paid Ticket Lockout (**P2**)
- If a reseller bought 50.000 DT of detergent on credit (`TKT-01` created for 50.000 DT), and subsequently paid 20.000 DT via a debt payment (`TKT-01` remaining balance is now 30.000 DT):
  - If the customer later returns goods worth 40.000 DT and the cashier selects `CREDIT_REDUCTION`:
  - [`sales.ts:938-943`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L938-L943) enforces:
    ```typescript
    if (creditReduction > targetTicket.remaining_amount) {
      throw new Error(`Refund credit reduction (${creditReduction.toFixed(3)}) exceeds remaining ticket balance (${targetTicket.remaining_amount.toFixed(3)})`);
    }
    ```
  - The server rejects the refund with 400.
  - **Frontend Friction:** In [`src/components/shared/RefundModal.tsx:384-396`](file:///home/admin/VibeCoding/JaziraERP/src/components/shared/RefundModal.tsx#L384-L396), the only options presented are `CASH` and `CREDIT_REDUCTION`. If the original credit ticket was already paid in full, credit reduction is impossible, and the cashier is forced to hand out cash even if the business agreement was store credit (wallet).
  - **Proposed Fix:** Add `WALLET` as an eligible refund tender in `RefundModal.tsx`, and support splitting the refund between reducing the open ticket and crediting the wallet.

### 4.3 Customer Statement Ledger Divergence Bug (**P1**)
- **File:** [`server/routes/customers.ts:315-340`](file:///home/admin/VibeCoding/JaziraERP/server/routes/customers.ts#L315-L340) in `/api/customers/:id/statement`.
- **The Defect:**
  - The debt ledger entries (`debtEntries`) are assembled by joining:
    1. `customer_debt_tickets` (debit = `total_amount`, credit = 0)
    2. `customer_payment_allocations` (debit = 0, credit = `amount_allocated`)
  - When a credit-reduction refund occurs, [`sales.ts:940`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sales.ts#L940) directly decreases `customer_debt_tickets.remaining_amount`. It **does not create an allocation row** (allocations are strictly FK-linked to `customer_payments`).
  - Nor does `customers.ts:315-340` query the `refunds` table!
  - **Result:**
    - `debtEntries` list shows the original ticket debit (e.g. 50.000 DT) without any corresponding refund credit entry. The running balance column ends at **50.000 DT**.
    - Meanwhile, `debtTotal` is calculated from `SUM(remaining_amount)`, which evaluates to **30.000 DT**.
    - In `CustomerStatementModal.tsx`, the summary badge at the top shows `30.000 DT`, while the ledger table below ends with a running balance of `50.000 DT`. A wholesale client presented with this statement will rightly complain that the numbers do not add up.
- **Minimal Fix:** In `customers.ts:315-334`, query `refunds` where `credit_reduced > 0` joined through `sales.customer_id = ?`, and append them to `debtEntries` as credit lines:
  ```sql
  SELECT r.id, 'REFUND' as entry_type,
    'Avoir ' || r.refund_number as reference,
    r.date, 0 as debit, r.credit_reduced as credit,
    'Réduction crédit' as status, r.created_at
  FROM refunds r
  JOIN sales s ON s.id = r.sale_id
  WHERE s.customer_id = ? AND r.credit_reduced > 0
  ```

---

## 5. Offline Sync Vulnerabilities

### 5.1 Replay Idempotency Gap (**P1**)
- In [`server/routes/sync.ts:118-132`](file:///home/admin/VibeCoding/JaziraERP/server/routes/sync.ts#L118-L132), offline `SALE` records are deduplicated:
  ```typescript
  const clientId = temp_client_id || payload?.temp_client_id;
  if (clientId) {
    const existingSale = db.prepare('SELECT id, receipt_number FROM sales WHERE synced_from_client_id = ?').get(clientId);
    if (existingSale) { ... return; }
  }
  ```
- **The Gap:** In lines 508–613 of `sync.ts`, `CASH_MOVEMENT` and `CONTAINER_TRANSACTION` actions contain no such check, and the database schema lacks `synced_from_client_id` on `register_cash_movements` and `container_transactions`.
- **Proof:** Verified in adversarial tests 12 and 13. If an Android device flushes a sync batch and drops connection before receiving the HTTP 200 response, it will retry upon reconnection. The second sync run duplicates cash movements and container loans.
- **Fix:** Add `synced_from_client_id TEXT UNIQUE` to both tables and check before inserting.

---

## 6. The 18 Adversarial Scenarios Table

All 18 scenarios were executed against an in-memory SQLite database matching the production schema with foreign keys enabled (`foreign_keys = ON`) using actual production services.

| # | Scenario Name | Test Description | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|---|
| 1 | Reseller Discount Parity | Reseller discount 12.5% on 10.000 DT wholesale | 8.750 DT on both client and server | Client: 8.750 DT, Server: 8.750 DT | **PASS** |
| 2 | Tax Invariant | Flat 19% tax: HT + TVA == TTC across 7 test points | Exact equality down to 0.001 DT | Invariant held across all values | **PASS** |
| 3 | Multi-Ticket FIFO Allocation | 3 tickets (30, 40, 50 DT) + 50 DT payment | T1: 0 (PAID), T2: 20 (PARTIAL), T3: 50 (UNPAID), Total Debt: 70 DT | Matches expected exactly | **PASS** |
| 4 | Refund Between Payments | 50 DT ticket, pay 20, refund 20 credit, pay 15 | T1 rem: 10 after refund; rem: 0 after pay 2; 5 DT to wallet | Matches expected exactly | **PASS** |
| 5 | Credit Refund on Paid Ticket | Attempt credit reduction on PAID ticket | Rejection with 400 (no open ticket) | Blocked correctly (undefined ticket) | **PASS** |
| 6 | Overpayment Surplus | Debt 45 DT, Payment 100 DT | Tickets paid (0 debt), 55 DT to wallet | Allocated: 45 DT, Wallet: 55 DT, Debt: 0 | **PASS** |
| 7 | Non-Positive Payment Amounts | Payment amount <= 0 or NaN | Throws validation error | Both 0 and negative rejected | **PASS** |
| 8 | Split Payment Exact | 20 Cash + 15 Wallet + 35 Credit on 70 DT sale | Validation succeeds, change = 0 | ok: true, change: 0 | **PASS** |
| 9 | Split Payment Cash Overtender | 30 Cash Tendered, 20 Applied + 15 Wallet + 35 Credit | Validation succeeds, change = 10 DT | ok: true, change: 10.000 DT | **PASS** |
| 10 | Split Payment Sum Mismatch | Tender sum 65 DT on 70 DT sale | Validation fails with error | Blocked with "does not equal sale total" | **PASS** |
| 11 | Offline Sale Replay Idempotency | Sync same SALE twice with same temp_client_id | Second sync deduplicates via `synced_from_client_id` | Deduplicated cleanly | **PASS** |
| 12 | Offline Cash Movement Replay | Check idempotency guard on `register_cash_movements` | `synced_from_client_id` exists to block replay | **MISSING COLUMN (Vulnerability confirmed)** | **FAIL** |
| 13 | Offline Container Loan Replay | Check idempotency guard on `container_transactions` | `synced_from_client_id` exists to block replay | **MISSING COLUMN (Vulnerability confirmed)** | **FAIL** |
| 14 | Pack Price Override vs Reseller | 12-pack with 30 DT retail override on 2.5 DT wholesale | 27.000 DT (retail override ignored) | 27.000 DT calculated | **PASS** |
| 15 | Proportional Line Refund | 3 units of 20 DT total refunded unit by unit | Units 1 & 2: 6.667 DT, Unit 3: 6.666 DT, Total: 20.000 DT | Total refunded exactly 20.000 DT | **PASS** |
| 16 | Refund Quantity Exceeded | Attempt refund of 3 units when only 2 sold | Validation blocks refund | Blocked correctly | **PASS** |
| 17 | Dynamic Debt Sum Invariant | Customer debt == SUM(remaining_amount of open tickets) | Dynamic query matches manual ticket sum | Exact match: 105.000 DT | **PASS** |
| 18 | Product Catalog Search Latency | Benchmark 50 search queries on 2,000 products | SQLite < 10ms, Client-side JS filter < 5ms | SQLite: 0.12ms, Client JS: 0.28ms | **PASS** |

**Summary:** 16 PASS, 2 FAIL (Scenarios 12 and 13 confirm the offline sync idempotency gap).
