import { randomUUID } from 'crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Prefer inbound x-request-id so logs correlate across proxy/app hops. */
export function resolveRequestId(headers: Headers): string {
  const existing = headers.get(REQUEST_ID_HEADER)?.trim();
  if (existing) return existing;
  return randomUUID();
}

export function withRequestIdHeader(headers: Headers, requestId: string): Headers {
  const next = new Headers(headers);
  next.set(REQUEST_ID_HEADER, requestId);
  return next;
}
