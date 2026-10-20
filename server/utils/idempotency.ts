import type { Request, Response } from 'express';
import {
  claimRequest,
  getClientRequestId,
  hashPayload,
  resolveDuplicate,
  releaseRequest,
  IdempotencyBadRequestError,
  IdempotencyConflictError,
  IdempotencyDuplicateError,
  IdempotencyInProgressError
} from '../services/idempotencyService.js';

export type IdempotencyGate =
  | { kind: 'NONE' }
  | { kind: 'CLAIMED'; requestId: string }
  | { kind: 'REPLAYED' };

export function sendIdempotencyError(res: Response, err: unknown): boolean {
  if (err instanceof IdempotencyBadRequestError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof IdempotencyConflictError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  if (err instanceof IdempotencyInProgressError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return true;
  }
  return false;
}

/**
 * Claim-once gate for financial POSTs.
 *
 * The claim row is inserted before business validation. If the same
 * client_request_id arrives again:
 * - COMPLETED + same payload -> replay the stored response;
 * - same id + different payload/action -> 409;
 * - PROCESSING -> 409.
 *
 * The route must call completeRequest() inside its business transaction and
 * releaseIdempotencyOnResponse() so validation failures release the claim.
 */
export function beginIdempotentRequest(
  db: any,
  req: Request,
  res: Response,
  actionType: string,
  scope?: string
): IdempotencyGate {
  let requestId: string | null = null;
  try {
    requestId = getClientRequestId(req.body);
  } catch (err) {
    if (sendIdempotencyError(res, err)) return { kind: 'REPLAYED' };
    throw err;
  }
  if (!requestId) return { kind: 'NONE' };

  const payloadHash = hashPayload(scope ? { scope, body: req.body } : req.body);
  const input = { requestId, actionType, payloadHash };
  try {
    claimRequest(db, input);
    releaseIdempotencyOnResponse(db, res, requestId);
    return { kind: 'CLAIMED', requestId };
  } catch (err) {
    if (err instanceof IdempotencyDuplicateError) {
      try {
        const replay = resolveDuplicate(db, input);
        res.status(replay.statusCode).json(replay.body);
      } catch (resolveErr) {
        if (!sendIdempotencyError(res, resolveErr)) throw resolveErr;
      }
      return { kind: 'REPLAYED' };
    }
    if (sendIdempotencyError(res, err)) return { kind: 'REPLAYED' };
    throw err;
  }
}

/**
 * Releases a PROCESSING claim when the response finishes without the business
 * transaction having marked it COMPLETED. Deleting a COMPLETED row is a no-op.
 */
export function releaseIdempotencyOnResponse(db: any, res: Response, requestId: string): void {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseRequest(db, requestId);
  };
  res.once('finish', release);
  res.once('close', release);
}
