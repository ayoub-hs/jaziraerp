import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, request, resetTestDb, getDb } from '../../tests/testApp.js';
import { cleanupOldSettings } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('F6: Settings Route, Sales Integration, and Migration Cleanup', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('a) GET /api/settings/shop returns name default and blank others', async () => {
    const res = await request(app).get('/api/settings/shop');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      shop_name: 'Société Al Jazira SHSP',
      shop_subtitle: '',
      shop_address: '',
      shop_phone: '',
      tax_id: '',
      default_retail_markup_percent: '',
      default_wholesale_markup_percent: ''
    });
  });

  it('a) PUT /api/settings/shop trims, saves, and ignores unknown keys', async () => {
    const res = await request(app)
      .put('/api/settings/shop')
      .send({
        shop_name: '  Al Jazira Store  ',
        shop_subtitle: '  Hygiène Pro  ',
        shop_address: '  Rue de la République, Djerba  ',
        shop_phone: '  +216 75 123 456  ',
        tax_id: '  9876543/B/N/000  ',
        unknown_field: 'should be ignored',
        another_random_key: 12345
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      shop_name: 'Al Jazira Store',
      shop_subtitle: 'Hygiène Pro',
      shop_address: 'Rue de la République, Djerba',
      shop_phone: '+216 75 123 456',
      tax_id: '9876543/B/N/000',
      default_retail_markup_percent: '',
      default_wholesale_markup_percent: ''
    });

    // Verify GET returns the saved data
    const getRes = await request(app).get('/api/settings/shop');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      shop_name: 'Al Jazira Store',
      shop_subtitle: 'Hygiène Pro',
      shop_address: 'Rue de la République, Djerba',
      shop_phone: '+216 75 123 456',
      tax_id: '9876543/B/N/000',
      default_retail_markup_percent: '',
      default_wholesale_markup_percent: ''
    });
  });

  it('a) rejects non-string and over-length with 400', async () => {
    // Non-string rejection
    const nonStringRes = await request(app)
      .put('/api/settings/shop')
      .send({
        shop_name: 12345
      });
    expect(nonStringRes.status).toBe(400);
    expect(nonStringRes.body.error).toContain('must be a string');

    // Over-length rejection: shop_name > 60 chars
    const overNameRes = await request(app)
      .put('/api/settings/shop')
      .send({
        shop_name: 'A'.repeat(61)
      });
    expect(overNameRes.status).toBe(400);
    expect(overNameRes.body.error).toContain('exceeds maximum length of 60');

    // Over-length rejection: tax_id > 30 chars
    const overTaxRes = await request(app)
      .put('/api/settings/shop')
      .send({
        tax_id: 'T'.repeat(31)
      });
    expect(overTaxRes.status).toBe(400);
    expect(overTaxRes.body.error).toContain('exceeds maximum length of 30');
  });

  it('a) sale payload returns the saved tax_id and subtitle', async () => {
    // Save custom settings
    await request(app)
      .put('/api/settings/shop')
      .send({
        shop_name: 'Al Jazira POS',
        shop_subtitle: 'Chimie & Nettoyage',
        shop_address: 'Zone Artisanale, Djerba',
        shop_phone: '+216 75 000 111',
        tax_id: '1122334/C/A/000'
      });

    // Seed register session & product
    const db = getDb();
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
      VALUES ('ses-set-1', 'SES-SET-1', 'Countertop', '2026-10-04 08:00:00', 100.000, 100.000, 'OPEN')
    `).run();

    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-s1', 'Fam 1', 'Cleaners', 'MANUFACTURED', '2026-10-04', '2026-10-04')
    `).run();

    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, created_at, updated_at)
      VALUES ('prod-s1', 'fam-s1', 'Savon Main', '500ml', '6199990001', 50, 4.000, 3.500, '2026-10-04', '2026-10-04')
    `).run();

    // Create sale
    const saleRes = await request(app)
      .post('/api/sales')
      .send({
        session_id: 'ses-set-1',
        items: [
          { product_id: 'prod-s1', quantity: 1, unit_price: 4.000 }
        ],
        cash_paid: 4.000
      });

    expect(saleRes.status).toBe(201);
    const saleId = saleRes.body.id;

    // Fetch sale details (which includes receipt object)
    const getSaleRes = await request(app).get(`/api/sales/${saleId}`);
    expect(getSaleRes.status).toBe(200);
    expect(getSaleRes.body.receipt.shop_name).toBe('Al Jazira POS');
    expect(getSaleRes.body.receipt.shop_subtitle).toBe('Chimie & Nettoyage');
    expect(getSaleRes.body.receipt.shop_address).toBe('Zone Artisanale, Djerba');
    expect(getSaleRes.body.receipt.shop_phone).toBe('+216 75 000 111');
    expect(getSaleRes.body.receipt.shop_tax_id).toBe('1122334/C/A/000');
  });

  it('d) cleanup: a DB containing the old placeholder strings is blanked on init', () => {
    const memoryDb = new Database(':memory:');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    memoryDb.exec(schemaSql);

    // Insert old placeholder strings explicitly
    memoryDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_address', 'Route de Gabès Km 3.5, Sfax, Tunisie')").run();
    memoryDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('shop_phone', '+216 74 000 000')").run();
    memoryDb.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('tax_id', '1234567/A/M/000')").run();

    // Verify they are present
    const beforeAddr: any = memoryDb.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
    expect(beforeAddr.value).toBe('Route de Gabès Km 3.5, Sfax, Tunisie');

    // Run cleanup
    cleanupOldSettings(memoryDb);

    // Verify all old placeholder values are now blank strings
    const addr: any = memoryDb.prepare("SELECT value FROM settings WHERE key = 'shop_address'").get();
    const phone: any = memoryDb.prepare("SELECT value FROM settings WHERE key = 'shop_phone'").get();
    const tax: any = memoryDb.prepare("SELECT value FROM settings WHERE key = 'tax_id'").get();
    const sub: any = memoryDb.prepare("SELECT value FROM settings WHERE key = 'shop_subtitle'").get();

    expect(addr.value).toBe('');
    expect(phone.value).toBe('');
    expect(tax.value).toBe('');
    expect(sub.value).toBe('');

    memoryDb.close();
  });

  it('validates default_retail_markup_percent and default_wholesale_markup_percent range (0-1000) and blank allowed', async () => {
    // Valid values (numeric or numeric strings, float allowed)
    const validRes = await request(app)
      .put('/api/settings/shop')
      .send({
        default_retail_markup_percent: 30,
        default_wholesale_markup_percent: '25.5'
      });
    expect(validRes.status).toBe(200);
    expect(validRes.body.default_retail_markup_percent).toBe('30');
    expect(validRes.body.default_wholesale_markup_percent).toBe('25.5');

    // Blank allowed
    const blankRes = await request(app)
      .put('/api/settings/shop')
      .send({
        default_retail_markup_percent: '',
        default_wholesale_markup_percent: null
      });
    expect(blankRes.status).toBe(200);
    expect(blankRes.body.default_retail_markup_percent).toBe('');
    expect(blankRes.body.default_wholesale_markup_percent).toBe('');

    // Rejection: negative < 0
    const negRes = await request(app)
      .put('/api/settings/shop')
      .send({
        default_retail_markup_percent: -5
      });
    expect(negRes.status).toBe(400);
    expect(negRes.body.error).toContain('must be a number between 0 and 1000');

    // Rejection: > 1000
    const overRes = await request(app)
      .put('/api/settings/shop')
      .send({
        default_wholesale_markup_percent: 1001
      });
    expect(overRes.status).toBe(400);
    expect(overRes.body.error).toContain('must be a number between 0 and 1000');

    // Rejection: non-numeric string
    const nanRes = await request(app)
      .put('/api/settings/shop')
      .send({
        default_retail_markup_percent: 'abc'
      });
    expect(nanRes.status).toBe(400);
    expect(nanRes.body.error).toContain('must be a number between 0 and 1000');
  });
});

