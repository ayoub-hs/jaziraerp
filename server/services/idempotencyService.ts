import crypto from 'crypto';

export const PROCESSED_REQUEST_PROCESSING = 'PROCESSING';
export const PROCESSED_REQUEST_COMPLETED = 'COMPLETED';

export class IdempotencyBadRequestError extends Error {
  public status = 400;
  public code = 'IDEMPOTENCY_BAD_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyBadRequestError';
  }
}

export class IdempotencyConflictError extends Error {
  public status = 409;
  public code = 'IDEMPOTENCY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

export class IdempotencyInProgressError extends Error {
  public status = 409;
  public code = 'IDEMPOTENCY_IN_PROGRESS';
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyInProgressError';
  }
}

/** Internal marker: the primary key already existed. The caller must resolve it. */
export class IdempotencyDuplicateError extends Error {
  constructor(public requestId: string) {
    super(`Duplicate request id: ${requestId}`);
    this.name = 'IdempotencyDuplicateError';
  }
}

export interface CompletedRequest {
  statusCode: number;
  body: any;
  resourceId: string | null;
}

export interface ClaimRequestInput {
  requestId: string;
  actionType: string;
  payloadHash: string;
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Stable SHA-256 of a request payload. Object key order is normalized so a
 * client retry with the same JSON values but a different key order still
 * matches; any value change produces a different hash.
 */
export function hashPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(canonicalize(payload)).digest('hex');
}

/**
 * Accepts an optional client-generated request id. Empty/absent means the
 * request is legacy and not idempotent. Invalid types/sizes are 400s.
 */
export function getClientRequestId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as Record<string, unknown>).client_request_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') {
    throw new IdempotencyBadRequestError('client_request_id must be a string');
  }
  const requestId = raw.trim();
  if (requestId === '') return null;
  if (!/^[A-Za-z0-9_.:-]{4,128}$/.test(requestId)) {
    throw new IdempotencyBadRequestError(
      'client_request_id must be 4-128 characters (letters, digits, dot, colon, underscore, hyphen)'
    );
  }
  return requestId;
}

function isRequestIdUniqueViolation(err: any): boolean {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return (
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    message.includes('UNIQUE constraint failed: processed_requests.request_id')
  );
}

/**
 * Claims a request id by inserting the PROCESSING row. This must be called
 * outside the business transaction so the primary key is the single dedupe
 * mechanism (no check-then-insert). A primary-key violation is converted to
 * IdempotencyDuplicateError; the caller resolves it with resolveDuplicate().
 */
export function claimRequest(db: any, input: ClaimRequestInput): void {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO processed_requests (
        request_id, action_type, payload_hash, status, created_at
      ) VALUES (?, ?, ?, 'PROCESSING', ?)
    `).run(input.requestId, input.actionType, input.payloadHash, now);
  } catch (err: any) {
    if (isRequestIdUniqueViolation(err)) {
      throw new IdempotencyDuplicateError(input.requestId);
    }
    throw err;
  }
}

/**
 * Resolves a duplicate request id:
 * - same id + different payload/action -> 409
 * - still PROCESSING -> 409 (in progress)
 * - COMPLETED -> return the stored status/body for a safe replay
 */
export function resolveDuplicate(
  db: any,
  input: ClaimRequestInput
): CompletedRequest {
  const row: any = db.prepare('SELECT * FROM processed_requests WHERE request_id = ?').get(input.requestId);
  if (!row) {
    throw new Error(`Idempotency row disappeared for request ${input.requestId}`);
  }
  if (row.action_type !== input.actionType) {
    throw new IdempotencyConflictError(
      'Ce client_request_id a déjà été utilisé pour un autre type d’opération.'
    );
  }
  if (row.payload_hash !== input.payloadHash) {
    throw new IdempotencyConflictError(
      'Ce client_request_id a déjà été utilisé avec un contenu différent.'
    );
  }
  if (row.status === PROCESSED_REQUEST_PROCESSING) {
    throw new IdempotencyInProgressError(
      'Cette requête est déjà en cours de traitement. Réessayez dans un instant.'
    );
  }
  let body: any = null;
  if (row.response_json) {
    try {
      body = JSON.parse(row.response_json);
    } catch {
      throw new Error(`Corrupt idempotency response for request ${input.requestId}`);
    }
  }
  return {
    statusCode: Number(row.status_code) || 200,
    body,
    resourceId: row.resource_id ?? null
  };
}

/**
 * Marks the claimed request as completed. Called inside the same database
 * transaction as the business writes, so a crash can never leave a completed
 * business operation without a completed idempotency row.
 */
export function completeRequest(
  db: any,
  requestId: string,
  input: { statusCode: number; resourceId?: string | null; body: unknown }
): void {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE processed_requests
    SET status = 'COMPLETED',
        status_code = ?,
        resource_id = ?,
        response_json = ?,
        completed_at = ?
    WHERE request_id = ? AND status = 'PROCESSING'
  `).run(
    input.statusCode,
    input.resourceId ?? null,
    JSON.stringify(input.body ?? null),
    now,
    requestId
  );
  if (result.changes !== 1) {
    throw new Error(`Could not complete idempotency request ${requestId}`);
  }
}

/**
 * Deletes a still-processing claim when the route returns a validation error
 * or throws. COMPLETED rows are never deleted.
 */
export function releaseRequest(db: any, requestId: string): void {
  try {
    db.prepare("DELETE FROM processed_requests WHERE request_id = ? AND status = 'PROCESSING'").run(requestId);
  } catch {
    // Never mask the original error.
  }
}

/** Read-only lookup used by offline sync to detect an already-committed online write. */
export function findCompletedRequest(
  db: any,
  requestId: string,
  actionType: string
): CompletedRequest | null {
  const row: any = db.prepare(`
    SELECT * FROM processed_requests
    WHERE request_id = ? AND action_type = ? AND status = 'COMPLETED'
  `).get(requestId, actionType);
  if (!row) return null;
  let body: any = null;
  try {
    body = row.response_json ? JSON.parse(row.response_json) : null;
  } catch {
    body = null;
  }
  return {
    statusCode: Number(row.status_code) || 200,
    body,
    resourceId: row.resource_id ?? null
  };
}

/**
 * A PROCESSING row can only survive a failed request or a crash. It is safe to
 * remove old ones because business writes and the COMPLETED update share one
 * SQLite transaction.
 */
export function cleanupStaleProcessing(db: any, maxAgeMs: number = 10 * 60 * 1000): void {
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    db.prepare("DELETE FROM processed_requests WHERE status = 'PROCESSING' AND created_at < ?").run(cutoff);
  } catch {
    // Schema may not exist during very early boot.
  }
}
