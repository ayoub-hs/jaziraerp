# Al Jazira SHSP ERP & POS — Implementation Plan & Specification Analysis

This document outlines the architecture, database design, offline-first synchronization strategy, hardware integration (barcode scanner, 58mm ESC/POS thermal printer via USB/Bluetooth, A4 invoice printer, cash drawer), core business logic, confirmed specifications, and dedicated UI/UX designs for both Desktop Countertop and Mobile Register.

---

## Confirmed Specifications & System Decisions

> [!NOTE]
> The following items have been confirmed and incorporated:
> - **Currency:** **TND (Tunisian Dinar / DT)** with **3 decimal places** (millimes, e.g. `12.500 DT`).
> - **Thermal Printer Hardware:** **H313 POS 58mm Thermal Receipt Printer** (STMicroelectronics USB, Vendor ID: `0x0483`, Product ID: `0x5840`, Bulk OUT endpoint `0x04`).
> - **Thermal Printer Connection & Driver:**
>   - **Linux Countertop (Primary):** Direct native **`libusb-1.0`** driver running on the backend (`/api/hardware/printer/print`). Automatically detaches conflicting Linux kernel module (`usblp`), streams raw ESC/POS byte buffers to endpoint `0x04`, and performs ASCII normalization (`cleanAscii`) to prevent firmware crashes.
>   - **Client/Browser Fallbacks:** WebUSB API direct driver, WebBluetooth API (Android Mobile Register), and CSS-formatted browser print preview (`ReceiptPrintModal` with `@media print`).
> - **Cash Drawer Hardware & Driver:**
>   - **Standalone USB-to-Serial Drawer:** Connected via dedicated USB Serial controller (`/dev/ttyUSB0` at 9600 baud, 8N1). Triggered via raw byte stream write (`\x1b\x70\x00\x19\xfa`, `\x07`, `\x01`) exposed via `/api/hardware/drawer/kick`.
>   - **Dual-Layer Kick:** Automatically triggers both the `/dev/ttyUSB0` serial controller and the printer DK pulse on cash tenders, with manual "Drawer" button on the POS header.
> - **Barcode Generation:** **Code-128** standard (supports alphanumeric product codes, printable as SVG/Canvas using `JsBarcode`).

---

## Core Assumptions Beyond `erp-spec.md`

### 1. Currency & Tax (TVA)
- **Currency & Formatting:** Displayed as `TND` / `DT` with **3 decimal places** (e.g. `15.750 DT`). Input fields and calculations maintain 3-decimal precision.
- **TVA Calculation:** Prices are tax-inclusive with a flat 19% TVA rate:
  - $\text{Subtotal (HT)} = \text{Total (TTC)} / 1.19$
  - $\text{TVA Amount} = \text{Total (TTC)} - \text{Subtotal (HT)}$
  - Receipts (58mm) and A4 invoices display the itemized totals, subtotal HT, and TVA 19% breakdown.

### 2. Single-User Authentication & Offline Unlocking
- Backoffice and POS are protected by a **PIN / Master Password** (4-digit PIN for rapid counter unlock, plus master password).
- The PIN hash is securely stored in local client storage (`IndexedDB` / Web Crypto) so the counter can be unlocked and operated offline without VPN access.
- First launch prompts for initial PIN/password and shop details (company name, address, tax registration number).

### 3. Sizing Model: Liquid/Weight SKUs vs Pack Multipliers
- **Liquid/Weight sizes:** Each size (e.g., 1L, 1.5L, 2L, 5L) is a **distinct stock-tracked SKU** with its own barcode, stock count, low-stock threshold, wholesale price, and retail price. Grouped under a **Product Family** (e.g., "Detergent Lavender").
- **Pack multipliers:** Any SKU can define pack sizes (e.g. 1pc, 6pcs, 12pcs, 24pcs). A pack size references the parent SKU's piece stock and applies a multiplier (e.g., selling a 12-pack deducts 12 from stock).
- **Pack Pricing:** A pack can either calculate price dynamically (`multiplier × unit_price`) or have an explicit override price (e.g., 1 pc = 2.000 DT, pack of 12 = 22.000 DT).

### 4. Production Recipe Scaling & Packaging
- Formulations define raw materials and packaging quantities for a reference yield (e.g., 100 Liters or 100 Units).
- When logging a production batch, the operator specifies the target product/size and actual output quantity (e.g. 50 bottles of 1L). Ingredients are scaled proportionally.
- **Packaging:** Bottles, caps, and labels are stored as raw materials and deducted directly during production.
- **Negative Stock Handling:** If ingredient/packaging stock is lower than required, the system warns the user but **does not block production**, recording the deduction and flagging the variance.

### 5. Reseller Pricing & Discounts
- Reseller customers have a `reseller_discount_percent` field (e.g., 10%).
- Selecting a reseller customer at checkout automatically pre-fills unit prices as:
  $$\text{Unit Price} = \text{Wholesale Price} \times \left(1 - \frac{\text{Discount \%}}{100}\right)$$
