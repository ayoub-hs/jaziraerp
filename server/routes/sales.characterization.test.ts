import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, app, request, getDb } from '../../tests/testApp.js';
import { round3 } from '../utils/money.js';

describe('POST /api/sales Characterization Tests (Phase 0 Baseline)', () => {
  beforeEach(() => {
    const db = resetTestDb();

    // 1. Seed customers
    db.prepare(`
      INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at)
      VALUES
        ('cust-retail', 'Walk-in Retail', 'RETAIL', 0, 0, '2026-10-01', '2026-10-01'),
        ('cust-wallet', 'Wallet Customer', 'RETAIL', 0, 50.000, '2026-10-01', '2026-10-01'),
        ('cust-reseller', 'Pro Reseller', 'RESELLER', 10, 0, '2026-10-01', '2026-10-01'),
        ('cust-wholesale', 'Wholesale Pro', 'WHOLESALE', 0, 0, '2026-10-01', '2026-10-01')
    `).run();

    // 2. Seed families
    db.prepare(`
      INSERT INTO product_families (id, name, category, type, created_at, updated_at)
      VALUES ('fam-cleaners', 'Surface Cleaners', 'Detergents', 'MANUFACTURED', '2026-10-01', '2026-10-01')
    `).run();

    // 3. Seed container types
    db.prepare(`
      INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
      VALUES
        ('ct-bidon-1l', 'Bidon 1L', 1.0, 50, '2026-10-01'),
        ('ct-bidon-10l', 'Bidon 10L Consigné', 10.0, 20, '2026-10-01')
    `).run();

    // 4. Seed products
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, container_type_id, created_at, updated_at)
      VALUES
        ('prod-clean-1l', 'fam-cleaners', 'Floor Cleaner 1L', '1L', '619000123456', 100, 3.000, 2.500, 'ct-bidon-1l', '2026-10-01', '2026-10-01'),
        ('prod-bulk-vaisselle', 'fam-cleaners', 'Liquide Vaisselle Vrac', NULL, '619000999888', 200, 1.800, 1.400, 'ct-bidon-10l', '2026-10-01', '2026-10-01')
    `).run();

    // 5. Seed pack sizes
    db.prepare(`
      INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode)
      VALUES
        ('pack-12-clean', 'prod-clean-1l', 'Box of 12', 12, 33.000, '619000123412'),
        ('pack-6-clean', 'prod-clean-1l', 'Box of 6', 6, NULL, '619000123406'),
        ('pack-other', 'prod-bulk-vaisselle', 'Drum of 5', 5, NULL, '619000999005')
    `).run();

    // 6. Seed register sessions
    db.prepare(`
      INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status)
      VALUES
        ('ses-open', 'SES-01', 'Comptoir Principal', '2026-10-01 08:00:00', 100.000, 100.000, 'OPEN'),
        ('ses-closed', 'SES-00', 'Comptoir Fermé', '2026-09-30 08:00:00', 50.000, 50.000, 'CLOSED')
    `).run();
  });

  describe('1. Exact Cash Sale & Complete Response Shape Parity', () => {
    it('creates an exact cash sale, decrements stock, records sale items, and returns exact response structure', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-retail',
          items: [
            {
              product_id: 'prod-clean-1l',
              quantity: 2,
              unit_price: 3.000
            }
          ],
          cash_paid: 6.000,
          cash_tendered: 6.000
        });

      expect(res.status).toBe(201);
      const b = res.body;

      // Verify top-level response structure
      expect(typeof b.id).toBe('string');
      expect(b.id).toBe(b.sale_id);
      expect(b.receipt_number).toMatch(/^REC-\d{8}-\d{4}$/);
      expect(b.session_id).toBe('ses-open');
      expect(b.customer_id).toBe('cust-retail');
      expect(b.total_ttc).toBe(6.000);
      expect(b.subtotal_ht).toBe(round3(6.000 / 1.19));
      expect(b.tva_amount).toBe(round3(6.000 - 6.000 / 1.19));
      expect(b.cash_paid).toBe(6.000);
      expect(b.wallet_paid).toBe(0);
      expect(b.credit_amount).toBe(0);
      expect(b.change_given).toBe(0);
      expect(b.open_cash_drawer).toBe(true);
      expect(b.should_kick_drawer).toBe(true);
      expect(b.debt_ticket).toBeNull();
      expect(b.container_loans).toEqual([]);

      // Verify items shape
      expect(Array.isArray(b.items)).toBe(true);
      expect(b.items).toHaveLength(1);
      const item = b.items[0];
      expect(item.product_id).toBe('prod-clean-1l');
      expect(item.quantity).toBe(2);
      expect(item.unit_price).toBe(3.000);
      expect(item.catalog_unit_price).toBe(3.000);
      expect(item.overridden).toBe(false);
      expect(item.discount_amount).toBe(0);
      expect(item.line_total).toBe(6.000);
      expect(item.base_stock_deducted).toBe(2);
      expect(item.pack_multiplier).toBe(1);
      expect(item.is_quick_add).toBe(0);
      expect(item.loan_container).toBe(false);

      // Verify mirrored sale object
      expect(b.sale).toBeDefined();
      expect(b.sale.id).toBe(b.id);
      expect(b.sale.receipt_number).toBe(b.receipt_number);
      expect(b.sale.total_ttc).toBe(6.000);

      // Verify database state
      const db = getDb();
      const productRow: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
      expect(productRow.stock_quantity).toBe(98); // 100 - 2

      const saleRow: any = db.prepare('SELECT * FROM sales WHERE id = ?').get(b.id);
      expect(saleRow).toBeDefined();
      expect(saleRow.status).toBe('COMPLETED');
      expect(saleRow.receipt_number).toBe(b.receipt_number);
      expect(saleRow.cash_paid).toBe(6.000);
      expect(saleRow.wallet_paid).toBe(0);
      expect(saleRow.credit_amount).toBe(0);

      const saleItemRow: any = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(b.id);
      expect(saleItemRow).toBeDefined();
      expect(saleItemRow.product_id).toBe('prod-clean-1l');
      expect(saleItemRow.quantity).toBe(2);
      expect(saleItemRow.base_stock_deducted).toBe(2);
      expect(saleItemRow.line_total).toBe(6.000);
    });
  });

  describe('2. Cash Tendered with Change Due', () => {
    it('computes change_given server-side and flags cash drawer kick', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-retail',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 10.000
        });

      expect(res.status).toBe(201);
      expect(res.body.total_ttc).toBe(3.000);
      expect(res.body.cash_paid).toBe(3.000);
      expect(res.body.change_given).toBe(7.000);
      expect(res.body.open_cash_drawer).toBe(true);
      expect(res.body.should_kick_drawer).toBe(true);

      const db = getDb();
      const saleRow: any = db.prepare('SELECT change_given FROM sales WHERE id = ?').get(res.body.id);
      expect(saleRow.change_given).toBe(7.000);
    });
  });

  describe('3. Cash + Wallet Split Payment', () => {
    it('applies split tender, deducts customer wallet balance, logs wallet transaction, and kicks drawer', async () => {
      // 5 units @ 3.000 = 15.000 DT. Pay 5.000 cash, 10.000 wallet. Customer has 50.000.
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-wallet',
          items: [{ product_id: 'prod-clean-1l', quantity: 5, unit_price: 3.000 }],
          cash_paid: 5.000,
          cash_tendered: 5.000,
          wallet_paid: 10.000
        });

      expect(res.status).toBe(201);
      expect(res.body.total_ttc).toBe(15.000);
      expect(res.body.cash_paid).toBe(5.000);
      expect(res.body.wallet_paid).toBe(10.000);
      expect(res.body.should_kick_drawer).toBe(true);

      const db = getDb();
      const custRow: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-wallet');
      expect(custRow.wallet_balance).toBe(40.000); // 50 - 10

      const walletTx: any = db.prepare('SELECT * FROM customer_wallet_transactions WHERE customer_id = ?').get('cust-wallet');
      expect(walletTx).toBeDefined();
      expect(walletTx.type).toBe('SALE_PAYMENT');
      expect(walletTx.amount).toBe(10.000);
      expect(walletTx.reference_id).toBe(res.body.id);
      expect(walletTx.notes).toBe('POS Checkout wallet payment');
    });

    it('pure wallet payment does NOT kick the drawer', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-wallet',
          items: [{ product_id: 'prod-clean-1l', quantity: 2, unit_price: 3.000 }],
          cash_paid: 0,
          wallet_paid: 6.000
        });

      expect(res.status).toBe(201);
      expect(res.body.open_cash_drawer).toBe(false);
      expect(res.body.should_kick_drawer).toBe(false);
    });
  });

  describe('4. Wallet Insufficient & Edge Cases', () => {
    it('rejects sale when wallet_paid exceeds customer available balance without modifying state', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-wallet',
          items: [{ product_id: 'prod-clean-1l', quantity: 25, unit_price: 3.000 }], // 75.000 DT
          wallet_paid: 60.000, // Available: 50.000 DT
          cash_paid: 15.000,
          cash_tendered: 15.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Insufficient wallet balance/i);

      // Verify no DB changes
      const db = getDb();
      const cust: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get('cust-wallet');
      expect(cust.wallet_balance).toBe(50.000);
      const prod: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
      expect(prod.stock_quantity).toBe(100);
    });

    it('rejects wallet payment when no customer is selected', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          wallet_paid: 3.000,
          cash_paid: 0
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot pay with wallet without selecting a customer');
    });
  });

  describe('5. Credit with Customer & FIFO Debt Ticket', () => {
    it('creates an UNPAID customer debt ticket when credit is used with a customer', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-retail',
          items: [{ product_id: 'prod-clean-1l', quantity: 4, unit_price: 3.000 }],
          credit_amount: 12.000,
          cash_paid: 0
        });

      expect(res.status).toBe(201);
      expect(res.body.credit_amount).toBe(12.000);
      expect(res.body.open_cash_drawer).toBe(false);
      expect(res.body.should_kick_drawer).toBe(false);

      const ticket = res.body.debt_ticket;
      expect(ticket).toBeDefined();
      expect(ticket.ticket_number).toMatch(/^TKT-\d{8}-\d{4}$/);
      expect(ticket.total_amount).toBe(12.000);
      expect(ticket.remaining_amount).toBe(12.000);
      expect(ticket.status).toBe('UNPAID');

      const db = getDb();
      const ticketRow: any = db.prepare('SELECT * FROM customer_debt_tickets WHERE sale_id = ?').get(res.body.id);
      expect(ticketRow).toBeDefined();
      expect(ticketRow.ticket_number).toBe(ticket.ticket_number);
      expect(ticketRow.total_amount).toBe(12.000);
      expect(ticketRow.remaining_amount).toBe(12.000);
      expect(ticketRow.status).toBe('UNPAID');
    });

    it('rejects credit sale when no customer is selected', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 2, unit_price: 3.000 }],
          credit_amount: 6.000,
          cash_paid: 0
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Credit sale (unpaid balance) requires selecting a customer');
    });
  });

  describe('6. Pack Size Lines', () => {
    it('applies pack multiplier to stock deduction and persists pack size details', async () => {
      // Selling 2 packs of 'pack-12-clean' (multiplier 12) -> 24 base units deducted
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              product_id: 'prod-clean-1l',
              pack_size_id: 'pack-12-clean',
              quantity: 2,
              unit_price: 33.000
            }
          ],
          cash_paid: 66.000,
          cash_tendered: 70.000
        });

      expect(res.status).toBe(201);
      expect(res.body.change_given).toBe(4.000);

      const item = res.body.items[0];
      expect(item.pack_size_id).toBe('pack-12-clean');
      expect(item.pack_multiplier).toBe(12);
      expect(item.base_stock_deducted).toBe(24);

      const db = getDb();
      const prodRow: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
      expect(prodRow.stock_quantity).toBe(76); // 100 - 24

      const itemRow: any = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(res.body.id);
      expect(itemRow.pack_size_id).toBe('pack-12-clean');
      expect(itemRow.pack_multiplier).toBe(12);
      expect(itemRow.base_stock_deducted).toBe(24);
    });

    it('rejects pack size that does not belong to the product', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              product_id: 'prod-clean-1l',
              pack_size_id: 'pack-other', // belongs to prod-bulk-vaisselle
              quantity: 1,
              unit_price: 15.000
            }
          ],
          cash_paid: 15.000,
          cash_tendered: 15.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Pack size pack-other does not belong to product prod-clean-1l');
    });

    it('rejects non-existent pack size', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              product_id: 'prod-clean-1l',
              pack_size_id: 'pack-ghost',
              quantity: 1,
              unit_price: 15.000
            }
          ],
          cash_paid: 15.000,
          cash_tendered: 15.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Pack size not found: pack-ghost');
    });
  });

  describe('7. Container Loans with and without Customer', () => {
    it('records container loans, decrements container stock, and upserts customer loans', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-retail',
          items: [
            {
              product_id: 'prod-clean-1l',
              quantity: 3,
              unit_price: 3.000,
              loan_container: true
            }
          ],
          cash_paid: 9.000,
          cash_tendered: 10.000
        });

      expect(res.status).toBe(201);
      expect(res.body.container_loans).toHaveLength(1);
      expect(res.body.container_loans[0].container_type_id).toBe('ct-bidon-1l');
      expect(res.body.container_loans[0].quantity).toBe(3);

      const db = getDb();
      // Shop container stock decremented: 50 - 3 = 47
      const ctRow: any = db.prepare('SELECT stock_quantity FROM container_types WHERE id = ?').get('ct-bidon-1l');
      expect(ctRow.stock_quantity).toBe(47);

      // Customer container loan updated
      const loanRow: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?')
        .get('cust-retail', 'ct-bidon-1l');
      expect(loanRow.quantity_owed).toBe(3);

      // Container transaction logged with GIVE
      const txRow: any = db.prepare('SELECT * FROM container_transactions WHERE customer_id = ? AND action = ?')
        .get('cust-retail', 'GIVE');
      expect(txRow).toBeDefined();
      expect(txRow.quantity).toBe(3);
      expect(txRow.notes).toContain(res.body.receipt_number);
    });

    it('rejects container loan when customer is not provided', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              product_id: 'prod-clean-1l',
              quantity: 1,
              unit_price: 3.000,
              loan_container: true
            }
          ],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Loaning a container requires selecting a customer.');
    });
  });

  describe('8. Quick-Add Line Items', () => {
    it('processes uncataloged quick-add items without deducting product inventory', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              is_quick_add: true,
              quick_add_name: 'Custom Service Cleaning',
              quantity: 2,
              unit_price: 15.000
            }
          ],
          cash_paid: 30.000,
          cash_tendered: 30.000
        });

      expect(res.status).toBe(201);
      const item = res.body.items[0];
      expect(item.is_quick_add).toBe(1);
      expect(item.quick_add_name).toBe('Custom Service Cleaning');
      expect(item.base_stock_deducted).toBe(0);
      expect(item.product_id).toBeNull();

      const db = getDb();
      // No products stock changed
      const prodRow: any = db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get('prod-clean-1l');
      expect(prodRow.stock_quantity).toBe(100);

      const saleItemRow: any = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').get(res.body.id);
      expect(saleItemRow.is_quick_add).toBe(1);
      expect(saleItemRow.quick_add_name).toBe('Custom Service Cleaning');
      expect(saleItemRow.base_stock_deducted).toBe(0);
      expect(saleItemRow.product_id).toBeNull();
    });

    it('rejects quick-add item with missing or whitespace-only name', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [
            {
              is_quick_add: true,
              quick_add_name: '   ',
              quantity: 1,
              unit_price: 10.000
            }
          ],
          cash_paid: 10.000,
          cash_tendered: 10.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Quick-add items must have a name');
    });
  });

  describe('9. Price Override & Deviation Flag', () => {
    it('sets overridden = true when item unit_price differs from expected catalog price', async () => {
      // Catalog price for retail customer is 3.000 DT. We sell at 2.500 DT.
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-retail',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 2.500 }],
          cash_paid: 2.500,
          cash_tendered: 2.500
        });

      expect(res.status).toBe(201);
      const item = res.body.items[0];
      expect(item.catalog_unit_price).toBe(3.000);
      expect(item.unit_price).toBe(2.500);
      expect(item.overridden).toBe(true);
    });

    it('sets overridden = false when item unit_price matches expected reseller discounted price', async () => {
      // Reseller has 10% discount off wholesale (2.500 DT) -> 2.250 DT
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-reseller',
          items: [{ product_id: 'prod-clean-1l', quantity: 2, unit_price: 2.250 }],
          cash_paid: 4.500,
          cash_tendered: 4.500
        });

      expect(res.status).toBe(201);
      const item = res.body.items[0];
      expect(item.catalog_unit_price).toBe(2.250);
      expect(item.unit_price).toBe(2.250);
      expect(item.overridden).toBe(false);
    });
  });

  describe('10. Register Session Resolution & Enforcements', () => {
    it('accepts register_session_id alias when session_id is omitted', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          register_session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(201);
      expect(res.body.session_id).toBe('ses-open');
    });

    it('falls back to latest OPEN session when neither session_id nor register_session_id is provided', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(201);
      expect(res.body.session_id).toBe('ses-open');
    });

    it('rejects sale with 400 when explicit session_id does not exist', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-ghost',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Session de caisse introuvable: ses-ghost');
    });

    it('rejects sale with 400 when explicit session is CLOSED', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-closed',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('La caisse est fermée');
    });

    it('rejects sale with 400 when no session is supplied and no OPEN session exists', async () => {
      const db = getDb();
      db.prepare("UPDATE register_sessions SET status = 'CLOSED' WHERE id = 'ses-open'").run();

      const res = await request(app)
        .post('/api/sales')
        .send({
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('La caisse est fermée');
    });
  });

  describe('11. Customer Validation & Errors', () => {
    it('returns 404 when customer_id does not exist', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          customer_id: 'cust-ghost',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Selected customer not found');
    });
  });

  describe('12. Line Item & Payment Validation Errors', () => {
    it('rejects missing or empty items array', async () => {
      const resEmpty = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [],
          cash_paid: 0
        });
      expect(resEmpty.status).toBe(400);
      expect(resEmpty.body.error).toBe('At least one line item is required');

      const resMissing = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          cash_paid: 0
        });
      expect(resMissing.status).toBe(400);
      expect(resMissing.body.error).toBe('At least one line item is required');
    });

    it('rejects quantity <= 0 or invalid quantity numbers', async () => {
      const resZero = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 0, unit_price: 3.000 }],
          cash_paid: 0
        });
      expect(resZero.status).toBe(400);
      expect(resZero.body.error).toBe('Quantity must be greater than 0');

      const resNeg = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: -2, unit_price: 3.000 }],
          cash_paid: 0
        });
      expect(resNeg.status).toBe(400);
      expect(resNeg.body.error).toBe('Quantity must be greater than 0');
    });

    it('rejects negative unit_price', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: -1.000 }],
          cash_paid: 0
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('unit_price must be a finite non-negative number');
    });

    it('rejects negative discount_amount', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000, discount_amount: -0.500 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('discount_amount must be a finite non-negative number');
    });

    it('rejects line total when discount exceeds unit_price * quantity', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000, discount_amount: 5.000 }],
          cash_paid: 0
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Line total cannot be negative');
    });

    it('rejects catalog item missing product_id', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('product_id is required for catalog items');
    });

    it('rejects catalog item with non-existent product_id', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-ghost', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 3.000
        });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Product not found: prod-ghost');
    });

    it('rejects payment breakdown mismatch with total_ttc', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 2, unit_price: 3.000 }], // total 6.000
          cash_paid: 4.000, // missing 2.000
          cash_tendered: 4.000
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/does not equal/i);
    });

    it('rejects under-tendered cash', async () => {
      const res = await request(app)
        .post('/api/sales')
        .send({
          session_id: 'ses-open',
          items: [{ product_id: 'prod-clean-1l', quantity: 1, unit_price: 3.000 }],
          cash_paid: 3.000,
          cash_tendered: 2.000 // less than cash_paid
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cash_tendered/i);
    });
  });
});
