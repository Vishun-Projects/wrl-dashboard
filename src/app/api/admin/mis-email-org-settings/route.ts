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

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const auth = await loadUserAuth(user.id);
  if (!auth) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  if (
    !canManageMisEmailRouting({
      role: auth.profile.role,
      office_ids: auth.profile.office_ids ?? [],
      permissions: auth.permissions,
    })
  ) {
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
    // Config save never sends mail.
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to save org settings';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
