import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canManageMisEmailRouting } from '@/modules/mis-email';
import {
  getAttendanceSettings,
  saveAttendanceSettings,
  type AttendanceSettings,
} from '@/modules/attendance/services/org-settings';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'attendance_settings_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'attendance_settings_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (
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
      reason: 'attendance_settings_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth, user };
}

export async function GET(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const settings = await getAttendanceSettings();
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load attendance settings');
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const body = (await request.json()) as { settings?: Partial<AttendanceSettings> };
    const patch = body.settings ?? {};
    const current = await getAttendanceSettings({ fresh: true });
    const settings = await saveAttendanceSettings(patch, access.user.id);
    await logSecurityEventBestEffort({
      eventType: 'admin.attendance_settings.update',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'attendance_settings',
      targetId: 'global',
      metadata: {
        summary: 'Updated attendance thresholds',
        actionLabel: 'Updated attendance thresholds',
        keys: Object.keys(patch).sort(),
        before: current,
        after: settings,
      },
    });
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    await logSecurityEventBestEffort({
      eventType: 'admin.attendance_settings.update',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message: err instanceof Error ? err.message : 'save failed' },
    });
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to save attendance settings') },
      { status: 400 }
    );
  }
}