- Cashiers can still apply an additional one-off percentage or amount discount per line item or on the entire cart.

### 6. Customer Balance, Debt Tickets & Wallet Mechanism
- Any unpaid portion of any sale creates an **open ticket** with: Date, Sale ID, Total Owed, Remaining Owed, and Status (`UNPAID`, `PARTIALLY_PAID`, `PAID`).
- Debt payments are applied to open tickets in **FIFO order (oldest first)**.
- **Overdue tickets:** Tickets unpaid after 30 days (configurable) display an overdue badge.
- **Overpayment:** If a customer pays more than their total outstanding debt, the surplus is automatically credited to their **Wallet balance**.
- **Wallet payment at checkout:** Cashier can apply customer wallet credit toward a purchase.

### 7. Hardware Integration Strategy & Operational Findings

#### A. USB Serial Cash Drawer (`/dev/ttyUSB0`)
- **Hardware Architecture:**
  - The physical cash drawer operates via a dedicated **USB-to-Serial converter interface** (e.g. Prolific PL2303, FTDI, CH340, or QinHeng chip) presenting as `/dev/ttyUSB0` on Linux, independent of any receipt printer RJ11 daisy chain.
  - Browser-based WebUSB/WebSerial APIs in standard client browsers cannot reliably control `/dev/ttyUSB0` due to OS-level serial port locking and browser security restrictions.
- **Backend Driver Implementation (`server/routes/hardware.ts` & `src/services/hardware/hardwareDrivers.ts`):**
  - Configures the serial port dynamically via `stty -F /dev/ttyUSB0 9600 raw -echo` (9600 baud, 8 data bits, no parity, 1 stop bit).
  - Emits trigger pulses via raw byte stream writes to `/dev/ttyUSB0` using byte sequences:
    - Primary ESC/POS pulse: `[0x1b, 0x70, 0x00, 0x19, 0xfa]`
    - Standard bell trigger: `[0x07]`
    - Binary trigger: `[0x01]`
- **Dual-Layer Kick Execution:**
  - Whenever a sale includes a cash tender (`cash_tendered > 0`), the system executes a dual-layer kick:
    1. Direct serial kick write to `/dev/ttyUSB0`.
    2. ESC/POS drawer kick pulse (`ESC p 0 25 250`) transmitted to the USB thermal printer (for setups with an RJ11 drawer connected through the printer).
- **Manual Control & Status:**
  - The POS top header includes a dedicated **[Drawer]** button (`handleKickDrawer()`) for manual drawer opening without a sale.
  - Real-time hardware status indicator reflects drawer connection status based on `/dev/ttyUSB0` detection via `GET /api/hardware/status`.

#### B. H313 POS 58mm Thermal Receipt Printer (STMicroelectronics `0x0483:0x5840`)
- **Hardware Profile:**
  - Model: **H313 POS 58mm Thermal Receipt Printer**.
  - USB Vendor ID (VID): `0x0483` (STMicroelectronics).
  - USB Product ID (PID): `0x5840`.
  - USB Transfer Type: Bulk OUT endpoint `0x04`.
  - Paper Spec: 58mm roll width (~32 printable monospace characters per line).
- **Linux Kernel Driver Conflict & Native `libusb-1.0` Solution:**
  - *Conflict:* In Linux environments, the kernel automatically binds the default `usblp` driver (`/dev/usb/lp0`) to the printer interface. When user-space applications or browser WebUSB attempt to claim interface 0, libusb returns `LIBUSB_ERROR_BUSY` (Resource Busy).
  - *Driver Architecture:* Implemented a native backend driver using `libusb-1.0.so.0` (matching the desktop reference implementation in `docs/DesktopReceiptPrinter.kt`):
    1. Initializes a global `libusb` context and scans for device `0x0483:0x5840` (or fallback to USB class `0x07` printer).
    2. Calls `libusb_set_auto_detach_kernel_driver(dev_handle, 1)` and explicitly detaches the `usblp` kernel driver if active (`libusb_detach_kernel_driver(dev_handle, 0)`).
    3. Claims interface `0` (`libusb_claim_interface(dev_handle, 0)`).
    4. Streams formatted raw ESC/POS byte buffers via `libusb_bulk_transfer` to endpoint `0x04`.
    5. Releases interface and cleanly shuts down the device handle.
- **Character Encoding & Firmware Sanitization (`cleanAscii`):**
  - Standard 58mm thermal printer firmware stalls, prints garbage characters, or resets when receiving multi-byte UTF-8 accented characters (e.g. French accents *é, è, à, ê, î, ô, ç*).
  - Implemented `cleanAscii` sanitization using Unicode NFD normalization (`str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')`), converting accents into their base ASCII equivalents (e.g., *Désodorisant* $\to$ *Desodorisant*, *Éponge* $\to$ *Eponge*).
