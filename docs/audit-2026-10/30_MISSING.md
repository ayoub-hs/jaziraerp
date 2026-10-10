# Scope C — Missing Features & Capabilities Evaluation
**Project:** Al Jazira SHSP ERP / POS  
**Context:** Single-operator manufacturer & distributor of detergents and consumer goods in Djerba, Tunisia.  
**Hardware & Scale:** 1–3 devices (Desktop caisse, Android Capacitor register, backoffice laptop). Personal scale, NOT multi-tenant, NOT enterprise cloud.  
**Evaluation Standard:** Judged strictly by business necessity, operational clarity, tax/audit compliance, and cashier speed.

---

## 1. Master Feature Evaluation Matrix

| # | Feature | Status | Evidence (file:line) | Business Impact | Dev Effort | Worth It for Personal Scale? |
|---|---|---|---|---|---|---|
| 1 | **Quotes & Delivery Notes (Devis & BL)** | **Missing** | No schema table or route in `server/routes/` | **Critical** | Medium | **YES (Top Priority)** |
| 2 | **Empty Container Returns to Suppliers** | **Missing** | [`server/db/schema.sql:260-310`](file:///home/admin/VibeCoding/JaziraERP/server/db/schema.sql#L260-L310) | **High** | Small | **YES** |
| 3 | **Thermal End-of-Day Z-Report Roll** | **Missing** | [`src/services/hardware/escpos.ts`](file:///home/admin/VibeCoding/JaziraERP/src/services/hardware/escpos.ts) | **High** | Small | **YES** |
| 4 | **Customer Credit Limit** | **Missing** | [`server/db/schema.sql:138-149`](file:///home/admin/VibeCoding/JaziraERP/server/db/schema.sql#L138-L149) | **High** | Small | **YES** |
| 5 | **Production Margin Warning Alerts** | **Missing** | [`src/components/backoffice/BatchDetailModal.tsx:75`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice) | **High** | Small | **YES** |
| 6 | **Centralized Low-Stock Reorder List** | **Partial** | Low stock tags in POS, no centralized order sheet | **High** | Small | **YES** |
| 7 | **Supplier Payables Aging (30/60/90 days)** | **Partial** | Open tickets shown per supplier, no aging buckets | **Medium** | Small | **YES** |
| 8 | **Purchase Returns (Raw Materials)** | **Missing** | No return route for supplier purchases | **Medium** | Medium | **Later** |
| 9 | **Physical Stocktake Count Sessions** | **Missing** | Only single-item adjustments in `inventory.ts` | **Medium** | Medium | **Later** |
| 10 | **Formal Tax Invoice Metadata (Facture)** | **Partial** | POS receipt generated; lacks Tunisian legal header | **Medium** | Small | **YES** |
| 11 | **Named Price Lists / Tariffs** | **Partial** | Customer % discount exists; no named lists | **Low** | Medium | **No** (Current % tier is sufficient) |
| 12 | **Retail Batch / Expiry Tracking at POS** | **Missing** | Batches exist for production, not retail checkout | **Low** | Large | **No** (Detergents have long shelf life; FIFO is enough) |
| 13 | **Cash Drawer Variance History** | **Present** | [`server/routes/register.ts:100-160`](file:///home/admin/VibeCoding/JaziraERP/server/routes/register.ts#L100-L160) | N/A | None | **Already Done** |
| 14 | **Expense Categories & Operating P&L** | **Present** | [`server/routes/accounting.ts`](file:///home/admin/VibeCoding/JaziraERP/server/routes/accounting.ts), `general_expenses` | N/A | None | **Already Done** |
| 15 | **Accountant Data Export (CSV/Excel)** | **Present** | [`src/utils/csv.ts`](file:///home/admin/VibeCoding/JaziraERP/src/utils/csv.ts), `ReportsTab.tsx` | N/A | None | **Already Done** |
| 16 | **System Backup & Restore Drill** | **Present** | [`src/components/backoffice/BackupManager.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice) | N/A | None | **Already Done** |
| 17 | **Product Barcode Label Printing** | **Present** | [`src/components/backoffice/BarcodeLabelPrinter.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice) | N/A | None | **Already Done** |
| 18 | **Audit Trail of Edits & Deletions** | **Partial** | Price history & inventory logged; no global log | **Low** | Medium | **No** (Single operator owner) |

---

## 2. In-Depth Analysis of Critical Missing Items

### 2.1 Quotes & Delivery Notes (Devis & Bon de Livraison — BL)
- **Status:** **MISSING**.
- **The Operational Problem in Tunisia:**
  In Tunisian business-to-business commerce, detergent manufacturers sell to cafes, hotels, laundromats, and grocery resellers. The normal commercial practice is:
  1. The client requests a price estimate (**Devis**).
  2. The goods are delivered with a physical delivery note (**Bon de Livraison — BL**) signed by the receiver. At this moment, inventory leaves the warehouse, but payment is not made.
  3. At the end of the week or month, the vendor aggregates one or multiple BLs into a single formal invoice or credit debt ticket.
- **Current System Limitation:** The POS only knows how to execute an immediate `sale`. If goods leave the shop on a delivery truck, the operator must either ring it up as an immediate credit sale (generating a cash register receipt `REC-...`) or record nothing. A thermal register receipt cannot serve as a legally accepted B2B delivery note.
- **Effort:** **Medium (M)**. Needs a `delivery_notes` table with items, status (`DRAFT`, `DELIVERED`, `INVOICED`), and an A4/A5 printable layout.
- **Verdict for Personal Scale:** **HIGH PRIORITY / ESSENTIAL**.

### 2.2 Returns of Empty Containers to Suppliers
- **Status:** **MISSING**.
- **Evidence:** [`server/db/schema.sql:260-310`](file:///home/admin/VibeCoding/JaziraERP/server/db/schema.sql#L260-L310).
- **The Operational Problem in Djerba:**
  Detergent manufacturing requires buying bulk chemical raw materials (surfactants, LABSA, caustic soda, fragrance oils) delivered in **1000-liter IBC containers** (Cuves 1000L) or **200-liter plastic/steel drums** (Fûts).
  - Chemical suppliers in Sfax or Tunis charge substantial container deposit fees (e.g. 150–250 DT per IBC container).
  - When the detergent is produced, the empty IBC is returned to the supplier's truck to get credit refunded or offset against the next raw material purchase.
  - **The Gap:** The ERP has a complete container subsystem for *customers* (bidons 5L/10L loaned and returned), but **zero tracking for supplier container balances**.
- **Effort:** **Small (S)**. Add `supplier_id` to container transaction tracking or add a `supplier_container_balances` table.
- **Verdict for Personal Scale:** **HIGH PRIORITY / WORTH IT**.

### 2.3 Thermal End-of-Day Z-Report Slip (ESC/POS 58mm/80mm)
- **Status:** **MISSING**.
- **Evidence:** Backoffice has `SessionsHistoryModal.tsx`, but no ESC/POS generator in `src/services/hardware/escpos.ts`.
- **The Operational Problem:**
  At closing time, the cashier counts physical cash in the drawer, enters counted cash into `SessionModal.tsx`, and the screen displays variance (e.g. `+2.500 DT`).
  - In a standard retail POS, closing the register automatically prints a **Z-Report** thermal slip summarizing:
    - Session ID, Counter Name, Date & Time opened/closed
    - Opening Cash Float
    - Total Cash Sales, Total Cash Refunds, Net Cash Sales
    - Total Cash In / Cash Out movements
    - Expected Drawer Cash vs Counted Cash vs Discrepancy
  - The cashier wraps the paper slip around the day's cash envelope and puts it in the safe.
  - Without this, the owner must open the laptop backoffice to verify the till envelope.
- **Effort:** **Small (S)**. Extend `escpos.ts` with a `formatZReportReceipt()` function and trigger direct thermal print on session close.
- **Verdict for Personal Scale:** **HIGH PRIORITY / WORTH IT**.

### 2.4 Customer Credit Limit
- **Status:** **MISSING**.
- **Evidence:** [`server/db/schema.sql:138-149`](file:///home/admin/VibeCoding/JaziraERP/server/db/schema.sql#L138-L149).
- **The Risk:**
  Currently, any customer with `type = 'RESELLER'` or `'WHOLESALE'` can accumulate unbounded debt. The checkout modal allows any credit amount as long as a customer is selected. If a reseller owes 5,000 DT and has not made a payment in 60 days, the POS cashier is not alerted and can add another 1,000 DT on credit.
- **Recommendation:** Add `credit_limit REAL DEFAULT 0` to `customers`. If `credit_limit > 0` and `current_debt + creditAmount > credit_limit`, display a clear warning badge in `CheckoutModal.tsx` requiring explicit confirmation.
- **Effort:** **Small (S)**.
- **Verdict for Personal Scale:** **HIGH PRIORITY / WORTH IT**.

### 2.5 Production Cost Margin Alerts
- **Status:** **MISSING**.
- **Evidence:** [`src/components/backoffice/BatchDetailModal.tsx`](file:///home/admin/VibeCoding/JaziraERP/src/components/backoffice).
- **The Operational Problem:**
  When raw material prices fluctuate (e.g. cost of Sulfonic acid spikes by 15%), `costingService.ts` correctly updates weighted average raw material costs and computes the new cost per liter/unit of finished detergent in `production_batches`.
  - However, the system does not compare the calculated unit cost against the catalog `wholesale_price` or `retail_price` of the finished product.
  - If production cost is 2.650 DT and wholesale price is 2.500 DT, the owner is selling at a net loss without receiving any visual warning in the backoffice.
- **Effort:** **Small (S)**. Compute `margin = wholesale_price - unit_cost` in `BatchDetailModal` and display a red badge if margin is below a defined threshold (e.g. < 15%).
- **Verdict for Personal Scale:** **HIGH PRIORITY / WORTH IT**.

---

## 3. Features Confirmed Present and Sufficient

The audit confirmed that the following modules are fully implemented and appropriate for personal scale:
1. **Cash Drawer Variance Tracking:** `register_sessions` properly audits opening float, computed expected cash, counted cash, and variance.
2. **General Expenses & Operating P&L:** Categorized overhead expenses (`REGISTER_CASH` vs `BANK_OTHER`) integrate directly into monthly P&L reporting.
3. **Accountant CSV Exports:** Complete export capabilities for sales, purchases, and expenses with UTF-8 BOM encoding.
4. **Barcode Sticker Printing:** In-browser 50mm x 25mm label sheet generation with Code-128 barcodes.
5. **Database Backup & Snapshot Manager:** SQLite binary backup snapshot and restore via Backoffice UI.
