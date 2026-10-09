import { Router, Request, Response } from 'express';
import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { getDb } from '../db/index.js';
import { getShopSettingsFromDb } from './settings.js';

export const hardwareRouter = Router();

/**
 * Find candidate USB serial ports on Linux
 */
export function findSerialPort(): string | null {
  const candidates = ['/dev/ttyUSB0', '/dev/ttyUSB1', '/dev/ttyACM0', '/dev/ttyACM1'];
  for (const port of candidates) {
    if (fs.existsSync(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Triggers the solenoid kick pulse on a serial port
 */
export function kickSerialDrawer(portPath?: string): { success: boolean; port: string; error?: string } {
  const isValidPort = typeof portPath === 'string' && /^\/dev\/(ttyUSB|ttyACM|ttyS)\d+$/.test(portPath.trim());
  const validatedPort = isValidPort ? portPath.trim() : null;
  const targetPort = validatedPort || findSerialPort() || '/dev/ttyUSB0';

  if (!fs.existsSync(targetPort)) {
    return {
      success: false,
      port: targetPort,
      error: `Serial port ${targetPort} not found. Ensure USB cash drawer is plugged in.`
    };
  }

  try {
    // Open in non-blocking write mode without truncation and transmit pulses
    // Standard ESC/POS kick: 1B 70 00 19 FA
    // Standalone USB trigger box triggers (BT-100U / Maken): 0x01, 0x07, 0x00
    const pulse = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x01, 0x07, 0x00]);
    const fd = fs.openSync(targetPort, fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
    fs.writeSync(fd, pulse);
    fs.closeSync(fd);

    return {
      success: true,
      port: targetPort
    };
  } catch (err: any) {
    return {
      success: false,
      port: targetPort,
      error: err.message || 'Failed to write to serial port'
    };
  }
}

/**
 * GET /api/hardware/drawer/status
 * Returns detected serial port and hardware information
 */
hardwareRouter.get('/drawer/status', (req: Request, res: Response) => {
  const port = findSerialPort();
  let usbDeviceName = 'Unknown USB Serial Device';

  if (port) {
    try {
      const udevOut = execFileSync('udevadm', ['info', '-q', 'property', '-n', port]).toString();
      const modelMatch = udevOut.match(/ID_MODEL_FROM_DATABASE=(.+)/) || udevOut.match(/ID_MODEL=(.+)/);
      if (modelMatch && modelMatch[1]) {
        usbDeviceName = modelMatch[1].trim();
      }
    } catch {
      // Ignore udev query errors
    }
  }

  res.json({
    detected: Boolean(port),
    port: port || null,
    device_name: port ? usbDeviceName : null
  });
});

/**
 * POST /api/hardware/drawer/kick
 * Fires the hardware pulse to pop open the USB serial cash drawer
 */
hardwareRouter.post('/drawer/kick', (req: Request, res: Response) => {
  const requestedPort = req.body?.port;
  const result = kickSerialDrawer(requestedPort);

  if (result.success) {
    res.json({
      success: true,
      message: `Cash drawer kicked via ${result.port}`,
      port: result.port
    });
  } else {
    res.status(500).json({
      success: false,
      error: result.error,
      port: result.port
    });
  }
});

/**
 * Checks printer hardware status (libusb VID 0x0483 PID 0x5840 or /dev/usb/lp*)
 */
export function checkPrinterStatus(): {
  connected: boolean;
  vendor_id: string;
  product_id: string;
  device_name: string | null;
  endpoint: string;
  driver_type?: string;
  error?: string;
} {
  // 1. Direct libusb driver check (matches Kotlin DesktopReceiptPrinter)
  try {
    const scriptPath = path.resolve(process.cwd(), 'server/hardware/usb_printer.py');
    const proc = spawnSync('python3', [scriptPath, 'status'], { timeout: 3000, encoding: 'utf-8' });
    if (proc.stdout) {
      const data = JSON.parse(proc.stdout.trim());
      if (data.connected) {
        return {
          ...data,
          driver_type: 'libusb'
        };
      }
    }
  } catch {
    // Ignore script failure
  }

  // 2. Linux kernel lp devices (/dev/usb/lp0, /dev/lp0)
  const lpDevices = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/lp0'];
  for (const dev of lpDevices) {
    if (fs.existsSync(dev)) {
      return {
        connected: true,
        vendor_id: '0x0483',
        product_id: '0x5840',
        device_name: `Thermal Printer (${dev})`,
        endpoint: dev,
        driver_type: 'dev_lp'
      };
    }
  }

  return {
    connected: false,
    vendor_id: '0x0483',
    product_id: '0x5840',
    device_name: null,
    endpoint: '0x04',
    driver_type: 'none'
  };
}

function formatMoneyDinars(val: any): string {
  if (val === undefined || val === null) return '0.000 DT';
  const num = Number(val);
  if (!Number.isFinite(num)) return '0.000 DT';
  // All amounts in this ERP are dinars (3-decimal millimes). No millime
  // heuristic: a plain 500 DT total must print as 500.000 DT, not 0.500 DT.
  return `${num.toFixed(3)} DT`;
}

function cleanAscii(str: string): string {
  if (!str) return '';
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Builds 58mm ESC/POS byte buffer matching Kotlin DesktopReceiptPrinter.kt
 */
export function buildReceiptEscPosBuffer(sale: any, storeName?: string, customDb?: any): Buffer {
  const bytes: number[] = [];

  const db = customDb || getDb();
  let shopSettings;
  try {
    shopSettings = getShopSettingsFromDb(db);
  } catch {
    shopSettings = {
      shop_name: 'Société Al Jazira SHSP',
      shop_subtitle: '',
      shop_address: '',
      shop_phone: '',
      tax_id: ''
    };
  }
  const effectiveName = storeName && storeName !== 'SOCIETE AL JAZIRA'
    ? storeName
    : (shopSettings.shop_name || 'Société Al Jazira SHSP');

  const push = (...b: number[]) => bytes.push(...b);
  const text = (str: string) => {
    const clean = cleanAscii(str);
    const b = Buffer.from(clean, 'utf-8');
    for (let i = 0; i < b.length; i++) bytes.push(b[i]);
  };
  const lf = (lines = 1) => {
    for (let i = 0; i < lines; i++) bytes.push(0x0a);
  };
  const line = (str: string = '') => {
    text(str);
    lf(1);
  };
  const divider = (ch = '-') => line(ch.repeat(32));
  const twoCol = (left: string, right: string, maxLen = 32) => {
    const cleanLeft = cleanAscii(left);
    const cleanRight = cleanAscii(right);
    const space = maxLen - cleanLeft.length - cleanRight.length;
    if (space > 0) {
      line(cleanLeft + ' '.repeat(space) + cleanRight);
    } else {
      line(cleanLeft.slice(0, Math.max(0, maxLen - cleanRight.length - 1)) + ' ' + cleanRight);
    }
  };

  // Initialize
  push(0x1b, 0x40);

  // Store header
  push(0x1b, 0x61, 0x01); // Center
  if (effectiveName && effectiveName.trim()) {
    push(0x1b, 0x45, 0x01); // Bold on
    line(cleanAscii(effectiveName.trim()).slice(0, 32));
    push(0x1b, 0x45, 0x00); // Bold off
  }
  if (shopSettings.shop_subtitle && shopSettings.shop_subtitle.trim()) {
    line(cleanAscii(shopSettings.shop_subtitle.trim()).slice(0, 32));
  }
  if (shopSettings.shop_address && shopSettings.shop_address.trim()) {
    line(cleanAscii(shopSettings.shop_address.trim()).slice(0, 32));
  }
  if (shopSettings.shop_phone && shopSettings.shop_phone.trim()) {
    line(cleanAscii(`Tel: ${shopSettings.shop_phone.trim()}`).slice(0, 32));
  }
  if (shopSettings.tax_id && shopSettings.tax_id.trim()) {
    const rawTax = shopSettings.tax_id.trim();
    const taxLine = rawTax.startsWith('MF:') ? rawTax : `MF: ${rawTax}`;
    line(cleanAscii(taxLine).slice(0, 32));
  }
  divider('=');

  // Metadata
  push(0x1b, 0x61, 0x00); // Left
  twoCol('Ticket N:', sale?.receipt_number || 'N/A');
  twoCol('Date:', new Date(sale?.date || Date.now()).toLocaleString('fr-FR'));
  twoCol('Client:', (sale?.customer_name || 'Passager').slice(0, 20));
  divider('-');

  // Line items
  const items = sale?.items || sale?.receipt?.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      const rawName = item.catalog_product_name || item.quick_add_name || item.description || item.name || 'Article';
      const cleanName = cleanAscii(rawName).slice(0, 32);
      line(cleanName);

      const qty = item.quantity || 1;
      const unitPrice = item.unit_price || 0;
      const itemDiscount = Number(item.discount_amount) || 0;
      const computedFull = Math.round(Number(qty) * Number(unitPrice) * 1000) / 1000;
      const fullTotal = computedFull > 0
        ? computedFull
        : Math.round(((Number(item.line_total ?? item.total_line) || 0) + itemDiscount) * 1000) / 1000;

      const qtyStr = `${qty} x ${formatMoneyDinars(unitPrice)}`;
      const totStr = formatMoneyDinars(fullTotal);
      twoCol(qtyStr, totStr);

      if (itemDiscount > 0) {
        twoCol('  Remise:', `-${formatMoneyDinars(itemDiscount)}`);
      }
    }
  }

  divider('-');

  // Totals
  twoCol('Sous-total HT:', formatMoneyDinars(sale?.subtotal_ht));
  twoCol('TVA (19%):', formatMoneyDinars(sale?.tva_amount));
  const globalDiscount = Number(sale?.total_discount) || 0;
  if (globalDiscount > 0) {
    twoCol('Remise globale:', `-${formatMoneyDinars(globalDiscount)}`);
  }
  push(0x1b, 0x45, 0x01); // Bold
  twoCol('TOTAL TTC:', formatMoneyDinars(sale?.total_ttc));
  push(0x1b, 0x45, 0x00); // Bold off

  // Payments (cash_tendered is not stored; re-derive received cash as applied + change)
  divider('-');
  if ((sale?.cash_paid || 0) > 0) twoCol('Especes:', formatMoneyDinars(sale.cash_paid));
  if ((sale?.wallet_paid || 0) > 0) twoCol('Portefeuille:', formatMoneyDinars(sale.wallet_paid));
  if ((sale?.credit_amount || 0) > 0) twoCol('Bon de Credit:', formatMoneyDinars(sale.credit_amount));
  if ((sale?.cash_paid || 0) > 0 && (sale?.change_given || 0) > 0) {
    twoCol('Recu:', formatMoneyDinars(Math.round(((Number(sale.cash_paid) || 0) + (Number(sale.change_given) || 0)) * 1000) / 1000));
  }
  if ((sale?.change_given || 0) > 0) twoCol('Rendu:', formatMoneyDinars(sale.change_given));

  // Footer
  lf(2);
  push(0x1b, 0x61, 0x01); // Center
  line('Merci de votre visite!');
  line('Les bidons sont remboursables');
  lf(4);

  // Cut
  push(0x1d, 0x56, 0x00);

  // Kick drawer on cash
  if ((sale?.cash_paid || 0) > 0) {
    push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  return Buffer.from(bytes);
}

/**
 * Sends raw bytes or receipt to printer via libusb /dev/usb/lp*
 */
export function printHardwareReceipt(payload: Buffer | Uint8Array): {
  success: boolean;
  message?: string;
  error?: string;
  driver_type?: string;
} {
  const inputBuf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

  // 1. Try python libusb driver (VID 0x0483 PID 0x5840)
  try {
    const scriptPath = path.resolve(process.cwd(), 'server/hardware/usb_printer.py');
    const proc = spawnSync('python3', [scriptPath, 'print'], {
      input: inputBuf,
      timeout: 6000
    });
    if (proc.stdout) {
      const resp = JSON.parse(proc.stdout.toString().trim());
      if (resp.success) {
        return {
          success: true,
          message: `Printed ${resp.bytes_transferred} bytes via libusb (VID 0x0483, PID 0x5840)`,
          driver_type: 'libusb'
        };
      }
    }
  } catch {
    // Continue to lp devices
  }

  // 2. Try /dev/usb/lp0 or /dev/lp0
  const lpDevices = ['/dev/usb/lp0', '/dev/usb/lp1', '/dev/lp0'];
  for (const dev of lpDevices) {
    if (fs.existsSync(dev)) {
      try {
        const fd = fs.openSync(dev, 'w');
        fs.writeSync(fd, inputBuf);
        fs.closeSync(fd);
        return {
          success: true,
          message: `Printed directly to ${dev}`,
          driver_type: 'dev_lp'
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Failed to write to ${dev}: ${err.message}`
        };
      }
    }
  }

  return {
    success: false,
    error: 'Printer device not found (VID: 0x0483, PID: 0x5840). Ensure the H313 POS printer is switched ON and connected via USB.'
  };
}

/**
 * GET /api/hardware/printer/status
 * Returns detected printer hardware information
 */
hardwareRouter.get('/printer/status', (req: Request, res: Response) => {
  const status = checkPrinterStatus();
  res.json(status);
});

/**
 * POST /api/hardware/printer/print
 * Prints an ESC/POS receipt directly via libusb / Linux USB printer device
 */
hardwareRouter.post('/printer/print', (req: Request, res: Response) => {
  const { sale, rawBytes, sale_id } = req.body || {};

  let payload: Buffer;
  if (Array.isArray(rawBytes)) {
    payload = Buffer.from(rawBytes);
  } else {
    let saleData = sale;
    if (!saleData && sale_id) {
      try {
        const db = getDb();
        const dbSale: any = db.prepare(`
          SELECT s.*, c.name as customer_name
          FROM sales s
          LEFT JOIN customers c ON s.customer_id = c.id
          WHERE s.id = ? OR s.receipt_number = ?
        `).get(sale_id, sale_id);
        if (dbSale) {
          const dbItems = db.prepare(`
            SELECT si.*, p.name as catalog_product_name, p.size_label, pps.pack_label
            FROM sale_items si
            LEFT JOIN products p ON si.product_id = p.id
            LEFT JOIN product_pack_sizes pps ON si.pack_size_id = pps.id
            WHERE si.sale_id = ?
          `).all(dbSale.id);
          saleData = {
            ...dbSale,
            items: dbItems
          };
        } else {
          res.status(404).json({ success: false, error: `Sale not found: ${sale_id}` });
          return;
        }
      } catch (err) {
        console.warn('Failed to load sale from db for printing:', err);
      }
    }

    if (saleData) {
      payload = buildReceiptEscPosBuffer(saleData);
    } else {
      // Send a test receipt slip
      const dummySale = {
        receipt_number: 'TEST-001',
        date: new Date().toISOString(),
        customer_name: 'Test Client',
        items: [{ description: 'Test Ticket / Impress. Test', quantity: 1, unit_price: 1, line_total: 1 }],
        subtotal_ht: 0.840,
        tva_amount: 0.160,
        total_ttc: 1.000,
        cash_paid: 1.000
      };
      payload = buildReceiptEscPosBuffer(dummySale);
    }
  }

  const result = printHardwareReceipt(payload);
  if (result.success) {
    res.json(result);
  } else {
    res.status(503).json(result);
  }
});
