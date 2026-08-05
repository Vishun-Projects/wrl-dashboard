import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  isDbSignInAvailable,
  signInViaDatabase,
} from '@/lib/auth/db-sign-in';
import { persistSessionCookies } from '@/lib/auth/persist-session-cookies';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import {
  logSecurityEventBestEffort,
  requestAuditContext,
  setAuditSessionCookie,
  startSessionAudit,
} from '@/lib/security/audit';
import { setSessionStartedAtCookie } from '@/lib/auth/session-policy-server';
import { checkRateLimit, recordFailedAttempt, resetFailedAttempts } from '@/lib/security/rate-limit';
import { sendSuspiciousActivityAlert } from '@/lib/security/security-alert-email';

type SignInBody = {
  email?: string;
  password?: string;
};

type SessionUser = {
  id: string;
  email?: string;
};

type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: unknown;
};

async function proxyGoTrueSignIn(email: string, password: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase env is not configured');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    /* HTML block page from firewall */
  }

  if (!res.ok) {
    const blocked = text.includes('Blocked site') || res.status === 403;
    const msg =
      (json?.error_description as string) ||
      (json?.msg as string) ||
      (json?.error as string) ||
      (blocked ? 'network_blocked' : `Auth failed (${res.status})`);
    return { ok: false as const, status: res.status, message: msg, blocked };
  }

  return { ok: true as const, session: json };
}

function parseProxySession(session: Record<string, unknown>): SessionPayload | null {
  if (!session.access_token || !session.refresh_token) return null;
  return {
    access_token: String(session.access_token),
    refresh_token: String(session.refresh_token),
    expires_in: session.expires_in as number | undefined,
    expires_at: session.expires_at as number | undefined,
    token_type: session.token_type as string | undefined,
    user: session.user,
  };
}

function shouldPersistSessionWithoutGoTrue(): boolean {
  if (isDevAuthBypass()) return true;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  // Self-hosted GoTrue from Vercel may hit bad TLS; write cookies from token response directly.
  return !url.includes('supabase.co');
}

function sessionUserFromPayload(user: unknown): SessionUser | undefined {
  if (user && typeof user === 'object' && user !== null && 'id' in user) {
    return {
      id: String((user as { id: string }).id),
      email:
        'email' in user ? String((user as { email?: string }).email ?? '') : undefined,
    };
  }
  return undefined;
}

async function persistSession(sessionPayload: SessionPayload) {
  const cookieStore = await cookies();
  const cookieWriter = {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
      cookiesToSet.forEach(({ name, value, options }) => {
        cookieStore.set(name, value, options);
      });
    },
  };

  // setSession() calls GoTrue getUser over HTTPS — fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE
  // when the self-hosted cert is untrusted or the host is blocked on the network.
  if (shouldPersistSessionWithoutGoTrue()) {
    persistSessionCookies(cookieWriter, {
      ...sessionPayload,
      user: sessionUserFromPayload(sessionPayload.user),
    });
    return;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.setSession({
    access_token: sessionPayload.access_token,
    refresh_token: sessionPayload.refresh_token,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function POST(request: Request) {
  try {
    const audit = requestAuditContext(request);
    const ipKey = `sign-in:${audit.ip || 'unknown'}`;
    const rl = checkRateLimit(ipKey, 5, 60_000);
    if (!rl.allowed) {
      await logSecurityEventBestEffort({
        eventType: 'auth.sign_in.failure',
        result: 'failure',
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 429,
        metadata: { reason: 'rate_limited', retryAfterSec: rl.retryAfterSec },
      });
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please try again in a minute.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
      );
    }

    const body = (await request.json()) as SignInBody;
    const email = body.email?.trim();
    const password = body.password ?? '';

    const handleFailure = async (opts: {
      statusCode: number;
      reason: string;
      message?: string;
      userFacingError: string;
    }) => {
      const failedCount = recordFailedAttempt(ipKey, 60_000);
      await logSecurityEventBestEffort({
        eventType: 'auth.sign_in.failure',
        result: 'failure',
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: opts.statusCode,
        metadata: { email, reason: opts.reason, failedCount, message: opts.message },
      });

      if (failedCount >= 5) {
        void sendSuspiciousActivityAlert({
          ip: audit.ip,
          attemptedEmail: email,
          route: audit.route,
          userAgent: audit.userAgent,
          failedCount,
        });
      }

      return NextResponse.json({ error: opts.userFacingError }, { status: opts.statusCode });
    };

    if (!email || !password) {
      return handleFailure({
        statusCode: 400,
        reason: 'missing_credentials',
        userFacingError: 'Email and password are required',
      });
    }

    let sessionPayload: SessionPayload | null = null;
    let proxyBlocked = false;
    const usedDbAuthFallback = isDevAuthBypass() && isDbSignInAvailable();

    // Dev-only: DB auth when GoTrue HTTPS is blocked on localhost.
    if (usedDbAuthFallback) {
      try {
        sessionPayload = await signInViaDatabase(email, password);
        if (!sessionPayload) {
          return handleFailure({
            statusCode: 401,
            reason: 'invalid_credentials',
            userFacingError: 'Invalid email or password',
          });
        }
      } catch (dbErr: unknown) {
        const message = dbErr instanceof Error ? dbErr.message : 'Database sign-in failed';
        return handleFailure({
          statusCode: 500,
          reason: 'db_sign_in_failed',
          message,
          userFacingError: 'Invalid email or password',
        });
      }
    }

    if (!sessionPayload) {
      try {
        const proxy = await proxyGoTrueSignIn(email, password);
        if (proxy.ok && proxy.session) {
          sessionPayload = parseProxySession(proxy.session);
        } else if (proxy.ok === false) {
          proxyBlocked = proxy.blocked;
          if (proxy.message !== 'network_blocked') {
            return handleFailure({
              statusCode: proxy.status === 401 ? 401 : 502,
              reason: 'proxy_sign_in_failed',
              message: proxy.message,
              userFacingError: 'Invalid email or password',
            });
          }
        }
      } catch {
        proxyBlocked = true;
      }
    }

    if (!sessionPayload) {
      return handleFailure({
        statusCode: proxyBlocked ? 503 : 401,
        reason: proxyBlocked ? 'network_blocked' : 'sign_in_failed',
        userFacingError: proxyBlocked
          ? 'Sign-in is temporarily unavailable. Try again later.'
          : 'Invalid email or password',
      });
    }

    resetFailedAttempts(ipKey);
    await persistSession(sessionPayload);
    await setSessionStartedAtCookie();
    const sessionUser = sessionUserFromPayload(sessionPayload.user);
    const sessionId = await startSessionAudit({
      userId: sessionUser?.id ?? null,
      userEmail: sessionUser?.email ?? email,
      authMethod: usedDbAuthFallback ? 'database_fallback' : 'password',
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: { route: audit.route },
    });
    await setAuditSessionCookie(sessionId);
    await logSecurityEventBestEffort({
      eventType: 'auth.sign_in.success',
      result: 'success',
      actorUserId: sessionUser?.id ?? null,
      actorEmail: sessionUser?.email ?? email,
      sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      metadata: { authMethod: usedDbAuthFallback ? 'database_fallback' : 'password' },
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sign-in failed';
    const audit = requestAuditContext(request);
    await logSecurityEventBestEffort({
      eventType: 'auth.sign_in.failure',
      result: 'failure',
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { reason: 'exception', message },
    });
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. Try again later.' }, { status: 500 });
  }
}
