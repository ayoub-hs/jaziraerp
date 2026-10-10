import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function seedAuditDb(dbPath: string = '/tmp/audit_test.sqlite') {
  if (fs.existsSync(dbPath)) {
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(`${dbPath}-wal`); } catch {}
    try { fs.unlinkSync(`${dbPath}-shm`); } catch {}
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schemaPath = path.join(__dirname, '../server/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);

  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  // 1. Configuration settings (Auth configured & unlocked)
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES 
    ('pin_hash', 'configured_hash'), 
    ('is_locked', 'false'), 
    ('master_hash', 'configured_master'),
    ('shop_name', 'Société Al Jazira SHSP'),
    ('shop_address', 'Zone Industrielle Charguia II, Tunis'),
    ('shop_phone', '+216 71 234 567'),
    ('tax_id', '1234567/A/M/000')
  `).run();

  // 2. Categories
  const categories = [
    { id: 'cat-detergents', name: 'Détergents & Nettoyants' },
    { id: 'cat-hygiene', name: 'Hygiène & Soins' },
    { id: 'cat-auto', name: 'Lavage & Auto' },
    { id: 'cat-resale-goods', name: 'Articles de Revente' },
  ];
  for (const c of categories) {
    db.prepare(`INSERT OR REPLACE INTO categories (id, name, type, created_at) VALUES (?, ?, 'PRODUCT', ?)`).run(c.id, c.name, now);
  }

  // 3. Container Types
  const containers = [
    { id: 'ct-1', name: 'Bidon Plastique 5L Renforcé', capacity: 5.0, stock: 120 },
    { id: 'ct-2', name: 'Fût Plastique Bleu 20L avec Robinet', capacity: 20.0, stock: 45 },
    { id: 'ct-3', name: 'Fût Métallique Industriel 200L', capacity: 200.0, stock: 12 },
  ];
  for (const ct of containers) {
    db.prepare(`INSERT INTO container_types (id, name, capacity_liters, stock_quantity, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(ct.id, ct.name, ct.capacity, ct.stock, now);
  }

  // 4. Product Families
  const families = [
    { id: 'fam-javel', name: 'Eau de Javel Al Jazira', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-vaisselle', name: 'Liquide Vaisselle Super Dégraissant', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-sol', name: 'Nettoyant Sols Parfumé Longue Durée', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-lessive', name: 'Lessive Liquide Concentrée Textile', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-savon', name: 'Savon Liquide Douceur Mains', cat: 'cat-hygiene', type: 'MANUFACTURED' },
    { id: 'fam-gel-hydro', name: 'Gel Hydroalcoolique Désinfectant', cat: 'cat-hygiene', type: 'MANUFACTURED' },
    { id: 'fam-auto', name: 'Shampoing Auto Haute Mousse Lustrant', cat: 'cat-auto', type: 'MANUFACTURED' },
    { id: 'fam-vitres', name: 'Nettoyant Vitres Anti-Traces Brillance', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-wc', name: 'Gel Détartrant Surpuissant WC Action Choc', cat: 'cat-detergents', type: 'MANUFACTURED' },
    { id: 'fam-degraissant', name: 'Dégraissant Universel Cuisine Multi-Surfaces', cat: 'cat-detergents', type: 'MANUFACTURED' },
  ];
  for (const f of families) {
    db.prepare(`INSERT INTO product_families (id, name, category, type, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(f.id, f.name, f.cat, f.type, now, now);
  }

  // 5. 40 Realistic Products with Long French Names
  const productList = [
    { id: 'prod-01', fam: 'fam-javel', name: 'Javel Parfumée Citron Frais 1.5L Flacon Ergonomique', size: '1.5L', bar: '619100000001', stock: 150, low: 20, cost: 1.200, retail: 2.400, wholesale: 2.000, ct: null },
    { id: 'prod-02', fam: 'fam-javel', name: 'Eau de Javel Désinfectante Concentrée 12° Bidon 5L', size: '5L', bar: '619100000002', stock: 85, low: 15, cost: 3.100, retail: 5.800, wholesale: 4.900, ct: 'ct-1' },
    { id: 'prod-03', fam: 'fam-javel', name: 'Eau de Javel Industrielle 18° Fût Plastique 20L', size: '20L', bar: '619100000003', stock: 25, low: 5, cost: 12.000, retail: 22.500, wholesale: 19.000, ct: 'ct-2' },
    { id: 'prod-04', fam: 'fam-javel', name: 'Gel Javel Épais Surpuissant Océan Flacon Canard 750ml', size: '750ml', bar: '619100000004', stock: 60, low: 10, cost: 1.800, retail: 3.200, wholesale: 2.700, ct: null },
    { id: 'prod-05', fam: 'fam-vaisselle', name: 'Liquide Vaisselle Extra Dégraissant Pomme Verte 1L', size: '1L', bar: '619100000005', stock: 110, low: 20, cost: 1.500, retail: 3.100, wholesale: 2.600, ct: null },
    { id: 'prod-06', fam: 'fam-vaisselle', name: 'Liquide Vaisselle Concentré Citron Vert Antibactérien 1L', size: '1L', bar: '619100000006', stock: 95, low: 20, cost: 1.550, retail: 3.200, wholesale: 2.650, ct: null },
    { id: 'prod-07', fam: 'fam-vaisselle', name: 'Liquide Vaisselle Formule Pro Économique Bidon 5L', size: '5L', bar: '619100000007', stock: 45, low: 10, cost: 5.200, retail: 9.800, wholesale: 8.200, ct: 'ct-1' },
    { id: 'prod-08', fam: 'fam-vaisselle', name: 'Liquide Vaisselle Restauration Collective Fût 20L', size: '20L', bar: '619100000008', stock: 18, low: 5, cost: 18.000, retail: 34.000, wholesale: 29.500, ct: 'ct-2' },
    { id: 'prod-09', fam: 'fam-sol', name: 'Nettoyant Sols Fraîcheur Lavande Sauvage 1L Flacon', size: '1L', bar: '619100000009', stock: 130, low: 25, cost: 1.400, retail: 2.900, wholesale: 2.400, ct: null },
    { id: 'prod-10', fam: 'fam-sol', name: 'Nettoyant Désinfectant Pin Sylvestre Sol & Carrelage 5L', size: '5L', bar: '619100000010', stock: 55, low: 10, cost: 4.800, retail: 9.200, wholesale: 7.800, ct: 'ct-1' },
    { id: 'prod-11', fam: 'fam-sol', name: 'Nettoyant Brillance Marbre & Céramique Jasmin 1L', size: '1L', bar: '619100000011', stock: 80, low: 15, cost: 1.700, retail: 3.500, wholesale: 2.950, ct: null },
    { id: 'prod-12', fam: 'fam-sol', name: 'Dégraissant Sols Ateliers & Garages Super Décapant 20L', size: '20L', bar: '619100000012', stock: 14, low: 4, cost: 24.000, retail: 45.000, wholesale: 38.000, ct: 'ct-2' },
    { id: 'prod-13', fam: 'fam-lessive', name: 'Lessive Liquide Concentrée Textile Fleur de Coton 3L', size: '3L', bar: '619100000013', stock: 75, low: 15, cost: 6.500, retail: 12.800, wholesale: 10.900, ct: null },
    { id: 'prod-14', fam: 'fam-lessive', name: 'Lessive Liquide Spéciale Linge Noir & Couleurs 1.5L', size: '1.5L', bar: '619100000014', stock: 40, low: 10, cost: 3.800, retail: 7.500, wholesale: 6.200, ct: null },
    { id: 'prod-15', fam: 'fam-lessive', name: 'Assouplissant Textile Soin & Parfum Orchidée 2L', size: '2L', bar: '619100000015', stock: 65, low: 12, cost: 3.200, retail: 6.400, wholesale: 5.300, ct: null },
    { id: 'prod-16', fam: 'fam-lessive', name: 'Lessive Poudre Atomisée Sac Polypropylène 10kg', size: '10kg', bar: '619100000016', stock: 35, low: 8, cost: 14.500, retail: 26.000, wholesale: 22.500, ct: null },
    { id: 'prod-17', fam: 'fam-savon', name: 'Savon Liquide Mains Aloe Vera & Glycérine Végétale 500ml', size: '500ml', bar: '619100000017', stock: 140, low: 25, cost: 1.100, retail: 2.500, wholesale: 2.050, ct: null },
    { id: 'prod-18', fam: 'fam-savon', name: 'Recharge Savon Mains Antibactérien Amande Douce 1L', size: '1L', bar: '619100000018', stock: 90, low: 20, cost: 1.600, retail: 3.400, wholesale: 2.800, ct: null },
    { id: 'prod-19', fam: 'fam-savon', name: 'Savon Mains Crème Lavante Professionnelle Bidon 5L', size: '5L', bar: '619100000019', stock: 40, low: 10, cost: 6.200, retail: 11.500, wholesale: 9.800, ct: 'ct-1' },
    { id: 'prod-20', fam: 'fam-gel-hydro', name: 'Gel Hydroalcoolique 70% Flacon Pompe Hygiénique 500ml', size: '500ml', bar: '619100000020', stock: 120, low: 20, cost: 2.100, retail: 4.500, wholesale: 3.700, ct: null },
    { id: 'prod-21', fam: 'fam-gel-hydro', name: 'Solution Hydroalcoolique Antiseptique Bidon 5L', size: '5L', bar: '619100000021', stock: 30, low: 8, cost: 15.000, retail: 28.000, wholesale: 24.000, ct: 'ct-1' },
    { id: 'prod-22', fam: 'fam-auto', name: 'Shampoing Carrosserie Lustrant Anti-Statique 1L', size: '1L', bar: '619100000022', stock: 70, low: 15, cost: 2.200, retail: 4.800, wholesale: 3.900, ct: null },
    { id: 'prod-23', fam: 'fam-auto', name: 'Mousse Active Lavage Haute Pression Station Bidon 5L', size: '5L', bar: '619100000023', stock: 35, low: 10, cost: 7.800, retail: 15.500, wholesale: 13.000, ct: 'ct-1' },
    { id: 'prod-24', fam: 'fam-auto', name: 'Rénovateur Pneus & Plastiques Extérieurs Brillance 500ml', size: '500ml', bar: '619100000024', stock: 50, low: 10, cost: 2.900, retail: 6.200, wholesale: 5.100, ct: null },
    { id: 'prod-25', fam: 'fam-auto', name: 'Lave-Glace Démoustiquant Toutes Saisons Sécurité 3L', size: '3L', bar: '619100000025', stock: 85, low: 15, cost: 2.400, retail: 5.000, wholesale: 4.100, ct: null },
    { id: 'prod-26', fam: 'fam-vitres', name: 'Nettoyant Vitres & Glaces Vaporisateur Pistolet 750ml', size: '750ml', bar: '619100000026', stock: 95, low: 20, cost: 1.300, retail: 2.800, wholesale: 2.300, ct: null },
    { id: 'prod-27', fam: 'fam-vitres', name: 'Recharge Nettoyant Vitres Sans Traces Brillant 1.5L', size: '1.5L', bar: '619100000027', stock: 65, low: 15, cost: 1.600, retail: 3.300, wholesale: 2.750, ct: null },
    { id: 'prod-28', fam: 'fam-vitres', name: 'Nettoyant Vitres Concentré Baies Vitrées Bidon 5L', size: '5L', bar: '619100000028', stock: 28, low: 8, cost: 4.500, retail: 8.900, wholesale: 7.500, ct: 'ct-1' },
    { id: 'prod-29', fam: 'fam-wc', name: 'Gel Détartrant WC Triple Action Désinfectant 750ml', size: '750ml', bar: '619100000029', stock: 80, low: 15, cost: 1.750, retail: 3.600, wholesale: 3.000, ct: null },
    { id: 'prod-30', fam: 'fam-wc', name: 'Bloc Cuve WC Nettoyant & Parfumé Bleu Pack de 3', size: '3 pcs', bar: '619100000030', stock: 110, low: 25, cost: 1.200, retail: 2.600, wholesale: 2.100, ct: null },
    { id: 'prod-31', fam: 'fam-wc', name: 'Acide Chlorhydrique Technique Décapant Émail 1L', size: '1L', bar: '619100000031', stock: 60, low: 12, cost: 1.100, retail: 2.200, wholesale: 1.800, ct: null },
    { id: 'prod-32', fam: 'fam-degraissant', name: 'Dégraissant Puissant Fours & Plaques Spray 750ml', size: '750ml', bar: '619100000032', stock: 75, low: 15, cost: 2.100, retail: 4.600, wholesale: 3.800, ct: null },
    { id: 'prod-33', fam: 'fam-degraissant', name: 'Solvant Dégraissant Industriel Métaux Bidon 5L', size: '5L', bar: '619100000033', stock: 22, low: 6, cost: 8.500, retail: 16.800, wholesale: 14.000, ct: 'ct-1' },
    { id: 'prod-34', fam: 'fam-degraissant', name: 'Nettoyant Désincrustant Friteuses & Hottes Pro 1L', size: '1L', bar: '619100000034', stock: 48, low: 10, cost: 2.800, retail: 5.900, wholesale: 4.900, ct: null },
    { id: 'prod-35', fam: 'fam-javel', name: 'Pastilles de Chlore Effervescentes Boîte de 40', size: '40 pcs', bar: '619100000035', stock: 50, low: 10, cost: 3.000, retail: 6.500, wholesale: 5.400, ct: null },
    { id: 'prod-36', fam: 'fam-sol', name: 'Cire Lustrante Auto-Brillante Sols et Faïences 1L', size: '1L', bar: '619100000036', stock: 38, low: 8, cost: 2.700, retail: 5.800, wholesale: 4.700, ct: null },
    { id: 'prod-37', fam: 'fam-sol', name: 'Désodorisant Surodorant Concentré Fraise des Bois 1L', size: '1L', bar: '619100000037', stock: 45, low: 10, cost: 3.500, retail: 7.200, wholesale: 6.000, ct: null },
    { id: 'prod-38', fam: 'fam-savon', name: 'Savon Noir Liquide Végétal Naturel Multi-Usages 1L', size: '1L', bar: '619100000038', stock: 52, low: 10, cost: 2.000, retail: 4.200, wholesale: 3.500, ct: null },
    { id: 'prod-39', fam: 'fam-lessive', name: 'Eau Déminéralisée Purete Supérieure Fer & Vapeur 5L', size: '5L', bar: '619100000039', stock: 90, low: 20, cost: 1.000, retail: 2.300, wholesale: 1.900, ct: 'ct-1' },
    { id: 'prod-40', fam: 'fam-auto', name: 'Dégoudronnant Rapide Sécurité Carrosserie Spray 500ml', size: '500ml', bar: '619100000040', stock: 0, low: 10, cost: 3.400, retail: 7.000, wholesale: 5.900, ct: null },
  ];

  for (const p of productList) {
    db.prepare(`
      INSERT INTO products (id, family_id, name, size_label, barcode, stock_quantity, low_stock_threshold, cost_reference, retail_price, wholesale_price, container_type_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(p.id, p.fam, p.name, p.size, p.bar, p.stock, p.low, p.cost, p.retail, p.wholesale, p.ct, now, now);
  }

  // Pack sizes
  db.prepare(`
    INSERT INTO product_pack_sizes (id, product_id, pack_label, multiplier, price_override, barcode)
    VALUES 
      ('pack-1-6', 'prod-01', 'Carton de 6 bouteilles', 6, 13.500, '619100000001-6'),
      ('pack-1-12', 'prod-01', 'Carton de 12 bouteilles', 12, 26.000, '619100000001-12'),
      ('pack-5-12', 'prod-05', 'Carton de 12 bidons 1L', 12, 35.000, '619100000005-12')
  `).run();

  // 6. Customers
  const customersList = [
    { id: 'cust-1', name: 'Grossiste Ben Salem & Frères', phone: '+216 71 234 567', addr: 'Zone Industrielle Charguia II, Tunis', type: 'RESELLER', discount: 15.0, wallet: 0.0 },
    { id: 'cust-2', name: 'Mme Amel Trabelsi', phone: '+216 98 765 432', addr: '14 Rue Ibn Khaldoun, La Marsa', type: 'RETAIL', discount: 0.0, wallet: 45.000 },
    { id: 'cust-3', name: 'Mohamed Ali Ben Amor', phone: '+216 55 112 233', addr: 'Cité Ennasr 2, Ariana', type: 'RETAIL', discount: 0.0, wallet: 0.0 },
    { id: 'cust-4', name: 'Supérette El Baraka (M. Slim)', phone: '+216 72 345 678', addr: 'Avenue Habib Bourguiba, Nabeul', type: 'WHOLESALE', discount: 0.0, wallet: 12.500 },
    { id: 'cust-5', name: 'Société Propreté Plus SARL', phone: '+216 73 456 789', addr: 'Route de Ceinture, Sousse', type: 'WHOLESALE', discount: 0.0, wallet: 0.0 },
    { id: 'cust-6', name: 'Café Restaurant Le Jasmin', phone: '+216 97 889 900', addr: 'Port de Plaisance, Hammamet', type: 'RETAIL', discount: 0.0, wallet: 0.0 },
  ];

  for (const c of customersList) {
    db.prepare(`
      INSERT INTO customers (id, name, phone, address, type, reseller_discount_percent, wallet_balance, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(c.id, c.name, c.phone, c.addr, c.type, c.discount, c.wallet, now, now);
  }

  // Debt ticket for Reseller Grossiste Ben Salem
  db.prepare(`
    INSERT INTO customer_debt_tickets (id, ticket_number, customer_id, sale_id, date, total_amount, remaining_amount, status, created_at, updated_at)
    VALUES ('ticket-debt-1', 'CR-202610-001', 'cust-1', NULL, ?, 450.000, 280.000, 'PARTIALLY_PAID', ?, ?)
  `).run(yesterday, yesterday, now);

  // Customer container loan for cust-5 (owes 5x ct-1)
  db.prepare(`
    INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
    VALUES ('loan-1', 'cust-5', 'ct-1', 5)
  `).run();

  // 7. Suppliers & Purchases
  db.prepare(`
    INSERT INTO suppliers (id, name, phone, address, active, created_at, updated_at)
    VALUES 
      ('sup-1', 'Fournisseur Plastique & Emballage Tunis', '+216 71 888 999', 'Z.I. Ben Arous', 1, ?, ?),
      ('sup-2', 'Chimie Industrielle Du Sud Sfax', '+216 74 222 333', 'Route de Gabès km 3, Sfax', 1, ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO purchases (id, purchase_number, supplier_id, date, total_amount, payment_status, notes, created_at)
    VALUES ('pur-1', 'ACH-202610-001', 'sup-1', ?, 1200.000, 'CREDIT', 'Facture emballages bidons 5L et fûts 20L', ?)
  `).run(yesterday, yesterday);

  db.prepare(`
    INSERT INTO supplier_debt_tickets (id, ticket_number, supplier_id, purchase_id, date, total_amount, remaining_amount, status, created_at, updated_at)
    VALUES ('sup-ticket-1', 'DET-FOURN-001', 'sup-1', 'pur-1', ?, 1200.000, 600.000, 'PARTIALLY_PAID', ?, ?)
  `).run(yesterday, yesterday, now);

  // 8. Raw Materials & Formulations
  db.prepare(`
    INSERT INTO raw_materials (id, name, category, unit, stock_quantity, latest_supplier_id, latest_purchase_cost, low_stock_threshold, active, created_at, updated_at)
    VALUES 
      ('mat-1', 'Tensioactif SLES 70% Sulfat', 'surfactant', 'kg', 450.0, 'sup-2', 3.800, 50.0, 1, ?, ?),
      ('mat-2', 'Parfum Citron Concentré Huileux', 'fragrance', 'L', 28.0, 'sup-2', 42.000, 5.0, 1, ?, ?),
      ('mat-3', 'Flacon PEHD Blanc 1L avec Poignée', 'bottle', 'pcs', 1200.0, 'sup-1', 0.450, 200.0, 1, ?, ?),
      ('mat-4', 'Bouchon Sécurité Enfant 28mm Rouge', 'cap', 'pcs', 2500.0, 'sup-1', 0.080, 500.0, 1, ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO formulations (id, name, notes, base_yield_quantity, base_yield_unit, created_at, updated_at)
    VALUES ('form-1', 'Formule Liquide Vaisselle Standard 1000L', 'Recette certifiée pH neutre', 1000.0, 'L', ?, ?)
  `).run(now, now);

  // 9. Register Sessions
  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, closed_at, counted_cash, expected_cash, difference, status, notes)
    VALUES ('sess-counter-1', 'SESS-20261010-001', 'Countertop', ?, 250.000, NULL, NULL, 250.000, 0, 'OPEN', 'Ouverture de matinée caisse comptoir')
  `).run(now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, closed_at, counted_cash, expected_cash, difference, status, notes)
    VALUES ('sess-mobile-1', 'SESS-20261010-002', 'Mobile Register', ?, 100.000, NULL, NULL, 100.000, 0, 'OPEN', 'Caisse mobile terminal')
  `).run(now);

  db.prepare(`
    INSERT INTO register_sessions (id, session_number, counter_name, opened_at, opening_cash, closed_at, counted_cash, expected_cash, difference, status, notes)
    VALUES ('sess-closed-1', 'SESS-20261009-001', 'Countertop', ?, 200.000, ?, 480.000, 480.000, 0.000, 'CLOSED', 'Session clôturée avec succès')
  `).run(yesterday, yesterday);

  // 10. Cash movements
  db.prepare(`
    INSERT INTO register_cash_movements (id, session_id, date, type, amount, reason, created_at)
    VALUES 
      ('mov-1', 'sess-counter-1', ?, 'CASH_IN', 50.000, 'Appoint monnaie supplémentaire', ?),
      ('mov-2', 'sess-counter-1', ?, 'CASH_OUT', 20.000, 'Achat fournitures d entretien', ?)
  `).run(now, now, now, now);

  // 11. Completed Sale
  db.prepare(`
    INSERT INTO sales (id, receipt_number, session_id, date, customer_id, subtotal_ht, tva_rate, tva_amount, total_ttc, total_discount, cash_paid, wallet_paid, credit_amount, change_given, status, created_at)
    VALUES ('sale-prev-1', 'REC-20261010-0001', 'sess-counter-1', ?, 'cust-3', 14.706, 0.19, 2.794, 17.500, 0.0, 20.000, 0.0, 0.0, 2.500, 'COMPLETED', ?)
  `).run(yesterday, yesterday);

  db.prepare(`
    INSERT INTO sale_items (id, sale_id, product_id, is_quick_add, quick_add_name, pack_size_id, pack_multiplier, quantity, quantity_refunded, base_stock_deducted, unit_price, catalog_unit_price, discount_amount, line_total)
    VALUES 
      ('si-1', 'sale-prev-1', 'prod-01', 0, NULL, NULL, 1, 2, 0, 2, 2.400, 2.400, 0, 4.800),
      ('si-2', 'sale-prev-1', 'prod-05', 0, NULL, NULL, 1, 3, 0, 3, 3.100, 3.100, 0, 9.300),
      ('si-3', 'sale-prev-1', 'prod-09', 0, NULL, NULL, 1, 1, 0, 1, 2.900, 2.900, 0, 2.900)
  `).run();

  db.close();
  console.log(`[SeedAuditDb] Seeded realistic database successfully at: ${dbPath}`);
}

if (process.argv[1] && (process.argv[1].endsWith('seed_audit_db.ts') || process.argv[1].endsWith('seed_audit_db.js'))) {
  seedAuditDb(process.env.DATABASE_PATH || '/tmp/audit_test.sqlite');
}
