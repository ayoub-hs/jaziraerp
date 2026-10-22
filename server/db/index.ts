import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance: DatabaseType | null = null;

export function getDb(customPath?: string): DatabaseType {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || process.env.DATABASE_PATH || path.join(__dirname, '../../data/erp.sqlite');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode and foreign key constraints
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');

  // Execute schema initialization
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  // A PROCESSING idempotency row can only survive a crash: business writes and
  // the COMPLETED update share one transaction. Clear stale claims at boot.
  try {
    const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM processed_requests WHERE status = 'PROCESSING' AND created_at < ?")
      .run(staleCutoff);
  } catch {
    // Ignore if the table is missing during a partial upgrade.
  }

  // Clean up old placeholder settings
  cleanupOldSettings(db);

  // Auto-migrate active columns for existing databases
  const ensureColumn = (table: string, column: string, def: string) => {
    try {
      const cols: any[] = db.prepare(`PRAGMA table_info(${table})`).all();
      if (cols.length > 0 && !cols.some(c => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      }
    } catch {
      // Ignore if table doesn't exist
    }
  };
  ensureColumn('raw_materials', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('customers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('customers', 'credit_limit', 'REAL DEFAULT NULL');
  ensureColumn('suppliers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('container_types', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('sale_items', 'catalog_unit_price', 'REAL');
  ensureColumn('register_cash_movements', 'expense_id', 'TEXT REFERENCES general_expenses(id) ON DELETE SET NULL');
  ensureColumn('products', 'size_volume', 'REAL');
  ensureColumn('production_batches', 'batch_volume', 'REAL');
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_register_movements_expense ON register_cash_movements(expense_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_date ON refunds(date)');
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_processed (
        client_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS delivery_notes (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
        number TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_sale_id ON delivery_notes(sale_id);
      CREATE TABLE IF NOT EXISTS product_packaging_items (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        material_id TEXT NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
        quantity_per_unit REAL NOT NULL CHECK (quantity_per_unit > 0),
        UNIQUE (product_id, material_id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_packaging_items_prod ON product_packaging_items(product_id);
      CREATE TABLE IF NOT EXISTS delivery_zones (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        min_order_amount REAL NOT NULL DEFAULT 0.000 CHECK (min_order_amount >= 0),
        delivery_fee REAL NOT NULL DEFAULT 0.000 CHECK (delivery_fee >= 0),
        delivery_days TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS client_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT UNIQUE NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('RESELLER_PORTAL', 'PUBLIC_WEB', 'MANUAL_ENTRY')),
        customer_id TEXT REFERENCES customers(id) ON DELETE RESTRICT,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        delivery_zone_id TEXT NOT NULL REFERENCES delivery_zones(id),
        subtotal_ttc REAL NOT NULL CHECK (subtotal_ttc >= 0),
        delivery_fee REAL NOT NULL DEFAULT 0.000 CHECK (delivery_fee >= 0),
        total_ttc REAL NOT NULL CHECK (total_ttc >= 0),
        payment_preference TEXT NOT NULL CHECK (payment_preference IN ('CASH_ON_DELIVERY', 'CREDIT_ACCOUNT')),
        loan_containers_requested INTEGER NOT NULL DEFAULT 0 CHECK (loan_containers_requested >= 0),
        notes TEXT,
        status TEXT NOT NULL CHECK (status IN ('NEW', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
        cancellation_reason TEXT,
        sale_id TEXT UNIQUE REFERENCES sales(id) ON DELETE SET NULL,
        idempotency_key TEXT UNIQUE NOT NULL,
        access_token TEXT UNIQUE NOT NULL,
        delivered_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS client_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES client_orders(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id),
        pack_size_id TEXT REFERENCES product_pack_sizes(id),
        container_type_id TEXT REFERENCES container_types(id),
        ordered_quantity REAL NOT NULL CHECK (ordered_quantity > 0),
        delivered_quantity REAL CHECK (delivered_quantity IS NULL OR delivered_quantity >= 0),
        pack_multiplier INTEGER NOT NULL DEFAULT 1 CHECK (pack_multiplier >= 1),
        unit_price_ttc REAL NOT NULL CHECK (unit_price_ttc >= 0),
        catalog_unit_price_snapshot REAL,
        line_total_ttc REAL NOT NULL CHECK (line_total_ttc >= 0),
        notes TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_client_orders_status ON client_orders(status);
      CREATE INDEX IF NOT EXISTS idx_client_orders_customer ON client_orders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_client_order_items_order ON client_order_items(order_id);
    `);
    // One open session per counter, enforced at the DB level so concurrent
    // POST /api/register/open calls cannot both succeed (check-then-insert race).
    // Pre-existing duplicate OPENs (from before the index) are reconciled first:
    // keep the newest per counter, auto-close the rest.
    try {
      const dedupe = db.transaction(() => {
        const dupes: any[] = db.prepare(`
          SELECT id, counter_name FROM register_sessions
          WHERE status = 'OPEN'
          ORDER BY counter_name ASC, opened_at DESC, id DESC
        `).all();
        const seen = new Set<string>();
        const closeOne = db.prepare(`
          UPDATE register_sessions
          SET status = 'CLOSED', closed_at = ?, notes = 'auto-closed duplicate'
          WHERE id = ?
        `);
        const nowIso = new Date().toISOString();
        for (const row of dupes) {
          if (seen.has(row.counter_name)) {
            closeOne.run(nowIso, row.id);
          } else {
            seen.add(row.counter_name);
          }
        }
      });
      dedupe();
    } catch {}
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_counter ON register_sessions(counter_name) WHERE status = 'OPEN'");
  } catch {}

  try {
    const now = new Date().toISOString();
    const counterCount: any = db.prepare('SELECT COUNT(*) as count FROM counters').get();
    if (counterCount && counterCount.count === 0) {
      const insertCounter = db.prepare('INSERT OR IGNORE INTO counters (id, name, is_active, created_at) VALUES (?, ?, 1, ?)');
      insertCounter.run('counter-countertop', 'Countertop', now);
      insertCounter.run('counter-mobile', 'Mobile Register', now);
    }
    // Always ensure the dedicated 'Livraison' counter exists idempotently
    db.prepare("INSERT OR IGNORE INTO counters (id, name, is_active, created_at) VALUES ('counter-delivery', 'Livraison', 1, ?)").run(now);
  } catch {
    // Ignore if counters table not yet created
  }

  if (!customPath) {
    dbInstance = db;
  }

  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * True when err is a SQLite UNIQUE constraint violation (better-sqlite3).
 * Used to retry sequential-number inserts (receipt/ticket/batch numbers are
 * COUNT(*)+1 and can collide under concurrent duplicate submits).
 */
export function isUniqueViolation(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || msg.includes('UNIQUE constraint failed');
}

export function cleanupOldSettings(db: DatabaseType): void {
  try {
    const cleanedRow = db.prepare("SELECT value FROM settings WHERE key = 'cleaned_placeholder_defaults_v1'").get() as { value: string } | undefined;
    if (cleanedRow?.value === '1') {
      return;
    }

    const oldPlaceholders = [
      'Route de Gabès Km 3.5, Sfax, Tunisie',
      '+216 74 000 000',
      '1234567/A/M/000'
    ];
    const update = db.prepare("UPDATE settings SET value = '' WHERE value = ?");
    for (const ph of oldPlaceholders) {
      update.run(ph);
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('shop_subtitle', '')").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cleaned_placeholder_defaults_v1', '1')").run();
  } catch {}
}

export default getDb;