- **Receipt Layout & Monetary Precision:**
  - Amounts are formatted in **Tunisian Dinars (`REAL`, 3 decimal places, e.g. `5.200 DT`)** using `formatMoneyDinars`.
  - Line items resolve product names from both catalog products (`catalog_product_name`) and quick-add ad-hoc items (`quick_add_name`).
  - Formatted ticket sections:
    - Store Header: Centered business name, subtitle, and tax registration (Matricule Fiscal).
    - Metadata: Official receipt number (`REC-YYYYMMDD-XXXX`), session ID, cashier, and formatted date/time.
    - Items Table: Left-aligned product name and quantity, right-aligned line total TTC.
    - Financial Summary: Subtotal HT (`TTC / 1.19`), TVA 19% breakdown, Total Due TTC.
    - Payment Tender: Amount tendered by payment method (Cash, Wallet, Credit, Card), change returned.
    - Footer: Centered thank-you note and auto-cut paper feed command (`GS V 66 0` / `\x1d\x56\x42\x00`).
- **Post-Checkout One-Click Printing Workflow:**
  - `POST /api/sales` returns both internal `id` and sequential `receipt_number`.
  - Checkout modal (`src/components/shared/CheckoutModal.tsx`) invokes `POST /api/hardware/printer/print` passing either UUID or receipt number.
  - Interactive UI displays real-time printing feedback (`Impression...` $\to$ `✓ Ticket imprimé avec succès !`).
  - If the physical printer is offline or disconnected, the app falls back gracefully to opening `ReceiptPrintModal` for browser printing (`window.print()`).

#### C. A4 Commercial Invoice Printer
- Dedicated **[Print A4 Invoice]** action generates a styled printable commercial invoice layout including company tax credentials, customer matricule/address, line-item table with Unit Price HT, Quantity, TVA rate (19%), Line Total TTC, and legal footer.

#### D. Barcode Scanners & Generators
- **Countertop Hardware Barcode Scanner:** Global keyboard wedge listener buffers rapid keystrokes (< 50ms per character terminated by `Enter`), automatically matching scanned barcodes against catalog SKUs without requiring input field focus.
- **Android Camera Scanner:** Embedded camera viewfinder using browser `BarcodeDetector` API (with fallback to `html5-qrcode` / `zxing`) for rapid mobile scanning.
- **Barcode Generator:** Generates **Code-128** barcodes for new or imported products with printable SVG/Canvas labels using `JsBarcode`.

### 8. Offline Synchronization Architecture
- Built as a Progressive Web App (PWA) with Service Worker and IndexedDB (Dexie.js).
- All catalog data (products, sizes, barcodes, prices, customers, container types, active register session) are mirrored locally.
- When offline:
  - POS checkout continues to operate without internet/VPN.
  - Completed sales are stored in an IndexedDB `pending_sync_queue`.
  - Local product stock count is decremented immediately so subsequent scans reflect current stock.
  - Quick-add items, cash in/out, and container transactions are queued locally.
- When connection resumes:
  - Background worker flushes `pending_sync_queue` to `POST /api/sync/flush`.
  - Server executes transactions in SQLite, generates official sequential receipt numbers and credit tickets, and returns the master state.
  - Top bar shows sync status: **Online (Synced)**, **Offline (N pending sync)**, or **Syncing...**.

---

## UI & UX Design Specifications: Desktop Countertop vs. Mobile Register

The frontend delivers **two distinct, purpose-built interfaces** sharing 100% of the underlying state, offline database, and hardware drivers:

```
                              ┌────────────────────────────────────────┐
                              │ Shared Logic, IndexedDB & State Engine │
                              │ (Cart, FIFO Debt, TND Math, Hardware)  │
                              └───────────────────┬────────────────────┘
                                                  │
                        ┌─────────────────────────┴─────────────────────────┐
                        ▼                                                   ▼
         ┌──────────────────────────────┐                    ┌──────────────────────────────┐
         │   Desktop Countertop POS     │                    │     Mobile Phone Register    │
         │   (Linux Widescreen View)    │                    │     (Android Thumb View)     │
         ├──────────────────────────────┤                    ├──────────────────────────────┤
         │ • 2-column widescreen layout │                    │ • Single-column vertical     │
         │ • Category chips + product   │                    │ • Fixed bottom navigation    │
         │   grid (touch/mouse friendly)│                    │ • Floating Camera Scan button│
         │ • Always-visible side cart   │                    │ • Pull-up bottom sheet cart  │
         │ • Built-in numpad & tender   │                    │ • Standalone Price Check mode│
         │ • USB scanner wedge listener │                    │ • In-aisle Price/Stock edit  │
         │ • Full Backoffice navigation │                    │ • Bluetooth 58mm print driver│
         │ • A4 Invoice & 58mm preview  │                    │ • Torch / flashlight toggle  │
         └──────────────────────────────┘                    └──────────────────────────────┘
```

