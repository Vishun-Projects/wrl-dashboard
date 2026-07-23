import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadDigestRecipientById } from '@/features/mis-email/lib/recipients';
import {
  mergeMisEmailPreferences,
  validateMisEmailPreferencesPatch,
  type MisEmailPreferences,
} from '@/features/mis-email/lib/preferences';
import { resolveAvailableBodySections } from '@/features/mis-email/lib/body-sections';
import { resolveUserDigestScopeWithLabel } from '@/features/mis-email/lib/user-scope';

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

    const preferences = mergeMisEmailPreferences(row.mis_email_preferences);
    const allowed = {
      includeSummary: recipient?.includeSummary ?? false,
      includeDetailed: recipient?.includeDetailed ?? false,
      includeKeyAccount: recipient?.includeKeyAccount ?? false,
    };

    let scopeLabel: string | null = null;
    if (recipient) {
      const scope = await resolveUserDigestScopeWithLabel(recipient);
      scopeLabel = scope.scopeLabel;
    }

    return NextResponse.json({
      mis_email_enabled: Boolean(row.mis_email_enabled),
      preferences,
      allowed,
      availableBodySections: resolveAvailableBodySections({
        includeSummary: allowed.includeSummary,
        includeKeyAccount: allowed.includeKeyAccount,
      }),
      availableKeyAccounts: [],
      roleName: row.role_name,
      scopeLabel,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load email preferences';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as MisEmailPreferences;
    const [row, recipient] = await Promise.all([
      loadMisEmailRow(user.id),
      loadDigestRecipientById(user.id),
    ]);

    if (!row) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const current = mergeMisEmailPreferences(row.mis_email_preferences);
    const permissions = {
      includeSummary: recipient?.includeSummary ?? false,
      includeDetailed: recipient?.includeDetailed ?? false,
      includeKeyAccount: recipient?.includeKeyAccount ?? false,
    };

    const validated = validateMisEmailPreferencesPatch({
      patch: body,
      permissions,
      current,
      misEmailEnabled: Boolean(row.mis_email_enabled),
    });

    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    await prisma.$queryRawUnsafe(
      `UPDATE public.app_users SET mis_email_preferences = $1::jsonb WHERE id = $2`,
      JSON.stringify(validated.merged),
      user.id
    );

    return NextResponse.json({
      success: true,
      preferences: validated.merged,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update email preferences';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
