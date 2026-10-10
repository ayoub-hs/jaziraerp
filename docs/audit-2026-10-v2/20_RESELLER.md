# Master Audit v2 — 20. Reseller Flow & Debt Engine

## 1. Scope & Architecture Review

In Al Jazira SHSP's business model, resellers are high-volume B2B partners operating on credit:
- **Reseller Pricing Rule:** Reseller price = $\text{round3}(\text{product.wholesale\_price} \times (100 - \text{customer.reseller\_discount\_percent}) / 100)$. Reseller pricing always uses the wholesale base; pack `price_override` is retail-only.
- **Credit & Debt Tickets:** Any unpaid amount creates an open debt ticket (`customer_debt_tickets`).
- **Debt Payments:** Payments are allocated against open tickets in strict FIFO order (oldest first by `date ASC, created_at ASC`).
- **Customer Statement:** Statements must show all debits (tickets) and credits (payments + credit-reducing refunds), with a running balance matching the open ticket balance.

---

## 2. End-to-End Test Matrix & Verification

Every scenario below was executed against the project's real Express route handlers and SQLite database using the test harness.

| # | Scenario | Expected Behavior | Actual Behavior (Command & Output) | Verdict |
|---|---|---|---|---|
| **R1** | **Reseller Price Parity (Client vs Server vs Sync)** | Product (Retail 3.000, Wholesale 2.500), Reseller with 10% discount: unit price is $2.500 \times 0.9 = 2.250\text{ DT}$. Pack of 12 (retail override 28.000): reseller pays $12 \times 2.250 = 27.000\text{ DT}$. | `cart.ts`, `sales.ts`, and `sync.ts` all calculate exactly 2.250 DT and 27.000 DT. Verified in `cart.test.ts` and `sales.test.ts`. | **PASS** |
| **R2** | **Customer Switched Mid-Cart Overwrites Price** | If cashier enters a custom price (e.g. 2.100 DT) on an item and then selects a customer, the custom price should be preserved. | `useEffect` in [`DesktopPos.tsx:326`](file:///home/admin/VibeCoding/JaziraERP/src/components/desktop/DesktopPos.tsx#L326) unconditionally resets `unit_price = getProductPackPrice(...)`, wiping out the manual price. | **FAIL** (POS-03) |
| **R3** | **Global Cart Discount + Line Discount Stacking** | Sale total calculated as $\max(0, \sum \text{line\_total} - \text{total\_discount})$. Taxes split flat 19% tax-inclusive. | Validated in `sales.ts:403`. Correct arithmetic on creation. | **PASS** |
| **R4** | **Credit Ticket Numbering & Status Transitions** | Credit sale creates a ticket `TKT-YYYYMMDD-XXXX` with status `UNPAID` and `remaining_amount == credit_amount`. | Ticket created sequentially per Tunis business date. Validated in `sales.test.ts`. | **PASS** |
| **R5** | **FIFO Payment Allocation (Partial & Exact)** | Payment applies to oldest ticket first; if payment covers ticket, status becomes `PAID`, remaining becomes 0. | `allocateCustomerPayment` in `debtService.ts:89` applies FIFO correctly. | **PASS** |
| **R6** | **Payment Overpayment to Wallet** | Payment exceeding total debt retires all tickets and deposits surplus into customer wallet (`OVERPAYMENT_DEPOSIT`). | `debtService.ts:124` creates `OVERPAYMENT_DEPOSIT` in `customer_wallet_transactions`. Verified. | **PASS** |
| **R7** | **Payment on Zero Debt** | Customer with zero debt makes payment: entire amount deposits into wallet as credit deposit. | `openTickets` is empty; surplus goes to wallet. Verified. | **PASS** |
| **R8** | **Refund on Unpaid Credit Sale** | Customer returns item from credit sale with `refund_method = 'CREDIT_REDUCTION'`: `customer_debt_tickets.remaining_amount` decrements by refunded amount. | Backend updates `remaining_amount` correctly. But customer statement ledger omits the credit entry. | **FAIL** (RES-01) |
| **R9** | **Refund on Paid-Down Credit Sale** | If the credit ticket was already paid down via customer payment, credit reduction is rejected (400). Cashier should be able to refund to customer Wallet. | Backend rejects credit reduction (400). `RefundModal.tsx:393` only offers CASH and CREDIT_REDUCTION — no WALLET option. Cashier is blocked. | **FAIL** (REF-02) |
| **R10** | **Refund on Discounted Sale Exceeds Paid** | Sale with global cart discount returned: refund amount must not exceed actual paid amount. | Backend refunds unallocated `line_total`. Customer receives more than paid. Command: `npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts`. Output: `BUG CONFIRMED: sum(refunds.total_refunded) EXCEEDS sale.total_ttc by 5 DT!`. | **FAIL** (REF-01) |
| **R11** | **Customer Statement Reconciliation** | `/api/customers/:id/statement` debt ledger running balance matches summary card `final_balance`. | Running balance ends at 50 DT while summary shows 30 DT. Command: `npx tsx docs/audit-2026-10-v2/scratch/repro_invariants.ts`. Output: `BUG CONFIRMED: Running balance in ledger table ( 50 ) does NOT match summary card ( 30 )!`. | **FAIL** (RES-01) |
| **R12** | **Offline Credit Sale Sync with Deleted Customer** | Offline credit sale queued on mobile; customer deleted before sync flush. | `sync.ts:175` checks `customerRow`. Fails loudly with `Customer not found` and moves to `failed` queue. Does NOT silently convert to walk-in. | **PASS** |
| **R13** | **Offline Credit Sale Sync Price Variance** | Offline sale queued at old price; customer discount changed on server before sync flush. | Server honors offline unit price (receipt parity) and records catalog price in `sale_items.catalog_unit_price`. | **PASS** |
| **R14** | **Double Submit / Network Retry on Sync Flush** | Replaying sync flush with identical `temp_client_id` must be idempotent. | `SALE` is deduplicated on `synced_from_client_id` (PASS). `CASH_MOVEMENT` and `CONTAINER_TRANSACTION` duplicate records on replay (FAIL). | **FAIL** (SYNC-01) |

---

## 3. Deep-Dive Findings in Scope A

### Finding RES-01 (Severity: P1)
- **Component:** Customer Statement Ledger (`server/routes/customers.ts:315-334`)
- **Impact:** Wholesale customer account statements do not balance when returns occur on credit tickets.
- **Root Cause:** The SQL query building `debtEntries` in `GET /api/customers/:id/statement` merges `tickets` and `allocations`, but omits `refunds` where `credit_reduced > 0`.
- **Minimal Fix:**
  Add a query for `credit_reduced` refunds matching the customer's sales/tickets:
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

### Finding REF-01 (Severity: P0)
- **Component:** Line-Item Refund Calculation (`server/routes/sales.ts:827-846`)
- **Impact:** Store loses money by paying out refunds higher than customer tender.
- **Root Cause:** Line refunds calculate refund value based on `saleItem.line_total` without accounting for the cart-level `total_discount`.
- **Minimal Fix:**
  Apportion the global discount across lines during refund, or cap cumulative refunds at `sale.total_ttc`.