---

### 1. Desktop Countertop UI (Linux Terminal & Kiosk Mode)

Designed for rapid cashier operation on widescreen monitors (1080p / 720p), optimized for high-volume transactions with USB handheld scanners:

- **Top Status Bar:**
  - Shop name & logo ("Al Jazira SHSP").
  - Register session status: `Session #01 — Countertop` with opening float indicator.
  - Connectivity & Sync Badge: `● Online (Synced)` or `▲ Offline (3 Pending)`.
  - Hardware status: USB Receipt Printer status indicator.
  - Quick actions: **[Pop Cash Drawer]**, **[Cash In / Out]**, and **[Close Session]**.
- **Left Column (Product Browser & Search — 60% Width):**
  - **Category Tabs:** Horizontal pill filters (`All`, `Detergents`, `Resale`, `Air Fresheners`, `Packaging`).
  - **Live Search Bar:** Instant filtering by product name or barcode.
  - **Product Grid:** Compact, high-contrast cards displaying:
    - Product name & category.
    - Size tag (e.g. `1L`, `5L`, `Piece`).
    - Current stock count (amber alert if below low-stock threshold).
    - Retail & Wholesale prices in `TND`.
  - **Multi-size Family Popup:** Clicking a product family opens a clean modal to select the desired size (e.g., `1L`, `1.5L`, `2L`).
  - **Quick-Add Item Button:** One-click modal to ring up an uncataloged ad-hoc item (Name + Price in TND) without leaving POS.
- **Right Column (Persistent Cart & Checkout Terminal — 40% Width):**
  - **Customer Header:** Dropdown to select customer (or `Walk-in Retail`). Displays customer type (`Reseller (10% off)`, `Wholesale`, `Retail`), current debt tickets balance, and wallet balance.
  - **Cart Item Rows:**
    - Item name & size.
    - Pack multiplier dropdown (e.g. `1 pc`, `Pack of 6`, `Box of 12`).
    - Unit price in TND (auto-discounted for resellers, editable for custom discount).
    - Quantity stepper (`-` / `+`) with direct keyboard entry.
    - Line total in TND with delete button.
  - **Totals & Taxes Box:**
    - Subtotal HT (Before tax).
    - Flat 19% TVA amount.
    - Total TTC in prominent bold font (e.g., **`48.500 DT`**).
  - **Checkout Action Panel:**
    - Quick-cash buttons (`10 DT`, `20 DT`, `50 DT`, `Exact Cash`).
    - Split payment inputs: Cash, Wallet (if balance available), Credit (open ticket).
    - Real-time **Change Due** display in green.
    - Prominent **[Complete Sale & Pop Drawer]** button (Enter key shortcut).
    - Post-sale modal: `[Print 58mm Receipt]`, `[Print A4 Invoice]`, or `[Next Sale]`.
- **Desktop Backoffice Navigation:**
  - Accessible via top menu or sidebar:
    - **Catalog & Inventory:** Families, SKUs, pack multipliers, low stock alerts, Code-128 label printing.
    - **Raw Materials & Packaging:** Stock levels, purchase cost trends, latest suppliers.
    - **Formulations & Production:** Recipe builder, batch production wizard with automatic material deduction and unit costing.
    - **Customers & Balances:** Customer ledger, open debt tickets with overdue flags (>30 days), FIFO debt payment modal, wallet top-ups.
    - **Suppliers & Purchases:** Raw material & resale goods purchasing, supplier credit ledger.
    - **Containers:** Returnable container loans, shop stock of empty jerrycans/drums, give/return transactions.
    - **Register Sessions:** Full cash audit logs, cash in/out history, opening vs counted cash difference.
    - **Accounting:** Simple cash-flow ledger (Money In vs Money Out), stock valuation at cost, and automated daily backup manager.

---

### 2. Mobile Register UI (Android Phone & PWA Standalone Mode)

Designed specifically for one-handed operation on Android smartphones (360px–430px screens) while walking the shop aisles or operating a mobile register:

- **Top Header:**
  - Compact title with active register indicator and offline sync pill.
  - Bluetooth printer status icon (green when connected, tap to pair).
