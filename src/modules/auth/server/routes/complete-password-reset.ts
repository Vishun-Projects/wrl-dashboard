import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clearSessionCookies } from '@/lib/auth/persist-session-cookies';
import { requireRequestUser } from '@/lib/auth/server-user';
import { clearSessionStartedAtCookie } from '@/lib/auth/session-policy-server';
import {
  clearAuditSessionCookie,
  finishSessionAudit,
  logSecurityEventBestEffort,
  requestAuditContext,
} from '@/lib/security/audit';

const VAGUE_FAIL = 'Could not update password. Request a new reset link and try again.';

export async function POST(request: Request) {
  const audit = requestAuditContext(request);
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'failure',
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 401,
      metadata: { reason: 'unauthorized' },
    });
    return NextResponse.json({ error: VAGUE_FAIL }, { status: 401 });
  }

  const actorEmail = user.email ?? null;
  const actorUserId = user.id;

  try {
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    const password = typeof body?.password === 'string' ? body.password : '';

    if (password.length < 6) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.complete',
        result: 'failure',
        actorUserId,
        actorEmail,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 400,
        metadata: { reason: 'weak_password' },
      });
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.complete',
        result: 'failure',
        actorUserId,
        actorEmail,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 400,
        metadata: { reason: 'update_failed', message: error.message },
      });
      return NextResponse.json({ error: VAGUE_FAIL }, { status: 400 });
    }

    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'success',
      actorUserId,
      actorEmail,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      metadata: { reason: 'recovery_complete' },
    });

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

    try {
      clearSessionCookies(cookieWriter);
      // Force re-login: recovery JWT must not remain a usable session.
      await clearSessionStartedAtCookie();
      await clearAuditSessionCookie();
    } catch {
      /* cookies cleared; recovery session must not linger */
    }

    try {
      const goTrue = createServerClient(
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
      await goTrue.auth.signOut({ scope: 'global' });
    } catch {
      /* cookie clear is enough */
    }

    await finishSessionAudit({
      sessionId: audit.sessionId,
      userId: actorUserId,
      endedReason: 'password_reset',
      status: 'ended',
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Password update failed';
    console.error('[complete-password-reset]', message);
    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'failure',
      actorUserId,
      actorEmail,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { reason: 'exception', message },
    });
    return NextResponse.json({ error: VAGUE_FAIL }, { status: 500 });
  }
}
