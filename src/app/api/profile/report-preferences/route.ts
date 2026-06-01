import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { getUserInfo } from '@/lib/auth';
import {
  buildRoleDefaultShared,
  emptyUserReportPreferences,
  mergeUserReportPreferences,
  parseUserReportPreferences,
  sanitizeRegisterPrefs,
  sanitizeSerialAuditPrefs,
  sanitizeStoredShared,
  type RestoreFilterContext,
  type UserReportPreferencesV1,
} from '@/lib/user-report-preferences';

async function loadPreferences(userId: string): Promise<UserReportPreferencesV1> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ report_preferences: unknown }>
  >(
    'SELECT report_preferences FROM public.app_users WHERE id = $1 LIMIT 1',
    userId
  );
  const raw = rows[0]?.report_preferences ?? {};
  return parseUserReportPreferences(raw);
}

async function savePreferences(userId: string, prefs: UserReportPreferencesV1): Promise<void> {
  await prisma.$queryRawUnsafe(
    'UPDATE public.app_users SET report_preferences = $1::jsonb WHERE id = $2',
    JSON.stringify(prefs),
    userId
  );
}

function buildRestoreContext(profile: {
  role?: string;
  office_ids?: string[];
}): RestoreFilterContext {
  const officeIds = (profile.office_ids ?? []).map(String);
  return {
    role: profile.role ?? 'branch_manager',
    officeIds,
    callTypes: [],
    visibleOfficeIds: officeIds,
  };
}

function sanitizeFullPreferences(
  prefs: UserReportPreferencesV1,
  ctx: RestoreFilterContext
): UserReportPreferencesV1 {
  return {
    version: 1,
    lastReportPath: prefs.lastReportPath,
    shared: sanitizeStoredShared(prefs.shared, ctx),
    serialAudit: sanitizeSerialAuditPrefs(prefs.serialAudit),
    register: sanitizeRegisterPrefs(prefs.register),
    updatedAt: prefs.updatedAt,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await getUserInfo();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const prefs = await loadPreferences(user.id);
    const ctx = buildRestoreContext(profile);
    const sanitized = sanitizeFullPreferences(prefs, ctx);

    return NextResponse.json({
      preferences: sanitized,
      role: profile.role,
      office_ids: profile.office_ids ?? [],
      permissions: profile.permissions ?? [],
    });
  } catch (err: unknown) {
    console.error('Report preferences GET error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load preferences';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await getUserInfo();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    const body = (await request.json()) as Partial<UserReportPreferencesV1> & {
      reset?: boolean;
    };

    const ctx = buildRestoreContext(profile);

    if (body.reset === true) {
      const cleared = emptyUserReportPreferences();
      cleared.shared = buildRoleDefaultShared(ctx);
      await savePreferences(user.id, cleared);
      return NextResponse.json({
        preferences: sanitizeFullPreferences(cleared, ctx),
      });
    }

    const existing = await loadPreferences(user.id);
    const merged = mergeUserReportPreferences(existing, body);
    const sanitized = sanitizeFullPreferences(merged, ctx);
    await savePreferences(user.id, sanitized);

    return NextResponse.json({ preferences: sanitized });
  } catch (err: unknown) {
    console.error('Report preferences PATCH error:', err);
    const message = err instanceof Error ? err.message : 'Failed to save preferences';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
