import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { resolveReportSecurity, type ReportSecurity } from '@/lib/auth/report-security';
import { resolveRequestUserId, resolveUserIdFromAccessToken } from '@/lib/auth/server-user';
import { createClient } from '@/lib/supabase/server';

export type BearerAuthResult =
  | { ok: true; userId: string; security: ReportSecurity }
  | { ok: false; response: NextResponse };

/** Authenticate report API requests using Authorization: Bearer <supabase jwt>. */
export async function resolveBearerReportSecurity(
  authHeader: string | null,
  opts?: { pagePermission?: string }
): Promise<BearerAuthResult> {
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const token = authHeader.slice(7).trim();
  const userId = await resolveUserIdFromAccessToken(token);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const security = await resolveReportSecurity(userId, {
    pagePermission: opts?.pagePermission,
  });
  if (security.forbidden) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId, security };
}

/** Authenticate report API requests via Bearer header or httpOnly session cookies. */
export async function resolveRequestReportSecurity(
  req: NextRequest,
  opts?: { pagePermission?: string }
): Promise<BearerAuthResult> {
  const supabase = await createClient();
  const userId = await resolveRequestUserId(req, supabase);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const security = await resolveReportSecurity(userId, {
    pagePermission: opts?.pagePermission,
  });
  if (security.forbidden) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId, security };
}
