import type { Database } from 'better-sqlite3';
import { ValidationError } from '../utils/validation.js';

export class NotFoundError extends Error {
  public status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface RecordContainerTransactionInput {
  customer_id: string;
  container_type_id: string;
  action: 'GIVE' | 'RETURN' | string;
  quantity: number | string;
  correction?: boolean;
  notes?: string;
  date?: string;
}

export interface RecordContainerTransactionResult {
  success: boolean;
  transaction_id: string;
  customer_id: string;
  container_type_id: string;
  action: string;
  quantity: number;
  customer_quantity_owed: number;
  shop_stock_remaining: number;
}

/**
 * Records a GIVE or RETURN container transaction for a customer.
 * Extracted verbatim from containers.ts for reuse in order conversion.
 * Executes cleanly within an existing outer transaction or standalone.
 */
export function recordContainerTransaction(
  db: Database,
  input: RecordContainerTransactionInput
): RecordContainerTransactionResult {
  const {
    customer_id,
    container_type_id,
    action,
    quantity,
    correction = false,
    notes = '',
    date = new Date().toISOString()
  } = input || ({} as any);

  if (!customer_id || !container_type_id || !action || quantity === undefined || quantity === null || quantity === '') {
    throw new ValidationError('customer_id, container_type_id, action, and quantity are required.');
  }

  if (action !== 'GIVE' && action !== 'RETURN') {
    throw new ValidationError('action must be GIVE or RETURN');
  }

  const numQty = Number(quantity);
  const qty = parseInt(String(quantity), 10);
  if (isNaN(qty) || qty <= 0 || !Number.isInteger(numQty)) {
    throw new ValidationError('quantity must be a positive integer');
  }

  const customer: any = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  const containerType: any = db.prepare('SELECT * FROM container_types WHERE id = ?').get(container_type_id);
  if (!containerType) {
    throw new NotFoundError('Container type not found');
  }

  const txId = crypto.randomUUID();
  const loanId = crypto.randomUUID();
  const now = new Date().toISOString();

  // RETURN above the customer's owed count is rejected unless sent as a correction.
  // (GIVE at zero shop stock stays allowed per spec.)
  if (action === 'RETURN' && !correction) {
    const loan: any = db.prepare(
      'SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?'
    ).get(customer_id, container_type_id);
    const owed = loan ? Number(loan.quantity_owed) || 0 : 0;
    if (qty > owed) {
      throw new ValidationError(
        `Return quantity (${qty}) exceeds customer's owed count (${owed}). Resubmit with correction=true to override.`
      );
    }
  }

  // 1. Log transaction record
  db.prepare(`
    INSERT INTO container_transactions (id, date, customer_id, container_type_id, action, quantity, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(txId, date, customer_id, container_type_id, action, qty, notes, now);

  if (action === 'GIVE') {
    // Decrement shop container stock (DOES NOT BLOCK IF 0)
    db.prepare(`
      UPDATE container_types
      SET stock_quantity = stock_quantity - ?
      WHERE id = ?
    `).run(qty, container_type_id);

    // Upsert customer owed count
    db.prepare(`
      INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(customer_id, container_type_id)
      DO UPDATE SET quantity_owed = quantity_owed + excluded.quantity_owed
    `).run(loanId, customer_id, container_type_id, qty);
  } else if (action === 'RETURN') {
    // Increment shop container stock
    db.prepare(`
      UPDATE container_types
      SET stock_quantity = stock_quantity + ?
      WHERE id = ?
    `).run(qty, container_type_id);

    // Decrement customer owed count
    db.prepare(`
      INSERT INTO customer_container_loans (id, customer_id, container_type_id, quantity_owed)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(customer_id, container_type_id)
      DO UPDATE SET quantity_owed = MAX(0, quantity_owed - ?)
    `).run(loanId, customer_id, container_type_id, qty);
  }

  const updatedLoan: any = db.prepare(`
    SELECT * FROM customer_container_loans WHERE customer_id = ? AND container_type_id = ?
  `).get(customer_id, container_type_id);

  const updatedType: any = db.prepare(`
    SELECT * FROM container_types WHERE id = ?
  `).get(container_type_id);

  return {
    success: true,
    transaction_id: txId,
    customer_id,
    container_type_id,
    action,
    quantity: qty,
    customer_quantity_owed: updatedLoan ? updatedLoan.quantity_owed : 0,
    shop_stock_remaining: updatedType ? updatedType.stock_quantity : 0
  };
}
