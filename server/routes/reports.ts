import { Router, Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { round3 } from '../utils/money.js';
import { getMaterialUnitCosts } from '../services/costingService.js';

export const reportsRouter = Router();

// ==========================================
// 1. Sales by Period & Customer
// ==========================================
reportsRouter.get('/sales-by-customer', (req: Request, res: Response) => {
  const db = getDb();
  const { start_date, end_date, customer_id } = req.query;

  let whereClause = "WHERE s.status IN ('COMPLETED', 'PARTIALLY_REFUNDED')";
  const params: any[] = [];

  if (start_date) {
    whereClause += " AND s.date >= ?";
    params.push(String(start_date));
  }
  if (end_date) {
    // If end_date is date-only (10 chars), extend to end of day
    const endStr = String(end_date).length === 10 ? `${end_date}T23:59:59.999Z` : String(end_date);
    whereClause += " AND s.date <= ?";
    params.push(endStr);
  }
  if (customer_id) {
    if (customer_id === 'WALK_IN' || customer_id === 'walk-in') {
      whereClause += " AND s.customer_id IS NULL";
    } else {
      whereClause += " AND s.customer_id = ?";
      params.push(String(customer_id));
    }
  }

  const query = `
    SELECT 
      COALESCE(s.customer_id, 'WALK_IN') as customer_id,
      COALESCE(c.name, 'Walk-in Customer') as customer_name,
      c.phone as customer_phone,
      COUNT(s.id) as sale_count,
      ROUND(SUM(s.subtotal_ht), 3) as total_ht,
      ROUND(SUM(s.tva_amount), 3) as total_tva,
      ROUND(SUM(s.total_ttc), 3) as gross_ttc,
      ROUND(SUM(COALESCE(r.total_refunded, 0)), 3) as refunded_amount,
      ROUND(SUM(s.total_ttc) - SUM(COALESCE(r.total_refunded, 0)), 3) as net_ttc,
      ROUND(SUM(s.total_ttc) - SUM(COALESCE(r.total_refunded, 0)), 3) as total_ttc,
      ROUND(SUM(s.cash_paid), 3) as gross_cash,
      ROUND(SUM(COALESCE(r.cash_refunded, 0)), 3) as cash_refunded,
      ROUND(SUM(s.cash_paid) - SUM(COALESCE(r.cash_refunded, 0)), 3) as cash_paid,
      ROUND(SUM(s.wallet_paid), 3) as gross_wallet,
      ROUND(SUM(COALESCE(r.wallet_refunded, 0)), 3) as wallet_refunded,
      ROUND(SUM(s.wallet_paid) - SUM(COALESCE(r.wallet_refunded, 0)), 3) as wallet_paid,
      ROUND(SUM(s.credit_amount), 3) as gross_credit,
      ROUND(SUM(COALESCE(r.credit_reduced, 0)), 3) as credit_reduced,
      ROUND(SUM(s.credit_amount) - SUM(COALESCE(r.credit_reduced, 0)), 3) as credit_amount
    FROM sales s
    LEFT JOIN (
      SELECT 
        sale_id,
        SUM(total_refunded) as total_refunded,
        SUM(cash_refunded) as cash_refunded,
        SUM(wallet_refunded) as wallet_refunded,
        SUM(credit_reduced) as credit_reduced
      FROM refunds
      GROUP BY sale_id
    ) r ON s.id = r.sale_id
    LEFT JOIN customers c ON s.customer_id = c.id
    ${whereClause}
    GROUP BY COALESCE(s.customer_id, 'WALK_IN')
    ORDER BY net_ttc DESC
  `;

  const rows: any[] = db.prepare(query).all(...params);

  // Summary totals
  let grandGrossTtc = 0;
  let grandRefunded = 0;
  let grandNetTtc = 0;
  let grandCash = 0;
  let grandWallet = 0;
  let grandCredit = 0;
  let grandCount = 0;

  for (const r of rows) {
    grandGrossTtc += r.gross_ttc || 0;
    grandRefunded += r.refunded_amount || 0;
    grandNetTtc += r.net_ttc || 0;
    grandCash += r.cash_paid || 0;
    grandWallet += r.wallet_paid || 0;
    grandCredit += r.credit_amount || 0;
    grandCount += r.sale_count || 0;
  }

  res.json({
    start_date: start_date || null,
    end_date: end_date || null,
    customer_sales: rows,
    summary: {
      total_sales_count: grandCount,
      total_gross_ttc: round3(grandGrossTtc),
      total_refunded: round3(grandRefunded),
      total_net_ttc: round3(grandNetTtc),
      total_ttc: round3(grandNetTtc),
      total_cash: round3(grandCash),
      total_wallet: round3(grandWallet),
      total_credit: round3(grandCredit)
    }
  });
});

// ==========================================
// 2. Sales by Register & Period
// ==========================================
reportsRouter.get('/sales-by-register', (req: Request, res: Response) => {
  const db = getDb();
  const { start_date, end_date, counter_name } = req.query;

  let whereClause = "WHERE s.status IN ('COMPLETED', 'PARTIALLY_REFUNDED')";
  const params: any[] = [];

  if (start_date) {
    whereClause += " AND s.date >= ?";
    params.push(String(start_date));
  }
  if (end_date) {
    const endStr = String(end_date).length === 10 ? `${end_date}T23:59:59.999Z` : String(end_date);
    whereClause += " AND s.date <= ?";
    params.push(endStr);
  }
  if (counter_name) {
    whereClause += " AND LOWER(COALESCE(rs.counter_name, 'Unassigned')) = LOWER(?)";
    params.push(String(counter_name));
  }

  const query = `
    SELECT 
      COALESCE(rs.counter_name, 'Countertop') as counter_name,
      COUNT(DISTINCT s.session_id) as session_count,
      COUNT(s.id) as sale_count,
      ROUND(SUM(s.subtotal_ht), 3) as total_ht,
      ROUND(SUM(s.tva_amount), 3) as total_tva,
      ROUND(SUM(s.total_ttc), 3) as gross_ttc,
      ROUND(SUM(COALESCE(r.total_refunded, 0)), 3) as refunded_amount,
      ROUND(SUM(s.total_ttc) - SUM(COALESCE(r.total_refunded, 0)), 3) as net_ttc,
      ROUND(SUM(s.total_ttc) - SUM(COALESCE(r.total_refunded, 0)), 3) as total_ttc,
      ROUND(SUM(s.cash_paid), 3) as gross_cash,
      ROUND(SUM(COALESCE(r.cash_refunded, 0)), 3) as cash_refunded,
      ROUND(SUM(s.cash_paid) - SUM(COALESCE(r.cash_refunded, 0)), 3) as cash_paid,
      ROUND(SUM(s.wallet_paid), 3) as gross_wallet,
      ROUND(SUM(COALESCE(r.wallet_refunded, 0)), 3) as wallet_refunded,
      ROUND(SUM(s.wallet_paid) - SUM(COALESCE(r.wallet_refunded, 0)), 3) as wallet_paid,
      ROUND(SUM(s.credit_amount), 3) as gross_credit,
      ROUND(SUM(COALESCE(r.credit_reduced, 0)), 3) as credit_reduced,
      ROUND(SUM(s.credit_amount) - SUM(COALESCE(r.credit_reduced, 0)), 3) as credit_amount
    FROM sales s
    LEFT JOIN (
      SELECT 
        sale_id,
        SUM(total_refunded) as total_refunded,
        SUM(cash_refunded) as cash_refunded,
        SUM(wallet_refunded) as wallet_refunded,
        SUM(credit_reduced) as credit_reduced
      FROM refunds
      GROUP BY sale_id
    ) r ON s.id = r.sale_id
    LEFT JOIN register_sessions rs ON s.session_id = rs.id
    ${whereClause}
    GROUP BY COALESCE(rs.counter_name, 'Countertop')
    ORDER BY net_ttc DESC
  `;

  const rows: any[] = db.prepare(query).all(...params);

  let grandGrossTtc = 0;
  let grandRefunded = 0;
  let grandNetTtc = 0;
  let grandCash = 0;
  let grandWallet = 0;
  let grandCredit = 0;
  let grandCount = 0;

  for (const r of rows) {
    grandGrossTtc += r.gross_ttc || 0;
    grandRefunded += r.refunded_amount || 0;
    grandNetTtc += r.net_ttc || 0;
    grandCash += r.cash_paid || 0;
    grandWallet += r.wallet_paid || 0;
    grandCredit += r.credit_amount || 0;
    grandCount += r.sale_count || 0;
  }

  res.json({
    start_date: start_date || null,
    end_date: end_date || null,
    register_sales: rows,
    summary: {
      total_sales_count: grandCount,
      total_gross_ttc: round3(grandGrossTtc),
      total_refunded: round3(grandRefunded),
      total_net_ttc: round3(grandNetTtc),
      total_ttc: round3(grandNetTtc),
      total_cash: round3(grandCash),
      total_wallet: round3(grandWallet),
      total_credit: round3(grandCredit)
    }
  });
});

// ==========================================
// 3. Customer Debt Payments by Period
// ==========================================
reportsRouter.get('/customer-debt-payments', (req: Request, res: Response) => {
  const db = getDb();
  const { start_date, end_date, customer_id } = req.query;

  let whereClause = "WHERE 1=1";
  const params: any[] = [];

  if (start_date) {
    whereClause += " AND cp.date >= ?";
    params.push(String(start_date));
  }
  if (end_date) {
    const endStr = String(end_date).length === 10 ? `${end_date}T23:59:59.999Z` : String(end_date);
    whereClause += " AND cp.date <= ?";
    params.push(endStr);
  }
  if (customer_id) {
    whereClause += " AND cp.customer_id = ?";
    params.push(String(customer_id));
  }

  // 1. Detailed payments log
  const paymentsQuery = `
    SELECT 
      cp.id,
      cp.date,
      ROUND(cp.amount, 3) as amount,
      cp.payment_method,
      cp.notes,
      c.id as customer_id,
      c.name as customer_name,
      c.phone as customer_phone
    FROM customer_payments cp
    JOIN customers c ON cp.customer_id = c.id
    ${whereClause}
    ORDER BY cp.date DESC
  `;
  const payments: any[] = db.prepare(paymentsQuery).all(...params);

  // 2. Grouped by customer
  const groupedQuery = `
    SELECT 
      c.id as customer_id,
      c.name as customer_name,
      c.phone as customer_phone,
      COUNT(cp.id) as payment_count,
      ROUND(SUM(cp.amount), 3) as total_paid
    FROM customer_payments cp
    JOIN customers c ON cp.customer_id = c.id
    ${whereClause}
    GROUP BY c.id
    ORDER BY total_paid DESC
  `;
  const groupedByCustomer: any[] = db.prepare(groupedQuery).all(...params);

  let totalAmount = 0;
  for (const p of payments) {
    totalAmount += p.amount || 0;
  }

  res.json({
    start_date: start_date || null,
    end_date: end_date || null,
    payments,
    by_customer: groupedByCustomer,
    summary: {
      total_payments_count: payments.length,
      total_amount_paid: round3(totalAmount)
    }
  });
});

// ==========================================
// 4. Inventory Valuation Report
// ==========================================
reportsRouter.get('/inventory-valuation', (req: Request, res: Response) => {
  const db = getDb();
  const { type = 'ALL' } = req.query;

  let products: any[] = [];
  let materials: any[] = [];

  if (type === 'ALL' || type === 'PRODUCTS') {
    products = db.prepare(`
      SELECT 
        p.id,
        p.name,
        pf.category,
        p.size_label,
        p.barcode,
        p.stock_quantity,
        ROUND(p.cost_reference, 3) as unit_cost,
        ROUND(p.stock_quantity * p.cost_reference, 3) as line_cost_valuation,
        ROUND(p.retail_price, 3) as retail_price,
        ROUND(p.stock_quantity * p.retail_price, 3) as line_retail_valuation
      FROM products p
      JOIN product_families pf ON p.family_id = pf.id
      WHERE p.active = 1 AND pf.active = 1
      ORDER BY pf.category ASC, p.name ASC
    `).all();
  }

  if (type === 'ALL' || type === 'MATERIALS') {
    const unitCosts = getMaterialUnitCosts(db);
    const rawMaterials: any[] = db.prepare(`
      SELECT 
        id,
        name,
        category,
        unit,
        stock_quantity,
        ROUND(latest_purchase_cost, 3) as latest_purchase_cost
      FROM raw_materials
      WHERE (active = 1 OR active IS NULL)
      ORDER BY category ASC, name ASC
    `).all();

    materials = rawMaterials.map((m: any) => {
      const unitCost = unitCosts.get(m.id) ?? round3(Number(m.latest_purchase_cost) || 0);
      const lineCostValuation = round3(m.stock_quantity * unitCost);
      return {
        ...m,
        unit_cost: unitCost,
        current_cost_per_unit: unitCost,
        line_cost_valuation: lineCostValuation
      };
    });
  }

  let productCostValuation = 0;
  let productRetailValuation = 0;
  for (const p of products) {
    productCostValuation += p.line_cost_valuation || 0;
    productRetailValuation += p.line_retail_valuation || 0;
  }

  let materialCostValuation = 0;
  for (const m of materials) {
    materialCostValuation += m.line_cost_valuation || 0;
  }

  res.json({
    generated_at: new Date().toISOString(),
    products,
    materials,
    summary: {
      product_count: products.length,
      material_count: materials.length,
      product_cost_valuation: round3(productCostValuation),
      product_retail_valuation: round3(productRetailValuation),
      material_cost_valuation: round3(materialCostValuation),
      grand_total_cost_valuation: round3(productCostValuation + materialCostValuation)
    }
  });
});
