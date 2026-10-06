import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('DB boot reconciliation of duplicate OPEN sessions', () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
    tmpFiles.length = 0;
  });

  it('boots a DB with two OPEN sessions on one counter into one OPEN session plus the index', () => {
    const tmp = path.join(os.tmpdir(), `erp-boot-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    tmpFiles.push(tmp);

    // Seed a legacy DB: raw schema (no partial index) + two OPEN same-counter sessions.
    const seed = new Database(tmp);
    seed.pragma('journal_mode = WAL');
    seed.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const insert = seed.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, status, notes)
      VALUES (?, ?, ?, ?, ?, 'OPEN', '')
    `);
    insert.run('old-open', 'SES-OLD', 'Countertop', '2026-01-01T08:00:00.000Z', 100);
    insert.run('new-open', 'SES-NEW', 'Countertop', '2026-01-02T08:00:00.000Z', 50);
    seed.close();

    // Boot: runs init (dedupe in tx + guarded partial index creation).
    const db = getDb(tmp);

    const openRows: any[] = db
      .prepare("SELECT id FROM register_sessions WHERE counter_name = ? AND status = 'OPEN'")
      .all('Countertop');
    expect(openRows.map(r => r.id)).toEqual(['new-open']);

    const closed: any = db.prepare('SELECT status, notes FROM register_sessions WHERE id = ?').get('old-open');
    expect(closed.status).toBe('CLOSED');
    expect(closed.notes).toBe('auto-closed duplicate');

    const idx: any = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_one_open_session_per_counter'")
      .get();
    expect(idx?.name).toBe('idx_one_open_session_per_counter');

    db.close();
  });
});
