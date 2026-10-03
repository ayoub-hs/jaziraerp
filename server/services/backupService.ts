import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
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
   * Restores database from a specified backup file in backups/ or base64 data.
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
      // Validate that source is a valid SQLite database
      const testDb = new Database(sourcePath, { readonly: true });
      const testTables = testDb.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table'").get() as any;
      testDb.close();
      if (!testTables || testTables.cnt === 0) {
        throw new Error('Provided file is not a valid SQLite database or contains no tables.');
      }

      // Close current db connection
      closeDb();

      // Ensure data directory exists
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Copy source to dbPath
      fs.copyFileSync(sourcePath, dbPath);

      // Clean up wal and shm files if they exist
      if (fs.existsSync(`${dbPath}-wal`)) {
        try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
      }
      if (fs.existsSync(`${dbPath}-shm`)) {
        try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
      }

      // Re-open DB
      getDb();

      return { success: true, message: 'Database restored successfully' };
    } finally {
      if (tempCreated && fs.existsSync(sourcePath)) {
        try { fs.unlinkSync(sourcePath); } catch {}
      }
    }
  }

  /**
   * Starts daily automated backup schedule (runs every 24 hours).
   */
  public startDailySchedule(): void {
    if (this.timer) return;
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
