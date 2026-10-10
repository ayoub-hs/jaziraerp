import os from 'os';
import path from 'path';
import crypto from 'crypto';

// Ensure DATABASE_PATH is in os.tmpdir() before testApp and db modules load
if (!process.env.DATABASE_PATH || !process.env.DATABASE_PATH.startsWith(os.tmpdir())) {
  process.env.DATABASE_PATH = path.join(os.tmpdir(), 'erp-invariant-test.sqlite');
}
process.env.NODE_ENV = 'test';

// Dynamic import so env vars take effect before DB initialization
const { resetTestDb, app, request, getDb } = await import('./testApp.js');
const { round3, addMoney } = await import('../server/utils/money.js');
const { calculateSessionExpectedCash } = await import('../server/services/registerService.js');

// Seeded PRNG (Mulberry32) for determinism
class PRNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  nextFloat(min: number, max: number, decimals: number = 3): number {
    const val = min + this.next() * (max - min);
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  boolean(prob: number = 0.5): boolean {
    return this.next() < prob;
  }
}

interface InvariantFailure {
  invariant: string;
  step: number;
  operation: string;
  details: string;
  seed: number;
}

export async function runHarness(seed: number, numSteps: number = 200): Promise<{ failures: InvariantFailure[], totalSteps: number }> {
  const rng = new PRNG(seed);
  const db = resetTestDb();
  const failures: InvariantFailure[] = [];

  // 1. Initial Seeding
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO product_families (id, name, category, type, created_at, updated_at) VALUES
    ('fam-1', 'Cleaners', 'Detergents', 'MANUFACTURED', ?, ?),
    ('fam-2', 'Soaps', 'Cosmetics', 'MANUFACTURED', ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at) VALUES
    ('ct-1', 'Bidon 5L', 5.0, 100, ?)
  `).run(now);

  db.prepare(`
    INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, retail_price, wholesale_price, container_type_id, created_at, updated_at) VALUES
    ('prod-1', 'fam-1', 'Detergent Sol 1L', '1L', '619001', 500, 3.000, 2.500, NULL, ?, ?),
    ('prod-2', 'fam-2', 'Savon Liquide 500ml', '500ml', '619002', 300, 2.200, 1.800, NULL, ?, ?),
    ('prod-3', 'fam-1', 'Javel 5L Bidon', '5L', '619003', 200, 4.500, 3.800, 'ct-1', ?, ?)
  `).run(now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode) VALUES
    ('pack-1', 'prod-1', 'Carton 12x1L', 12, 28.000, '619001-12'),
    ('pack-3', 'prod-3', 'Carton 4x5L', 4, 14.000, '619003-4')
  `).run();

  db.prepare(`
    INSERT INTO customers (id, name, type, reseller_discount_percent, wallet_balance, created_at, updated_at) VALUES
    ('cust-ret', 'Client Detail', 'RETAIL', 0, 50.000, ?, ?),
    ('cust-ws', 'Grossiste Habib', 'WHOLESALE', 0, 20.000, ?, ?),
    ('cust-res1', 'Revendeur Djerba 10%', 'RESELLER', 10, 0, ?, ?),
    ('cust-res2', 'Revendeur Midoun 15%', 'RESELLER', 15, 100.000, ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO customer_wallet_transactions (id, customer_id, date, type, amount, reference_id, notes, created_at) VALUES
    ('wtx-init-1', 'cust-ret', ?, 'TOP_UP', 50.000, NULL, 'Solde initial', ?),
    ('wtx-init-2', 'cust-ws', ?, 'TOP_UP', 20.000, NULL, 'Solde initial', ?),
    ('wtx-init-3', 'cust-res2', ?, 'TOP_UP', 100.000, NULL, 'Solde initial', ?)
  `).run(now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO suppliers (id, name, phone, address, created_at, updated_at) VALUES
    ('sup-1', 'Fournisseur Chimique Tunisie', '71000000', 'Tunis', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO raw_materials (id, name, category, unit, stock_quantity, low_stock_threshold, latest_purchase_cost, created_at, updated_at) VALUES
    ('mat-1', 'LABSA 96%', 'Matières Premières', 'kg', 500, 50, 4.200, ?, ?),
    ('mat-2', 'Soude Caustique', 'Matières Premières', 'kg', 200, 20, 2.100, ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, expected_cash, status) VALUES
    ('ses-1', 'SES-20261010-0001', 'Countertop', ?, 200.000, 200.000, 'OPEN')
  `).run(now);

  const customers = [null, 'cust-ret', 'cust-ws', 'cust-res1', 'cust-res2'];
  const products = ['prod-1', 'prod-2', 'prod-3'];
  const packSizes = [null, 'pack-1', 'pack-3'];

  // Invariant Assertion Checkers
  async function assertInvariants(step: number, opName: string) {
    // I1: For every sale: sum(refunds.total_refunded) <= sale.total_ttc
    const sales: any[] = db.prepare('SELECT id, receipt_number, total_ttc, total_discount FROM sales').all();
    for (const s of sales) {
      const refRow: any = db.prepare('SELECT COALESCE(SUM(total_refunded), 0) as sum_ref FROM refunds WHERE sale_id = ?').get(s.id);
      const sumRefunded = round3(refRow?.sum_ref || 0);
      if (sumRefunded > s.total_ttc + 0.001) {
        failures.push({
          invariant: 'I1',
          step,
          operation: opName,
          details: `Sale ${s.receipt_number} total_ttc=${s.total_ttc}, sum_refunded=${sumRefunded} (EXCEEDS total_ttc)`,
          seed
        });
      }
    }

    // I2: For every sale: cash_paid + wallet_paid + credit_amount == total_ttc
    const salesPmt: any[] = db.prepare('SELECT id, receipt_number, total_ttc, cash_paid, wallet_paid, credit_amount FROM sales').all();
    for (const s of salesPmt) {
      const pmtSum = round3(s.cash_paid + s.wallet_paid + s.credit_amount);
      if (Math.abs(pmtSum - s.total_ttc) > 0.005) {
        failures.push({
          invariant: 'I2',
          step,
          operation: opName,
          details: `Sale ${s.receipt_number} total_ttc=${s.total_ttc} != cash(${s.cash_paid}) + wallet(${s.wallet_paid}) + credit(${s.credit_amount}) = ${pmtSum}`,
          seed
        });
      }
    }

    // I3: Customer total debt consistency and statement running balance == summary
    const custRows: any[] = db.prepare('SELECT id, name FROM customers').all();
    for (const c of custRows) {
      const ticketsRow: any = db.prepare(`SELECT COALESCE(SUM(remaining_amount), 0) as sum_rem FROM customer_debt_tickets WHERE customer_id = ? AND status != 'PAID'`).get(c.id);
      const allTicketsRow: any = db.prepare('SELECT COALESCE(SUM(total_amount), 0) as sum_tot FROM customer_debt_tickets WHERE customer_id = ?').get(c.id);
      const openRemaining = round3(ticketsRow?.sum_rem || 0);

      const allocRow: any = db.prepare(`
        SELECT COALESCE(SUM(cpa.amount_allocated), 0) as sum_alloc
        FROM customer_payment_allocations cpa
        JOIN customer_payments cp ON cp.id = cpa.payment_id
        WHERE cp.customer_id = ?
      `).get(c.id);
      const sumAlloc = round3(allocRow?.sum_alloc || 0);

      const creditRedRow: any = db.prepare(`
        SELECT COALESCE(SUM(r.credit_reduced), 0) as sum_cred_red
        FROM refunds r
        JOIN sales s ON s.id = r.sale_id
        WHERE s.customer_id = ?
      `).get(c.id);
      const sumCreditRed = round3(creditRedRow?.sum_cred_red || 0);

      const expectedDebt = round3(Math.max(0, (allTicketsRow?.sum_tot || 0) - sumAlloc - sumCreditRed));
      if (Math.abs(openRemaining - expectedDebt) > 0.005) {
        failures.push({
          invariant: 'I3_FORMULA',
          step,
          operation: opName,
          details: `Customer ${c.id} open remaining=${openRemaining} != all_tickets(${allTicketsRow?.sum_tot}) - alloc(${sumAlloc}) - credit_red(${sumCreditRed}) = ${expectedDebt}`,
          seed
        });
      }

      const stmtRes = await request(app).get(`/api/customers/${c.id}/statement`);
      if (stmtRes.status === 200) {
        const stmt = stmtRes.body;
        const summaryDebt = round3(stmt?.debt?.final_balance || 0);
        if (Math.abs(summaryDebt - openRemaining) > 0.005) {
          failures.push({
            invariant: 'I3_STATEMENT_SUMMARY',
            step,
            operation: opName,
            details: `Customer ${c.id} statement summary debt=${summaryDebt} != open tickets sum=${openRemaining}`,
            seed
          });
        }
        const entries = stmt?.debt?.entries || [];
        if (entries.length > 0) {
          const lastRunning = round3(entries[entries.length - 1].running_balance || 0);
          if (Math.abs(lastRunning - summaryDebt) > 0.005) {
            failures.push({
              invariant: 'I3_STATEMENT_RUNNING_VS_SUMMARY',
              step,
              operation: opName,
              details: `Customer ${c.id} statement running_balance (${lastRunning}) != summary final_balance (${summaryDebt})`,
              seed
            });
          }
        }
      }
    }

    // I4: Customer wallet balance == sum of signed transactions. Never negative.
    for (const c of custRows) {
      const custDb: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(c.id);
      const wBal = round3(custDb?.wallet_balance || 0);
      if (wBal < -0.001) {
        failures.push({
          invariant: 'I4_NEGATIVE',
          step,
          operation: opName,
          details: `Customer ${c.id} wallet_balance is negative: ${wBal}`,
          seed
        });
      }
      const wTxRow: any = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN type IN ('TOP_UP', 'OVERPAYMENT_DEPOSIT', 'REFUND_CREDIT') THEN amount ELSE 0 END), 0) as credits,
          COALESCE(SUM(CASE WHEN type = 'SALE_PAYMENT' THEN amount ELSE 0 END), 0) as debits
        FROM customer_wallet_transactions
        WHERE customer_id = ?
      `).get(c.id);
      const sumTx = round3((wTxRow?.credits || 0) - (wTxRow?.debits || 0));
      if (Math.abs(wBal - sumTx) > 0.005) {
        failures.push({
          invariant: 'I4_CONSISTENCY',
          step,
          operation: opName,
          details: `Customer ${c.id} wallet_balance=${wBal} != sum of transactions=${sumTx}`,
          seed
        });
      }
    }

    // I5: Register expected cash recomputed from raw rows == registerService figure
    const sessions: any[] = db.prepare('SELECT * FROM register_sessions').all();
    for (const ses of sessions) {
      const breakdown = calculateSessionExpectedCash(db, ses.id);
      const salesCash: any = db.prepare('SELECT COALESCE(SUM(cash_paid), 0) as c FROM sales WHERE session_id = ?').get(ses.id);
      const movIn: any = db.prepare("SELECT COALESCE(SUM(amount), 0) as c FROM register_cash_movements WHERE session_id = ? AND type = 'CASH_IN'").get(ses.id);
      const movOut: any = db.prepare("SELECT COALESCE(SUM(amount), 0) as c FROM register_cash_movements WHERE session_id = ? AND type = 'CASH_OUT'").get(ses.id);
      const refCash: any = db.prepare('SELECT COALESCE(SUM(cash_refunded), 0) as c FROM refunds WHERE session_id = ?').get(ses.id);
      const rawExpected = round3((ses.opening_cash || 0) + (salesCash?.c || 0) + (movIn?.c || 0) - (movOut?.c || 0) - (refCash?.c || 0));

      if (Math.abs(breakdown.expected_cash - rawExpected) > 0.005) {
        failures.push({
          invariant: 'I5_REGISTER_EXPECTED',
          step,
          operation: opName,
          details: `Session ${ses.session_number} registerService expected_cash=${breakdown.expected_cash} != raw computed=${rawExpected}`,
          seed
        });
      }
    }

    // I7: Reports: HT + TVA == TTC on both gross and net basis
    const repCustRes = await request(app).get('/api/reports/sales-by-customer');
    if (repCustRes.status === 200 && Array.isArray(repCustRes.body)) {
      for (const row of repCustRes.body) {
        const ht = row.total_ht || 0;
        const tva = row.total_tva || 0;
        const grossTtc = row.gross_ttc || 0;
        const netTtc = row.net_ttc || 0;
        const refunded = row.refunded_amount || 0;

        if (Math.abs(round3(ht + tva) - grossTtc) > 0.01) {
          failures.push({
            invariant: 'I7_GROSS_HT_TVA',
            step,
            operation: opName,
            details: `Report sales-by-customer row ${row.customer_name}: HT(${ht}) + TVA(${tva}) = ${round3(ht+tva)} != gross_ttc(${grossTtc})`,
            seed
          });
        }
        if (refunded > 0 && Math.abs(round3(ht + tva) - netTtc) > 0.01) {
          failures.push({
            invariant: 'I7_NET_HT_TVA_MISMATCH',
            step,
            operation: opName,
            details: `Report sales-by-customer row ${row.customer_name}: refunded=${refunded}, HT(${ht}) + TVA(${tva}) = ${round3(ht+tva)} != net_ttc(${netTtc})`,
            seed
          });
        }
      }
    }

    // I9: Money values are finite and 3-decimal clean
    const allSalesRows: any[] = db.prepare('SELECT total_ttc, subtotal_ht, tva_amount, cash_paid, wallet_paid, credit_amount FROM sales').all();
    for (const r of allSalesRows) {
      for (const [k, v] of Object.entries(r)) {
        if (v !== null && typeof v === 'number') {
          if (!Number.isFinite(v) || round3(v) !== v) {
            failures.push({
              invariant: 'I9_MONEY_CLEAN',
              step,
              operation: opName,
              details: `Sales field ${k} has non-clean money value: ${v}`,
              seed
            });
          }
        }
      }
    }

    // I10: Sequential numbering per day without duplicate receipt numbers
    const recRows: any[] = db.prepare('SELECT receipt_number FROM sales').all();
    const recNums = recRows.map(r => r.receipt_number);
    const recUnique = new Set(recNums);
    if (recNums.length !== recUnique.size) {
      failures.push({
        invariant: 'I10_RECEIPT_COLLISION',
        step,
        operation: opName,
        details: `Duplicate receipt numbers detected: ${recNums.length} total vs ${recUnique.size} unique`,
        seed
      });
    }
  }

  // Operation execution loop
  for (let step = 1; step <= numSteps; step++) {
    const opChoice = rng.nextInt(1, 9);
    let opName = '';

    try {
      if (opChoice === 1 || opChoice === 2) {
        // --- SALE ---
        opName = 'SALE';
        const custId = rng.pick(customers);
        const numItems = rng.nextInt(1, 3);
        const saleItems: any[] = [];
        let runningTotal = 0;

        for (let i = 0; i < numItems; i++) {
          const prodId = rng.pick(products);
          const packId = rng.boolean(0.3) ? rng.pick(packSizes.filter(p => p !== null)) : null;
          const qty = rng.nextInt(1, 5);

          const prod: any = db.prepare('SELECT retail_price, wholesale_price FROM products WHERE id = ?').get(prodId);
          let unitPrice = prod.retail_price;
          if (custId) {
            const c: any = db.prepare('SELECT type, reseller_discount_percent FROM customers WHERE id = ?').get(custId);
            if (c.type === 'RESELLER') {
              unitPrice = round3(prod.wholesale_price * (100 - (c.reseller_discount_percent || 0)) / 100);
            } else if (c.type === 'WHOLESALE') {
              unitPrice = prod.wholesale_price;
            }
          }
          if (packId) {
            const pack: any = db.prepare('SELECT multiplier, price_override FROM product_pack_sizes WHERE id = ?').get(packId);
            if (pack) {
              unitPrice = pack.price_override || round3(unitPrice * pack.multiplier);
            }
          }

          const lineDiscount = rng.boolean(0.2) ? rng.nextFloat(0.1, 0.5) : 0;
          const lineTotal = Math.max(0, round3(qty * unitPrice - lineDiscount));
          runningTotal = addMoney(runningTotal, lineTotal);

          saleItems.push({
            product_id: prodId,
            pack_size_id: packId,
            quantity: qty,
            unit_price: unitPrice,
            discount_amount: lineDiscount
          });
        }

        const cartDiscount = rng.boolean(0.35) ? Math.min(runningTotal, rng.nextFloat(0.5, 3.0)) : 0;
        const totalTTC = Math.max(0, round3(runningTotal - cartDiscount));

        let cashPaid = 0;
        let walletPaid = 0;
        let creditAmount = 0;

        let rem = totalTTC;
        if (custId && rem > 0) {
          const c: any = db.prepare('SELECT wallet_balance FROM customers WHERE id = ?').get(custId);
          const wBal = c?.wallet_balance || 0;
          if (wBal > 0 && rng.boolean(0.5)) {
            walletPaid = Math.min(rem, rng.nextFloat(0.1, Math.min(rem, wBal)));
            walletPaid = round3(walletPaid);
            rem = round3(rem - walletPaid);
          }
          if (rem > 0 && rng.boolean(0.4)) {
            creditAmount = rng.boolean(0.5) ? rem : round3(rem / 2);
            rem = round3(rem - creditAmount);
          }
        }
        cashPaid = rem;
        const cashTendered = rng.boolean(0.3) ? addMoney(cashPaid, rng.nextInt(1, 10)) : cashPaid;

        const openSession: any = db.prepare("SELECT id FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
        if (openSession) {
          await request(app).post('/api/sales').send({
            customer_id: custId,
            session_id: openSession.id,
            items: saleItems,
            total_discount: cartDiscount,
            cash_paid: cashPaid,
            cash_tendered: cashTendered,
            wallet_paid: walletPaid,
            credit_amount: creditAmount
          });
        }

      } else if (opChoice === 3) {
        // --- CUSTOMER DEBT PAYMENT ---
        opName = 'CUSTOMER_PAYMENT';
        const openDebtCusts: any[] = db.prepare(`
          SELECT DISTINCT customer_id FROM customer_debt_tickets WHERE status IN ('UNPAID', 'PARTIALLY_PAID')
        `).all();

        if (openDebtCusts.length > 0) {
          const cid = rng.pick(openDebtCusts).customer_id;
          const debtRow: any = db.prepare(`SELECT SUM(remaining_amount) as rem FROM customer_debt_tickets WHERE customer_id = ? AND status != 'PAID'`).get(cid);
          const remDebt = debtRow?.rem || 0;
          const pmtAmount = rng.pick([
            round3(remDebt * 0.5),
            remDebt,
            round3(remDebt + rng.nextFloat(5.0, 20.0))
          ]);
          if (pmtAmount > 0) {
            await request(app).post(`/api/customers/${cid}/payments`).send({
              amount: pmtAmount,
              payment_method: 'Cash',
              notes: 'Audit harness payment'
            });
          }
        }

      } else if (opChoice === 4) {
        // --- CUSTOMER WALLET TOP-UP ---
        opName = 'WALLET_TOPUP';
        const cid = rng.pick(customers.filter(c => c !== null)) as string;
        const amt = rng.nextFloat(10.0, 50.0);
        await request(app).post(`/api/customers/${cid}/wallet/topup`).send({
          amount: amt,
          notes: 'Audit harness wallet topup'
        });

      } else if (opChoice === 5) {
        // --- REFUND ---
        opName = 'REFUND';
        const refundableSales: any[] = db.prepare(`
          SELECT s.id, s.customer_id, s.total_ttc, s.cash_paid, s.wallet_paid, s.credit_amount, s.total_discount
          FROM sales s
          JOIN sale_items si ON si.sale_id = s.id
          WHERE si.quantity > si.quantity_refunded AND s.status != 'FULLY_REFUNDED'
        `).all();

        if (refundableSales.length > 0) {
          const targetSale = rng.pick(refundableSales);
          const saleItems: any[] = db.prepare(`
            SELECT id, quantity, quantity_refunded, line_total FROM sale_items
            WHERE sale_id = ? AND quantity > quantity_refunded
          `).all(targetSale.id);

          if (saleItems.length > 0) {
            const itemToRefund = rng.pick(saleItems);
            const maxQty = itemToRefund.quantity - itemToRefund.quantity_refunded;
            const refundQty = rng.nextInt(1, maxQty);

            const openSession: any = db.prepare("SELECT id FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
            if (openSession) {
              let pMethod = 'CASH';
              if (targetSale.customer_id && targetSale.credit_amount > 0 && rng.boolean(0.5)) {
                const openTkt: any = db.prepare("SELECT id FROM customer_debt_tickets WHERE sale_id = ? AND status != 'PAID'").get(targetSale.id);
                if (openTkt) {
                  pMethod = 'CREDIT_REDUCTION';
                }
              } else if (targetSale.customer_id && targetSale.wallet_paid > 0 && rng.boolean(0.5)) {
                pMethod = 'WALLET';
              }

              await request(app).post(`/api/sales/${targetSale.id}/refund`).send({
                session_id: openSession.id,
                refund_method: pMethod,
                items: [{ sale_item_id: itemToRefund.id, quantity: refundQty }],
                reason: 'Harness test refund'
              });
            }
          }
        }

      } else if (opChoice === 6) {
        // --- CASH MOVEMENT ---
        opName = 'CASH_MOVEMENT';
        const openSession: any = db.prepare("SELECT id FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
        if (openSession) {
          const type = rng.boolean(0.5) ? 'CASH_IN' : 'CASH_OUT';
          const amt = rng.nextFloat(5.0, 30.0);
          await request(app).post('/api/register/movement').send({
            session_id: openSession.id,
            type,
            amount: amt,
            reason: `Audit test ${type}`
          });
        }

      } else if (opChoice === 7) {
        // --- SUPPLIER PURCHASE & PAYMENT ---
        opName = 'SUPPLIER_PURCHASE';
        const isCredit = rng.boolean(0.5);
        const mat = rng.pick(['mat-1', 'mat-2']);
        const qty = rng.nextInt(10, 50);
        const cost = rng.nextFloat(2.0, 5.0);

        await request(app).post('/api/purchases').send({
          supplier_id: 'sup-1',
          payment_type: isCredit ? 'CREDIT' : 'CASH',
          items: [{ material_id: mat, quantity: qty, unit_cost: cost }]
        });

        if (isCredit && rng.boolean(0.5)) {
          await request(app).post('/api/suppliers/sup-1/payments').send({
            amount: rng.nextFloat(10.0, 50.0),
            payment_method: 'Bank Transfer',
            notes: 'Harness supplier payment'
          });
        }

      } else if (opChoice === 8) {
        // --- INVENTORY ADJUSTMENT ---
        opName = 'INVENTORY_ADJUST';
        const prod = rng.pick(products);
        const delta = rng.pick([-5, -1, 1, 5]);
        await request(app).post('/api/inventory/adjust').send({
          item_type: 'PRODUCT',
          product_id: prod,
          quantity_delta: delta,
          reason: 'Harness inventory count adjustment'
        });

      } else if (opChoice === 9) {
        // --- OFFLINE SYNC FLUSH & IDEMPOTENCY REPLAY (I8) ---
        opName = 'SYNC_FLUSH_REPLAY';
        const openSession: any = db.prepare("SELECT id FROM register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1").get();
        if (openSession) {
          const tempClientId = `offline-${crypto.randomUUID()}`;
          const actionType = rng.pick(['SALE', 'CASH_MOVEMENT', 'CONTAINER_TRANSACTION', 'PRICE_STOCK_EDIT']);
          let payload: any = {};

          if (actionType === 'SALE') {
            payload = {
              temp_client_id: tempClientId,
              session_id: openSession.id,
              customer_id: 'cust-ret',
              items: [{ product_id: 'prod-1', quantity: 1, unit_price: 3.000, discount_amount: 0 }],
              cash_paid: 3.000,
              wallet_paid: 0,
              credit_amount: 0
            };
          } else if (actionType === 'CASH_MOVEMENT') {
            payload = {
              session_id: openSession.id,
              type: 'CASH_IN',
              amount: 15.000,
              reason: 'Sync test movement'
            };
          } else if (actionType === 'CONTAINER_TRANSACTION') {
            payload = {
              customer_id: 'cust-ret',
              container_type_id: 'ct-1',
              action: 'GIVE',
              quantity: 2,
              notes: 'Sync container loan'
            };
          } else if (actionType === 'PRICE_STOCK_EDIT') {
            payload = {
              product_id: 'prod-2',
              retail_price: 2.250,
              wholesale_price: 1.850,
              stock_quantity: 290
            };
          }

          const opObj = { temp_client_id: tempClientId, action_type: actionType, payload };

          // Measure state BEFORE first sync
          const snapBefore = {
            salesCount: (db.prepare('SELECT COUNT(*) as c FROM sales').get() as any).c,
            movementsCount: (db.prepare('SELECT COUNT(*) as c FROM register_cash_movements').get() as any).c,
            containerTxCount: (db.prepare('SELECT COUNT(*) as c FROM container_transactions').get() as any).c,
            containerOwed: (db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-ret', 'ct-1') as any)?.quantity_owed || 0,
            adjustmentsCount: (db.prepare('SELECT COUNT(*) as c FROM inventory_adjustments').get() as any).c
          };

          // 1. First sync flush
          await request(app).post('/api/sync/flush').send({ operations: [opObj] });

          const snapAfter1 = {
            salesCount: (db.prepare('SELECT COUNT(*) as c FROM sales').get() as any).c,
            movementsCount: (db.prepare('SELECT COUNT(*) as c FROM register_cash_movements').get() as any).c,
            containerTxCount: (db.prepare('SELECT COUNT(*) as c FROM container_transactions').get() as any).c,
            containerOwed: (db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-ret', 'ct-1') as any)?.quantity_owed || 0,
            adjustmentsCount: (db.prepare('SELECT COUNT(*) as c FROM inventory_adjustments').get() as any).c
          };

          // 2. REPLAY identical operation (idempotency check)
          await request(app).post('/api/sync/flush').send({ operations: [opObj] });

          const snapAfter2 = {
            salesCount: (db.prepare('SELECT COUNT(*) as c FROM sales').get() as any).c,
            movementsCount: (db.prepare('SELECT COUNT(*) as c FROM register_cash_movements').get() as any).c,
            containerTxCount: (db.prepare('SELECT COUNT(*) as c FROM container_transactions').get() as any).c,
            containerOwed: (db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?').get('cust-ret', 'ct-1') as any)?.quantity_owed || 0,
            adjustmentsCount: (db.prepare('SELECT COUNT(*) as c FROM inventory_adjustments').get() as any).c
          };

          if (snapAfter2.salesCount !== snapAfter1.salesCount ||
              snapAfter2.movementsCount !== snapAfter1.movementsCount ||
              snapAfter2.containerTxCount !== snapAfter1.containerTxCount ||
              snapAfter2.containerOwed !== snapAfter1.containerOwed ||
              snapAfter2.adjustmentsCount !== snapAfter1.adjustmentsCount) {
            failures.push({
              invariant: 'I8_SYNC_IDEMPOTENCY',
              step,
              operation: `SYNC_REPLAY_${actionType}`,
              details: `Sync action ${actionType} was replayed but state duplicated! snapAfter1=${JSON.stringify(snapAfter1)}, snapAfter2=${JSON.stringify(snapAfter2)}`,
              seed
            });
          }
        }
      }

      await assertInvariants(step, opName);

    } catch (err: any) {
      console.error(`Error during step ${step} (${opName}):`, err.message);
    }
  }

  return { failures, totalSteps: numSteps };
}

// Multi-seed runner
async function main() {
  const seeds = [424242, 123456, 789012, 314159, 271828];
  const stepsPerSeed = 200;

  console.log(`\n================ RUNNING MULTI-SEED INVARIANT HARNESS ================`);
  console.log(`Seeds: ${seeds.join(', ')} (${seeds.length} seeds, ${stepsPerSeed} steps each)\n`);

  let totalFailures = 0;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const startTime = Date.now();
    const res = await runHarness(seed, stepsPerSeed);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (res.failures.length === 0) {
      console.log(`✓ Seed ${seed} (${i + 1}/${seeds.length}): PASSED (${res.totalSteps} steps in ${duration}s, 0 failures)`);
    } else {
      console.log(`✗ Seed ${seed} (${i + 1}/${seeds.length}): FAILED (${res.failures.length} invariant failures in ${duration}s)`);
      totalFailures += res.failures.length;
      for (const f of res.failures.slice(0, 5)) {
        console.log(`  - [${f.invariant}] Step ${f.step} (${f.operation}): ${f.details}`);
      }
    }
  }

  console.log('\n======================================================================');
  if (totalFailures === 0) {
    console.log(`ALL ${seeds.length}/${seeds.length} SEEDS PASSED WITH ZERO INVARIANT FAILURES!`);
    process.exit(0);
  } else {
    console.error(`HARNESS FAILED WITH ${totalFailures} TOTAL INVARIANT FAILURES!`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