- **Fixed Bottom Navigation Bar (4 Dedicated Tabs):**
  1. **Register (POS Checkout):**
     - Single-column vertical scrollable product list with top horizontal category chips.
     - Search bar with instant filter.
     - **Floating Action Button (FAB):** Centered at the bottom with a prominent camera icon. Tapping it opens the full-screen camera barcode scanner with torch/flashlight toggle to scan products directly into the cart.
     - **Sticky Bottom Cart Summary Bar:** Displays `X items • Total: 34.500 DT` with an expand arrow.
     - **Pull-Up Bottom Sheet Cart:** Swiping or tapping the cart bar slides up a full-screen drawer showing cart items, customer picker, split payment options, cash tender, and the **[Complete Sale]** button.
  2. **Price Lookup Mode (Per Spec Section 4):**
     - Instantly activates the camera scanner or barcode search.
     - Scanning an item displays a clean full-screen inquiry card:
       - Large Product Name & Family.
       - Retail Price & Wholesale Price in TND.
       - Current Stock on Hand (with low-stock badge).
       - Returnable container requirement (if linked).
       - **Zero cart interaction** — pure instant verification for customer inquiries in the aisles.
  3. **Price & Stock Quick-Edit Mode (Per Spec Section 4):**
     - Scan any shelf barcode with the phone camera.
     - Opens a quick in-aisle editing card:
       - Direct number pad to adjust **Retail Price (TND)**.
       - Direct number pad to adjust **Wholesale Price (TND)**.
       - Quick stepper to update **Stock Quantity on Hand**.
       - One-tap `[Save & Update]` button that commits changes locally and queues for server sync.
     - Also used for **Catalog Entry** to assign barcodes to new products using the camera.
  4. **Customers & Debt Ledger:**
     - Search customer list with instant debt summary.
     - Tap a customer to view open debt tickets with overdue age indicators.
     - One-tap `[Record Payment]` button with FIFO oldest-first debt allocation.
     - One-tap `[Give / Return Containers]` action.
- **Mobile Hardware Execution:**
  - Direct pairing with mobile 58mm Bluetooth receipt printers via WebBluetooth API.
  - Camera scanner with automatic continuous barcode recognition and audible beep upon successful scan.

---

## Database Schema Design (SQLite)

