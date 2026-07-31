import { NextResponse } from 'next/server';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

/** Sanitize an error for JSON API clients (never raw stack / DB internals). */
export function safeErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const msg = toUserFacingError(err).trim();
  return msg || fallback;
}

/** Log full error server-side; return a sanitized JSON error body. */
export function jsonSafeError(
  err: unknown,
  status = 500,
  fallback = 'Something went wrong'
): NextResponse {
  console.error(err);
  return NextResponse.json({ error: safeErrorMessage(err, fallback) }, { status });
}
