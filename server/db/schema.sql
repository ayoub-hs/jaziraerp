-- ==========================================================
-- Al Jazira SHSP ERP — Complete SQLite Database Schema
-- ==========================================================

-- 1. Configuration & Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('shop_name', 'Société Al Jazira SHSP'),
    ('shop_address', 'Route de Gabès Km 3.5, Sfax, Tunisie'),
    ('shop_phone', '+216 74 000 000'),
    ('tax_id', '1234567/A/M/000');

-- 2. Raw Materials & Packaging
CREATE TABLE IF NOT EXISTS raw_materials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL, -- surfactant, fragrance, bottle, cap, label, etc.
    unit TEXT NOT NULL,     -- kg, pcs, L, etc.
    stock_quantity REAL NOT NULL DEFAULT 0,
    latest_supplier_id TEXT REFERENCES suppliers(id),
    latest_purchase_cost REAL NOT NULL DEFAULT 0, -- in TND (3 decimals)
    low_stock_threshold REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS material_price_history (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
    supplier_id TEXT REFERENCES suppliers(id),
    cost_per_unit REAL NOT NULL,
    date TEXT NOT NULL,
    purchase_id TEXT REFERENCES purchases(id)
);

-- 3. Formulations & Recipes
CREATE TABLE IF NOT EXISTS formulations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    notes TEXT,
    base_yield_quantity REAL NOT NULL DEFAULT 1,
    base_yield_unit TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS formulation_items (
    id TEXT PRIMARY KEY,
    formulation_id TEXT NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES raw_materials(id),
    quantity_required REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'PRODUCT', -- 'PRODUCT', 'MATERIAL', 'BOTH'
    created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO categories (id, name, type, created_at)
VALUES 
    ('cat-detergents', 'Detergents', 'PRODUCT', '2026-01-01T00:00:00.000Z'),
    ('cat-hygiene', 'Hygiene', 'PRODUCT', '2026-01-01T00:00:00.000Z'),
    ('cat-auto', 'Auto', 'PRODUCT', '2026-01-01T00:00:00.000Z'),
    ('cat-resale-goods', 'Resale Goods', 'PRODUCT', '2026-01-01T00:00:00.000Z');

-- 4. Product Families & SKUs (Liquid/Weight sizes)
CREATE TABLE IF NOT EXISTS product_families (
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

CREATE TABLE IF NOT EXISTS products (
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
CREATE TABLE IF NOT EXISTS product_pack_sizes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    pack_label TEXT NOT NULL, -- e.g. "Box of 12", "Pack of 6"
    multiplier INTEGER NOT NULL, -- e.g. 12
    price_override REAL,         -- optional custom price in TND
    barcode TEXT UNIQUE          -- Code-128
);

-- 5. Production Batches
CREATE TABLE IF NOT EXISTS production_batches (
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

CREATE TABLE IF NOT EXISTS production_batch_materials_consumed (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES raw_materials(id),
    quantity_consumed REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_cost REAL NOT NULL
);

-- 6. Customers, Tickets, and Wallet
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    type TEXT NOT NULL CHECK (type IN ('RETAIL', 'WHOLESALE', 'RESELLER')),
    reseller_discount_percent REAL NOT NULL DEFAULT 0,
    wallet_balance REAL NOT NULL DEFAULT 0, -- in TND (3 decimals)
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_debt_tickets (
    id TEXT PRIMARY KEY,
    ticket_number TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_payments (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL, -- Cash, Bank, etc.
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    ticket_id TEXT NOT NULL REFERENCES customer_debt_tickets(id) ON DELETE CASCADE,
    amount_allocated REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('TOP_UP', 'SALE_PAYMENT', 'REFUND_CREDIT', 'OVERPAYMENT_DEPOSIT')),
    amount REAL NOT NULL,
    reference_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL
);

-- 7. Suppliers & Purchases
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    purchase_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID', 'CREDIT')),
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
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
CREATE TABLE IF NOT EXISTS supplier_debt_tickets (
    id TEXT PRIMARY KEY,
    ticket_number TEXT UNIQUE NOT NULL,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    total_amount REAL NOT NULL,
    remaining_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT NOT NULL, -- Cash, Bank, etc.
    notes TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    ticket_id TEXT NOT NULL REFERENCES supplier_debt_tickets(id) ON DELETE CASCADE,
    amount_allocated REAL NOT NULL
);

-- 8. Returnable Containers
CREATE TABLE IF NOT EXISTS container_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL, -- "10L Jerrycan", "20L Jerrycan", "200L Drum"
    capacity_liters REAL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_container_loans (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    container_type_id TEXT NOT NULL REFERENCES container_types(id) ON DELETE CASCADE,
    quantity_owed INTEGER NOT NULL DEFAULT 0,
    UNIQUE(customer_id, container_type_id)
);

CREATE TABLE IF NOT EXISTS container_transactions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    container_type_id TEXT NOT NULL REFERENCES container_types(id),
    action TEXT NOT NULL CHECK (action IN ('GIVE', 'RETURN')),
    quantity INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
);

-- 9. Register Sessions, Counters & Cash Tracking
CREATE TABLE IF NOT EXISTS counters (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO counters (id, name, is_active, created_at)
VALUES 
    ('counter-countertop', 'Countertop', 1, '2026-01-01T00:00:00.000Z'),
    ('counter-mobile', 'Mobile Register', 1, '2026-01-01T00:00:00.000Z');

CREATE TABLE IF NOT EXISTS register_sessions (
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

CREATE TABLE IF NOT EXISTS register_cash_movements (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES register_sessions(id) ON DELETE CASCADE,
    expense_id TEXT REFERENCES general_expenses(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('CASH_IN', 'CASH_OUT')),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 10. Sales, Cart Items & Split Payments
CREATE TABLE IF NOT EXISTS sales (
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
    status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED')),
    synced_from_client_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    is_quick_add INTEGER NOT NULL DEFAULT 0,
    quick_add_name TEXT,
    pack_size_id TEXT REFERENCES product_pack_sizes(id),
    pack_multiplier INTEGER NOT NULL DEFAULT 1,
    quantity REAL NOT NULL,
    quantity_refunded REAL NOT NULL DEFAULT 0,
    base_stock_deducted REAL NOT NULL,
    unit_price REAL NOT NULL,
    catalog_unit_price REAL,
    discount_amount REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    refund_number TEXT UNIQUE NOT NULL,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    total_refunded REAL NOT NULL,
    cash_refunded REAL NOT NULL DEFAULT 0,
    wallet_refunded REAL NOT NULL DEFAULT 0,
    credit_reduced REAL NOT NULL DEFAULT 0,
    reason TEXT,
    session_id TEXT REFERENCES register_sessions(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refund_items (
    id TEXT PRIMARY KEY,
    refund_id TEXT NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
    quantity_refunded REAL NOT NULL,
    amount_refunded REAL NOT NULL
);

-- 11. Inventory Adjustments
CREATE TABLE IF NOT EXISTS inventory_adjustments (
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
CREATE TABLE IF NOT EXISTS general_expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount REAL NOT NULL,
    payment_source TEXT NOT NULL, -- 'REGISTER_CASH', 'BANK_OTHER'
    session_id TEXT REFERENCES register_sessions(id),
    description TEXT,
    created_at TEXT NOT NULL
);

-- Indices for performance & fast lookups
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_family ON products(family_id);
CREATE INDEX IF NOT EXISTS idx_pack_sizes_barcode ON product_pack_sizes(barcode);
CREATE INDEX IF NOT EXISTS idx_customer_debt_customer ON customer_debt_tickets(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_debt_sale ON customer_debt_tickets(sale_id);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_supplier ON supplier_debt_tickets(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_debt_purchase ON supplier_debt_tickets(purchase_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales(session_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_batches_product ON production_batches(target_product_id);
CREATE INDEX IF NOT EXISTS idx_register_movements_session ON register_cash_movements(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_synced_client_id ON sales(synced_from_client_id) WHERE synced_from_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(date);
CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(date);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(date);
CREATE INDEX IF NOT EXISTS idx_refunds_date ON refunds(date);
