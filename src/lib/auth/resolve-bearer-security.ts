import 'server-only';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resolveReportSecurity, type ReportSecurity } from '@/lib/auth/report-security';

export type BearerAuthResult =
  | { ok: true; userId: string; security: ReportSecurity }
  | { ok: false; response: NextResponse };

/** Authenticate report API requests using Authorization: Bearer <supabase jwt>. */
export async function resolveBearerReportSecurity(
  authHeader: string | null
): Promise<BearerAuthResult> {
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const token = authHeader.slice(7).trim();
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const security = await resolveReportSecurity(user.id);
  if (security.forbidden) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId: user.id, security };
}
