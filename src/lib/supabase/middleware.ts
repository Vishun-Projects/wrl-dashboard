import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt-core';
import { resolveUserIdFromSupabaseCookies } from '@/lib/auth/supabase-cookie';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import { clearSessionCookies } from '@/lib/auth/persist-session-cookies';
import {
  SESSION_EXPIRED_REASON,
  SESSION_MAX_AGE_SEC,
  SESSION_STARTED_AT_COOKIE,
  sessionExpiredJsonBody,
  sessionStartedAtCookieOptions,
} from '@/lib/auth/session-policy';
import {
  evaluatePortalSession,
} from '@/lib/auth/session-policy-server';
import {
  AUDIT_SESSION_COOKIE,
  finishSessionAudit,
  logSecurityEventBestEffort,
  requestAuditContext,
} from '@/lib/security/audit';

function routeGuards(request: NextRequest, hasUser: boolean): NextResponse | null {
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname.startsWith('/login');
  const isAuthRecoveryPage =
    pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password');
  const isPublicRoute = isLoginPage || isAuthRecoveryPage || pathname === '/';
  const isApiRoute = request.nextUrl.pathname.startsWith('/api');

  if (!hasUser && !isPublicRoute && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Do not redirect /login → /report here: stale cookies + API 401 caused a reload loop.
  // Logged-in users on /login are handled client-side after /api/auth/me succeeds.

  if (hasUser && request.nextUrl.pathname === '/calls') {
    const url = request.nextUrl.clone();
    url.pathname = '/report';
    return NextResponse.redirect(url);
  }

  return null;
}

function buildCookieWriter(request: NextRequest, response: NextResponse) {
  return {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(
      cookiesToSet: {
        name: string;
        value: string;
        options: Record<string, unknown>;
      }[]
    ) {
      cookiesToSet.forEach(({ name, value, options }) => {
        request.cookies.set(name, value);
        response.cookies.set(name, value, options);
      });
    },
  };
}

async function expirePortalSessionResponse(
  request: NextRequest,
  base: NextResponse
): Promise<NextResponse> {
  const cookieWriter = buildCookieWriter(request, base);
  try {
    clearSessionCookies(cookieWriter);
  } catch {
    /* NEXT_PUBLIC_SUPABASE_URL missing in edge edge-cases */
  }
  cookieWriter.setAll([
    {
      name: SESSION_STARTED_AT_COOKIE,
      value: '',
      options: { ...sessionStartedAtCookieOptions(0), maxAge: 0 },
    },
    {
      name: AUDIT_SESSION_COOKIE,
      value: '',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      },
    },
  ]);

  const audit = requestAuditContext(request);
  await finishSessionAudit({
    sessionId: audit.sessionId,
    endedReason: 'session_expired',
    status: 'ended',
  }).catch(() => {});
  await logSecurityEventBestEffort({
    eventType: 'auth.session.expired',
    result: 'denied',
    sessionId: audit.sessionId,
    route: audit.route,
    method: audit.method,
    ip: audit.ip,
    userAgent: audit.userAgent,
    statusCode: 401,
    metadata: {
      summary: 'Session expired',
      actionLabel: 'Session expired',
      reason: 'absolute_ttl',
    },
  });

  return base;
}

function hasSupabaseAuthCookies(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.includes('-auth-token'));
}

/**
 * Absolute 3-day session: if auth cookies exist but started_at missing/expired,
 * clear session and redirect pages / 401 APIs.
 */
async function enforceAbsoluteSessionTtl(request: NextRequest): Promise<NextResponse | null> {
  if (!hasSupabaseAuthCookies(request)) return null;

  const session = evaluatePortalSession(request.cookies.getAll());
  if (session.ok) return null;

  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith('/api');
  const isLoginPage = pathname.startsWith('/login');
  const isAuthRecoveryPage =
    pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password');
  const isPublicRoute = isLoginPage || isAuthRecoveryPage || pathname === '/';

  if (isApiRoute) {
    // Sign-out / sign-in must still work without a valid started_at.
    if (
      pathname.startsWith('/api/auth/sign-out') ||
      pathname.startsWith('/api/auth/sign-in') ||
      pathname.startsWith('/api/auth/forgot-password') ||
      pathname.startsWith('/api/auth/complete-password-reset')
    ) {
      return null;
    }
    const res = NextResponse.json(sessionExpiredJsonBody(), { status: 401 });
    return expirePortalSessionResponse(request, res);
  }

  if (isPublicRoute) {
    // Clear stale cookies on public routes so login starts clean.
    const res = NextResponse.next({ request });
    return expirePortalSessionResponse(request, res);
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('reason', SESSION_EXPIRED_REASON);
  const res = NextResponse.redirect(url);
  return expirePortalSessionResponse(request, res);
}

export async function updateSession(request: NextRequest) {
  const expiredEarly = await enforceAbsoluteSessionTtl(request);
  if (expiredEarly) return expiredEarly;

  if (isDevAuthBypass()) {
    const userId = await resolveUserIdFromSupabaseCookies(request);
    const stillValid =
      Boolean(userId) && evaluatePortalSession(request.cookies.getAll()).ok;
    const guard = routeGuards(request, stillValid);
    if (guard) return guard;
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach((cookie) => request.cookies.set(cookie.name, cookie.value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach((cookie) =>
            supabaseResponse.cookies.set(cookie.name, cookie.value, {
              ...cookie.options,
              // Keep rewritten auth cookies within portal absolute TTL.
              maxAge:
                typeof cookie.options?.maxAge === 'number' && cookie.options.maxAge > 0
                  ? Math.min(cookie.options.maxAge, SESSION_MAX_AGE_SEC)
                  : cookie.options?.maxAge,
            })
          );
        },
      },
    }
  );

  const user = await requireSupabaseUser(supabase);
  const stillValid =
    Boolean(user) && evaluatePortalSession(request.cookies.getAll()).ok;
  const guard = routeGuards(request, stillValid);
  if (guard) return guard;

  return supabaseResponse;
}
