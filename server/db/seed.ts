import { getDb } from './index.js';

export function seedDatabase() {
  const db = getDb();

  // Check if already seeded
  console.log('[Seed] Seeding database with initial data...');

  // 1. Settings
  db.prepare(`
    INSERT OR REPLACE INTO settings (key, value) VALUES 
    ('shop_name', 'Société Al Jazira SHSP'),
    ('shop_address', 'Route de Gabès Km 3.5, Sfax, Tunisie'),
    ('shop_phone', '+216 74 000 000'),
    ('tax_id', '1234567/A/M/000')
  `).run();

  // 2. Suppliers
  db.prepare(`
    INSERT OR IGNORE INTO suppliers (id, name, phone, address, created_at, updated_at) VALUES
    ('sup-1', 'Chimie Maghreb Sarl', '+216 71 111 222', 'Zone Industrielle Charguia, Tunis', '2026-09-01', '2026-09-01'),
    ('sup-2', 'Plastique PlastPack Tunisie', '+216 74 333 444', 'Route de Gabès, Sfax', '2026-09-01', '2026-09-01')
  `).run();

  // 3. Raw Materials & Packaging
  db.prepare(`
    INSERT OR IGNORE INTO raw_materials (id, name, category, unit, stock_quantity, low_stock_threshold, latest_purchase_cost, latest_supplier_id, created_at, updated_at) VALUES
    ('mat-labsa', 'LABSA 96%', 'surfactant', 'kg', 1200, 200, 4.500, 'sup-1', '2026-09-01', '2026-09-01'),
    ('mat-sles', 'SLES 70%', 'surfactant', 'kg', 800, 150, 3.200, 'sup-1', '2026-09-01', '2026-09-01'),
    ('mat-frag-lemon', 'Parfum Citron Concentré', 'fragrance', 'L', 50, 10, 28.000, 'sup-1', '2026-09-01', '2026-09-01'),
    ('mat-bot-1l', 'Bouteille Plastique 1L Transparente', 'bottle', 'pcs', 2500, 500, 0.350, 'sup-2', '2026-09-01', '2026-09-01'),
    ('mat-bot-1.5l', 'Bouteille Plastique 1.5L', 'bottle', 'pcs', 1500, 300, 0.420, 'sup-2', '2026-09-01', '2026-09-01'),
    ('mat-bot-5l', 'Bidon Plastique 5L Renforcé', 'bottle', 'pcs', 600, 100, 0.950, 'sup-2', '2026-09-01', '2026-09-01'),
    ('mat-cap', 'Bouchon à Vis Standard', 'cap', 'pcs', 6000, 1000, 0.050, 'sup-2', '2026-09-01', '2026-09-01'),
    ('mat-label-1l', 'Étiquette Autocollante 1L Citron', 'label', 'pcs', 4000, 500, 0.080, 'sup-2', '2026-09-01', '2026-09-01')
  `).run();

  // 4. Formulations
  db.prepare(`
    INSERT OR IGNORE INTO formulations (id, name, notes, base_yield_quantity, base_yield_unit, created_at, updated_at) VALUES
    ('form-vaisselle', 'Formulation Liquide Vaisselle Citron Standard', 'Recette standard 100L avec mousse active', 100.0, 'L', '2026-09-01', '2026-09-01')
  `).run();

  db.prepare(`
    INSERT OR IGNORE INTO formulation_items (id, formulation_id, material_id, quantity_required) VALUES
    ('fi-1', 'form-vaisselle', 'mat-labsa', 12.0),
    ('fi-2', 'form-vaisselle', 'mat-sles', 8.0),
    ('fi-3', 'form-vaisselle', 'mat-frag-lemon', 0.5)
  `).run();

  // 5. Container Types
  db.prepare(`
    INSERT OR IGNORE INTO container_types (id, name, capacity_liters, stock_quantity, created_at) VALUES
    ('ct-5l', 'Bidon 5L Consigné', 5, 120, '2026-09-01'),
    ('ct-20l', 'Jerrycan 20L Bleu', 20, 40, '2026-09-01')
  `).run();

  // 6. Product Families
  db.prepare(`
    INSERT OR IGNORE INTO product_families (id, name, category, type, formulation_id, created_at, updated_at) VALUES
    ('fam-vaisselle', 'Liquide Vaisselle Citron', 'Detergents', 'MANUFACTURED', 'form-vaisselle', '2026-09-01', '2026-09-01'),
    ('fam-javel', 'Eau de Javel Concentrée', 'Detergents', 'MANUFACTURED', NULL, '2026-09-01', '2026-09-01'),
    ('fam-air', 'Désodorisant Ambiance', 'Air Fresheners', 'MANUFACTURED', NULL, '2026-09-01', '2026-09-01'),
    ('fam-sponge', 'Éponge Abrasive Pro', 'Resale', 'RESALE', NULL, '2026-09-01', '2026-09-01')
  `).run();

  // 7. Products
  db.prepare(`
    INSERT OR IGNORE INTO products (id, family_id, name, size_label, barcode, stock_quantity, low_stock_threshold, cost_reference, retail_price, wholesale_price, container_type_id, active, created_at, updated_at) VALUES
    ('prod-v1', 'fam-vaisselle', 'Liquide Vaisselle Citron 1L', '1L', '619000100101', 45, 10, 1.250, 3.500, 2.800, NULL, 1, '2026-09-01', '2026-09-01'),
    ('prod-v15', 'fam-vaisselle', 'Liquide Vaisselle Citron 1.5L', '1.5L', '619000100156', 30, 8, 1.820, 4.800, 3.900, NULL, 1, '2026-09-01', '2026-09-01'),
    ('prod-v5', 'fam-vaisselle', 'Liquide Vaisselle Citron 5L', '5L', '619000100507', 12, 5, 5.500, 14.500, 12.000, 'ct-5l', 1, '2026-09-01', '2026-09-01'),
    ('prod-j1', 'fam-javel', 'Eau de Javel 1L', '1L', '619000200108', 60, 15, 0.650, 1.800, 1.400, NULL, 1, '2026-09-01', '2026-09-01'),
    ('prod-j5', 'fam-javel', 'Eau de Javel 5L', '5L', '619000200504', 25, 5, 2.800, 7.500, 6.000, 'ct-5l', 1, '2026-09-01', '2026-09-01'),
    ('prod-air-jas', 'fam-air', 'Désodorisant Jasmin 500ml', '500ml', '619000300501', 40, 10, 2.100, 5.200, 4.200, NULL, 1, '2026-09-01', '2026-09-01'),
    ('prod-sp-pro', 'fam-sponge', 'Éponge Abrasive Pro', 'Piece', '619000400012', 150, 20, 0.350, 0.850, 0.650, NULL, 1, '2026-09-01', '2026-09-01')
  `).run();

  // 8. Customers
  db.prepare(`
    INSERT OR IGNORE INTO customers (id, name, phone, address, type, reseller_discount_percent, wallet_balance, created_at, updated_at) VALUES
    ('cust-moncef', 'Moncef Ben Salah', '+216 98 123 456', 'Sfax Ville', 'RETAIL', 0, 15.000, '2026-09-01', '2026-09-01'),
    ('cust-elhana', 'Superette El Hana', '+216 74 222 333', 'Route Téniour Km 4, Sfax', 'WHOLESALE', 0, 0.000, '2026-09-01', '2026-09-01'),
    ('cust-trabelsi', 'Grossiste Trabelsi & Fils', '+216 99 888 777', 'Marché de Gros, Sfax', 'RESELLER', 10.0, 50.000, '2026-09-01', '2026-09-01')
  `).run();

  // 9. Debt tickets
  db.prepare(`
    INSERT OR IGNORE INTO customer_debt_tickets (id, ticket_number, customer_id, date, total_amount, remaining_amount, status, created_at, updated_at) VALUES
    ('tkt-1', 'TKT-20260801-0001', 'cust-elhana', '2026-08-01', 120.000, 120.000, 'UNPAID', '2026-08-01', '2026-08-01'),
    ('tkt-2', 'TKT-20260815-0002', 'cust-trabelsi', '2026-08-15', 250.000, 250.000, 'UNPAID', '2026-08-15', '2026-08-15')
  `).run();

  // 10. Container loans
  db.prepare(`
    INSERT OR IGNORE INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed) VALUES
    ('loan-1', 'cust-elhana', 'ct-5l', 10),
    ('loan-2', 'cust-trabelsi', 'ct-5l', 25),
    ('loan-3', 'cust-trabelsi', 'ct-20l', 5)
  `).run();

  // 11. Supplier debt ticket
  db.prepare(`
    INSERT OR IGNORE INTO supplier_debt_tickets (id, ticket_number, supplier_id, date, total_amount, remaining_amount, status, created_at, updated_at) VALUES
    ('sup-tkt-1', 'SUP-TKT-20260810-001', 'sup-1', '2026-08-10', 450.000, 450.000, 'UNPAID', '2026-08-10', '2026-08-10')
  `).run();

  console.log('[Seed] Seeding completed successfully!');
}

if (process.env.RUN_SEED === 'true') {
  seedDatabase();
}
