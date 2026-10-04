import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const settingsRouter = Router();

const MAX_LENGTHS: Record<string, number> = {
  shop_name: 60,
  shop_subtitle: 60,
  shop_address: 120,
  shop_phone: 30,
  tax_id: 30
};

const WHITELIST_KEYS = [
  'shop_name',
  'shop_subtitle',
  'shop_address',
  'shop_phone',
  'tax_id',
  'default_retail_markup_percent',
  'default_wholesale_markup_percent'
] as const;

export interface ShopSettings {
  shop_name: string;
  shop_subtitle: string;
  shop_address: string;
  shop_phone: string;
  tax_id: string;
  default_retail_markup_percent: string;
  default_wholesale_markup_percent: string;
}

export function getShopSettingsFromDb(db = getDb()): ShopSettings {
  const rows: any[] = db.prepare(`
    SELECT key, value FROM settings 
    WHERE key IN ('shop_name', 'shop_subtitle', 'shop_address', 'shop_phone', 'tax_id', 'default_retail_markup_percent', 'default_wholesale_markup_percent')
  `).all();

  const settings: ShopSettings = {
    shop_name: 'Société Al Jazira SHSP',
    shop_subtitle: '',
    shop_address: '',
    shop_phone: '',
    tax_id: '',
    default_retail_markup_percent: '',
    default_wholesale_markup_percent: ''
  };

  for (const row of rows) {
    if (row.key === 'shop_name') {
      settings.shop_name = row.value || 'Société Al Jazira SHSP';
    } else if (row.key in settings) {
      (settings as any)[row.key] = row.value || '';
    }
  }

  return settings;
}

// GET /api/settings/shop - returns the 5 shop settings values
settingsRouter.get('/shop', (req: Request, res: Response) => {
  const db = getDb();
  res.json(getShopSettingsFromDb(db));
});

// PUT /api/settings/shop - updates shop settings (whitelist 5 keys, string required, trims, max length check)
settingsRouter.put('/shop', (req: Request, res: Response) => {
  const db = getDb();
  const body = req.body;

  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be an object' });
    return;
  }

  const updates: Record<string, string> = {};

  for (const key of WHITELIST_KEYS) {
    if (key in body) {
      const val = body[key];
      if (key === 'default_retail_markup_percent' || key === 'default_wholesale_markup_percent') {
        if (val === '' || val === null || val === undefined) {
          updates[key] = '';
        } else if (typeof val === 'number') {
          if (isNaN(val) || val < 0 || val > 1000) {
            res.status(400).json({ error: `Field "${key}" must be a number between 0 and 1000` });
            return;
          }
          updates[key] = String(val);
        } else if (typeof val === 'string') {
          const trimmed = val.trim();
          if (trimmed === '') {
            updates[key] = '';
          } else {
            const num = Number(trimmed);
            if (isNaN(num) || num < 0 || num > 1000) {
              res.status(400).json({ error: `Field "${key}" must be a number between 0 and 1000` });
              return;
            }
            updates[key] = trimmed;
          }
        } else {
          res.status(400).json({ error: `Field "${key}" must be a number between 0 and 1000` });
          return;
        }
      } else {
        if (typeof val !== 'string') {
          res.status(400).json({ error: `Field "${key}" must be a string` });
          return;
        }
        const trimmed = val.trim();
        const maxLen = MAX_LENGTHS[key];
        if (maxLen && trimmed.length > maxLen) {
          res.status(400).json({ 
            error: `Field "${key}" exceeds maximum length of ${maxLen} characters (received ${trimmed.length})` 
          });
          return;
        }
        updates[key] = trimmed;
      }
    }
  }

  // Execute in one transaction
  const updateTx = db.transaction((toUpdate: Record<string, string>) => {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [k, v] of Object.entries(toUpdate)) {
      stmt.run(k, v);
    }
  });

  updateTx(updates);

  res.json(getShopSettingsFromDb(db));
});