```sql
-- 1. Configuration & Settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. Raw Materials & Packaging
CREATE TABLE raw_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- surfactant, fragrance, bottle, cap, label, etc.
    unit TEXT NOT NULL,     -- kg, pcs, L, etc.
    stock_quantity REAL NOT NULL DEFAULT 0,
    latest_supplier_id TEXT REFERENCES suppliers(id),
    latest_purchase_cost REAL NOT NULL DEFAULT 0, -- in TND (3 decimals)
    low_stock_threshold REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE material_price_history (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES raw_materials(id),
    supplier_id TEXT REFERENCES suppliers(id),
    cost_per_unit REAL NOT NULL,
    date TEXT NOT NULL,
    purchase_id TEXT REFERENCES purchases(id)
);

-- 3. Formulations & Recipes
CREATE TABLE formulations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT,
    base_yield_quantity REAL NOT NULL DEFAULT 1,
    base_yield_unit TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE formulation_items (
    id TEXT PRIMARY KEY,
    formulation_id TEXT NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES raw_materials(id),
    quantity_required REAL NOT NULL
);

-- 4. Product Families & SKUs (Liquid/Weight sizes)
CREATE TABLE product_families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- Detergents, Air Fresheners, Resale, etc.
    type TEXT NOT NULL CHECK (type IN ('MANUFACTURED', 'RESALE')),
    formulation_id TEXT REFERENCES formulations(id),
    image_url TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE products (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- e.g. "Dish Soap Lemon 1L"
    size_label TEXT,    -- e.g. "1L", "5L", "Piece"
    barcode TEXT UNIQUE, -- Code-128
    stock_quantity REAL NOT NULL DEFAULT 0,
    low_stock_threshold REAL NOT NULL DEFAULT 5,
    cost_reference REAL NOT NULL DEFAULT 0, -- auto-suggested, read-only (in TND)
    retail_price REAL NOT NULL DEFAULT 0,   -- in TND (3 decimals)
    wholesale_price REAL NOT NULL DEFAULT 0, -- in TND (3 decimals)
    container_type_id TEXT REFERENCES container_types(id),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Pack Size Multipliers
CREATE TABLE product_pack_sizes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    pack_label TEXT NOT NULL, -- e.g. "Box of 12", "Pack of 6"
    multiplier INTEGER NOT NULL, -- e.g. 12
    price_override REAL,         -- optional custom price in TND
    barcode TEXT UNIQUE          -- Code-128
);

-- 5. Production Batches
CREATE TABLE production_batches (
    id TEXT PRIMARY KEY,
    batch_number TEXT UNIQUE NOT NULL,
    date TEXT NOT NULL,
    formulation_id TEXT NOT NULL REFERENCES formulations(id),
    target_product_id TEXT NOT NULL REFERENCES products(id),
    units_produced REAL NOT NULL,
    total_batch_cost REAL NOT NULL,
    cost_per_unit REAL NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE production_batch_materials_consumed (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES raw_materials(id),
    quantity_consumed REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_cost REAL NOT NULL
);

-- 6. Customers, Tickets, and Wallet
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    type TEXT NOT NULL CHECK (type IN ('RETAIL', 'WHOLESALE', 'RESELLER')),
    reseller_discount_percent REAL NOT NULL DEFAULT 0,
    wallet_balance REAL NOT NULL DEFAULT 0, -- in TND (3 decimals)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE customer_debt_tickets (
    id TEXT PRIMARY KEY,
    ticket_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    sale_id TEXT REFERENCES sales(id),
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE customer_payments (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL, -- Cash, Bank, etc.
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE customer_payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    ticket_id TEXT NOT NULL REFERENCES customer_debt_tickets(id),
    amount_allocated REAL NOT NULL
);

CREATE TABLE customer_wallet_transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('TOP_UP', 'SALE_PAYMENT', 'REFUND_CREDIT', 'OVERPAYMENT_DEPOSIT')),
    amount REAL NOT NULL,
    reference_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

-- 7. Suppliers & Purchases
CREATE TABLE suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE purchases (
    id TEXT PRIMARY KEY,
    purchase_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID', 'CREDIT')),
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE purchase_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('RAW_MATERIAL', 'RESALE_PRODUCT')),
    material_id TEXT REFERENCES raw_materials(id),
    product_id TEXT REFERENCES products(id),
    quantity REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_cost REAL NOT NULL
);

-- Supplier Debt Ledger (mirrors customer_debt_tickets / customer_payments)
CREATE TABLE supplier_debt_tickets (
    id TEXT PRIMARY KEY,
    ticket_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    purchase_id TEXT REFERENCES purchases(id),
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
-- Created automatically whenever a purchase's payment_status = 'CREDIT'
-- (total_amount = purchases.total_amount, remaining_amount starts equal to total_amount)

CREATE TABLE supplier_payments (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL, -- Cash, Bank, etc.
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE supplier_payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    ticket_id TEXT NOT NULL REFERENCES supplier_debt_tickets(id),
    amount_allocated REAL NOT NULL
);
-- Same FIFO oldest-first allocation logic as customer_payment_allocations

-- 8. Returnable Containers
CREATE TABLE container_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, -- "10L Jerrycan", "20L Jerrycan", "200L Drum"
    capacity_liters REAL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE customer_container_loans (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    container_type_id TEXT NOT NULL REFERENCES container_types(id),
    quantity_owed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(customer_id, container_type_id)
);

CREATE TABLE container_transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    container_type_id TEXT NOT NULL REFERENCES container_types(id),
    action TEXT NOT NULL CHECK (action IN ('GIVE', 'RETURN')),
    quantity INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
);

-- 9. Register Sessions & Cash Tracking
CREATE TABLE register_sessions (
    id TEXT PRIMARY KEY,
    session_number TEXT UNIQUE NOT NULL,
    counter_name TEXT NOT NULL, -- "Counter 1", "Mobile", etc.
    opened_at TEXT NOT NULL,
    opening_cash REAL NOT NULL,
    closed_at TEXT,
    counted_cash REAL,
    expected_cash REAL,
    difference REAL,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    notes TEXT
);

CREATE TABLE register_cash_movements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES register_sessions(id),
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('CASH_IN', 'CASH_OUT')),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 10. Sales, Cart Items & Split Payments
CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    receipt_number TEXT UNIQUE NOT NULL,
    session_id TEXT REFERENCES register_sessions(id),
    date TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    subtotal_ht REAL NOT NULL,
    tva_rate REAL NOT NULL DEFAULT 0.19,
    tva_amount REAL NOT NULL,
    total_ttc REAL NOT NULL,
    total_discount REAL NOT NULL DEFAULT 0,
    cash_paid REAL NOT NULL DEFAULT 0,
    wallet_paid REAL NOT NULL DEFAULT 0,
    credit_amount REAL NOT NULL DEFAULT 0,
    change_given REAL NOT NULL DEFAULT 0,
    -- COMPLETED: nothing refunded. PARTIALLY_REFUNDED: some line items refunded.
    -- FULLY_REFUNDED: every line item refunded (derived from sale_items, not set directly).
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED')),
    synced_from_client_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    is_quick_add INTEGER NOT NULL DEFAULT 0,
    quick_add_name TEXT,
    pack_size_id TEXT REFERENCES product_pack_sizes(id),
    pack_multiplier INTEGER NOT NULL DEFAULT 1,
    quantity REAL NOT NULL,
    quantity_refunded REAL NOT NULL DEFAULT 0, -- supports partial-quantity refund on one line
    base_stock_deducted REAL NOT NULL,
    unit_price REAL NOT NULL,
    discount_amount REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL
);

-- One row per refund action; a sale can have several refunds over time
CREATE TABLE refunds (
    id TEXT PRIMARY KEY,
    refund_number TEXT UNIQUE NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    date TEXT NOT NULL,
    total_refunded REAL NOT NULL, -- TTC amount reversed
    -- How the refunded amount was returned to the customer
    cash_refunded REAL NOT NULL DEFAULT 0,
    wallet_refunded REAL NOT NULL DEFAULT 0,
    credit_reduced REAL NOT NULL DEFAULT 0, -- reduces an open debt ticket instead of paying out
    reason TEXT,
    session_id TEXT REFERENCES register_sessions(id), -- which counter processed it (for cash accounting)
    created_at TEXT NOT NULL
);

CREATE TABLE refund_items (
    id TEXT PRIMARY KEY,
    refund_id TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
    quantity_refunded REAL NOT NULL, -- adds back to product stock on save
    amount_refunded REAL NOT NULL
);

-- 11. Inventory Adjustments
CREATE TABLE inventory_adjustments (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('RAW_MATERIAL', 'PRODUCT')),
    material_id TEXT REFERENCES raw_materials(id),
    product_id TEXT REFERENCES products(id),
    quantity_delta REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 12. Accounting & Cashflow Ledger
CREATE TABLE general_expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_source TEXT NOT NULL,
    session_id TEXT REFERENCES register_sessions(id),
    description TEXT,
    created_at TEXT NOT NULL
);
```

