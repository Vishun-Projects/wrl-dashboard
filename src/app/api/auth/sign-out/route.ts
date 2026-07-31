import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clearSessionCookies } from '@/lib/auth/persist-session-cookies';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { clearSessionStartedAtCookie } from '@/lib/auth/session-policy-server';
import {
  clearAuditSessionCookie,
  finishSessionAudit,
  logSecurityEventBestEffort,
  requestAuditContext,
} from '@/lib/security/audit';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError } from '@/lib/api/safe-error';

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const audit = requestAuditContext(request);
  const cookieStore = await cookies();
  const supabaseAuth = await createClient();
  const user = await requireRequestUser(request, supabaseAuth).catch(() => null);
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

  // Always clear httpOnly cookies first — GoTrue signOut can fail (TLS / key mismatch).
  try {
    clearSessionCookies(cookieWriter);
    await clearSessionStartedAtCookie();
    await clearAuditSessionCookie();
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Sign-out failed');
  }

  try {
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
    await supabase.auth.signOut();
  } catch {
    /* cookie clear above is enough for logout */
  }

  await finishSessionAudit({
    sessionId: audit.sessionId,
    userId: user?.id ?? null,
    endedReason: 'sign_out',
    status: 'ended',
  }).catch(() => {});
  await logSecurityEventBestEffort({
    eventType: 'auth.sign_out',
    result: 'success',
    actorUserId: user?.id ?? null,
    actorEmail: user?.email ?? null,
    sessionId: audit.sessionId,
    route: audit.route,
    method: audit.method,
    ip: audit.ip,
    userAgent: audit.userAgent,
    statusCode: 200,
  });

  return NextResponse.json({ ok: true });
}
