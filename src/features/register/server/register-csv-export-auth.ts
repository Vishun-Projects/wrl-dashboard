/**
 * Auth + filter wiring for register CSV export on the VPS host (no `server-only`).
 * Repair-done filter stays on same-origin `/api/report` (CRM lookup).
 */
import {
  hasCapability,
  LEGACY_HOD_ROLE_NAMES,
  resolveApiAccess,
} from '@/lib/auth/rbac-catalog';
import { queryUserAuth } from '@/lib/auth/user-auth-query';
import { parseRepairQueryParam } from '@/lib/repair/options';
import { resolveRegisterDateSqlColumn } from '@/lib/trhcalls/query';
import { readRegisterFromPostgres } from '@/lib/read-model/flags';
import { buildPostgresRegisterCsvStream } from '@/features/register/server/postgres-csv-export';
import { REGISTER_EXPORT_COLUMNS } from '@/features/register/services/table-columns';
import { escapeCsvCell } from '@/lib/utils/csv';
import { logAction } from '@/lib/security/audit';

function isHodUser(
  profile: { role?: string } | undefined,
  permissions: string[]
): boolean {
  return (
    hasCapability(permissions, 'view_all_offices') ||
    (LEGACY_HOD_ROLE_NAMES as readonly string[]).includes(profile?.role || '')
  );
}

/** Empty CSV with the usual register headers (0 data rows). */
function emptyRegisterCsvResponse(): Response {
  const header = `${REGISTER_EXPORT_COLUMNS.map((c) => escapeCsvCell(c.header)).join(',')}\r\n`;
  const filename = `WRL_MIS_Register_${new Date().toISOString().split('T')[0]}.csv`;
  return new Response(`\uFEFF${header}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Register-Export-Total': '0',
    },
  });
}

/**
 * Build a streaming CSV Response for the Call Register (same filters as /api/report?export=csv).
 */
export async function buildRegisterCsvExportResponse(opts: {
  userId: string;
  searchParams: URLSearchParams;
  acceptEncoding?: string | null;
  /** When set, start/complete/failure are written to the activity log. */
  request?: Request;
}): Promise<Response> {
  if (!readRegisterFromPostgres()) {
    return Response.json(
      { error: 'Register CSV export requires the Postgres read model' },
      { status: 503 }
    );
  }

  const repair = opts.searchParams.get('repair') || 'All';
  if (parseRepairQueryParam(repair).length > 0) {
    return Response.json(
      { error: 'Repair filter exports use the app host — clear Repair Done or retry from the dashboard' },
      { status: 400 }
    );
  }

  const auth = await queryUserAuth(opts.userId);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = auth.permissions ?? [];
  if (!resolveApiAccess(permissions, { pageId: 'mis_reports', tabId: 'register' })) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const profile = auth.profile;
  const assignedOffices = profile?.office_ids || [];
  const visibleStatuses = profile?.visible_statuses || [];
  const isHod = isHodUser(profile ?? undefined, permissions);

  const search = opts.searchParams.get('search') || '';
  const officeId = opts.searchParams.get('officeId') || 'All';
  const callType = opts.searchParams.get('callType');
  const startDate = opts.searchParams.get('startDate') || '';
  const endDate = opts.searchParams.get('endDate') || '';
  const dateFilterColumnParam = opts.searchParams.get('dateFilterColumn') || 'dtrndate';
  const account = opts.searchParams.get('account') || '';
  const region = opts.searchParams.get('region') || '';
  const status = opts.searchParams.get('status') || '';
  const pincode = opts.searchParams.get('pincode') || '';
  const priority = opts.searchParams.get('priority') || 'all';
  const portalFilter = opts.searchParams.get('portalFilter') || 'All';
  const state = opts.searchParams.get('state') || '';
  const city = opts.searchParams.get('city') || '';
  const branch = opts.searchParams.get('branch') || '';
  const franchisee = opts.searchParams.get('franchisee') || '';
  const technician = opts.searchParams.get('technician') || '';

  if (!startDate || !endDate) {
    return emptyRegisterCsvResponse();
  }

  const registerDateCol = resolveRegisterDateSqlColumn(dateFilterColumnParam);

  const exportActor = {
    userId: opts.userId,
    email: profile?.email ?? null,
    name: profile?.name ?? null,
  };
  const exportMeta = {
    startDate,
    endDate,
    dateFilterColumn: registerDateCol,
    status,
    callType,
    officeId,
  };

  if (opts.request) {
    await logAction({
      request: opts.request,
      action: 'report.export.start',
      actor: exportActor,
      result: 'started',
      statusCode: 202,
      target: { type: 'register_csv_export' },
      summary: 'Started Call Register CSV export',
      metadata: exportMeta,
    });
  }

  return buildPostgresRegisterCsvStream({
    search,
    officeId,
    callType: callType ?? null,
    startDate,
    endDate,
    dateFilterColumn: registerDateCol,
    status,
    account,
    region,
    pincode,
    priority,
    portalFilter,
    state,
    city,
    branch,
    franchisee,
    technician,
    assignedOffices,
    visibleStatuses,
    isHod,
    acceptEncoding: opts.acceptEncoding,
    audit: opts.request
      ? { request: opts.request, actor: exportActor, metadata: exportMeta }
      : undefined,
  });
}
