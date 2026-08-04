import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { resolveReportSecurity, type ReportSecurity } from '@/lib/auth/report-security';
import { resolveRequestUserId, resolveUserIdFromAccessToken } from '@/lib/auth/server-user';
import { createClient } from '@/lib/supabase/server';
import type { RbacApiSpec } from '@/lib/auth/rbac-catalog';
import { logAccessDenied } from '@/lib/security/audit';

export type BearerAuthResult =
  | { ok: true; userId: string; security: ReportSecurity }
  | { ok: false; response: NextResponse };

export async function resolveBearerRbac(
  authHeader: string | null,
  spec: RbacApiSpec
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

  const security = await resolveReportSecurity(userId, spec);
  if (security.forbidden) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId, security };
}

/** Cookie/Bearer + RBAC; logs auth.access.denied (Bearer-only helper does not). */
export async function requireRbac(
  req: NextRequest,
  spec: RbacApiSpec
): Promise<BearerAuthResult> {
  const supabase = await createClient();
  const userId = await resolveRequestUserId(req, supabase);
  if (!userId) {
    await logAccessDenied({
      request: req,
      statusCode: 401,
      reason: 'report_route_unauthorized',
      metadata: { spec },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const security = await resolveReportSecurity(userId, spec);
  if (security.forbidden) {
    await logAccessDenied({
      request: req,
      actorUserId: userId,
      statusCode: 403,
      reason: 'report_route_forbidden',
      metadata: { spec },
    });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return { ok: true, userId, security };
}

/** @deprecated Use requireRbac */
export async function resolveRequestReportSecurity(
  req: NextRequest,
  opts: RbacApiSpec
): Promise<BearerAuthResult> {
  return requireRbac(req, opts);
}

/** @deprecated Use resolveBearerRbac */
export async function resolveBearerReportSecurity(
  authHeader: string | null,
  spec: RbacApiSpec
): Promise<BearerAuthResult> {
  return resolveBearerRbac(authHeader, spec);
}
