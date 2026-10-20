import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  claimRequest,
  completeRequest,
  findCompletedRequest,
  getClientRequestId,
  hashPayload,
  releaseRequest,
  resolveDuplicate,
  IdempotencyConflictError,
  IdempotencyDuplicateError,
  IdempotencyInProgressError
} from './idempotencyService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Online request idempotency store', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  });

  afterEach(() => {
    db.close();
  });

  it('hashes payloads stably regardless of object key order', () => {
    const a = hashPayload({ customer_id: 'c1', items: [{ product_id: 'p1', quantity: 2 }] });
    const b = hashPayload({ items: [{ quantity: 2, product_id: 'p1' }], customer_id: 'c1' });
    expect(a).toBe(b);
    expect(hashPayload({ customer_id: 'c1' })).not.toBe(a);
  });

  it('reads an optional client_request_id and rejects malformed ids', () => {
    expect(getClientRequestId({})).toBeNull();
    expect(getClientRequestId({ client_request_id: '  ' })).toBeNull();
    expect(getClientRequestId({ client_request_id: 'req-1234' })).toBe('req-1234');
    expect(() => getClientRequestId({ client_request_id: 42 })).toThrow(/must be a string/);
    expect(() => getClientRequestId({ client_request_id: 'x' })).toThrow(/4-128/);
  });

  it('claims once, stores the response, and replays the same payload', () => {
    const input = {
      requestId: 'req-sale-0001',
      actionType: 'SALE',
      payloadHash: hashPayload({ total: 10 })
    };
    claimRequest(db, input);
    const row: any = db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(input.requestId);
    expect(row.status).toBe('PROCESSING');

    expect(() => claimRequest(db, input)).toThrow(IdempotencyDuplicateError);
    expect(() => resolveDuplicate(db, input)).toThrow(IdempotencyInProgressError);

    completeRequest(db, input.requestId, {
      statusCode: 201,
      resourceId: 'sale-1',
      body: { sale_id: 'sale-1', receipt_number: 'REC-1' }
    });

    const replay = resolveDuplicate(db, input);
    expect(replay.statusCode).toBe(201);
    expect(replay.body).toEqual({ sale_id: 'sale-1', receipt_number: 'REC-1' });
    expect(replay.resourceId).toBe('sale-1');
  });

  it('rejects the same id with a different payload or action type', () => {
    const input = {
      requestId: 'req-sale-0002',
      actionType: 'SALE',
      payloadHash: hashPayload({ total: 10 })
    };
    claimRequest(db, input);
    completeRequest(db, input.requestId, { statusCode: 201, body: { ok: true } });

    expect(() => resolveDuplicate(db, { ...input, payloadHash: hashPayload({ total: 11 }) }))
      .toThrow(IdempotencyConflictError);
    expect(() => resolveDuplicate(db, { ...input, actionType: 'REFUND' }))
      .toThrow(IdempotencyConflictError);
  });

  it('releases a processing claim on validation failure and never deletes a completed row', () => {
    const input = {
      requestId: 'req-refund-0001',
      actionType: 'REFUND',
      payloadHash: hashPayload({ amount: 5 })
    };
    claimRequest(db, input);
    releaseRequest(db, input.requestId);
    expect(db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(input.requestId)).toBeUndefined();

    claimRequest(db, input);
    completeRequest(db, input.requestId, { statusCode: 201, body: { refund: true } });
    releaseRequest(db, input.requestId);
    const row: any = db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(input.requestId);
    expect(row.status).toBe('COMPLETED');
  });

  it('exposes completed requests for the offline sync cross-check', () => {
    const input = {
      requestId: 'req-cash-0001',
      actionType: 'CASH_MOVEMENT',
      payloadHash: hashPayload({ amount: 20 })
    };
    claimRequest(db, input);
    completeRequest(db, input.requestId, { statusCode: 201, resourceId: 'mov-1', body: { id: 'mov-1' } });

    expect(findCompletedRequest(db, input.requestId, 'CASH_MOVEMENT')?.body).toEqual({ id: 'mov-1' });
    expect(findCompletedRequest(db, input.requestId, 'SALE')).toBeNull();
  });
});
