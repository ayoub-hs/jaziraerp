# ERP Spec — Al Jazira SHSP

**Users:** Single user (owner-operated). No roles/permissions system needed — one login is enough.
**Deployment:** Web app, self-hosted on own server. Accessed remotely via VPN over cellular data.
**Platforms:** Must run on Linux (backoffice/countertop) and Android (mobile register + product management), with hardware access for barcode scanning, printing (thermal receipt printer + A4 invoice printer — two distinct printer types), and a cash drawer.
**Starting data:** Empty schema — no pre-loaded products, materials, or customers.

---

## 1. Scope

Full loop: **Raw materials & packaging → Production → Products (manufactured + resale) → Sales (POS + wholesale) → Customer balances/containers → Basic accounting.**

You sell both:
- **Manufactured goods** — formulated products (e.g. dish soap, cleaners) made from raw materials + packaging
- **Resale goods** — purchased finished goods you didn't make, tracked the same way (full purchase cost, stock, pricing)

---

## 2. Core Entities

### Raw Materials
- Name, category (surfactant, fragrance, bottle, cap, label, etc. — free-form categories)
- Single unit throughout (no conversion — buy and consume in the same unit, e.g. always kg or always pcs)
- Current stock quantity
- Latest supplier (only most recent tracked, not multi-supplier)
- Purchase price history over time (per material, so cost trends are visible)
- Includes **packaging materials** (bottles, caps, labels) — these are consumed during production exactly like formula ingredients, not tracked separately

### Formulations
- Name, linked to a Product (or product family)
- Recipe: list of raw materials (including packaging) + quantities per batch
- Used to calculate production cost automatically

