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
  ensureColumn('suppliers', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('container_types', 'active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('sale_items', 'catalog_unit_price', 'REAL');
  ensureColumn('register_cash_movements', 'expense_id', 'TEXT REFERENCES general_expenses(id) ON DELETE SET NULL');
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_register_movements_expense ON register_cash_movements(expense_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customer_payments_date ON customer_payments(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON supplier_payments(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_refunds_date ON refunds(date)');
  } catch {}

  try {
    const counterCount: any = db.prepare('SELECT COUNT(*) as count FROM counters').get();
    if (counterCount && counterCount.count === 0) {
      const now = new Date().toISOString();
      const insertCounter = db.prepare('INSERT OR IGNORE INTO counters (id, name, is_active, created_at) VALUES (?, ?, 1, ?)');
      insertCounter.run('counter-countertop', 'Countertop', now);
      insertCounter.run('counter-mobile', 'Mobile Register', now);
    }
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

export function cleanupOldSettings(db: DatabaseType): void {
  try {
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
  } catch {}
}

export default getDb;

