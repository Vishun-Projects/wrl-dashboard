import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canManageMisEmailRouting } from '@/features/mis-email/lib/routing-rules';
import {
  getMisEmailOrgSettings,
  saveMisEmailOrgSettings,
  type MisEmailOrgSettings,
} from '@/features/mis-email/lib/org-settings';
import { assertAllowedEmailDomains } from '@/features/mis-email/lib/allowed-domains';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_org_settings_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'mis_email_org_settings_unauthorized',
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
      reason: 'mis_email_org_settings_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth, user };
}

export async function GET(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const settings = await getMisEmailOrgSettings();
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load org settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const body = (await request.json()) as { settings?: Partial<MisEmailOrgSettings> };
    const patch = body.settings ?? {};
    const current = await getMisEmailOrgSettings();
    const mergedDomains = patch.allowedEmailDomains ?? current.allowedEmailDomains;
    const emails = [
      ...(patch.defaultToEmails ?? []),
      ...(patch.defaultCcEmails ?? []),
      ...(patch.majorRepairDefaultTo ? [patch.majorRepairDefaultTo] : []),
      ...(patch.majorRepairDefaultCc ? [patch.majorRepairDefaultCc] : []),
    ];
    if (emails.length > 0) {
      assertAllowedEmailDomains(emails, mergedDomains);
    }

    const settings = await saveMisEmailOrgSettings(patch, access.user.id);
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(patch) as (keyof MisEmailOrgSettings)[]) {
      if (!(key in current)) continue;
      changes[key] = {
        old: current[key],
        new: settings[key],
      };
    }
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_org_settings.update',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'mis_email_org_settings',
      targetId: 'global',
      metadata: {
        summary: 'Updated MIS email org settings',
        actionLabel: 'Updated MIS email org settings',
        keys: Object.keys(patch).sort(),
        changes,
      },
    });
    // Config save never sends mail.
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save org settings';
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_org_settings.update',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
