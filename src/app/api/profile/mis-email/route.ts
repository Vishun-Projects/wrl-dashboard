import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { hasMisEmailSendAccess } from '@/lib/auth/rbac-catalog';
import { loadDigestRecipientById } from '@/features/mis-email/services/recipients';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/features/mis-email/services/preferences';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { resolveAvailableBodySections } from '@/features/mis-email/services/body-sections';
import { resolveUserDigestScopeWithLabel } from '@/features/mis-email/services/user-scope';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import { queryUserAuth } from '@/lib/auth/user-auth-query';

type MisEmailRow = {
  mis_email_enabled: boolean;
  mis_email_preferences: unknown;
  role_name: string | null;
};

async function loadMisEmailRow(userId: string): Promise<MisEmailRow | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT u.mis_email_enabled, u.mis_email_preferences,
            COALESCE(
              (
                SELECT string_agg(r.name, ', ' ORDER BY r.name)
                FROM public.app_user_roles aur
                JOIN public.app_roles r ON r.id = aur.role_id
                WHERE aur.user_id = u.id
              ),
              (SELECT name FROM public.app_roles WHERE id = u.role_id)
            ) AS role_name
     FROM public.app_users u
     WHERE u.id = $1
     LIMIT 1`,
    userId
  )) as MisEmailRow[];
  return rows[0] ?? null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [row, recipient] = await Promise.all([
      loadMisEmailRow(user.id),
      loadDigestRecipientById(user.id),
    ]);

    if (!row) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const permissions = recipient?.permissions ?? [];
    const canAccessEmailUi = hasMisEmailSendAccess(permissions);
    const preferences = mergeMisEmailPreferences(row.mis_email_preferences);
    const allowed = {
      includeSummary: recipient?.includeSummary ?? false,
      includeDetailed: recipient?.includeDetailed ?? false,
      includeKeyAccount: recipient?.includeKeyAccount ?? false,
    };
    const hasReportAccess =
      allowed.includeSummary || allowed.includeDetailed || allowed.includeKeyAccount;

    let scopeLabel: string | null = null;
    if (recipient && hasReportAccess) {
      const scope = await resolveUserDigestScopeWithLabel(recipient);
      scopeLabel = scope.scopeLabel;
    }

    const { getMisEmailOrgSettings } = await import('@/features/mis-email/services/org-settings');
    const { toMisEmailLetterCopy } = await import(
      '@/features/mis-email/services/org-settings-defaults'
    );
    const letterCopy = toMisEmailLetterCopy(await getMisEmailOrgSettings());

    return NextResponse.json({
      mis_email_enabled: Boolean(row.mis_email_enabled),
      can_access_email_ui: canAccessEmailUi,
      has_report_access: hasReportAccess,
      preferences,
      allowed,
      availableBodySections: resolveAvailableBodySections({
        includeSummary: allowed.includeSummary,
        includeKeyAccount: allowed.includeKeyAccount,
      }),
      availableKeyAccounts: [],
      roleName: row.role_name,
      scopeLabel,
      letterCopy,
    });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load email preferences');
  }
}

export async function PATCH(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'profile_mis_email_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const auth = await queryUserAuth(user.id);
  const actor = {
    userId: user.id,
    email: auth?.profile?.email ?? user.email ?? null,
    name: auth?.profile?.name ?? null,
  };

  try {
    const body = (await request.json()) as MisEmailPreferences;
    const [row, recipient] = await Promise.all([
      loadMisEmailRow(user.id),
      loadDigestRecipientById(user.id),
    ]);

    if (!row) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (!recipient || !hasMisEmailSendAccess(recipient.permissions)) {
      return NextResponse.json(
        { error: 'Your role is missing the “MIS email reports” capability.' },
        { status: 403 }
      );
    }

    const current = mergeMisEmailPreferences(row.mis_email_preferences);
    const permissions = {
      includeSummary: recipient.includeSummary,
      includeDetailed: recipient.includeDetailed,
      includeKeyAccount: recipient.includeKeyAccount,
    };

    const { getMisEmailOrgSettings } = await import('@/features/mis-email/services/org-settings');
    const org = await getMisEmailOrgSettings();
    const validated = validateMisEmailPreferencesPatch({
      patch: body,
      permissions,
      current,
      misEmailEnabled: true,
      allowedEmailDomains: org.allowedEmailDomains,
    });

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    await prisma.$queryRawUnsafe(
      `UPDATE public.app_users
       SET mis_email_preferences = $1::jsonb,
           mis_email_enabled = CASE
             WHEN $3::boolean THEN true
             ELSE mis_email_enabled
           END
       WHERE id = $2`,
      JSON.stringify(validated.merged),
      user.id,
      // Saving an active schedule opts the account into the digest cron (admin list + runner).
      validated.merged.subscribed !== false
    );

    await logAction({
      request,
      action: 'profile.mis_email.update',
      actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'app_user', id: user.id, label: actor.email },
      summary: 'Updated MIS email preferences',
      metadata: {
        dateRange: validated.merged.dateRange ?? null,
        sendTimeIst: validated.merged.sendTimeIst ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      preferences: validated.merged,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update email preferences';
    await logAction({
      request,
      action: 'profile.mis_email.update',
      actor,
      result: 'failure',
      statusCode: 500,
      summary: 'Failed to update MIS email preferences',
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to update email preferences') }, { status: 500 });
  }
}
