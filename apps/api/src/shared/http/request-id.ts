// Every request gets an id that appears in its logs and in any error response (standard §11.1).
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// A client may supply its own id for end-to-end tracing, but it is untrusted input:
// accept only a short, safe token so it cannot be used to forge log lines.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function assignRequestId(req: IncomingMessage, res: ServerResponse): string {
  const supplied = req.headers['x-request-id'];
  const id = typeof supplied === 'string' && SAFE_ID.test(supplied) ? supplied : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function requestIdOf(req: { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : 'unknown';
}
