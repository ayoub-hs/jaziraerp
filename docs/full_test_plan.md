# Full Test Plan — Al Jazira SHSP ERP

Comprehensive test coverage across every feature in `erp-spec.md` and `implementation_plan.md`. Organized by module so failures are easy to trace back to a spec section.

---

## 1. Raw Materials & Formulations
- [ ] Create a raw material (including a packaging type: bottle/cap/label) with category, unit, stock, supplier
- [ ] Record a purchase → stock increases, price history entry created
- [ ] Purchase price history shows correct trend across multiple purchases of the same material
- [ ] Create a formulation linking multiple raw materials + packaging with quantities
- [ ] Formulation cost calculates correctly from current material costs

## 2. Production
- [ ] Run a production batch targeting a specific product size → correct materials + packaging deducted per recipe, scaled to actual output quantity
- [ ] Batch cost and cost-per-unit calculate correctly; product `cost_reference` updates
- [ ] Running a batch when material stock is insufficient: production proceeds, stock goes negative, a variance/warning is shown (not blocked)
- [ ] Multi-size product: batch for "2L" only affects 2L stock, not 1L/1.5L stock of the same family

## 3. Products & Sizing
- [ ] Create a manufactured product and a resale product, each with category, barcode (imported and system-generated cases)
- [ ] Liquid/weight sizes (1L/1.5L/2L) behave as separate SKUs with independent stock
- [ ] Pack-count product (6/12/24 pcs) shares one base stock; selling a 12-pack deducts 12 units correctly
- [ ] Low-stock alert triggers when a product crosses its threshold
- [ ] Retail/wholesale prices are manually set with cost shown as a read-only reference only

## 4. POS — Countertop
- [ ] Add to cart via: barcode scan, product grid tap, search, quick-add (uncataloged item)
- [ ] Multi-size popup appears and applies the correct SKU
- [ ] Selecting a reseller customer auto-applies their specific negotiated price
- [ ] Per-item and per-sale discounts apply correctly on top of tier pricing
- [ ] Split payment: part cash + part wallet; part cash + part credit; verify totals reconcile exactly
- [ ] Cash payment triggers drawer open; wallet-only and credit-only sales do NOT open the drawer
- [ ] Change-due calculates correctly on cash tender
- [ ] Receipt prints only when requested (thermal, 58mm); formal invoice (A4, with TVA breakdown at 19%) generates on request
- [ ] Clear/void cart before finalizing works and doesn't affect stock
- [ ] Marking a reseller sale "unpaid" creates a debt ticket for the correct amount

## 5. POS — Mobile Register
- [ ] Same checkout flow as countertop works one-handed, with camera barcode scan
- [ ] Price Lookup mode: scan shows price/stock with zero cart interaction
- [ ] Price/Stock Quick-Edit mode: scan → edit price or stock → saves and queues for sync
- [ ] Bluetooth thermal printer pairs and prints correctly from mobile

## 6. Offline Behavior & Sync
- [ ] Disconnect network — checkout, quick-add, cash in/out, and container transactions all continue working
- [ ] Reconnect — all queued actions sync correctly, stock and balances match expected state
- [ ] Two counters both sell the last unit of an item while offline — confirm this is NOT blocked (accepted risk), and reconcile manually to confirm the resulting stock is correct after sync
- [ ] Sync status indicator correctly shows Online/Offline/Syncing states

## 7. Register Management
- [ ] Open register with a starting cash amount
- [ ] Log cash-in and cash-out during a session with reasons
- [ ] Close register: entered counted cash vs. expected (opening + cash portion of every sale incl. splits − cash out + cash in) shows correct variance
- [ ] Wallet top-ups do NOT affect the register's expected cash calculation
- [ ] Each counter (countertop, mobile) opens/closes its own independent session

## 8. Customer Balance — Wallet & Debt Tickets
- [ ] Credit sale creates an open ticket with correct amount/date/status
- [ ] Partial payment on a ticket correctly updates remaining amount and status
- [ ] Multiple open tickets: a payment applies oldest-first (FIFO) across tickets
- [ ] Overdue flag appears on tickets past the age threshold
- [ ] No credit limit enforced — a reseller can keep buying on credit regardless of balance
- [ ] Wallet top-up increases balance; wallet payment at checkout decreases it correctly
- [ ] Overpayment beyond total owed on tickets auto-deposits the surplus into wallet balance
- [ ] Full transaction history (not just current balance) is visible per customer

## 9. Containers
- [ ] Giving a container to a customer decreases your own container stock and increases their owed count
- [ ] Giving a container when your own stock is 0 is NOT blocked
- [ ] Customer returning containers decreases their owed count and increases your stock
- [ ] Container tracking is a separate action from checkout, never a sale line item
- [ ] A sale using the customer's own container does not touch container records at all
- [ ] Multiple container types/sizes tracked independently per customer

## 10. Suppliers & Purchases
- [ ] Purchase raw material and purchase resale good both log correctly and hit the right stock
- [ ] Purchase marked PAID has no ticket created; purchase marked CREDIT creates a supplier debt ticket
- [ ] Partial payment to a supplier applies FIFO oldest-first across their open tickets, same as customer side
- [ ] Purchase stock increase is immediate/single-step (no separate order → receive stages)

## 11. Refunds
- [ ] Full-sale refund reverses all line items, all stock, and full payment
- [ ] Partial refund (single line item, partial quantity) reverses only that portion — stock, TVA, and subtotal adjust correctly
- [ ] Sale status correctly reflects PARTIALLY_REFUNDED vs FULLY_REFUNDED
- [ ] Refund payout correctly supports cash, wallet credit, or reducing an open debt ticket
- [ ] A sale can be refunded more than once over time (e.g. two separate partial refunds)

## 12. Inventory
- [ ] Manual stock adjustment (raw material or product) with a reason logs correctly and updates stock
- [ ] Adjustment history is visible, separate from sales/purchases/production movements

## 13. Accounting
- [ ] Cash-flow ledger correctly reflects sales (in), purchases (out), and general expenses (out)
- [ ] General expense entry (rent, utilities, etc.) logs correctly against a date/category
- [ ] Stock valuation view shows correct total (raw materials + finished goods at cost)

## 14. Hardware Integration
- [ ] USB barcode scanner (keyboard wedge) works from anywhere in the countertop app
- [ ] Android camera barcode scanner works with audible confirmation
- [ ] Thermal printer (USB on Linux, Bluetooth on Android) prints a correctly formatted 58mm receipt
- [ ] A4 invoice prints with full company/tax header and TVA breakdown
- [ ] Cash drawer physically opens on cash-inclusive sales only
- [ ] Barcode generation (Code-128) produces scannable labels for new products

## 15. Backup
- [ ] Daily automated backup runs and produces a valid, restorable SQLite snapshot
- [ ] Manual backup trigger works on demand

## 16. Cross-Cutting / Non-Functional
- [ ] Single-login/PIN unlock works both online and fully offline
- [ ] App runs correctly on Linux (countertop) and Android (mobile) as specified
- [ ] Remote access via VPN over cellular data works for backoffice use
- [ ] All currency figures display/calculate at 3 decimal places (millimes) with no floating-point drift

---

**Instruction to agent:** Run every automated test you can (unit + integration), then walk through every manual checklist item above against the running app and report pass/fail with specifics for anything that fails — don't just report a summary count. For anything you can't test automatically (physical hardware, VPN), state clearly that it needs manual verification on my end rather than marking it as passed.
