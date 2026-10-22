import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import {
  requireFinitePositive,
  requireFiniteNonNegative,
  requireOptionalFinitePositive,
  requireOptionalFiniteNonNegative
} from '../utils/validation.js';
import { recordContainerTransaction } from '../services/containerService.js';

export const containersRouter = Router();

// GET /api/containers or /api/containers/types - list container types with stock and total loaned out
const listContainerTypes = (req: Request, res: Response) => {
  const db = getDb();
  const { active = '1' } = req.query;
  let query = `
    SELECT ct.*,
      COALESCE((SELECT SUM(ccl.quantity_owed) FROM customer_container_loans ccl WHERE ccl.container_type_id = ct.id), 0) as total_loaned_out
    FROM container_types ct
    WHERE 1=1
  `;
  if (active === '1') {
    query += ` AND (ct.active = 1 OR ct.active IS NULL)`;
  }
  query += ` ORDER BY ct.name ASC`;

  const types: any[] = db.prepare(query).all();

  res.json(types);
};

containersRouter.get('/types', listContainerTypes);
containersRouter.get('/', listContainerTypes);

// POST /api/containers & /api/containers/types - create container type
const createContainerType = (req: Request, res: Response) => {
  const { name, capacity_liters = null, stock_quantity = 0 } = req.body;

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Container type name is required.' });
    return;
  }

  let validCapacity: number | null = null;
  let validStock: number = 0;
  try {
    if (capacity_liters !== null && capacity_liters !== undefined && capacity_liters !== '') {
      validCapacity = requireFinitePositive(capacity_liters, 'capacité en litres');
    }
    validStock = requireFiniteNonNegative(stock_quantity, 'quantité en stock', 0);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name.trim(), validCapacity, validStock, now);

  const created = db.prepare('SELECT * FROM container_types WHERE id = ?').get(id);
  res.status(201).json(created);
};

containersRouter.post('/types', createContainerType);
containersRouter.post('/', createContainerType);

// PUT /api/containers/types/:id & /:id - update container type
const handleUpdateContainerType = (req: Request, res: Response) => {
  const { name, capacity_liters, stock_quantity } = req.body;
  const db = getDb();

  const existing: any = db.prepare('SELECT * FROM container_types WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Container type not found' });
    return;
  }

  let validCapacity: number | undefined;
  let validStock: number | undefined;
  try {
    validCapacity = requireOptionalFinitePositive(capacity_liters, 'capacité en litres');
    validStock = requireOptionalFiniteNonNegative(stock_quantity, 'quantité en stock');
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  db.prepare(`
    UPDATE container_types
    SET name = COALESCE(?, name),
        capacity_liters = COALESCE(?, capacity_liters),
        stock_quantity = COALESCE(?, stock_quantity)
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : null,
    validCapacity !== undefined ? validCapacity : null,
    validStock !== undefined ? validStock : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM container_types WHERE id = ?').get(req.params.id);
  res.json(updated);
};

containersRouter.put('/types/:id', handleUpdateContainerType);
containersRouter.put('/:id', handleUpdateContainerType);

// DELETE /api/containers/types/:id & /:id - delete or soft-delete container type
const handleDeleteContainerType = (req: Request, res: Response) => {
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM container_types WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Container type not found' });
    return;
  }

  // Check references: customer_container_loans, container_transactions, products
  const hasLoans: any = db.prepare('SELECT COUNT(*) as count FROM customer_container_loans WHERE container_type_id = ?').get(req.params.id);
  const hasTx: any = db.prepare('SELECT COUNT(*) as count FROM container_transactions WHERE container_type_id = ?').get(req.params.id);
  const hasProducts: any = db.prepare('SELECT COUNT(*) as count FROM products WHERE container_type_id = ?').get(req.params.id);

  const isReferenced = (hasLoans?.count > 0) || (hasTx?.count > 0) || (hasProducts?.count > 0);

  if (isReferenced) {
    db.prepare('UPDATE container_types SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true, soft_deleted: true, id: req.params.id, message: 'Container type deactivated' });
  } else {
    db.prepare('DELETE FROM container_types WHERE id = ?').run(req.params.id);
    res.json({ success: true, soft_deleted: false, id: req.params.id, message: 'Container type deleted permanently' });
  }
};

containersRouter.delete('/types/:id', handleDeleteContainerType);
containersRouter.delete('/:id', handleDeleteContainerType);

// GET /api/containers/loans - list customer container loans
containersRouter.get('/loans', (req: Request, res: Response) => {
  const db = getDb();
  const { customer_id } = req.query;

  let query = `
    SELECT ccl.*, c.name as customer_name, ct.name as container_type_name, ct.capacity_liters
    FROM customer_container_loans ccl
    JOIN customers c ON ccl.customer_id = c.id
    JOIN container_types ct ON ccl.container_type_id = ct.id
    WHERE ccl.quantity_owed > 0
  `;
  const params: any[] = [];

  if (customer_id) {
    query += ` AND ccl.customer_id = ?`;
    params.push(String(customer_id));
  }

  query += ` ORDER BY c.name ASC, ct.name ASC`;

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// POST /api/containers/transactions - GIVE or RETURN containers (separate from sales checkout)
containersRouter.post('/transactions', (req: Request, res: Response) => {
  const db = getDb();
  try {
    const result = recordContainerTransaction(db, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.status || (err.message?.includes('not found') ? 404 : 400);
    res.status(status).json({ error: err.message });
  }
});

// GET /api/containers/transactions - transaction history
containersRouter.get('/transactions', (req: Request, res: Response) => {
  const db = getDb();
  const { customer_id, container_type_id } = req.query;

  let query = `
    SELECT ct.*, c.name as customer_name, ctype.name as container_type_name
    FROM container_transactions ct
    JOIN customers c ON ct.customer_id = c.id
    JOIN container_types ctype ON ct.container_type_id = ctype.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (customer_id) {
    query += ` AND ct.customer_id = ?`;
    params.push(String(customer_id));
  }

  if (container_type_id) {
    query += ` AND ct.container_type_id = ?`;
    params.push(String(container_type_id));
  }

  query += ` ORDER BY ct.date DESC, ct.created_at DESC`;

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});
