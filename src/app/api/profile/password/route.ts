import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { isDevAuthBypass } from '@/lib/auth/verify-jwt';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  const audit = requestAuditContext(request);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'profile_password_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isDevAuthBypass()) {
    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 503,
      metadata: { reason: 'dev_auth_bypass' },
    });
    return NextResponse.json(
      {
        error:
          'Password change requires Supabase Auth over HTTPS. Use Vercel preview, VPN, or change password on production.',
      },
      { status: 503 }
    );
  }

  try {
    const { newPassword } = await request.json();

    if (!newPassword || newPassword.length < 6) {
      await logSecurityEventBestEffort({
        eventType: 'auth.password_reset.complete',
        result: 'failure',
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        sessionId: audit.sessionId,
        route: audit.route,
        method: audit.method,
        ip: audit.ip,
        userAgent: audit.userAgent,
        statusCode: 400,
        metadata: { reason: 'weak_password' },
      });
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;

    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'success',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Password update error:', err);
    await logSecurityEventBestEffort({
      eventType: 'auth.password_reset.complete',
      result: 'failure',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 500,
      metadata: { reason: 'exception', message: err instanceof Error ? err.message : 'Password update failed' },
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Password update failed' },
      { status: 500 }
    );
  }
}
