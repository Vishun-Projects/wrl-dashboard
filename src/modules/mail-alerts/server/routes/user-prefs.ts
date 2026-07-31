import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canManageMisEmailRouting } from '@/modules/mail-alerts/services/routing-rules';
import { getMisEmailOrgSettings } from '@/modules/mail-alerts/services/org-settings';
import {
  adminUpdateMisEmailUserPrefs,
  listMisEmailUserSchedules,
  type AdminMisEmailUserPrefsPatch,
} from '@/modules/mail-alerts/services/list-user-schedules';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_user_prefs_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (
    !auth ||
    !canManageMisEmailRouting({
      role: auth.profile.role,
      office_ids: auth.profile.office_ids ?? [],
      permissions: auth.permissions,
    })
  ) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'mis_email_user_prefs_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, auth };
}

export async function GET(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const users = await listMisEmailUserSchedules();
    return NextResponse.json({ users });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load personal digests');
  }
}

export async function PATCH(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const body = (await request.json()) as {
      userId?: string;
      patch?: AdminMisEmailUserPrefsPatch;
    };
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    const patch = body.patch ?? {};
    const org = await getMisEmailOrgSettings();
    const user = await adminUpdateMisEmailUserPrefs(userId, patch, org.allowedEmailDomains);

    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_user_prefs.update',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'app_user',
      targetId: userId,
      metadata: {
        summary: 'Emergency update of personal MIS digest prefs',
        keys: Object.keys(patch).sort(),
        email: user.email,
      },
    });

    return NextResponse.json({ user });
  } catch (err: unknown) {
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_user_prefs.update',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message: err instanceof Error ? err.message : 'failed' },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update personal digest') },
      { status: 400 }
    );
  }
}
