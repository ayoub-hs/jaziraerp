import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from '../server/db/index.js';
import app from '../server/index.js';
import request from 'supertest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resets the shared test database by dropping all tables and re-applying schema.sql.
 * Ensures an isolated, pristine state for every test case.
 */
export function resetTestDb(): DatabaseType {
  const db = getDb();
  db.pragma('foreign_keys = OFF');

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const table of tables) {
    db.prepare(`DROP TABLE IF EXISTS "${table.name}"`).run();
  }

  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, '../server/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  return db;
}

export { app, request, getDb };
