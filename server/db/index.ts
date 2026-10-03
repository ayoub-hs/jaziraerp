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

export default getDb;
