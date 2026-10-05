import fs from 'fs';
import path from 'path';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { getDb, closeDb } from '../db/index.js';

export interface BackupMetadata {
  filename: string;
  size_bytes: number;
  created_at: string;
}

export class BackupService {
  private backupDir: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(backupDir?: string) {
    this.backupDir = backupDir || path.join(process.cwd(), 'backups');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Creates an online SQLite database snapshot using SQLite backup API.
   */
  public async createBackup(): Promise<BackupMetadata> {
    this.ensureDir();
    const db = getDb();

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const filename = `backup-${timestamp}.sqlite`;
    const destPath = path.join(this.backupDir, filename);

    // Use better-sqlite3 online backup API
    if (typeof (db as any).backup === 'function') {
      await (db as any).backup(destPath);
    } else {
      // Fallback to VACUUM INTO
      db.prepare(`VACUUM INTO ?`).run(destPath);
    }

    const stat = fs.statSync(destPath);

    // Prune backups older than 30 days
    this.pruneOldBackups(30);

    return {
      filename,
      size_bytes: stat.size,
      created_at: stat.mtime.toISOString()
    };
  }

  /**
   * Lists all existing backup files sorted by creation date (newest first).
   */
  public listBackups(): BackupMetadata[] {
    this.ensureDir();
    const files = fs.readdirSync(this.backupDir);
    const backups: BackupMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith('.sqlite')) continue;
      try {
        const filePath = path.join(this.backupDir, file);
        const stat = fs.statSync(filePath);
        backups.push({
          filename: file,
          size_bytes: stat.size,
          created_at: stat.mtime.toISOString()
        });
      } catch {
        // Ignore unreadable or deleted files
      }
    }

    return backups.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * Deletes backups older than maxAgeDays (default 30 days).
   */
  public pruneOldBackups(maxAgeDays: number = 30): number {
    this.ensureDir();
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(this.backupDir);
    let prunedCount = 0;

    for (const file of files) {
      if (!file.endsWith('.sqlite')) continue;
      const filePath = path.join(this.backupDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          prunedCount++;
        }
      } catch {
        // Ignore
      }
    }