### Products
- Name, category (Detergents, Air Fresheners, Resale Goods, etc.)
- Type: **Manufactured** (linked to a formulation) or **Resale** (purchased, no formulation)
- Barcode — mix of imported/existing supplier barcodes and system-generated ones for own products
- Active/inactive status
- **Sizing model** (see Section 3)
- Cost reference: auto-suggested from formulation cost (manufactured) or latest purchase cost (resale) — read-only reference, not editable
- Retail price (manual, cost-suggested)
- Wholesale price (manual, cost-suggested)
- *(No separate reseller price field — reseller price = wholesale price minus that reseller's own negotiated discount, stored on their customer record)*
- Stock quantity, low-stock threshold (triggers alert)
- Optional: linked container type (if selling this product involves a returnable container)
- Optional: image

### Production Batches
- Date, formulation used, batch size/target size (for multi-size products, batch targets a specific size)
- Auto-deducts raw materials + packaging per the recipe
- Auto-adds resulting quantity to the specific product/size's finished-good stock
- Batch cost auto-calculated from materials consumed

### Customers
- Name, contact info
- Type: retail / wholesale / reseller
- If reseller: negotiated discount % off wholesale price (per-reseller, not flat)
- **Balance ledger** (see Section 5)
- **Container loan record** (see Section 6)

### Suppliers
- Name, contact
- Linked to raw material purchases

### Sales
- Date, customer (optional for anonymous retail), line items (product + qty + price + optional per-item discount), payment method(s), total
- Document: simple receipt (thermal printer) by default; formal invoice (A4 printer) generated on request, with TVA breakdown shown (prices are always tax-inclusive, TVA rate is a flat 19%)
- Returns/refunds supported at the counter (reverses stock and payment)

### Purchases
- Covers both **raw materials** and **resale goods** — either can be bought from a supplier and logged the same way
- Date, supplier, line items (material or resale product + qty + cost), total
- Logged directly as stock arrives (single-step — no separate order/receipt stage)
- Payment: immediate or on credit depending on supplier (mirrors the customer balance model, on the supplier side)

### Accounting
- Simple cash-flow ledger: money in (sales) / money out (purchases + general expenses like rent, utilities) / running balance
- Not full double-entry bookkeeping
- Stock valuation view (raw materials + finished goods at cost)

---

## 3. Product Sizing Model

Two different mechanisms depending on the type of variation:

- **Liquid/weight sizes** (1L, 1.5L, 2L, 0.5kg, 1kg, etc.) → each size is its **own separate stock-tracked SKU**, grouped under one product family for browsing. A production batch targets a specific size directly.
- **Pack counts** (1pcs, 6pcs, 12pcs, 24pcs) → share **one base piece-count stock**; the pack size is just a sale-time multiplier (selling a 12-pack deducts 12 from the same underlying stock). No separate SKU per pack size.

---

## 4. POS (Countertop + Mobile Register)

### Add-to-cart flow (in priority order)
1. Barcode scan
2. Tap on product grid
3. Search
4. **Quick add** — ad-hoc item not yet in the catalog, added via a quick dialog (name + price on the spot)

For multi-size products, scanning/picking brings up a size-choice popup (e.g. 1L / 1.5L / 2L).

### Pricing at checkout
- Tier auto-applies based on customer selected: retail / wholesale / reseller (reseller's own negotiated price is pre-filled in order lines)
- One-off per-sale or per-item discounts can still be applied on top of tier pricing
- For a regular walk-in sale, no customer needs to be selected (anonymous cash sale) — a customer is only selected when relevant (reseller pricing, wallet payment, or attaching the sale to a known customer)

### Payment
- Methods: cash, wallet (customer store credit), or credit (unpaid — mainly for resellers)
- **Split payments supported** — e.g. part cash + part wallet, or part cash + part credit
- **Credit and "unpaid" are the same mechanism**: any portion of any sale not covered by cash/wallet creates a ticket for that remaining amount (see Section 5) — a fully-unpaid reseller sale is just the case where the whole total is credit
- Entering a received cash amount shows change due
- **Cash drawer opens only on sales that include a cash payment** — not for pure wallet or pure credit sales
- Receipt printing is optional per sale (ask each time, thermal printer); formal invoice (A4) generated on request instead

### Reseller-specific flow
- Reseller's negotiated price applies automatically once selected
- If not paying cash, sale is marked **unpaid** → creates an individual open ticket for that sale (see Section 5)
- Container give is tracked as a separate action from the sale itself, not a cart line item

### Returns/refunds
- Supported at the counter: reverses stock (adds back) and reverses payment

### Cart correction
- Clear/void cart action available before finalizing, to recover from mistakes

### Offline behavior
- **Checkout must keep working fully offline** (no internet/VPN), syncing to the server once connectivity returns
- Multiple counters (a few, same shop) may run simultaneously, but always operated by the same single user, one at a time — no multi-staff accounts needed
- Stock conflicts between offline counters (e.g. both sell the last unit before syncing) are accepted as a manual-fix risk, not engineered around
- Same applies to balance/ticket updates across offline counters — no system-level locking. Paying down the same ticket from two counters at once is avoided by workflow discipline (one user, one counter at a time), not enforced by the system

### Mobile-specific modes (beyond checkout)
- **Price lookup mode** — scan a barcode to see current price/stock, no sale involved
- **Price/stock update mode** — scan a barcode to directly edit price or stock quantity on the spot
- Also used for product management/catalog entry generally, since scanning with the phone camera is the easiest way to assign barcodes to new products

### Register Management

- **Open register**: enter a starting cash amount at the beginning of a session
- **Cash in / cash out**: log any cash movements during the day outside of sales (e.g. adding float, removing cash for an expense) with a reason
- **Close register**: enter the counted cash amount at end of session; system compares it against the expected total (opening amount + cash received from sales, including the cash portion of split payments − cash out + cash in) and shows the difference
- Applies per register/counter session — each countertop or mobile session opens and closes independently
- **Wallet top-ups are not part of register cash tracking** — they're logged as their own transaction on the customer's balance, separate from cash in/out

---

## 5. Customer Balance (Wallet / Debt)

One signed balance concept, but tracked as **individual tickets, not a single lump total**:

- Any unpaid portion of any sale (whether the whole sale is marked unpaid, or just the "credit" component of a split payment) creates its own **open ticket**: amount owed, date, status (unpaid / partially paid / paid)
- Payments are entered via a popup and applied against open tickets, **oldest first**
- A ticket's age is visible — this drives the **overdue/reminder flag** (surface tickets unpaid for a while)
- **No credit limit** — resellers can keep buying on credit regardless of existing balance
- **Concurrency note:** the system does not lock or prevent the same ticket being paid from two counters at once — avoided by workflow discipline (one user, one counter at a time), not system enforcement
- Wallet (positive store credit) uses the same underlying mechanism in the other direction — a customer can pay with wallet balance at checkout; top-ups are entered as their own transaction, separate from register cash tracking (see Register Management)
- Every top-up, credit sale, and payment is logged with a date — not just a running number

---

## 6. Container Management

- Tracks returnable containers (e.g. 10L jerrycans) given to and returned by customers
- **No cash deposit** — purely tracked as "customer owes N containers," per customer, per container type/size (multiple types supported)
- Given/returned as a **separate action from checkout**, not a sale line item
- When a customer returns containers, log them as received
- Some sales use the customer's own container (filled on the spot) — these are **not tracked** at all, since no container changes hands from your stock
- **Own container stock**: track how many empty containers you have on hand per type, decreasing when given out and increasing when returned. **Do not block giving out a container if stock shows 0** — this is informational/tracking only, not a hard constraint

---

## 7. Inventory

- Manual stock adjustment supported (shrinkage, damage, miscount correction) — logged with a reason, separate from sales/production/purchases
- No expiry or batch/lot tracking needed
- Low-stock alert per item, based on a configurable threshold

---

## 8. Explicitly Out of Scope

- Multi-user roles or permissions (single user only)
- Multi-currency
- Multi-location (single shop; a few counters, not multiple sites)
- Full double-entry accounting or tax filing
- CRM features (pipelines, follow-ups, marketing)
- Cash deposits on containers
- Credit limits on reseller debt
- Expiry/batch/lot tracking

---

## 9. Backup

- **Automated daily backup** of the server database.

---

**Instruction to agent:** Before implementing, generate a plan and list any assumptions you're making beyond what's specified here — especially anything not explicitly covered above. I will review and correct before you proceed.
