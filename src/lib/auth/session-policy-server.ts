import 'server-only';

import {
  SESSION_MAX_AGE_SEC,
  SESSION_STARTED_AT_COOKIE,
  isSessionExpired,
  parseSessionStartedAt,
  sessionExpiresAtIso,
  sessionStartedAtCookieOptions,
} from '@/lib/auth/session-policy';

export type PortalSessionOk = {
  ok: true;
  startedAtSec: number;
  expiresAtIso: string;
};

export type PortalSessionExpired = {
  ok: false;
  reason: 'missing' | 'expired';
};

export function readSessionStartedAt(
  cookies: Array<{ name: string; value: string }>
): number | null {
  const raw = cookies.find((c) => c.name === SESSION_STARTED_AT_COOKIE)?.value;
  return parseSessionStartedAt(raw);
}

/** Absolute 3-day portal TTL from wrl_session_started_at — independent of JWT exp / idle. */
export function evaluatePortalSession(
  cookies: Array<{ name: string; value: string }>,
  nowSec: number = Math.floor(Date.now() / 1000)
): PortalSessionOk | PortalSessionExpired {
  const startedAtSec = readSessionStartedAt(cookies);
  if (startedAtSec == null) return { ok: false, reason: 'missing' };
  if (isSessionExpired(startedAtSec, nowSec)) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    startedAtSec,
    expiresAtIso: sessionExpiresAtIso(startedAtSec),
  };
}

export async function setSessionStartedAtCookie(
  startedAtSec: number = Math.floor(Date.now() / 1000)
): Promise<void> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_STARTED_AT_COOKIE,
    String(startedAtSec),
    sessionStartedAtCookieOptions(SESSION_MAX_AGE_SEC)
  );
}

export async function clearSessionStartedAtCookie(): Promise<void> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.set(SESSION_STARTED_AT_COOKIE, '', {
    ...sessionStartedAtCookieOptions(0),
    maxAge: 0,
  });
}