    return prunedCount;
  }

  /**
   * Gets absolute file path for a given backup filename (with directory traversal guard).
   */
  public getBackupFilePath(filename: string): string | null {
    const safeName = path.basename(filename);
    const filePath = path.join(this.backupDir, safeName);
    if (fs.existsSync(filePath) && safeName.endsWith('.sqlite')) {
      return filePath;
    }
    return null;
  }

  /**
   * Core business tables a restore file must contain. Deliberately NOT the full
   * schema: older backups missing newer tables/columns still restore — the app's
   * normal schema init (CREATE TABLE IF NOT EXISTS + column migrations in
   * server/db/index.ts, run on every getDb() incl. startup and post-restore
   * reopen) recreates whatever is missing.
   */
  public static readonly CORE_RESTORE_TABLES = [
    'settings',
    'product_families',
    'products',
    'customers',
    'register_sessions',
    'sales',
    'sale_items'
  ];

  /**
   * Table names the app expects, derived from server/db/schema.sql.
   * Informational: validation only enforces CORE_RESTORE_TABLES so that older
   * backups (missing newer tables/columns) still restore cleanly.
   */
  public getRequiredTables(): string[] {
    const schemaPath = path.join(process.cwd(), 'server/db/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const names: string[] = [];
    const re = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+["']?(\w+)["']?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      names.push(m[1]);
    }
    return names;
  }

  /**
   * Validates an uploaded/SQLite file before it may replace the live DB:
   * (a) PRAGMA integrity_check + foreign_key_check,
   * (b) contains every table the app expects.
   * Throws with a clear message on any failure. Live DB untouched.
   */
  public validateRestoreFile(sourcePath: string): void {
    let checkDb: DatabaseType | null = null;
    try {
      checkDb = new Database(sourcePath, { readonly: true });
    } catch (err: any) {
      throw new Error(`Restore rejected: file is not a readable SQLite database (${err?.message || err})`);
    }
    try {
      let integrity: any[];
      try {
        integrity = checkDb.prepare('PRAGMA integrity_check').all() as any[];
      } catch (err: any) {
        throw new Error(`Restore rejected: integrity check could not run (${err?.message || err})`);
      }
      const bad = integrity.filter(r => String(r?.integrity_check ?? r).toLowerCase() !== 'ok');
      if (bad.length > 0) {
        throw new Error(`Restore rejected: PRAGMA integrity_check failed (${JSON.stringify(bad.slice(0, 3))})`);
      }

      const fkViolations = checkDb.prepare('PRAGMA foreign_key_check').all() as any[];
      if (fkViolations.length > 0) {
        throw new Error(`Restore rejected: PRAGMA foreign_key_check found ${fkViolations.length} violation(s)`);
      }

      const existing = new Set(
        (checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name)
      );
      const missing = BackupService.CORE_RESTORE_TABLES.filter(t => !existing.has(t));
      if (missing.length > 0) {
        throw new Error(`Restore rejected: missing required table(s): ${missing.join(', ')}`);
      }
    } finally {
      try { checkDb.close(); } catch {}
    }
  }

  /**
   * Restores database from a specified backup file in backups/ or base64 data.
   * Hardened: validate first, snapshot current DB to backups/pre-restore-<ts>.sqlite,
   * then swap atomically (temp file + rename). On any failure the live DB is kept.
   */
  public async restoreBackup(source: { filename?: string; fileData?: string }): Promise<{ success: boolean; message: string }> {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data/erp.sqlite');
    let sourcePath = '';
    let tempCreated = false;

    if (source.filename) {
      const found = this.getBackupFilePath(source.filename);
      if (!found) {
        throw new Error(`Backup file "${source.filename}" not found in backups directory.`);
      }
      sourcePath = found;
    } else if (source.fileData) {
      this.ensureDir();
      const tempPath = path.join(this.backupDir, `restore-temp-${Date.now()}.sqlite`);
      const buffer = Buffer.from(source.fileData, 'base64');
      fs.writeFileSync(tempPath, buffer);
      sourcePath = tempPath;
      tempCreated = true;
    } else {
      throw new Error('Either filename or fileData (base64) must be provided');
    }

    try {
      // 1. Validate BEFORE touching the live DB (integrity, FK, required tables)
      this.validateRestoreFile(sourcePath);

      // 2. Safety snapshot of the current DB into backups/
      this.ensureDir();
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const snapshotPath = path.join(this.backupDir, `pre-restore-${stamp}.sqlite`);
      try {
        const live = getDb();
        if (typeof (live as any).backup === 'function') {
          await (live as any).backup(snapshotPath);
        } else if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, snapshotPath);
        }
      } catch (snapErr: any) {
        throw new Error(`Restore aborted: could not snapshot current database (${snapErr?.message || snapErr})`);
      }

      // Ensure data directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 3. Atomic swap: stage next to the live file, close, rename, clean WAL/SHM, reopen
      const stagePath = `${dbPath}.restore-${Date.now()}.tmp`;
      fs.copyFileSync(sourcePath, stagePath);
      closeDb();
      try {
        fs.renameSync(stagePath, dbPath);
      } catch (swapErr: any) {
        try { if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath); } catch {}
        getDb();
        throw new Error(`Restore failed during swap, current database kept (${swapErr?.message || swapErr})`);
      }

      // Clean up wal and shm files if they exist
      if (fs.existsSync(`${dbPath}-wal`)) {
        try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
      }
      if (fs.existsSync(`${dbPath}-shm`)) {
        try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
      }

      // Re-open DB. getDb() runs the normal schema init (CREATE TABLE IF NOT
      // EXISTS + column migrations), so older backups missing newer tables or
      // columns (e.g. register_cash_movements.expense_id) are migrated here —
      // the same init also runs on every server startup.
      getDb();

      return { success: true, message: 'Database restored successfully' };
    } finally {
      if (tempCreated && fs.existsSync(sourcePath)) {
        try { fs.unlinkSync(sourcePath); } catch {}
      }
    }
  }

  /**
   * Checks whether the newest backup is older than 24 hours (or none exists)
   * and runs an initial backup snapshot immediately if needed.
   */
  public async checkAndRunInitialBackup(): Promise<boolean> {
    try {
      const backups = this.listBackups();
      const newest = backups[0];
      const nowMs = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      const isOlderThan24h = !newest || (nowMs - new Date(newest.created_at).getTime()) > oneDayMs;
      if (isOlderThan24h) {
        console.log('[BackupService] Newest backup is older than 24h (or none exists). Running startup backup...');
        const res = await this.createBackup();
        console.log(`[BackupService] Startup backup completed: ${res.filename} (${res.size_bytes} bytes)`);
        return true;
      }
      return false;
    } catch (err) {
      console.error('[BackupService] Startup backup check failed:', err);
      return false;
    }
  }

  /**
   * Starts daily automated backup schedule (runs startup check, then every 24 hours).
   */
  public startDailySchedule(): void {
    if (this.timer) return;
    this.checkAndRunInitialBackup().catch(() => {});

    const intervalMs = 24 * 60 * 60 * 1000; // 24 hours
    this.timer = setInterval(async () => {
      try {
        console.log('[BackupService] Running scheduled daily automated backup...');
        const res = await this.createBackup();
        console.log(`[BackupService] Daily backup completed: ${res.filename} (${res.size_bytes} bytes)`);
      } catch (err) {
        console.error('[BackupService] Daily automated backup failed:', err);
      }
    }, intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  public stopSchedule(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const backupService = new BackupService();
