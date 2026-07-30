/** Absolute portal session lifetime from sign-in (not idle). */
export const SESSION_MAX_AGE_SEC = 3 * 24 * 60 * 60;

export const SESSION_STARTED_AT_COOKIE = 'wrl_session_started_at';

/** API / client code for forced re-login after absolute TTL. */
export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

/** Login redirect query + audit endedReason. */
export const SESSION_EXPIRED_REASON = 'session_expired';

export function parseSessionStartedAt(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** True when started_at is missing/invalid or age >= SESSION_MAX_AGE_SEC. */
export function isSessionExpired(
  startedAtSec: number | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (startedAtSec == null || !Number.isFinite(startedAtSec) || startedAtSec <= 0) {
    return true;
  }
  return nowSec - startedAtSec >= SESSION_MAX_AGE_SEC;
}

export function sessionExpiresAtSec(startedAtSec: number): number {
  return startedAtSec + SESSION_MAX_AGE_SEC;
}

export function sessionExpiresAtIso(startedAtSec: number): string {
  return new Date(sessionExpiresAtSec(startedAtSec) * 1000).toISOString();
}

export function sessionStartedAtCookieOptions(maxAgeSec: number = SESSION_MAX_AGE_SEC) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSec,
  };
}

export function sessionExpiredJsonBody(message = 'Session expired — sign in again.') {
  return { error: message, code: SESSION_EXPIRED_CODE };
}
