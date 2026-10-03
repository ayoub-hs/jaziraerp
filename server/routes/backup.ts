import { Router, Request, Response } from 'express';
import path from 'path';
import { backupService } from '../services/backupService.js';

export const backupRouter = Router();

/**
 * GET /api/backups
 * List all available SQLite database backups
 */
backupRouter.get('/', (req: Request, res: Response) => {
  try {
    const backups = backupService.listBackups();
    res.json(backups);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list backups' });
  }
});

/**
 * POST /api/backups
 * Trigger immediate database backup snapshot
 */
backupRouter.post('/', async (req: Request, res: Response) => {
  try {
    const backup = await backupService.createBackup();
    res.status(201).json(backup);
  } catch (err: any) {
    console.error('[BackupRoute] Error creating backup:', err);
    res.status(500).json({ error: err.message || 'Failed to create backup' });
  }
});

/**
 * GET /api/backups/download/:filename
 * Download a specific SQLite backup file
 */
backupRouter.get('/download/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = backupService.getBackupFilePath(filename);

  if (!filePath) {
    res.status(404).json({ error: 'Backup file not found' });
    return;
  }

  res.download(filePath, path.basename(filePath));
});

/**
 * POST /api/backups/restore
 * Restore database from an existing backup filename or base64 file data
 */
backupRouter.post('/restore', async (req: Request, res: Response) => {
  try {
    const { filename, file_data } = req.body;
    if (!filename && !file_data) {
      res.status(400).json({ error: 'Either filename or file_data (base64) is required.' });
      return;
    }

    const result = await backupService.restoreBackup({ filename, fileData: file_data });
    res.json(result);
  } catch (err: any) {
    console.error('[BackupRoute] Restore error:', err);
    res.status(500).json({ error: err.message || 'Failed to restore backup' });
  }
});
