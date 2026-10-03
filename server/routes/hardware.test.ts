import { describe, it, expect, beforeEach } from 'vitest';
import { app, request, resetTestDb } from '../../tests/testApp.js';
import { buildReceiptEscPosBuffer } from './hardware.js';

describe('Hardware Router & USB Serial Cash Drawer (HTTP Routes)', () => {
  beforeEach(() => {
    resetTestDb();
  });

  it('GET /api/hardware/drawer/status returns detected serial port status', async () => {
    const res = await request(app).get('/api/hardware/drawer/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.detected).toBe('boolean');
    expect('port' in res.body).toBe(true);
    expect('device_name' in res.body).toBe(true);
  });

  it('POST /api/hardware/drawer/kick safely fails with 500 when port is nonexistent', async () => {
    const res = await request(app)
      .post('/api/hardware/drawer/kick')
      .send({ port: '/dev/ttyUSB99' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not found');
  });

  it('POST /api/hardware/drawer/kick ignores non-serial paths and does not overwrite arbitrary files', async () => {
    // If an attacker supplies an arbitrary file path, it must be ignored rather than truncated/opened
    const res = await request(app)
      .post('/api/hardware/drawer/kick')
      .send({ port: '/etc/passwd' });

    // It falls back to default serial device rather than targeting /etc/passwd
    expect(res.body.port).not.toBe('/etc/passwd');
  });

  it('GET /api/hardware/printer/status returns printer hardware status', async () => {
    const res = await request(app).get('/api/hardware/printer/status');
    expect(res.status).toBe(200);
    expect(typeof res.body.connected).toBe('boolean');
    expect(res.body.vendor_id).toBe('0x0483');
    expect(res.body.product_id).toBe('0x5840');
  });

  it('POST /api/hardware/printer/print with sample sale exercises printer route', async () => {
    const sampleSale = {
      receipt_number: 'REC-TEST-99',
      date: new Date().toISOString(),
      customer_name: 'Test Client',
      items: [
        { description: 'Savon Liquide 5L', quantity: 2, unit_price: 12000, total_line: 24000 }
      ],
      subtotal_ht: 20168,
      tva_amount: 3832,
      total_ttc: 24000,
      cash_paid: 30000
    };

    const res = await request(app)
      .post('/api/hardware/printer/print')
      .send({ sale: sampleSale });

    // Depending on whether physical printer is plugged in, returns 200 or 503
    expect([200, 503]).toContain(res.status);
    expect(typeof res.body.success).toBe('boolean');
  });

  it('POST /api/hardware/printer/print returns 404 for unknown sale_id', async () => {
    const res = await request(app)
      .post('/api/hardware/printer/print')
      .send({ sale_id: 'non-existent-uuid' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Sale not found');
  });

  it('builds valid ESC/POS byte buffer for thermal receipt', () => {
    const sampleSale = {
      receipt_number: 'REC-TEST-99',
      date: new Date().toISOString(),
      customer_name: 'Test Client',
      items: [
        { description: 'Savon Liquide 5L', quantity: 2, unit_price: 12000, total_line: 24000 }
      ],
      subtotal_ht: 20168,
      tva_amount: 3832,
      total_ttc: 24000,
      cash_paid: 30000
    };
    const buffer = buildReceiptEscPosBuffer(sampleSale);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(50);
    // Begins with ESC @ (0x1B 0x40)
    expect(buffer[0]).toBe(0x1b);
    expect(buffer[1]).toBe(0x40);
  });

  it('builds ESC/POS buffer with line discount and global discount', () => {
    const discountedSale = {
      receipt_number: 'REC-TEST-DISC',
      date: new Date().toISOString(),
      customer_name: 'Client Remise',
      items: [
        {
          catalog_product_name: 'Bidon Vaisselle 10L',
          quantity: 2,
          unit_price: 15.000,
          discount_amount: 2.000,
          line_total: 28.000
        }
      ],
      subtotal_ht: 21.008,
      tva_amount: 3.992,
      total_discount: 3.000,
      total_ttc: 25.000,
      cash_paid: 30.000,
      change_given: 5.000
    };
    const buffer = buildReceiptEscPosBuffer(discountedSale);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    const text = buffer.toString('utf-8');
    expect(text).toContain('Bidon Vaisselle 10L');
    expect(text).toContain('Remise:');
    expect(text).toContain('-2.000 DT');
    expect(text).toContain('Remise globale:');
    expect(text).toContain('-3.000 DT');
    expect(text).toContain('TOTAL TTC:');
    expect(text).toContain('25.000 DT');
    expect(text).toContain('Rendu:');
    expect(text).toContain('5.000 DT');
  });
});
