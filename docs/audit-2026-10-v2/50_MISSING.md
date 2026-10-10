# Master Audit v2 — 50. Missing Features Evaluation

This evaluation focuses strictly on operational realities for a **single-owner detergent manufacturer and distributor in Djerba, Tunisia (1–3 devices)**. No enterprise padding, no multi-user RBAC, no cloud advice.

Every item below includes:
1. Status (Present / Partial / Missing)
2. Concrete codebase evidence (schema + route + frontend verification)
3. Business impact & effort
4. Single-owner verdict
5. **ASSUMPTION flag & owner question** where business practice is not specified in `erp-spec.md`.

---

## Candidate Items (Max 6 Genuine Items)

### 1. Thermal ESC/POS Z-Report Printout on Session Close
- **Status:** **PARTIAL**
- **Evidence:**
  - `src/services/hardware/escpos.ts`: generates 58mm/80mm thermal byte streams for sales receipts (`generateReceiptCommands`), but contains zero functions for register closure or Z-reports.
  - `src/components/shared/SessionModal.tsx`: closing a session displays opening, cash sales, cash in/out, counted cash, and difference on screen, but provides no "Imprimer Ticket Z" button.
- **Business Impact:** Cashiers typically put the physical cash into a daily envelope with a printed slip taped to it. Currently, the owner must manually transcribe figures from the screen with a pen.
- **Effort:** Small (1–2 hours).
- **Worth it for Personal Scale:** **YES (High utility)**.
- **ASSUMPTION:** *Does the owner physically print an end-of-day thermal slip to archive with the cash envelope, or is viewing the closure on screen sufficient?*

---

### 2. Printable / PDF Customer Account Statement
- **Status:** **PARTIAL**
- **Evidence:**
  - `server/routes/customers.ts:290-370`: `GET /api/customers/:id/statement` calculates the running ledger.
  - `src/components/backoffice/CustomerStatementModal.tsx`: renders an on-screen modal table of entries and running balances.
  - Schema: no print layout, no `@media print` styling, and no export/share button in `CustomerStatementModal.tsx`.
- **Business Impact:** Wholesale detergent resellers in Tunisia frequently ask for an account statement ("Relevé de compte") to reconcile outstanding credit tickets before paying.
- **Effort:** Small (1 hour to add A4 print/PDF layout).
- **Worth it for Personal Scale:** **YES (High customer value)**.
- **ASSUMPTION:** *Do your wholesale and reseller clients ask for a printed or PDF statement of their account, or do you only review balances verbally with them at the counter?*

---

### 3. Delivery Notes (Bon de Livraison — BL)
- **Status:** **MISSING**
- **Evidence:**
  - 3 Grep variants: `grep -i "devis"`, `grep -i "livraison"`, `grep -i "delivery_note"` yield 0 application results.
  - Schema: only `sales` (POS ticket) and `invoices` exist.
  - `src/components/shared/InvoicePrintModal.tsx` prints formal A4 invoices ("FACTURE").
- **Business Impact:** In Tunisian B2B commerce, goods delivered by vehicle often require a "Bon de Livraison" (BL) signed by the receiver upon delivery, with grouped invoices issued at month-end.
- **Effort:** Medium (3–4 hours for document template and print option).
- **Worth it for Personal Scale:** **MODERATE (Depends on delivery model)**.
- **ASSUMPTION:** *Do you deliver detergent products to reseller stores by vehicle where drivers must carry a signed Bon de Livraison, or do resellers pick up goods directly at your counter with standard POS receipts/invoices?*

---

### 4. Park / Hold Cart (Mise en Attente)
- **Status:** **MISSING**
- **Evidence:**
  - Grep variants: `grep -i "parkCart"`, `grep -i "holdCart"`, `grep -i "pendingCart"` yield 0 results.
  - `DesktopPos.tsx` and `MobileRegister.tsx`: only hold a single in-memory `cart` array. The only option when a customer steps away is "Clear Cart" (void).
- **Business Impact:** At a retail counter, when a customer forgets their wallet in the car or steps away to pick up another bottle, the counter is frozen unless the cashier voids the scanned items and re-scans them later.
- **Effort:** Small (2 hours using local storage or memory array of held carts).
- **Worth it for Personal Scale:** **MODERATE**.
- **ASSUMPTION:** *Does the counter get busy enough that customers frequently pause at checkout, requiring the cashier to serve another customer in the meantime?*

---

### 5. Desktop Quick Price & Stock Lookup (Without Cart Insertion)
- **Status:** **PARTIAL**
- **Evidence:**
  - `src/components/mobile/MobileRegister.tsx`: has a dedicated "Consultation" (Lookup) tab.
  - `src/components/desktop/DesktopPos.tsx`: scanning a barcode or pressing Enter immediately inserts the item into the active cart. There is no dedicated lookup shortcut.
- **Business Impact:** When a walk-in customer asks "How much is this 5L jerrycan?", the cashier must scan it into the active cart to see the price, and then remember to delete it before the next real customer checks out.
- **Effort:** Small (1 hour).
- **Worth it for Personal Scale:** **YES (Everyday convenience)**.
- **ASSUMPTION:** *Do customers at the desktop counter ask for price checks on goods without immediately buying them?*

---

### 6. Raw Material Supplier Container Tracking (IBCs / Drums)
- **Status:** **MISSING**
- **Evidence:**
  - Schema: `container_types` and `customer_container_loans` track customer jerrycans (bidons) loaned out.
  - `server/db/schema.sql`: zero tables or fields track containers received from chemical suppliers (e.g. 1000L IBC cubes or 200L metal chemical drums).
- **Business Impact:** If raw material suppliers charge deposit fees on 1000L IBC containers, unreturned containers represent lost capital.
- **Effort:** Medium (4–5 hours).
- **Worth it for Personal Scale:** **LOW (Unless supplier deposits are substantial)**.
- **ASSUMPTION:** *Do your chemical raw material suppliers charge container deposits on IBC tanks or drums that you must return, or are raw materials delivered in non-returnable packaging?*
