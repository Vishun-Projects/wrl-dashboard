import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { fetchAppUserAuthProfile } from '@/lib/auth/app-user-profile';
import { isHodUser, resolveReportSecurity } from '@/lib/auth/report-security';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { createClient } from '@/lib/supabase/server';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import { resolveHotWindowCoverage } from '@/lib/read-model/hot-window';
import type { RegisterPostgresParams } from '@/lib/read-model/queries/register';

export type RegisterPostgresRequestContext = {
  userId: string;
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>;
};

export type RegisterPostgresRequestResult =
  | { ok: true; ctx: RegisterPostgresRequestContext }
  | { ok: false; response: NextResponse };

export function parseRegisterSearchParams(searchParams: URLSearchParams) {
  return {
    search: searchParams.get('search') || '',
    officeId: searchParams.get('officeId') || 'All',
    callType: searchParams.get('callType'),
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    status: searchParams.get('status') || '',
    account: searchParams.get('account') || '',
    region: searchParams.get('region') || '',
    pincode: searchParams.get('pincode') || '',
    priority: searchParams.get('priority') || 'all',
    portalFilter: searchParams.get('portalFilter') || 'All',
    state: searchParams.get('state') || '',
    city: searchParams.get('city') || '',
    branch: searchParams.get('branch') || '',
    franchisee: searchParams.get('franchisee') || '',
    technician: searchParams.get('technician') || '',
  };
}

/** Authenticate and parse Postgres register query params (totals, filter-options, etc.). */
export async function resolveRegisterPostgresRequest(
  req: NextRequest
): Promise<RegisterPostgresRequestResult> {
  if (!readRegisterFromPostgres()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Postgres read model required' }, { status: 400 }),
    };
  }

  const supabase = await createClient();
  const userId = await resolveRequestUserId(req, supabase);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const security = await resolveReportSecurity(userId, {
    pageId: 'mis_reports',
    tabId: 'register',
  });
  if (security.forbidden) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const { searchParams } = new URL(req.url);
  const parsed = parseRegisterSearchParams(searchParams);
  const coverage = resolveHotWindowCoverage(parsed.startDate, parsed.endDate);
  if (coverage.mode !== 'postgres') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Date range is outside the Postgres hot window' },
        { status: 400 }
      ),
    };
  }

  const permissions = await (prisma as { getUserPermissions: (id: string) => Promise<string[]> }).getUserPermissions(
    userId
  );
  const profile = await fetchAppUserAuthProfile(userId);

  const assignedOffices = profile?.office_ids || security.assignedOffices;
  const visibleStatuses = profile?.visible_statuses || [];
  const isHod = isHodUser(profile ?? undefined, permissions);

  return {
    ok: true,
    ctx: {
      userId,
      params: {
        ...parsed,
        assignedOffices,
        visibleStatuses,
        isHod,
      },
    },
  };
}
