import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isHodUser, resolveReportSecurity } from '@/lib/auth/report-security';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { createClient } from '@/lib/supabase/server';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import type { RegisterPostgresParams } from '@/sql/read-model/register';
import { resolveRegisterDateSqlColumn } from '@/sql/trhcalls/query';
import { resolveRegisterRepairCallKeys } from '@/modules/mis/register/server/repair-call-ncodes';

export type RegisterPostgresRequestContext = {
  userId: string;
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>;
};

export type RegisterPostgresRequestResult =
  | { ok: true; ctx: RegisterPostgresRequestContext }
  | { ok: false; response: NextResponse };

export function parseRegisterSearchParams(searchParams: URLSearchParams) {
  const dateFilterColumnParam = searchParams.get('dateFilterColumn') || 'dtrndate';
  return {
    search: searchParams.get('search') || '',
    officeId: searchParams.get('officeId') || 'All',
    callType: searchParams.get('callType'),
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    dateFilterColumn: resolveRegisterDateSqlColumn(dateFilterColumnParam),
    status: searchParams.get('status') || '',
    account: searchParams.get('account') || '',
    region: searchParams.get('region') || '',
    pincode: searchParams.get('pincode') || '',
    priority: searchParams.get('priority') || 'all',
    portalFilter: searchParams.get('portalFilter') || 'All',
    repair: searchParams.get('repair') || 'All',
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

  const auth = await loadUserAuth(userId);
  const permissions = auth?.permissions ?? [];
  const profile = auth?.profile;

  const assignedOffices = profile?.office_ids || security.assignedOffices;
  const visibleStatuses = profile?.visible_statuses || [];
  const isHod = isHodUser(profile ?? undefined, permissions);

  const repairCallKeys = await resolveRegisterRepairCallKeys({
    repair: parsed.repair,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    dateFilterColumn: parsed.dateFilterColumn,
    isHod,
    assignedOffices,
    officeId: parsed.officeId,
  });

  // Strip repair (resolved separately into repairCallKeys); spread the rest into query params.
  const { repair: _repair, ...rest } = parsed;
  void _repair;

  return {
    ok: true,
    ctx: {
      userId,
      params: {
        ...rest,
        assignedOffices,
        visibleStatuses,
        isHod,
        repairCallKeys,
      },
    },
  };
}
