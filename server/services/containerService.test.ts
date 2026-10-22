import { describe, it, expect, beforeEach } from 'vitest';
import { resetTestDb, getDb } from '../../tests/testApp.js';
import { recordContainerTransaction, NotFoundError } from './containerService.js';
import { ValidationError } from '../utils/validation.js';

describe('containerService.recordContainerTransaction', () => {
  beforeEach(() => {
    const db = resetTestDb();
    db.prepare(`
      INSERT INTO customers (id, name, type, created_at, updated_at)
      VALUES ('cust-svc-1', 'Agency Svc Test', 'WHOLESALE', '2026-09-07', '2026-09-07')
    `).run();
    db.prepare(`
      INSERT INTO container_types (id, name, capacity_liters, stock_quantity, created_at)
      VALUES ('ct-svc-1', '10L Test Jerrycan', 10, 20, '2026-09-07')
    `).run();
  });

  it('records a GIVE transaction and updates shop stock and customer owed count', () => {
    const db = getDb();
    const res = recordContainerTransaction(db, {
      customer_id: 'cust-svc-1',
      container_type_id: 'ct-svc-1',
      action: 'GIVE',
      quantity: 4,
      notes: 'Test loan'
    });

    expect(res.success).toBe(true);
    expect(res.action).toBe('GIVE');
    expect(res.quantity).toBe(4);
    expect(res.customer_quantity_owed).toBe(4);
    expect(res.shop_stock_remaining).toBe(16);

    const loan: any = db.prepare('SELECT quantity_owed FROM customer_container_loans WHERE customer_id = ?').get('cust-svc-1');
    expect(loan.quantity_owed).toBe(4);
  });

  it('records a RETURN transaction and updates counts', () => {
    const db = getDb();
    recordContainerTransaction(db, {
      customer_id: 'cust-svc-1',
      container_type_id: 'ct-svc-1',
      action: 'GIVE',
      quantity: 5
    });

    const res = recordContainerTransaction(db, {
      customer_id: 'cust-svc-1',
      container_type_id: 'ct-svc-1',
      action: 'RETURN',
      quantity: 2
    });

    expect(res.success).toBe(true);
    expect(res.customer_quantity_owed).toBe(3);
    expect(res.shop_stock_remaining).toBe(17); // 20 - 5 + 2 = 17
  });

  it('rejects RETURN quantity above owed count unless correction=true', () => {
    const db = getDb();
    recordContainerTransaction(db, {
      customer_id: 'cust-svc-1',
      container_type_id: 'ct-svc-1',
      action: 'GIVE',
      quantity: 2
    });

    expect(() => {
      recordContainerTransaction(db, {
        customer_id: 'cust-svc-1',
        container_type_id: 'ct-svc-1',
        action: 'RETURN',
        quantity: 5
      });
    }).toThrow(ValidationError);

    const corrected = recordContainerTransaction(db, {
      customer_id: 'cust-svc-1',
      container_type_id: 'ct-svc-1',
      action: 'RETURN',
      quantity: 5,
      correction: true
    });
    expect(corrected.customer_quantity_owed).toBe(0);
  });

  it('validates input and throws ValidationError for invalid fields', () => {
    const db = getDb();
    expect(() => recordContainerTransaction(db, null as any)).toThrow(ValidationError);
    expect(() => recordContainerTransaction(db, { customer_id: '', container_type_id: 'ct-svc-1', action: 'GIVE', quantity: 1 })).toThrow(ValidationError);
    expect(() => recordContainerTransaction(db, { customer_id: 'cust-svc-1', container_type_id: 'ct-svc-1', action: 'INVALID', quantity: 1 })).toThrow(ValidationError);
    expect(() => recordContainerTransaction(db, { customer_id: 'cust-svc-1', container_type_id: 'ct-svc-1', action: 'GIVE', quantity: -1 })).toThrow(ValidationError);
    expect(() => recordContainerTransaction(db, { customer_id: 'cust-svc-1', container_type_id: 'ct-svc-1', action: 'GIVE', quantity: 1.5 })).toThrow(ValidationError);
  });

  it('throws NotFoundError when customer or container type does not exist', () => {
    const db = getDb();
    expect(() => recordContainerTransaction(db, { customer_id: 'unknown-cust', container_type_id: 'ct-svc-1', action: 'GIVE', quantity: 1 })).toThrow(NotFoundError);
    expect(() => recordContainerTransaction(db, { customer_id: 'cust-svc-1', container_type_id: 'unknown-ct', action: 'GIVE', quantity: 1 })).toThrow(NotFoundError);
  });
});