---

## Component Architecture & Directory Structure

```
/home/admin/VibeCoding/ERP/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── public/
│   ├── manifest.json          # PWA Manifest for Android & Linux install
│   ├── icon-192.png
│   ├── icon-512.png
│   └── al-jazira-erp.desktop  # Linux desktop application launcher
├── server/
│   ├── index.ts               # Express API entry point + static frontend host
│   ├── db/
│   │   ├── index.ts           # SQLite connection with better-sqlite3 + WAL
│   │   ├── schema.sql         # Full SQLite schema
│   │   └── backup.ts          # Automated daily database backup routine
│   ├── routes/
│   │   ├── auth.ts            # PIN / master session unlock
│   │   ├── products.ts        # Products, sizes, pack multipliers, pricing, Code-128 barcodes
│   │   ├── materials.ts       # Raw materials, packaging, purchase price history
│   │   ├── formulations.ts    # Recipes & auto-cost calculations
│   │   ├── production.ts      # Production batches, stock deduction, unit cost
│   │   ├── customers.ts       # Customers, balances, FIFO ticket payments, wallet
│   │   ├── suppliers.ts       # Suppliers, credit purchases, supplier debt tickets, FIFO payments
│   │   ├── sales.ts           # POS checkout, receipts, line-item partial refunds
│   │   ├── register.ts        # Register open/close, cash in/out, session audits
│   │   ├── containers.ts      # Returnable container loan records & stock
│   │   ├── accounting.ts      # Cash flow ledger & stock valuation
│   │   ├── hardware.ts        # Hardware API (/dev/ttyUSB0 serial drawer & libusb H313 printer)
│   │   └── sync.ts            # Offline sync queue endpoint (POST /api/sync)
│   └── services/
│       ├── costingService.ts  # Formulation & batch cost calculation
│       ├── debtService.ts     # Oldest-first FIFO ticket allocation (customer debt + supplier debt)
│       └── backupService.ts   # Scheduled daily vacuum backup routine
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── db/
│   │   └── clientDb.ts        # Dexie.js (IndexedDB) schema & local tables
│   ├── hooks/
│   │   ├── useIsMobile.ts     # Responsive viewport & touch capability detection
│   │   ├── useCart.ts         # Shared reactive cart engine
│   │   └── useSync.ts         # Sync manager state hook
│   ├── services/
│   │   ├── syncManager.ts     # Offline outbox sync worker & event listener
│   │   └── hardware/
│   │       ├── scanner.ts     # Global keyboard-wedge scanner listener
│   │       ├── escpos.ts      # 58mm ESC/POS command builder (drawer kick, formatted receipt)
│   │       ├── hardwareDrivers.ts # Unified hardware client driver (/dev/ttyUSB0 kick & libusb print)
│   │       ├── webusb.ts      # WebUSB direct driver for Linux USB printer
│   │       ├── webbluetooth.ts # WebBluetooth direct driver for Android Bluetooth printer
│   │       └── barcode.ts     # Code-128 generator (JsBarcode wrapper)
│   ├── components/
│   │   ├── shared/
│   │   │   ├── Header.tsx     # Common status bar (session, sync badge, drawer pop)
│   │   │   ├── QuickAddModal.tsx # Ad-hoc uncataloged item dialog
│   │   │   ├── CheckoutModal.tsx # Shared split payment dialog (Cash, Wallet, Credit)
│   │   │   ├── RefundModal.tsx   # Pick line items + quantity to refund, choose payout method
│   │   │   ├── ReceiptPrint.tsx  # 58mm thermal receipt preview
│   │   │   ├── InvoicePrint.tsx  # A4 formal invoice print preview
│   │   │   └── CameraScannerModal.tsx # Embedded camera barcode viewfinder
│   │   ├── desktop/
│   │   │   ├── DesktopLayout.tsx # Widescreen countertop layout with side navigation
│   │   │   ├── DesktopPos.tsx    # 2-column POS: Left product grid, Right cart + numpad
│   │   │   ├── DesktopProductGrid.tsx # Categorized cards with size selection modal
│   │   │   └── DesktopCartPanel.tsx   # Item rows, pack dropdowns, tender calculator
│   │   ├── mobile/
│   │   │   ├── MobileLayout.tsx  # Mobile view with sticky header & bottom nav bar
│   │   │   ├── MobileRegister.tsx# Single-column feed + FAB scan button + bottom sheet cart
│   │   │   ├── MobileBottomSheetCart.tsx # Slide-up checkout drawer
│   │   │   ├── MobilePriceLookup.tsx # Instant camera price/stock check
│   │   │   └── MobilePriceStockEdit.tsx # In-aisle price & stock quick editor
│   │   ├── backoffice/
│   │   │   ├── ProductCatalog.tsx # Product families, SKUs, pack multipliers
│   │   │   ├── RawMaterialsList.tsx # Raw materials, packaging, price trend chart
│   │   │   ├── FormulationEditor.tsx # Recipe builder & cost preview
│   │   │   ├── BatchProductionModal.tsx # Batch execution & auto material deduction
│   │   │   ├── CustomerLedger.tsx # Customer list, open tickets, FIFO payment popup
│   │   │   ├── SupplierLedger.tsx # Supplier list, open debt tickets, FIFO payment popup
│   │   │   ├── ContainerManager.tsx # Container loans, shop stock, give/return modal
│   │   │   ├── RegisterAuditView.tsx # Session open/close audits, cash in/out
│   │   │   ├── AccountingDashboard.tsx # Cash-flow ledger & stock valuation
│   │   │   ├── BarcodeLabelPrinter.tsx # Code-128 printable sticker sheets
│   │   │   └── BackupManager.tsx  # Manual backup trigger & snapshot list
│   └── styles/
│       └── print.css          # 58mm thermal receipt & A4 invoice print CSS
└── backups/                   # Automated daily SQLite snapshots
```

