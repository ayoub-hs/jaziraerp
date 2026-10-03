import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';

export const authRouter = Router();

/**
 * Retrieves the unique cryptographic salt for this installation from settings,
 * or generates and persists a new 16-byte random hex salt if not present.
 */
export function getInstallSalt(db = getDb()): string {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'install_salt'`).get() as { value: string } | undefined;
  if (row?.value) {
    return row.value;
  }
  const newSalt = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('install_salt', ?)`).run(newSalt);
  return newSalt;
}

/**
 * Derives a cryptographic hash of the secret using scrypt and the specified (or install) salt.
 */
export function hashSecret(secret: string, salt?: string): string {
  const effectiveSalt = salt || getInstallSalt();
  return crypto.scryptSync(secret.trim(), effectiveSalt, 64).toString('hex');
}

/**
 * Validates a plaintext secret against a stored hash using timing-safe comparison.
 */
export function verifySecret(secret: string, expectedHash: string, salt?: string): boolean {
  if (!secret || !expectedHash) return false;
  try {
    const effectiveSalt = salt || getInstallSalt();
    const computedBuffer = crypto.scryptSync(secret.trim(), effectiveSalt, 64);
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    if (computedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(computedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * GET /api/auth/status
 * Returns current lock and configuration status.
 * Requires initial setup on first run (no default 1234/admin123 credentials).
 */
authRouter.get('/status', (req: Request, res: Response) => {
  const db = getDb();

  const pinHashRow = db.prepare(`SELECT value FROM settings WHERE key = 'pin_hash'`).get() as { value: string } | undefined;
  const lockRow = db.prepare(`SELECT value FROM settings WHERE key = 'is_locked'`).get() as { value: string } | undefined;
  const shopNameRow = db.prepare(`SELECT value FROM settings WHERE key = 'shop_name'`).get() as { value: string } | undefined;

  const isConfigured = Boolean(pinHashRow?.value);
  const isLocked = lockRow ? lockRow.value === 'true' : true;

  res.json({
    configured: isConfigured,
    locked: isConfigured ? isLocked : true,
    shop_name: shopNameRow?.value || 'Société Al Jazira SHSP'
  });
});

/**
 * POST /api/auth/setup
 * Initial setup of PIN (4 digits), Master Password, and shop metadata
 */
authRouter.post('/setup', (req: Request, res: Response) => {
  const { pin, password, masterPassword, master_password, shop_name, shop_address, shop_phone, tax_id } = req.body;
  const effectivePassword = password || masterPassword || master_password;

  if (!pin || !/^\d{4}$/.test(String(pin).trim())) {
    res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    return;
  }

  if (!effectivePassword || String(effectivePassword).trim().length < 4) {
    res.status(400).json({ error: 'Master password must be at least 4 characters' });
    return;
  }

  const db = getDb();
  const salt = getInstallSalt(db);
  const pinHash = hashSecret(String(pin), salt);
  const masterHash = hashSecret(String(effectivePassword), salt);

  const insert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
  const runTransaction = db.transaction(() => {
    insert.run('pin_hash', pinHash);
    insert.run('master_password_hash', masterHash);
    insert.run('is_locked', 'false');
    insert.run('is_auth_configured', 'true');

    if (shop_name) insert.run('shop_name', String(shop_name).trim());
    if (shop_address) insert.run('shop_address', String(shop_address).trim());
    if (shop_phone) insert.run('shop_phone', String(shop_phone).trim());
    if (tax_id) insert.run('tax_id', String(tax_id).trim());
  });

  runTransaction();

  res.json({
    success: true,
    configured: true,
    message: 'Authentication configured successfully',
    pin_hash: pinHash
  });
});

/**
 * POST /api/auth/unlock
 * Verifies 4-digit PIN or master password to unlock register
 */
authRouter.post('/unlock', (req: Request, res: Response) => {
  const { pin, password, masterPassword, master_password, secret } = req.body;
  const effectivePin = pin || (/^\d{4}$/.test(String(secret || '').trim()) ? secret : undefined);
  const effectivePassword = password || masterPassword || master_password || (!effectivePin && secret ? secret : undefined);

  if (!effectivePin && !effectivePassword) {
    res.status(400).json({ error: 'PIN or password required' });
    return;
  }

  const db = getDb();
  const pinHashRow = db.prepare(`SELECT value FROM settings WHERE key = 'pin_hash'`).get() as { value: string } | undefined;
  const masterHashRow = db.prepare(`SELECT value FROM settings WHERE key = 'master_password_hash'`).get() as { value: string } | undefined;
  const shopNameRow = db.prepare(`SELECT value FROM settings WHERE key = 'shop_name'`).get() as { value: string } | undefined;

  if (!pinHashRow?.value) {
    res.status(400).json({ error: 'Authentication not configured. Initial setup required.' });
    return;
  }

  const salt = getInstallSalt(db);
  let isValid = false;

  if (effectivePin && pinHashRow) {
    isValid = verifySecret(String(effectivePin), pinHashRow.value, salt);
  }

  if (!isValid && effectivePassword && masterHashRow) {
    isValid = verifySecret(String(effectivePassword), masterHashRow.value, salt);
  }

  if (!isValid) {
    res.status(401).json({ error: 'Invalid PIN or Master Password' });
    return;
  }

  // Update locked status
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('is_locked', 'false')`).run();

  res.json({
    success: true,
    unlocked: true,
    locked: false,
    message: 'Unlocked successfully',
    pin_hash: pinHashRow.value,
    shop_name: shopNameRow?.value || 'Société Al Jazira SHSP'
  });
});

/**
 * POST /api/auth/lock
 * Manually lock register session
 */
authRouter.post('/lock', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('is_locked', 'true')`).run();
  res.json({ success: true, locked: true });
});

/**
 * POST /api/auth/change
 * Change PIN or Master Password
 */
authRouter.post('/change', (req: Request, res: Response) => {
  const { current_secret, new_pin, new_password } = req.body;

  if (!current_secret) {
    res.status(400).json({ error: 'Current PIN or Master Password is required' });
    return;
  }

  const db = getDb();
  const salt = getInstallSalt(db);
  const pinHashRow = db.prepare(`SELECT value FROM settings WHERE key = 'pin_hash'`).get() as { value: string } | undefined;
  const masterHashRow = db.prepare(`SELECT value FROM settings WHERE key = 'master_password_hash'`).get() as { value: string } | undefined;

  const isAuthorized = (pinHashRow && verifySecret(String(current_secret), pinHashRow.value, salt)) ||
                       (masterHashRow && verifySecret(String(current_secret), masterHashRow.value, salt));

  if (!isAuthorized) {
    res.status(401).json({ error: 'Current credential is incorrect' });
    return;
  }

  if (new_pin) {
    if (!/^\d{4}$/.test(String(new_pin).trim())) {
      res.status(400).json({ error: 'New PIN must be exactly 4 digits' });
      return;
    }
    const newPinHash = hashSecret(String(new_pin), salt);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('pin_hash', ?)`).run(newPinHash);
  }

  if (new_password) {
    if (String(new_password).trim().length < 4) {
      res.status(400).json({ error: 'New master password must be at least 4 characters' });
      return;
    }
    const newMasterHash = hashSecret(String(new_password), salt);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('master_password_hash', ?)`).run(newMasterHash);
  }

  res.json({ success: true, message: 'Credentials updated successfully' });
});
