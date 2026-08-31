import { withAppClient } from '@/lib/read-model/db';
import { CANCELLED_CALL_REGISTER_ENTITY } from '@/lib/read-model/cancelled-call-register/constants';
import { shouldRestrictToAssignedOffices } from '@/sql/trhcalls/office-security';
import type {
  CancelledCallRow,
  CancelledCallsFilters,
  CancelledCallsHealth,
  CancelledCallsRowsResponse,
  CancelledCallsSummary,
} from '@/modules/cancelled-calls/types';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCsvList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'All');
}

function defaultMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${day}`,
  };
}

/** Yesterday's calendar date in Asia/Kolkata (YYYY-MM-DD). */
export function istYesterdayYmd(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = today.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utcNoon.setUTCDate(utcNoon.getUTCDate() - 1);
  return utcNoon.toISOString().slice(0, 10);
}

export function parseCancelledCallsFilters(
  searchParams: URLSearchParams
): Omit<CancelledCallsFilters, 'isHod' | 'assignedOffices'> {
  const defaults = defaultMonthRange();
  const startDate = searchParams.get('startDate')?.trim() || defaults.startDate;
  const endDate = searchParams.get('endDate')?.trim() || defaults.endDate;
  if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) {
    throw new Error('startDate and endDate must be YYYY-MM-DD');
  }
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(searchParams.get('pageSize') ?? 50) || 50)
  );
  return {
    startDate,
    endDate,
    branches: parseCsvList(searchParams.get('branches')),
    callTypes: parseCsvList(searchParams.get('callTypes')),
    page,
    pageSize,
  };
}

type FilterSql = { where: string; params: unknown[] };

function buildFilterSql(filters: CancelledCallsFilters, alias = 'c'): FilterSql {
  const params: unknown[] = [filters.startDate, filters.endDate];
  const parts = [
    `(${alias}.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date`,
    `(${alias}.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date`,
  ];
  if (filters.branches.length > 0) {
    params.push(filters.branches.map((b) => b.toUpperCase()));
    parts.push(`upper(btrim(${alias}.branch_name)) = ANY($${params.length}::text[])`);
  }
  if (filters.callTypes.length > 0) {
    params.push(filters.callTypes.map((t) => t.toUpperCase()));
    parts.push(`upper(btrim(${alias}.call_type)) = ANY($${params.length}::text[])`);
  }
  if (shouldRestrictToAssignedOffices(filters.isHod, filters.assignedOffices)) {
    params.push(filters.assignedOffices.map(Number));
    parts.push(`${alias}.nofficeid = ANY($${params.length}::bigint[])`);
  }
  return { where: parts.join(' AND '), params };
}

function mapRow(row: {
  vtrnno: string;
  ncode: number | string;
  ncancelreason: number | string;
  cancel_reason: string | null;
  cancelled_at: Date | string;
  logged_at: Date | string;
  call_type: string | null;
  branch_name: string | null;
  party_name: string | null;
  item_name: string | null;
  serial: string | null;
  engineer_name: string | null;
  complaint: string | null;
  region: string | null;
  account: string | null;
}): CancelledCallRow {
  const reasonText = String(row.cancel_reason ?? '').trim();
  const ncr = Number(row.ncancelreason) || 0;
  return {
    vtrnno: String(row.vtrnno ?? ''),
    ncode: Number(row.ncode) || 0,
    ncancelreason: ncr,
    cancelReason: reasonText || (ncr ? String(ncr) : ''),
    cancelledAt: new Date(row.cancelled_at).toISOString(),
    loggedAt: new Date(row.logged_at).toISOString(),
    callType: row.call_type,
    branchName: row.branch_name,
    partyName: row.party_name,
    itemName: row.item_name,
    serial: row.serial,
    engineerName: row.engineer_name,
    complaint: row.complaint,
    region: row.region,
    account: row.account,
  };
}

const SELECT_COLS = `
  c.vtrnno,
  c.ncode,
  c.ncancelreason,
  COALESCE(NULLIF(btrim(h.cancel_reason), ''), NULL) AS cancel_reason,
  c.cancelled_at,
  c.logged_at,
  c.call_type,
  c.branch_name,
  c.party_name,
  c.item_name,
  c.serial,
  c.engineer_name,
  c.complaint,
  c.region,
  c.account
`;

const FROM_JOIN = `
  FROM public.calls_cancelled c
  LEFT JOIN public.calls_latest_hot h ON h.vtrnno = c.vtrnno
`;

export async function fetchCancelledCallsHealth(): Promise<CancelledCallsHealth> {
  const [counts, registerSync] = await Promise.all([
    withAppClient(async (client) => {
      const res = await client.query<{
        total_rows: number | string;
        max_cancelled_at: Date | null;
        max_synced_at: Date | null;
      }>(`
        SELECT
          count(*)::int AS total_rows,
          max(cancelled_at) AS max_cancelled_at,
          max(synced_at) AS max_synced_at
        FROM public.calls_cancelled
      `);
      return res.rows[0];
    }),
    withAppClient(async (client) => {
      const res = await client.query<{ last_run_at: Date | null; status: string | null }>(
        `SELECT last_run_at, status FROM sync_state WHERE entity = $1 LIMIT 1`,
        [CANCELLED_CALL_REGISTER_ENTITY]
      );
      return res.rows[0];
    }),
  ]);

  const registerLastSyncedAt = registerSync?.last_run_at
    ? new Date(registerSync.last_run_at).toISOString()
    : null;
  const registerLagMinutes =
    registerSync?.last_run_at != null
      ? Math.max(0, Math.round((Date.now() - new Date(registerSync.last_run_at).getTime()) / 60000))
      : null;

  return {
    totalRows: Number(counts?.total_rows ?? 0),
    maxCancelledAt: counts?.max_cancelled_at
      ? new Date(counts.max_cancelled_at).toISOString()
      : null,
    maxSyncedAt: counts?.max_synced_at
      ? new Date(counts.max_synced_at).toISOString()
      : null,
    registerLastSyncedAt,
    registerStatus: registerSync?.status ?? null,
    registerLagMinutes,
  };
}

export async function fetchCancelledCallsSummary(
  filters: CancelledCallsFilters
): Promise<CancelledCallsSummary> {
  const { where, params } = buildFilterSql(filters);
  const [agg, health] = await Promise.all([
    withAppClient(async (client) => {
      const [totalRes, branchRes, typeRes] = await Promise.all([
        client.query<{ total: number | string }>(
          `SELECT count(*)::int AS total FROM public.calls_cancelled c WHERE ${where}`,
          params
        ),
        client.query<{ label: string; count: number | string }>(
          `SELECT coalesce(nullif(btrim(branch_name), ''), '(unknown)') AS label,
                  count(*)::int AS count
           FROM public.calls_cancelled c
           WHERE ${where}
           GROUP BY 1
           ORDER BY count DESC, label
           LIMIT 50`,
          params
        ),
        client.query<{ label: string; count: number | string }>(
          `SELECT coalesce(nullif(btrim(call_type), ''), '(unknown)') AS label,
                  count(*)::int AS count
           FROM public.calls_cancelled c
           WHERE ${where}
           GROUP BY 1
           ORDER BY count DESC, label
           LIMIT 50`,
          params
        ),
      ]);
      return {
        total: Number(totalRes.rows[0]?.total ?? 0),
        byBranch: branchRes.rows.map((r) => ({
          label: r.label,
          count: Number(r.count) || 0,
        })),
        byCallType: typeRes.rows.map((r) => ({
          label: r.label,
          count: Number(r.count) || 0,
        })),
      };
    }),
    fetchCancelledCallsHealth(),
  ]);

  return {
    total: agg.total,
    byBranch: agg.byBranch,
    byCallType: agg.byCallType,
    health,
  };
}

export async function fetchCancelledCallsRows(
  filters: CancelledCallsFilters
): Promise<CancelledCallsRowsResponse> {
  const { where, params } = buildFilterSql(filters);
  const offset = (filters.page - 1) * filters.pageSize;

  return withAppClient(async (client) => {
    const countRes = await client.query<{ total: number | string }>(
      `SELECT count(*)::int AS total FROM public.calls_cancelled c WHERE ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.total ?? 0);
    const pageParams = [...params, filters.pageSize, offset];
    const rowsRes = await client.query(
      `SELECT ${SELECT_COLS}
       ${FROM_JOIN}
       WHERE ${where}
       ORDER BY c.cancelled_at DESC, c.vtrnno DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams
    );
    return {
      rows: rowsRes.rows.map(mapRow),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}

export async function fetchCancelledCallsForCsv(
  filters: CancelledCallsFilters
): Promise<CancelledCallRow[]> {
  const { where, params } = buildFilterSql(filters);
  return withAppClient(async (client) => {
    const rowsRes = await client.query(
      `SELECT ${SELECT_COLS}
       ${FROM_JOIN}
       WHERE ${where}
       ORDER BY c.cancelled_at DESC, c.vtrnno DESC
       LIMIT 50000`,
      params
    );
    return rowsRes.rows.map(mapRow);
  });
}

/** All cancels for one IST calendar day, grouped by branch for digest. */
export async function fetchCancelledCallsForDigestDay(
  digestDateYmd: string
): Promise<Map<string, CancelledCallRow[]>> {
  if (!YMD_RE.test(digestDateYmd)) {
    throw new Error('digestDate must be YYYY-MM-DD');
  }
  const rows = await withAppClient(async (client) => {
    const res = await client.query(
      `SELECT ${SELECT_COLS}
       ${FROM_JOIN}
       WHERE (c.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
       ORDER BY upper(btrim(c.branch_name)), c.cancelled_at DESC, c.vtrnno DESC`,
      [digestDateYmd]
    );
    return res.rows.map(mapRow);
  });

  const byBranch = new Map<string, CancelledCallRow[]>();
  for (const row of rows) {
    const branch = (row.branchName ?? '').trim() || '(unknown)';
    const list = byBranch.get(branch) ?? [];
    list.push(row);
    byBranch.set(branch, list);
  }
  return byBranch;
}

export async function fetchCancelledCallsFilterOptions(scope: {
  isHod: boolean;
  assignedOffices: string[];
}): Promise<{
  branches: string[];
  callTypes: string[];
}> {
  const officeClause = shouldRestrictToAssignedOffices(scope.isHod, scope.assignedOffices)
    ? 'AND nofficeid = ANY($1::bigint[])'
    : '';
  const officeParams = shouldRestrictToAssignedOffices(scope.isHod, scope.assignedOffices)
    ? [scope.assignedOffices.map(Number)]
    : [];

  return withAppClient(async (client) => {
    const [branches, callTypes] = await Promise.all([
      client.query<{ branch_name: string }>(
        `
        SELECT DISTINCT btrim(branch_name) AS branch_name
        FROM public.calls_cancelled
        WHERE coalesce(btrim(branch_name), '') <> ''
        ${officeClause}
        ORDER BY 1
      `,
        officeParams
      ),
      client.query<{ call_type: string }>(
        `
        SELECT DISTINCT btrim(call_type) AS call_type
        FROM public.calls_cancelled
        WHERE coalesce(btrim(call_type), '') <> ''
        ${officeClause}
        ORDER BY 1
      `,
        officeParams
      ),
    ]);
    return {
      branches: branches.rows.map((r) => r.branch_name),
      callTypes: callTypes.rows.map((r) => r.call_type),
    };
  });
}