---

## Verification Plan

### Automated Tests
1. **Financial & Costing Unit Tests (`npm test`):**
   - **TND 3-decimal calculations:** Verify that tax calculations ($\text{Subtotal} = \text{Total} / 1.19$, $\text{TVA} = \text{Total} - \text{Subtotal}$) round cleanly to 3 decimals without floating-point drift.
   - **FIFO Debt Repayment:** Test paying 25.000 DT against three tickets (10.000 DT, 10.000 DT, 10.000 DT) -> tickets 1 & 2 marked `PAID`, ticket 3 marked `PARTIALLY_PAID` with 5.000 DT remaining. Test overpayment depositing into wallet.
   - **Pack Multipliers:** Selling 2 packs of a 12-pack deducts exactly 24 units from the base SKU stock.
   - **Production Batch Costing:** Consuming 50L bulk material + 50 bottles + 50 caps + 50 labels correctly calculates unit production cost and updates product `cost_reference`.
   - **Register Session Cash:** Opening float + cash sales + cash in - cash out matches expected cash to the millime.
   - **Supplier FIFO Debt Repayment:** Same test pattern as customer FIFO, applied to `supplier_debt_tickets` — paying a supplier partially settles their oldest open ticket first.
   - **Partial Refund:** Refunding 1 of 3 units on a sale line reduces `sale_items.quantity_refunded`, adds 1 unit back to product stock, marks the sale `PARTIALLY_REFUNDED` (not `FULLY_REFUNDED`), and reverses only that portion of TVA/subtotal.
2. **Offline Sync Integration Tests:**
   - Simulate offline sale in IndexedDB, trigger sync to `/api/sync/sales`, verify server persists receipt and stock update cleanly.

### Manual Verification
1. **Desktop Countertop Flow:** Test widescreen 2-column layout, USB barcode wedge rapid scan, on-screen numpad, split tender, 58mm receipt preview, and A4 invoice preview.
2. **Mobile Register Flow:** Test mobile bottom navigation, floating camera scan button, pull-up bottom sheet cart, standalone **Price Lookup mode**, and **Price/Stock Quick-Update mode**.
3. **Hardware Connectivity:** Test WebUSB printer connection on Linux and WebBluetooth printer discovery on Android.
4. **Linux App Launcher:** Verify standalone window mode (`chromium --app=...`) and `.desktop` launcher.
5. **Offline PWA:** Disconnect network in browser DevTools ("Offline" mode), perform sales, reconnect network, verify automatic sync and inventory update.
6. **Automated Daily Backup:** Trigger manual backup and verify valid `.sqlite` snapshot.
7. **Supplier Credit Purchase:** Log a purchase as `CREDIT`, verify a `supplier_debt_tickets` row is created; make two partial payments and verify FIFO allocation across tickets, matching the customer-side flow.
8. **Partial Refund Flow:** From a completed sale, refund a single line item at partial quantity; verify stock is restored, the payout method (cash/wallet/credit-reduction) is chosen correctly, and the sale's status reflects a partial (not full) refund.
