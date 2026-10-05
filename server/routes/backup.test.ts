import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BackupService } from '../services/backupService.js';
import { resetTestDb, getDb } from '../../tests/testApp.js';

describe('Step 15: Backup Service & Snapshot Verification', () => {
  let tempBackupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tempBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-backups-'));
    service = new BackupService(tempBackupDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }
  });

  it('creates a valid, queryable SQLite snapshot file on demand', async () => {
    const backupMeta = await service.createBackup();
    expect(backupMeta.filename.startsWith('backup-')).toBe(true);
    expect(backupMeta.filename.endsWith('.sqlite')).toBe(true);
    expect(backupMeta.size_bytes).toBeGreaterThan(0);
    expect(backupMeta.created_at).toBeTruthy();

    const fullPath = path.join(tempBackupDir, backupMeta.filename);
    expect(fs.existsSync(fullPath)).toBe(true);

    // Verify the snapshot can be opened and queried as a valid SQLite DB
    const restoredDb: DatabaseType = new Database(fullPath, { readonly: true });
    const tables = restoredDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
    expect(tables.length).toBeGreaterThan(0);
    restoredDb.close();
  });

  it('lists existing backups in descending chronological order', async () => {
    // Create first backup
    const b1 = await service.createBackup();

    // Create a mock older backup
    const olderFile = 'backup-2026-08-01_10-00-00.sqlite';
    const olderPath = path.join(tempBackupDir, olderFile);
    fs.writeFileSync(olderPath, 'fake-sqlite-content');
    // Set older mtime
    const oldDate = new Date('2026-08-01T10:00:00Z');
    fs.utimesSync(olderPath, oldDate, oldDate);

    const list = service.listBackups();
    expect(list.length).toBe(2);
    expect(list[0].filename).toBe(b1.filename); // Newest first
    expect(list[1].filename).toBe(olderFile);
  });

  it('prunes backup snapshots older than 30 days while retaining recent ones', async () => {
    // 1. Fresh backup
    const recent = await service.createBackup();

    // 2. Old backup (45 days old)
    const oldFile = 'backup-2026-07-01_10-00-00.sqlite';
    const oldPath = path.join(tempBackupDir, oldFile);
    fs.writeFileSync(oldPath, 'fake-sqlite-data');
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldPath, oldDate, oldDate);

    const prunedCount = service.pruneOldBackups(30);
    expect(prunedCount).toBe(1);

    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(tempBackupDir, recent.filename))).toBe(true);
  });

  it('guards against directory traversal in getBackupFilePath', () => {
    // Normal file
    const safeFile = 'backup-test.sqlite';
    fs.writeFileSync(path.join(tempBackupDir, safeFile), 'data');
    expect(service.getBackupFilePath(safeFile)).toBe(path.join(tempBackupDir, safeFile));

    // Traversal attempts
    expect(service.getBackupFilePath('../../../etc/passwd')).toBe(null);
    expect(service.getBackupFilePath('nonexistent.sqlite')).toBe(null);
    expect(service.getBackupFilePath('something.txt')).toBe(null);
  });

  it('restores a valid database snapshot from file and verifies content', async () => {
    // 1. Create a valid backup
    const backupMeta = await service.createBackup();
    expect(backupMeta.filename).toBeTruthy();

    // 2. Restore from the filename
    const res = await service.restoreBackup({ filename: backupMeta.filename });
    expect(res.success).toBe(true);
    expect(res.message).toContain('restored');
  });

  it('rejects invalid or corrupted files when attempting restore', async () => {
    // Invalid base64 file data
    const fakeData = Buffer.from('this is not a sqlite database').toString('base64');
    await expect(service.restoreBackup({ fileData: fakeData })).rejects.toThrow();
  });

  it('rejects a corrupt file and keeps the live DB untouched', async () => {
    resetTestDb();
    getDb().prepare(
      "INSERT INTO customers (id, name, type, created_at, updated_at) VALUES ('cust-live', 'Live Customer', 'RETAIL', '2026-09-07', '2026-09-07')"
    ).run();

    const corrupt = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]).toString('base64');
    await expect(service.restoreBackup({ fileData: corrupt })).rejects.toThrow(/integrity|readable|SQLite/i);

    // Live DB still intact
    const row: any = getDb().prepare('SELECT name FROM customers WHERE id = ?').get('cust-live');
    expect(row?.name).toBe('Live Customer');
    resetTestDb();
  });

  it('rejects a foreign SQLite file with wrong tables and keeps the live DB', async () => {
    resetTestDb();
    const foreignPath = path.join(tempBackupDir, 'foreign.sqlite');
    const foreign = new Database(foreignPath);
    foreign.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY, note TEXT)');
    foreign.exec("INSERT INTO unrelated (note) VALUES ('not our schema')");
    foreign.close();

    const fileData = fs.readFileSync(foreignPath).toString('base64');
    await expect(service.restoreBackup({ fileData })).rejects.toThrow(/missing required table/i);

    // No snapshot swap happened: live DB still has full schema, no 'unrelated' table
    const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
    expect(tables).not.toContain('unrelated');
    expect(tables).toContain('sales');
    resetTestDb();
  });

  it('restores a valid backup and leaves a pre-restore safety snapshot', async () => {
    resetTestDb();
    getDb().prepare(
      "INSERT INTO customers (id, name, type, created_at, updated_at) VALUES ('cust-marker', 'Marker', 'RETAIL', '2026-09-07', '2026-09-07')"
    ).run();
    const backupMeta = await service.createBackup();
    getDb().prepare('DELETE FROM customers WHERE id = ?').run('cust-marker');

    const res = await service.restoreBackup({ filename: backupMeta.filename });
    expect(res.success).toBe(true);

    const row: any = getDb().prepare('SELECT name FROM customers WHERE id = ?').get('cust-marker');
    expect(row?.name).toBe('Marker');

    const snapshots = fs.readdirSync(tempBackupDir).filter(f => f.startsWith('pre-restore-') && f.endsWith('.sqlite'));
    expect(snapshots.length).toBe(1);
    resetTestDb();
  });

  it('runs initial backup at startup if no backup exists or newest is older than 24h', async () => {
    // 1. No backup exists -> runs initial backup
    expect(service.listBackups().length).toBe(0);
    const ranInitial = await service.checkAndRunInitialBackup();
    expect(ranInitial).toBe(true);
    expect(service.listBackups().length).toBe(1);

    // 2. Newest backup is fresh (< 24h) -> does not run backup
    const ranFresh = await service.checkAndRunInitialBackup();
    expect(ranFresh).toBe(false);
    expect(service.listBackups().length).toBe(1);

    // 3. Newest backup is older than 24h -> runs backup
    const current = service.listBackups()[0];
    const olderFile = 'backup-2026-10-01_10-00-00.sqlite';
    fs.renameSync(path.join(tempBackupDir, current.filename), path.join(tempBackupDir, olderFile));
    const olderDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(path.join(tempBackupDir, olderFile), olderDate, olderDate);

    const ranStale = await service.checkAndRunInitialBackup();
    expect(ranStale).toBe(true);
    expect(service.listBackups().length).toBe(2);
  });
});

