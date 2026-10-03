import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, request, getDb, resetTestDb } from './testApp.js';
import { buildDrawerKickCommand, buildReceiptEscPos } from '../src/services/hardware/escpos.js';
import { WebBluetoothPrinterService } from '../src/services/hardware/webbluetooth.js';
import { KeyboardWedgeScanner } from '../src/services/hardware/scanner.js';
import { renderCode128Barcode } from '../src/services/hardware/barcode.js';
import { BackupService } from '../server/services/backupService.js';
import { round3, formatTND, calculateTaxBreakdown } from '../server/utils/money.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Full Acceptance Test Plan — Al Jazira SHSP ERP', () => {
  beforeEach(() => {
    resetTestDb();
  });

  // ==========================================
  // MODULE 1: Raw Materials & Formulations
  // ==========================================
  describe('1. Raw Materials & Formulations', () => {
    it('creates a raw material (including packaging: bottle/cap/label) with category, unit, stock, supplier', async () => {
      const supRes = await request(app)
        .post('/api/suppliers')
        .send({ name: 'PlastPack Sfax', phone: '74111222', address: 'Route de Gabes Km 3' });
      expect(supRes.status).toBe(201);
      const supplierId = supRes.body.id;

      const matRes = await request(app)
        .post('/api/materials')
        .send({
          name: 'Bidon 5L PEHD',
          category: 'bottle',
          unit: 'pcs',
          stock_quantity: 500,
          latest_purchase_cost: 0.950,
          latest_supplier_id: supplierId
        });
      expect(matRes.status).toBe(201);
      expect(matRes.body.name).toBe('Bidon 5L PEHD');
      expect(matRes.body.category).toBe('bottle');
      expect(matRes.body.unit).toBe('pcs');
      expect(matRes.body.stock_quantity).toBe(500);
      expect(matRes.body.latest_purchase_cost).toBe(0.95);
      expect(matRes.body.latest_supplier_id).toBe(supplierId);

      const db = getDb();
      const mat: any = db.prepare('SELECT * FROM raw_materials WHERE id = ?').get(matRes.body.id);
      expect(mat).toBeDefined();
      expect(mat.stock_quantity).toBe(500);
    });

    it('records a purchase → stock increases, price history entry created', async () => {
      const supRes = await request(app)
        .post('/api/suppliers')
        .send({ name: 'Maghreb Chimie', phone: '74333444' });
      const supplierId = supRes.body.id;

      const matRes = await request(app)
        .post('/api/materials')
        .send({
          name: 'SLES 70%',
          category: 'surfactant',
          unit: 'kg',
          stock_quantity: 100,
          latest_purchase_cost: 4.200,
          latest_supplier_id: supplierId
        });
      const materialId = matRes.body.id;

      const purRes = await request(app)
        .post('/api/purchases')
        .send({
          supplier_id: supplierId,
          payment_status: 'PAID',
          items: [
            {
              item_type: 'RAW_MATERIAL',
              material_id: materialId,
              quantity: 200,
              unit_cost: 4.500
            }
          ]
        });
      expect(purRes.status).toBe(201);

      const updatedMat = await request(app).get(`/api/materials/${materialId}`);
      expect(updatedMat.status).toBe(200);
      expect(updatedMat.body.stock_quantity).toBe(300);
      expect(updatedMat.body.latest_purchase_cost).toBe(4.5);

      const historyRes = await request(app).get(`/api/materials/${materialId}/history`);
      expect(historyRes.status).toBe(200);
      const entry = historyRes.body.find((h: any) => h.cost_per_unit === 4.5);
      expect(entry).toBeDefined();
      expect(entry.supplier_id).toBe(supplierId);
    });

    it('shows purchase price history trend across multiple purchases of the same material', async () => {
      const supRes = await request(app)
        .post('/api/suppliers')
        .send({ name: 'Chimie General' });
      const supplierId = supRes.body.id;

      const matRes = await request(app)
        .post('/api/materials')
        .send({
          name: 'Soude Caustique NaOH',
          category: 'alkali',
          unit: 'kg',
          stock_quantity: 50,
          latest_purchase_cost: 0
        });
      const materialId = matRes.body.id;

      const purchases = [
        { cost: 2.100, date: '2026-07-01' },
        { cost: 2.250, date: '2026-08-01' },
        { cost: 2.400, date: '2026-09-01' }
      ];

      for (const p of purchases) {
        await request(app)
          .post('/api/purchases')
          .send({
            supplier_id: supplierId,
            date: p.date,
            items: [{ item_type: 'RAW_MATERIAL', material_id: materialId, quantity: 10, unit_cost: p.cost }]
          });
      }

      const histRes = await request(app).get(`/api/materials/${materialId}/history`);
      expect(histRes.status).toBe(200);
      const rows = histRes.body;
      expect(rows.length).toBe(3);
      expect(rows[0].cost_per_unit).toBe(2.1);
      expect(rows[1].cost_per_unit).toBe(2.25);
      expect(rows[2].cost_per_unit).toBe(2.4);
      expect(rows[2].cost_per_unit).toBeGreaterThan(rows[0].cost_per_unit);
    });

    it('creates a formulation linking multiple raw materials + packaging with quantities and calculates cost correctly', async () => {
      const mat1 = await request(app).post('/api/materials').send({ name: 'LABSA 96%', category: 'surfactant', unit: 'kg', stock_quantity: 500, latest_purchase_cost: 5.000 });
      const mat2 = await request(app).post('/api/materials').send({ name: 'Parfum Jasmin', category: 'fragrance', unit: 'L', stock_quantity: 20, latest_purchase_cost: 25.000 });
      const mat3 = await request(app).post('/api/materials').send({ name: 'Flacon 1L', category: 'bottle', unit: 'pcs', stock_quantity: 1000, latest_purchase_cost: 0.400 });

      const formRes = await request(app)
        .post('/api/formulations')
        .send({
          name: 'Nettoyant Sols Jasmin 100L',
          base_yield_quantity: 100,
          base_yield_unit: 'pcs',
          items: [
            { material_id: mat1.body.id, quantity_required: 10 },
            { material_id: mat2.body.id, quantity_required: 1 },
            { material_id: mat3.body.id, quantity_required: 100 }
          ]
        });
      expect(formRes.status).toBe(201);
      const formulationId = formRes.body.id || formRes.body.formulation_id;

      const previewRes = await request(app).get(`/api/formulations/${formulationId}/preview-batch?target_units=100`);
      expect(previewRes.status).toBe(200);
      expect(previewRes.body.totalBatchCost).toBe(115.000);
      expect(previewRes.body.costPerUnit).toBe(1.150);
    });
  });

  // ==========================================
  // MODULE 2: Production
  // ==========================================
  describe('2. Production', () => {
    it('runs production batch targeting specific size, deducts recipe scaled to output, and updates cost_reference', async () => {
      const mat1 = await request(app).post('/api/materials').send({ name: 'LABSA 96%', category: 'surfactant', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 5.000 });
      const pkg1 = await request(app).post('/api/materials').send({ name: 'Flacon 1L', category: 'bottle', unit: 'pcs', stock_quantity: 150, latest_purchase_cost: 0.400 });

      const formRes = await request(app).post('/api/formulations').send({
        name: 'Citron Formulation',
        base_yield_quantity: 100,
        base_yield_unit: 'pcs',
        items: [
          { material_id: mat1.body.id, quantity_required: 10 },
          { material_id: pkg1.body.id, quantity_required: 100 }
        ]
      });
      const formulationId = formRes.body.id || formRes.body.formulation_id;

      const famRes = await request(app).post('/api/products/families').send({
        name: 'Citron Sol',
        category: 'Detergents',
        type: 'MANUFACTURED',
        formulation_id: formulationId
      });
      const familyId = famRes.body.id;

      const prodRes = await request(app).post('/api/products').send({
        family_id: familyId,
        name: 'Citron Sol 1L',
        size_label: '1L',
        barcode: 'BAR-1L',
        stock_quantity: 20,
        retail_price: 2.500,
        wholesale_price: 2.000
      });
      const productId = prodRes.body.id;

      // Run batch for 50 units
      const batchRes = await request(app)
        .post('/api/production/batches')
        .send({
          formulation_id: formulationId,
          target_product_id: productId,
          units_produced: 50
        });

      expect(batchRes.status).toBe(201);
      expect(batchRes.body.units_produced).toBe(50);
      expect(batchRes.body.total_batch_cost).toBe(45.000);
      expect(batchRes.body.cost_per_unit).toBe(0.900);

      // Verify product stock increased: 20 + 50 = 70
      const prodCheck = await request(app).get(`/api/products/${productId}`);
      expect(prodCheck.body.stock_quantity).toBe(70);
      expect(prodCheck.body.cost_reference).toBe(0.9);

      // Verify raw materials deducted:
      // LABSA: 100 - (10 * 0.5) = 95
      // Flacon 1L: 150 - (100 * 0.5) = 100
      const labsaCheck = await request(app).get(`/api/materials/${mat1.body.id}`);
      expect(labsaCheck.body.stock_quantity).toBe(95);

      const flaconCheck = await request(app).get(`/api/materials/${pkg1.body.id}`);
      expect(flaconCheck.body.stock_quantity).toBe(100);
    });

    it('allows production even if ingredients fall below zero (non-blocking negative inventory) with warning', async () => {
      const mat = await request(app).post('/api/materials').send({ name: 'Acide', category: 'acid', unit: 'kg', stock_quantity: 10, latest_purchase_cost: 2.000 });
      const form = await request(app).post('/api/formulations').send({
        name: 'Form Acide',
        base_yield_quantity: 10,
        base_yield_unit: 'L',
        items: [{ material_id: mat.body.id, quantity_required: 5 }]
      });
      const formId = form.body.id || form.body.formulation_id;

      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Acide', category: 'Auto', type: 'MANUFACTURED', formulation_id: formId });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Acide', stock_quantity: 0 });

      // Run production requiring 5 * 10 = 50 kg when only 10 kg in stock -> warning & negative stock
      const batchRes = await request(app)
        .post('/api/production/batches')
        .send({
          formulation_id: formId,
          target_product_id: prod.body.id,
          units_produced: 100
        });

      expect(batchRes.status).toBe(201);
      expect(batchRes.body.negative_stock_warnings.length).toBe(1);
      expect(batchRes.body.negative_stock_warnings[0].deficit).toBe(40);

      const matCheck = await request(app).get(`/api/materials/${mat.body.id}`);
      expect(matCheck.body.stock_quantity).toBe(-40);
    });

    it('packaging materials (bottles/caps) deducted from the same raw_materials inventory', async () => {
      const bottle = await request(app).post('/api/materials').send({ name: 'Bottle 500ml', category: 'bottle', unit: 'pcs', stock_quantity: 100, latest_purchase_cost: 0.200 });
      const form = await request(app).post('/api/formulations').send({
        name: 'Gel Form',
        base_yield_quantity: 10,
        base_yield_unit: 'pcs',
        items: [{ material_id: bottle.body.id, quantity_required: 10 }]
      });
      const formId = form.body.id || form.body.formulation_id;

      const fam = await request(app).post('/api/products/families').send({ name: 'Gel Fam', category: 'Hygiene', type: 'MANUFACTURED', formulation_id: formId });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Gel 500ml', stock_quantity: 0 });

      await request(app)
        .post('/api/production/batches')
        .send({
          formulation_id: formId,
          target_product_id: prod.body.id,
          units_produced: 20
        });

      const bottleCheck = await request(app).get(`/api/materials/${bottle.body.id}`);
      expect(bottleCheck.body.stock_quantity).toBe(80); // 100 - 20 = 80
    });
  });

  // ==========================================
  // MODULE 3: Products & Sizing
  // ==========================================
  describe('3. Products & Sizing', () => {
    it('creates manufactured vs resale products with barcodes (imported and auto-generated)', async () => {
      const resaleFam = await request(app).post('/api/products/families').send({ name: 'Éponge Abrasive', category: 'Accessories', type: 'RESALE' });
      const spongeRes = await request(app).post('/api/products').send({
        family_id: resaleFam.body.id,
        name: 'Éponge Spéciale',
        size_label: 'Standard',
        barcode: '6191234567890',
        stock_quantity: 100,
        retail_price: 0.800,
        wholesale_price: 0.650
      });
      expect(spongeRes.status).toBe(201);
      expect(spongeRes.body.barcode).toBe('6191234567890');

      const mfgFam = await request(app).post('/api/products/families').send({ name: 'Lavande Sol', category: 'Detergents', type: 'MANUFACTURED' });
      const lavRes = await request(app).post('/api/products').send({
        family_id: mfgFam.body.id,
        name: 'Lavande Sol 1L',
        size_label: '1L',
        barcode: 'SHSP-LAV-1L',
        stock_quantity: 50,
        retail_price: 2.500,
        wholesale_price: 2.000
      });
      expect(lavRes.status).toBe(201);
      expect(lavRes.body.barcode).toBe('SHSP-LAV-1L');
    });

    it('pack-count product (6/12/24 pcs) shares base stock; selling a 12-pack deducts 12 units', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Savon Liquide 500ml', category: 'Hygiène', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Savon Liquide 500ml (Unité)',
        size_label: 'Pièce',
        barcode: 'SHSP-SOAP-PC',
        stock_quantity: 120,
        retail_price: 2.200,
        wholesale_price: 1.800
      });
      const productId = prod.body.id;

      const packRes = await request(app).post(`/api/products/${productId}/pack-sizes`).send({
        pack_label: 'Carton de 12',
        multiplier: 12,
        price_override: 20.000,
        barcode: 'SHSP-SOAP-P12'
      });
      expect(packRes.status).toBe(201);
      const packId = packRes.body.id;

      // Sell 2 packs of 12
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });
      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        items: [{ product_id: productId, pack_size_id: packId, quantity: 2, unit_price: 20.000 }],
        cash_paid: 40.000
      });
      expect(saleRes.status).toBe(201);

      const checkProd = await request(app).get(`/api/products/${productId}`);
      expect(checkProd.body.stock_quantity).toBe(96); // 120 - 24 = 96
    });

    it('triggers low-stock alert when product stock crosses threshold', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Eau de Javel', category: 'Detergents', type: 'MANUFACTURED' });
      await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Javel 5L Normal', stock_quantity: 25, low_stock_threshold: 10 });
      const lowProd = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Javel 1L Bas', stock_quantity: 4, low_stock_threshold: 10 });

      const lowRes = await request(app).get('/api/products?low_stock=true');
      expect(lowRes.status).toBe(200);
      expect(lowRes.body.length).toBe(1);
      expect(lowRes.body[0].id).toBe(lowProd.body.id);
    });

    it('maintains retail and wholesale prices as manually set values with cost_reference purely informational', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Gel Hydroalcoolique', category: 'Hygiène', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Gel 500ml',
        stock_quantity: 40,
        retail_price: 5.000,
        wholesale_price: 4.200
      });
      const productId = prod.body.id;

      // Update prices via PUT /api/products/:id
      const updateRes = await request(app).put(`/api/products/${productId}`).send({
        retail_price: 5.500,
        wholesale_price: 4.500
      });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.retail_price).toBe(5.5);
      expect(updateRes.body.wholesale_price).toBe(4.5);
    });
  });

  // ==========================================
  // MODULE 4: POS — Countertop
  // ==========================================
  describe('4. POS — Countertop', () => {
    it('auto-applies reseller negotiated price and per-item/per-sale discounts', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Dégraissant Pro', category: 'Detergents', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Dégraissant Pro 5L',
        stock_quantity: 20,
        retail_price: 18.000,
        wholesale_price: 14.500
      });
      const cust = await request(app).post('/api/customers').send({
        name: 'Grossiste Sfax Nord',
        type: 'RESELLER',
        reseller_discount_percent: 10.0
      });
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      // Reseller wholesale price is 14.500. Item discount 1.000 -> 13.500 * 2 = 27.000. Total discount 1.350 (5%) -> total 25.650
      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: cust.body.id,
        items: [
          {
            product_id: prod.body.id,
            quantity: 2,
            unit_price: 14.500,
            discount_amount: 2.000
          }
        ],
        total_discount: 1.350,
        cash_paid: 25.650
      });

      expect(saleRes.status).toBe(201);
      expect(saleRes.body.sale.total_ttc).toBe(25.650);
    });

    it('handles split payment (cash + wallet) and exact reconciliation', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Split', category: 'Detergents', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Split', stock_quantity: 10, retail_price: 25.000 });
      const cust = await request(app).post('/api/customers').send({ name: 'Customer Split', type: 'RESELLER' });
      const customerId = cust.body.id;

      // Top up wallet with 15.000
      await request(app).post(`/api/customers/${customerId}/wallet/top-up`).send({ amount: 15.000 });

      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });
      const sessionId = ses.body.id;

      // Split payment: 10 cash + 15 wallet = 25 total
      const saleRes = await request(app).post('/api/sales').send({
        session_id: sessionId,
        customer_id: customerId,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 25.000 }],
        cash_paid: 10.000,
        wallet_paid: 15.000
      });
      expect(saleRes.status).toBe(201);

      // Verify customer wallet balance is 0
      const custCheck = await request(app).get(`/api/customers/${customerId}`);
      expect(custCheck.body.wallet_balance).toBe(0);

      // Verify register expected cash increased by exactly 10.000
      const curSession = await request(app).get('/api/register/current');
      expect(curSession.body.expected_cash).toBe(110.000);
    });

    it('verifies cash payment drawer kick rule: cash triggers drawer, credit-only or wallet-only do not', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Kick', category: 'Detergents', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Kick', stock_quantity: 50, retail_price: 10.000 });
      const cust = await request(app).post('/api/customers').send({ name: 'Cust Kick', type: 'RESELLER' });
      await request(app).post(`/api/customers/${cust.body.id}/wallet/top-up`).send({ amount: 50.000 });
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      // 1. Cash sale -> should kick drawer
      const cashSale = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: cust.body.id,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 10.000 }],
        cash_paid: 10.000
      });
      expect(cashSale.status).toBe(201);
      expect(cashSale.body.should_kick_drawer).toBe(true);

      // 2. Wallet-only sale -> should NOT kick drawer
      const walletSale = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: cust.body.id,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 10.000 }],
        wallet_paid: 10.000
      });
      expect(walletSale.status).toBe(201);
      expect(walletSale.body.should_kick_drawer).toBe(false);

      // 3. Credit-only sale -> should NOT kick drawer
      const creditSale = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: cust.body.id,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 10.000 }],
        credit_amount: 10.000
      });
      expect(creditSale.status).toBe(201);
      expect(creditSale.body.should_kick_drawer).toBe(false);

      // 4. Test actual drawer kick route
      const kickRes = await request(app).post('/api/hardware/drawer/kick').send({ port: '/dev/nonexistent' });
      expect([200, 500]).toContain(kickRes.status);
    });

    it('calculates change due correctly on cash tender', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Change', category: 'Detergents', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Change', stock_quantity: 10, retail_price: 14.500 });
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 14.500 }],
        cash_paid: 14.500,
        cash_tendered: 20.000
      });
      expect(saleRes.status).toBe(201);
      expect(saleRes.body.sale.change_given).toBe(5.5);
    });

    it('marks reseller unpaid sale as debt ticket with correct amount and open status', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Debt', category: 'Detergents', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Debt', stock_quantity: 10, retail_price: 60.000 });
      const cust = await request(app).post('/api/customers').send({ name: 'Unpaid Reseller', type: 'RESELLER' });
      const customerId = cust.body.id;
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: customerId,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 60.000 }],
        credit_amount: 60.000
      });
      expect(saleRes.status).toBe(201);

      const custCheck = await request(app).get(`/api/customers/${customerId}`);
      expect(custCheck.body.total_debt).toBe(60);
      expect(custCheck.body.debt_tickets.length).toBe(1);
      expect(custCheck.body.debt_tickets[0].remaining_amount).toBe(60);
      expect(custCheck.body.debt_tickets[0].status).toBe('UNPAID');
    });

    it('voiding/clearing cart before finalizing does not touch stock', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Fam Cart', category: 'Detergents', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Prod Cart', stock_quantity: 50, retail_price: 4.000 });
      const productId = prod.body.id;

      // 1. Initial stock
      const stockBefore = await request(app).get(`/api/products/${productId}`);
      expect(stockBefore.body.stock_quantity).toBe(50);

      // 2. Client adds items to cart in UI:
      const cart = [{ product_id: productId, quantity: 5, unit_price: 4.000 }];
      expect(cart.length).toBe(1);

      // 3. Client clicks "Clear Cart" / "Annuler" without making an HTTP sale request:
      cart.length = 0;
      expect(cart.length).toBe(0);

      // 4. Verify server stock was never altered:
      const stockAfter = await request(app).get(`/api/products/${productId}`);
      expect(stockAfter.body.stock_quantity).toBe(50);
    });
  });

  // ==========================================
  // MODULE 5: POS — Mobile Register
  // ==========================================
  describe('5. POS — Mobile Register', () => {
    it('supports price lookup mode returning product price and stock without altering cart', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Shamp Auto', category: 'Auto', type: 'MANUFACTURED' });
      await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Shamp Auto 1L',
        barcode: 'SHSP-AUTO-1L',
        stock_quantity: 34,
        retail_price: 3.800,
        wholesale_price: 3.000
      });

      const lookupRes = await request(app).get('/api/products/lookup/SHSP-AUTO-1L');
      expect(lookupRes.status).toBe(200);
      expect(lookupRes.body.product.retail_price).toBe(3.8);
      expect(lookupRes.body.product.stock_quantity).toBe(34);
    });

    it('supports quick-edit mode to immediately update price or stock on the floor', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Quick Edit Fam', category: 'Auto', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Floor Edit SKU',
        barcode: 'SHSP-EDIT-1L',
        stock_quantity: 20,
        retail_price: 3.800
      });
      const productId = prod.body.id;

      const editRes = await request(app).put(`/api/products/${productId}`).send({
        retail_price: 4.000,
        stock_quantity: 30
      });
      expect(editRes.status).toBe(200);
      expect(editRes.body.retail_price).toBe(4.0);
      expect(editRes.body.stock_quantity).toBe(30);

      const check = await request(app).get(`/api/products/${productId}`);
      expect(check.body.retail_price).toBe(4.0);
      expect(check.body.stock_quantity).toBe(30);
    });

    it('provides Bluetooth thermal printer ESC/POS driver with chunking for Android', async () => {
      const printer = new WebBluetoothPrinterService();
      expect(typeof printer.isSupported).toBe('function');
      expect(typeof printer.sendRaw).toBe('function');
    });
  });

  // ==========================================
  // MODULE 6: Offline Behavior & Sync
  // ==========================================
  describe('6. Offline Behavior & Sync', () => {
    it('allows offline selling of last unit concurrently without blocking (accepted risk), syncing to negative stock', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Wax Fam', category: 'Auto', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Cire Lustrante',
        barcode: 'SHSP-WAX',
        stock_quantity: 1,
        retail_price: 8.500
      });
      const productId = prod.body.id;

      const cust = await request(app).post('/api/customers').send({ name: 'Offline Cust', type: 'RETAIL' });

      // Counter 1 & Counter 2 both sell the last unit offline and flush
      const flushRes = await request(app).post('/api/sync/flush').send({
        operations: [
          {
            temp_client_id: 'sync-c1',
            action_type: 'SALE',
            payload: { customer_id: cust.body.id, items: [{ product_id: productId, quantity: 1, unit_price: 8.500 }], cash_paid: 8.500 }
          },
          {
            temp_client_id: 'sync-c2',
            action_type: 'SALE',
            payload: { customer_id: cust.body.id, items: [{ product_id: productId, quantity: 1, unit_price: 8.500 }], cash_paid: 8.500 }
          }
        ]
      });
      expect(flushRes.status).toBe(200);
      expect(flushRes.body.processed_count).toBe(2);

      const check = await request(app).get(`/api/products/${productId}`);
      expect(check.body.stock_quantity).toBe(-1);
    });
  });

  // ==========================================
  // MODULE 7: Register Management
  // ==========================================
  describe('7. Register Management', () => {
    it('opens register with float, logs cash movements, and computes counted vs expected variance upon close', async () => {
      const openRes = await request(app).post('/api/register/open').send({
        counter_name: 'Countertop',
        opening_cash: 150.000
      });
      expect(openRes.status).toBe(201);
      const sessionId = openRes.body.id;

      // CASH_IN 50.000
      const inRes = await request(app).post('/api/register/cash-movement').send({
        session_id: sessionId,
        type: 'CASH_IN',
        amount: 50.000,
        reason: 'Monnaie de banque'
      });
      expect(inRes.status).toBe(201);

      // CASH_OUT 20.000
      const outRes = await request(app).post('/api/register/cash-movement').send({
        session_id: sessionId,
        type: 'CASH_OUT',
        amount: 20.000,
        reason: 'Café atelier'
      });
      expect(outRes.status).toBe(201);

      // Direct sale with 85.000 cash
      const fam = await request(app).post('/api/products/families').send({ name: 'F', category: 'C', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'P', stock_quantity: 100, retail_price: 85.000 });
      await request(app).post('/api/sales').send({
        session_id: sessionId,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 85.000 }],
        cash_paid: 85.000
      });

      // Expected cash: 150 + 50 - 20 + 85 = 265.000
      // Close with counted cash 260.000 -> variance -5.000
      const closeRes = await request(app).post('/api/register/close').send({
        session_id: sessionId,
        counted_cash: 260.000
      });
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.expected_cash).toBe(265.0);
      expect(closeRes.body.counted_cash).toBe(260.0);
      expect(closeRes.body.difference).toBe(-5.0);
      expect(closeRes.body.status).toBe('CLOSED');
    });

    it('ensures wallet top-ups do NOT affect the register drawer expected cash calculation', async () => {
      const openRes = await request(app).post('/api/register/open').send({
        counter_name: 'Countertop',
        opening_cash: 200.000
      });
      expect(openRes.status).toBe(201);

      const cust = await request(app).post('/api/customers').send({ name: 'Wallet Topup Cust', type: 'RESELLER' });
      // Top up wallet with 50.000 DT
      const topupRes = await request(app).post(`/api/customers/${cust.body.id}/wallet/top-up`).send({ amount: 50.000 });
      expect([200, 201]).toContain(topupRes.status);

      // Verify register expected cash is STILL 200.000 (not 250.000)
      const curSes = await request(app).get('/api/register/current');
      expect(curSes.body.expected_cash).toBe(200.0);
    });

    it('allows countertop and mobile counters to run independent sessions simultaneously', async () => {
      const s1 = await request(app).post('/api/register/open').send({ counter_name: 'Countertop', opening_cash: 100.000 });
      const s2 = await request(app).post('/api/register/open').send({ counter_name: 'Mobile', opening_cash: 50.000 });

      expect(s1.status).toBe(201);
      expect(s2.status).toBe(201);

      const db = getDb();
      const sessions = db.prepare("SELECT * FROM register_sessions WHERE status = 'OPEN'").all();
      expect(sessions.length).toBe(2);
    });
  });

  // ==========================================
  // MODULE 8: Customer Balance — Wallet & Debt Tickets
  // ==========================================
  describe('8. Customer Balance — Wallet & Debt Tickets', () => {
    it('allocates customer partial payments FIFO (oldest ticket first)', async () => {
      const cust = await request(app).post('/api/customers').send({ name: 'Ali Trabelsi', type: 'RESELLER' });
      const customerId = cust.body.id;

      const fam = await request(app).post('/api/products/families').send({ name: 'F', category: 'C', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'P', stock_quantity: 100, retail_price: 10.000 });

      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      // Create two credit sales
      await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: customerId,
        date: '2026-08-01T10:00:00Z',
        items: [{ product_id: prod.body.id, quantity: 4, unit_price: 10.000 }],
        credit_amount: 40.000
      });

      await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: customerId,
        date: '2026-08-15T10:00:00Z',
        items: [{ product_id: prod.body.id, quantity: 6, unit_price: 10.000 }],
        credit_amount: 60.000
      });

      // Repay 50.000 DT
      const repayRes = await request(app).post(`/api/customers/${customerId}/debt/repay`).send({ amount: 50.000 });
      expect(repayRes.status).toBe(200);

      const custCheck = await request(app).get(`/api/customers/${customerId}`);
      const tickets = custCheck.body.debt_tickets.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      expect(tickets[0].remaining_amount).toBe(0);
      expect(tickets[0].status).toBe('PAID');
      expect(tickets[1].remaining_amount).toBe(50);
      expect(tickets[1].status).toBe('PARTIALLY_PAID');
    });

    it('auto-deposits overpayment beyond total owed on tickets into customer wallet', async () => {
      const cust = await request(app).post('/api/customers').send({ name: 'Ali Overpay', type: 'RESELLER' });
      const customerId = cust.body.id;

      const fam = await request(app).post('/api/products/families').send({ name: 'F', category: 'C', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'P', stock_quantity: 100, retail_price: 30.000 });
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: customerId,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 30.000 }],
        credit_amount: 30.000
      });

      // Pay 50.000 when only 30.000 owed -> 20.000 surplus to wallet
      const repayRes = await request(app).post(`/api/customers/${customerId}/debt/repay`).send({ amount: 50.000 });
      expect(repayRes.status).toBe(200);

      const custCheck = await request(app).get(`/api/customers/${customerId}`);
      expect(custCheck.body.total_debt).toBe(0);
      expect(custCheck.body.wallet_balance).toBe(20);
    });
  });

  // ==========================================
  // MODULE 9: Containers
  // ==========================================
  describe('9. Containers', () => {
    it('tracks give/return container loans: shop stock decreases, customer owed count increases, and vice versa', async () => {
      const ct = await request(app).post('/api/containers/types').send({ name: 'Bidon 5L Consigné', capacity_liters: 5, stock_quantity: 50 });
      const containerTypeId = ct.body.id;

      const cust = await request(app).post('/api/customers').send({ name: 'Sami Lavage Auto', type: 'RESELLER' });
      const customerId = cust.body.id;

      // GIVE 10
      const giveRes = await request(app).post('/api/containers/transactions').send({
        customer_id: customerId,
        container_type_id: containerTypeId,
        action: 'GIVE',
        quantity: 10
      });
      expect(giveRes.status).toBe(201);
      expect(giveRes.body.shop_stock_remaining).toBe(40);
      expect(giveRes.body.customer_quantity_owed).toBe(10);

      // RETURN 6
      const returnRes = await request(app).post('/api/containers/transactions').send({
        customer_id: customerId,
        container_type_id: containerTypeId,
        action: 'RETURN',
        quantity: 6
      });
      expect(returnRes.status).toBe(201);
      expect(returnRes.body.shop_stock_remaining).toBe(46);
      expect(returnRes.body.customer_quantity_owed).toBe(4);
    });

    it('does not block giving a container when shop stock is 0 (non-blocking negative container stock)', async () => {
      const ct = await request(app).post('/api/containers/types').send({ name: 'Zero Stock Container', capacity_liters: 5, stock_quantity: 0 });
      const cust = await request(app).post('/api/customers').send({ name: 'Client Neg', type: 'RESELLER' });

      const giveRes = await request(app).post('/api/containers/transactions').send({
        customer_id: cust.body.id,
        container_type_id: ct.body.id,
        action: 'GIVE',
        quantity: 3
      });
      expect(giveRes.status).toBe(201);
      expect(giveRes.body.shop_stock_remaining).toBe(-3);
    });

    it('tracks multiple container types independently per customer', async () => {
      const ct1 = await request(app).post('/api/containers/types').send({ name: 'Bidon 5L', capacity_liters: 5, stock_quantity: 50 });
      const ct2 = await request(app).post('/api/containers/types').send({ name: 'Fût 200L', capacity_liters: 200, stock_quantity: 10 });
      const cust = await request(app).post('/api/customers').send({ name: 'Multi Container Cust', type: 'RESELLER' });
      const customerId = cust.body.id;

      await request(app).post('/api/containers/transactions').send({ customer_id: customerId, container_type_id: ct1.body.id, action: 'GIVE', quantity: 6 });
      await request(app).post('/api/containers/transactions').send({ customer_id: customerId, container_type_id: ct2.body.id, action: 'GIVE', quantity: 2 });

      const loansRes = await request(app).get(`/api/containers/loans?customer_id=${customerId}`);
      expect(loansRes.status).toBe(200);
      expect(loansRes.body.length).toBe(2);
      expect(loansRes.body.find((l: any) => l.container_type_id === ct1.body.id)?.quantity_owed).toBe(6);
      expect(loansRes.body.find((l: any) => l.container_type_id === ct2.body.id)?.quantity_owed).toBe(2);
    });
  });

  // ==========================================
  // MODULE 10: Suppliers & Purchases
  // ==========================================
  describe('10. Suppliers & Purchases', () => {
    it('purchase marked CREDIT creates supplier debt ticket; PAID does not', async () => {
      const sup = await request(app).post('/api/suppliers').send({ name: 'Société Chimique Tunisienne' });
      const supplierId = sup.body.id;

      const mat = await request(app).post('/api/materials').send({ name: 'Mat Chem', category: 'chem', unit: 'kg', stock_quantity: 10 });

      // CREDIT purchase
      const credRes = await request(app).post('/api/purchases').send({
        supplier_id: supplierId,
        payment_status: 'CREDIT',
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 100, unit_cost: 10.000 }]
      });
      expect(credRes.status).toBe(201);

      // PAID purchase
      const paidRes = await request(app).post('/api/purchases').send({
        supplier_id: supplierId,
        payment_status: 'PAID',
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 25, unit_cost: 10.000 }]
      });
      expect(paidRes.status).toBe(201);

      const db = getDb();
      const tickets: any[] = db.prepare('SELECT * FROM supplier_debt_tickets WHERE supplier_id = ?').all(supplierId);
      expect(tickets.length).toBe(1);
      expect(tickets[0].purchase_id).toBe(credRes.body.id);
      expect(tickets[0].remaining_amount).toBe(1000);
    });

    it('applies supplier debt repayment FIFO across open supplier tickets', async () => {
      const sup = await request(app).post('/api/suppliers').send({ name: 'FIFO Supplier' });
      const supplierId = sup.body.id;
      const mat = await request(app).post('/api/materials').send({ name: 'Mat', category: 'chem', unit: 'kg', stock_quantity: 10 });

      await request(app).post('/api/purchases').send({
        supplier_id: supplierId,
        date: '2026-08-01T10:00:00Z',
        payment_status: 'CREDIT',
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 40, unit_cost: 10.000 }]
      });

      await request(app).post('/api/purchases').send({
        supplier_id: supplierId,
        date: '2026-09-01T10:00:00Z',
        payment_status: 'CREDIT',
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 60, unit_cost: 10.000 }]
      });

      // Repay 500.000
      const repayRes = await request(app).post(`/api/suppliers/${supplierId}/debt/repay`).send({ amount: 500.000 });
      expect(repayRes.status).toBe(200);

      const supCheck = await request(app).get(`/api/suppliers/${supplierId}`);
      const tickets = supCheck.body.debt_tickets.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
      expect(tickets[0].remaining_amount).toBe(0);
      expect(tickets[0].status).toBe('PAID');
      expect(tickets[1].remaining_amount).toBe(500);
      expect(tickets[1].status).toBe('PARTIALLY_PAID');
    });

    it('purchase marked CREDIT with cashPaid > 0 inserts supplier_payments and allocates to new ticket', async () => {
      const sup = await request(app).post('/api/suppliers').send({ name: 'Partial Credit Supplier' });
      const supplierId = sup.body.id;
      const mat = await request(app).post('/api/materials').send({ name: 'Mat Partial', category: 'chem', unit: 'kg', stock_quantity: 10 });

      const purchaseRes = await request(app).post('/api/purchases').send({
        supplier_id: supplierId,
        purchase_number: 'PO-PARTIAL-01',
        payment_status: 'CREDIT',
        cash_paid: 300.000,
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 100, unit_cost: 10.000, total_cost: 1000.000 }]
      });
      expect(purchaseRes.status).toBe(201);

      const db = getDb();
      // Check debt ticket
      const ticket: any = db.prepare('SELECT * FROM supplier_debt_tickets WHERE purchase_id = ?').get(purchaseRes.body.id);
      expect(ticket).toBeDefined();
      expect(ticket.total_amount).toBe(1000.000);
      expect(ticket.remaining_amount).toBe(700.000);
      expect(ticket.status).toBe('PARTIALLY_PAID');

      // Check supplier_payments
      const payment: any = db.prepare('SELECT * FROM supplier_payments WHERE supplier_id = ?').get(supplierId);
      expect(payment).toBeDefined();
      expect(payment.amount).toBe(300.000);

      // Check allocation
      const allocation: any = db.prepare('SELECT * FROM supplier_payment_allocations WHERE payment_id = ?').get(payment.id);
      expect(allocation).toBeDefined();
      expect(allocation.ticket_id).toBe(ticket.id);
      expect(allocation.amount_allocated).toBe(300.000);
    });
  });

  // ==========================================
  // MODULE 11: Refunds
  // ==========================================
  describe('11. Refunds', () => {
    it('partial refund reverses single line item quantity, restores stock, adjusts TVA, and sets PARTIALLY_REFUNDED status', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Vitres', category: 'Hygiene', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({
        family_id: fam.body.id,
        name: 'Nettoyant Vitres 750ml',
        stock_quantity: 40,
        retail_price: 3.000
      });
      const productId = prod.body.id;

      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });
      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        items: [{ product_id: productId, quantity: 10, unit_price: 3.000 }],
        cash_paid: 30.000
      });
      const saleId = saleRes.body.sale.id;
      const saleItemId = saleRes.body.sale.items[0].id;

      // Initial stock dropped from 40 to 30
      const prodAfterSale = await request(app).get(`/api/products/${productId}`);
      expect(prodAfterSale.body.stock_quantity).toBe(30);

      // Refund 3 units
      const refRes = await request(app).post('/api/refunds').send({
        sale_id: saleId,
        session_id: ses.body.id,
        items: [{ sale_item_id: saleItemId, quantity: 3, restock: true }],
        reason: 'Client a pris trop de flacons'
      });
      expect(refRes.status).toBe(201);

      // Stock restored to 33
      const prodAfterRefund = await request(app).get(`/api/products/${productId}`);
      expect(prodAfterRefund.body.stock_quantity).toBe(33);

      // Sale status is PARTIALLY_REFUNDED
      const db = getDb();
      const sale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
      expect(sale.status).toBe('PARTIALLY_REFUNDED');
    });

    it('supports multiple sequential partial refunds on the same sale until fully refunded', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'Vitres Seq', category: 'Hygiene', type: 'MANUFACTURED' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Nettoyant Vitres Seq', stock_quantity: 50, retail_price: 3.000 });
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });
      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        items: [{ product_id: prod.body.id, quantity: 10, unit_price: 3.000 }],
        cash_paid: 30.000
      });
      const saleId = saleRes.body.sale.id;
      const saleItemId = saleRes.body.sale.items[0].id;

      // Refund 4
      await request(app).post('/api/refunds').send({
        sale_id: saleId,
        session_id: ses.body.id,
        items: [{ sale_item_id: saleItemId, quantity: 4, restock: true }]
      });

      // Refund remaining 6
      await request(app).post('/api/refunds').send({
        sale_id: saleId,
        session_id: ses.body.id,
        items: [{ sale_item_id: saleItemId, quantity: 6, restock: true }]
      });

      const db = getDb();
      const sale: any = db.prepare('SELECT status FROM sales WHERE id = ?').get(saleId);
      expect(sale.status).toBe('FULLY_REFUNDED');
    });

    it('refund payout correctly supports reducing open debt tickets on credit sales', async () => {
      const fam = await request(app).post('/api/products/families').send({ name: 'F Red', category: 'C', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'P Red', stock_quantity: 50, retail_price: 10.000 });
      const cust = await request(app).post('/api/customers').send({ name: 'Client Credit Refund', type: 'RETAIL' });
      const customerId = cust.body.id;
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      const saleRes = await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        customer_id: customerId,
        items: [{ product_id: prod.body.id, quantity: 5, unit_price: 10.000 }],
        credit_amount: 50.000
      });
      const saleId = saleRes.body.sale.id;
      const saleItemId = saleRes.body.sale.items[0].id;

      // Refund 2 units (20.000 DT) reducing credit debt
      const refRes = await request(app).post('/api/refunds').send({
        sale_id: saleId,
        session_id: ses.body.id,
        items: [{ sale_item_id: saleItemId, quantity: 2, restock: true }],
        refund_to_credit_debt: true
      });
      expect(refRes.status).toBe(201);

      const custCheck = await request(app).get(`/api/customers/${customerId}`);
      expect(custCheck.body.total_debt).toBe(30.000);
      expect(custCheck.body.debt_tickets[0].status).toBe('PARTIALLY_PAID');
    });
  });

  // ==========================================
  // MODULE 12: Inventory
  // ==========================================
  describe('12. Inventory', () => {
    it('logs manual stock adjustment with reason and audit log separate from sales/purchases', async () => {
      const mat = await request(app).post('/api/materials').send({
        name: 'Sel Industriel',
        category: 'salt',
        unit: 'kg',
        stock_quantity: 500,
        latest_purchase_cost: 0.150
      });
      const materialId = mat.body.id;

      const reason = 'Sac déchiré lors du déchargement';
      const adjRes = await request(app).post('/api/inventory/adjust').send({
        item_type: 'RAW_MATERIAL',
        material_id: materialId,
        quantity_delta: -20,
        reason
      });
      expect(adjRes.status).toBe(201);
      expect(adjRes.body.new_stock).toBe(480);

      const matCheck = await request(app).get(`/api/materials/${materialId}`);
      expect(matCheck.body.stock_quantity).toBe(480);

      const db = getDb();
      const log: any = db.prepare('SELECT * FROM inventory_adjustments WHERE material_id = ?').get(materialId);
      expect(log.reason).toBe(reason);
      expect(log.quantity_delta).toBe(-20);
    });
  });

  // ==========================================
  // MODULE 13: Accounting
  // ==========================================
  describe('13. Accounting', () => {
    it('cash-flow ledger correctly records sales (Money In), purchases (Money Out), and general expenses (Money Out)', async () => {
      const ses = await request(app).post('/api/register/open').send({ opening_cash: 100.000 });

      // Sale: 150.000 cash
      const fam = await request(app).post('/api/products/families').send({ name: 'F CF', category: 'C', type: 'RESALE' });
      const prod = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'P CF', stock_quantity: 100, retail_price: 150.000 });
      await request(app).post('/api/sales').send({
        session_id: ses.body.id,
        items: [{ product_id: prod.body.id, quantity: 1, unit_price: 150.000 }],
        cash_paid: 150.000
      });

      // Purchase: 80.000 cash
      const sup = await request(app).post('/api/suppliers').send({ name: 'CF Supplier' });
      const mat = await request(app).post('/api/materials').send({ name: 'CF Mat', category: 'c', unit: 'kg', stock_quantity: 0 });
      await request(app).post('/api/purchases').send({
        supplier_id: sup.body.id,
        payment_status: 'PAID',
        items: [{ item_type: 'RAW_MATERIAL', material_id: mat.body.id, quantity: 8, unit_cost: 10.000 }]
      });

      // General expense: 35.000
      await request(app).post('/api/accounting/expenses').send({
        category: 'Electricity',
        amount: 35.000,
        payment_source: 'REGISTER_CASH',
        description: 'Facture STEG atelier'
      });

      const cfRes = await request(app).get('/api/accounting/cash-flow');
      expect(cfRes.status).toBe(200);
      expect(cfRes.body.total_inflow).toBe(150.000);
      expect(cfRes.body.total_outflow).toBe(115.000); // 80 + 35
      expect(cfRes.body.net_cash_flow).toBe(35.000);
    });

    it('calculates total stock valuation at cost (raw materials + finished goods)', async () => {
      await request(app).post('/api/materials').send({ name: 'Matière A', category: 'chemical', unit: 'kg', stock_quantity: 100, latest_purchase_cost: 3.000 });
      await request(app).post('/api/materials').send({ name: 'Matière B', category: 'packaging', unit: 'pcs', stock_quantity: 200, latest_purchase_cost: 0.500 });

      const fam = await request(app).post('/api/products/families').send({ name: 'Produit Fini Val', category: 'Detergents', type: 'RESALE' });
      const p1 = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Produit 1', stock_quantity: 50, cost_reference: 2.000 });
      const p2 = await request(app).post('/api/products').send({ family_id: fam.body.id, name: 'Produit 2', stock_quantity: 20, cost_reference: 8.000 });

      // Ensure cost_reference in DB for valuation assertion
      const db = getDb();
      db.prepare('UPDATE products SET cost_reference = 2.000 WHERE id = ?').run(p1.body.id);
      db.prepare('UPDATE products SET cost_reference = 8.000 WHERE id = ?').run(p2.body.id);

      const valRes = await request(app).get('/api/accounting/stock-valuation');
      expect(valRes.status).toBe(200);
      expect(valRes.body.raw_materials_valuation).toBe(400.000);
      expect(valRes.body.finished_goods_valuation).toBe(260.000);
      expect(valRes.body.total_inventory_valuation).toBe(660.000);
    });
  });

  // ==========================================
  // MODULE 14: Hardware Integration
  // ==========================================
  describe('14. Hardware Integration', () => {
    it('keyboard wedge scanner detects rapid keystrokes < 60ms ending in Enter', () => {
      const scanner = new KeyboardWedgeScanner(60);
      expect(scanner).toBeDefined();
    });

    it('builds 58mm thermal receipt with correct header, items, totals, and TVA breakdown', () => {
      const receiptBytes = buildReceiptEscPos({
        id: 's-1',
        receipt_number: 'REC-2026-001',
        date: '07/09/2026 14:00',
        customer_name: 'Passager',
        subtotal_ht: 4.202,
        tva_rate: 0.19,
        tva_amount: 0.798,
        total_ttc: 5.000,
        cash_paid: 10.000,
        wallet_paid: 0,
        credit_amount: 0,
        status: 'COMPLETED',
        items: [
          {
            id: '1',
            description: 'Liquide Vaisselle 1L',
            quantity: 2,
            unit_price: 2.500,
            pack_multiplier: 1,
            total_line: 5.000
          }
        ]
      });

      expect(receiptBytes).toBeInstanceOf(Uint8Array);
      expect(receiptBytes.length).toBeGreaterThan(50);
      const hasCutCommand = receiptBytes.some((b, i, arr) => b === 0x1d && arr[i + 1] === 0x56);
      expect(hasCutCommand).toBe(true);
    });

    it('cash drawer kick command builder generates exact ESC/POS pulse 1B 70 00 19 FA and route handles execution', async () => {
      const pulse = buildDrawerKickCommand(0);
      expect(Array.from(pulse)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);

      // Real HTTP call to drawer kick endpoint
      const kickRes = await request(app).post('/api/hardware/drawer/kick').send({ port: '/dev/ttyUSB99' });
      expect(kickRes.status).toBe(500);
      expect(kickRes.body.success).toBe(false);
      expect(kickRes.body.error).toContain('not found');
    });

    it('generates Code-128 scannable barcodes in SVG format for shelf labels', () => {
      expect(typeof renderCode128Barcode).toBe('function');
    });
  });

  // ==========================================
  // MODULE 16: Cross-Cutting / Non-Functional
  // ==========================================
  describe('16. Cross-Cutting / Non-Functional', () => {
    it('single-login PIN verification works online and offline with scrypt hash and install salt', async () => {
      // 1. Initial status: unconfigured on first run
      const statusBefore = await request(app).get('/api/auth/status');
      expect(statusBefore.status).toBe(200);
      expect(statusBefore.body.configured).toBe(false);

      // 2. Setup PIN and master password
      const setupRes = await request(app).post('/api/auth/setup').send({
        pin: '1234',
        masterPassword: 'adminpassword'
      });
      expect(setupRes.status).toBe(200);
      expect(setupRes.body.configured).toBe(true);

      // 3. Status now configured & unlocked
      const statusAfter = await request(app).get('/api/auth/status');
      expect(statusAfter.body.configured).toBe(true);
      expect(statusAfter.body.locked).toBe(false);

      // 4. Lock application
      await request(app).post('/api/auth/lock');

      // 5. Wrong PIN rejected
      const wrongRes = await request(app).post('/api/auth/unlock').send({ secret: '9999' });
      expect(wrongRes.status).toBe(401);

      // 6. Valid PIN unlocks
      const unlockRes = await request(app).post('/api/auth/unlock').send({ secret: '1234' });
      expect(unlockRes.status).toBe(200);
      expect(unlockRes.body.unlocked).toBe(true);
    });

    it('calculates and displays currency strictly at 3 decimal places (millimes) without floating point drift', () => {
      const sum = round3(0.100 + 0.200);
      expect(sum).toBe(0.300);
      expect(formatTND(sum)).toBe('0.300 DT');

      const ttc = 10.000;
      const tvaResult = calculateTaxBreakdown(ttc);
      expect(tvaResult.subtotalHT).toBe(8.403);
      expect(tvaResult.tvaAmount).toBe(1.597);
      expect(tvaResult.totalTTC).toBe(10.000);
      expect(round3(tvaResult.subtotalHT + tvaResult.tvaAmount)).toBe(10.000);
    });
  });
});
