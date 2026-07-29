import { prisma } from '@/lib/db/prisma';
import {
  normalizeExactTrnSearch,
  type RegisterDateFilterColumn,
} from '@/lib/trhcalls/query';
import { mapCachedRowToRegisterRow } from '@/lib/register-sql/map-cached-row';
import { isRealCancelReasonCode } from '@/lib/call-status/cancel';
import { getSyncMeta } from '@/lib/read-model/sync-meta';
import { mergeArcpApproveDatesFromHot } from '@/lib/register-sql/arcp-approve-dates-server';
import { mergeAuditEnrichment } from '@/lib/register-sql/audit-enrichment';
import { enrichRegisterRowsRepairDone } from '@/lib/register-sql/repair-done-enrich';
import { buildPortalFilterSqlForHot } from '@/lib/register-sql/portal-filter-sql';
import {
  DISTRIBUTION_COMPACT_COLUMNS,
  HOT_OFFICE_JOINS_SQL,
  REGISTER_BULK_MAX_ROWS,
  REGISTER_EXPORT_HOT_COLUMNS,
  REGISTER_HOT_COLUMNS,
} from '@/lib/read-model/queries/register-columns';
import { REGISTER_EXCLUDE_PRACTICE_OFFICE_SQL } from '@/lib/read-model/queries/summary-call-filters';
import { HOT_RESOLVED_REGION_SQL } from '@/lib/read-model/queries/hot-region';

export { REGISTER_BULK_MAX_ROWS };

/** Sortable register grid columns (whitelist; keep in sync with UI column keys). */
const REGISTER_SORT_SQL = {
  UniqueCallNo: 'h.vtrnno',
  vcclid: 'h.vcclid',
  calltype: 'h.call_type',
  callsdtrndate: 'h.logged_at',
  PartyName: 'h.party_name',
  officename: 'h.branch_name',
  region: HOT_RESOLVED_REGION_SQL,
  account: 'h.account',
  franchisee_name: 'h.franchisee_name',
  Pincode: 'h.pincode',
  itemname: 'h.item_name',
  callsvserialno: 'h.serial',
  WCO: 'h.wco',
  serviceman: 'h.engineer_name',
  vcomplaint: 'h.complaint',
  Status: 'h.status_label',
  callsolveddate: 'h.solved_at',
  vsolveremarks: 'h.solve_remarks',
  vpersoncalling: 'h.contact_person',
  vinsttel1: 'h.phone',
  vinstaddress: 'h.address',
} as const;

export type RegisterSortBy = keyof typeof REGISTER_SORT_SQL;

const POSTGRES_SOLVED_STAGE_SQL =
  '(COALESCE(h.bfastclose, false) = true OR COALESCE(h.bsolved, false) = true)';

const POSTGRES_REGISTER_STATUS_SQL: Record<string, string> = {
  'Open Unallocated':
    `(COALESCE(h.ncancelreason, 0) = 0) AND ${POSTGRES_SOLVED_STAGE_SQL} = false AND COALESCE(h.nengineer, 0) = 0`,
  Assigned:
    `(COALESCE(h.ncancelreason, 0) = 0) AND ${POSTGRES_SOLVED_STAGE_SQL} = false AND COALESCE(h.nengineer, 0) <> 0`,
  'Tech. Solve Call':
    `(COALESCE(h.ncancelreason, 0) = 0) AND ${POSTGRES_SOLVED_STAGE_SQL} = true AND COALESCE(h.bapproval, false) = false`,
  Closed:
    `(COALESCE(h.ncancelreason, 0) = 0) AND ${POSTGRES_SOLVED_STAGE_SQL} = true AND COALESCE(h.bapproval, false) = true`,
  Cancelled: 'COALESCE(h.ncancelreason, 0) NOT IN (0, 2)',
};

export type RegisterPostgresParams = {
  page: number;
  limit: number;
  search: string;
  officeId: string;
  callType: string | null;
  startDate: string;
  endDate: string;
  status: string;
  account: string;
  region: string;
  pincode: string;
  priority: string;
  portalFilter: string;
  state: string;
  city: string;
  branch: string;
  franchisee: string;
  technician: string;
  fetchTotals: boolean;
  fetchFilterOptions?: boolean;
  assignedOffices: string[];
  visibleStatuses: string[];
  isHod: boolean;
  dateFilterColumn?: RegisterDateFilterColumn;
  /** Composite keyset cursor — both required when paginating past page 1. */
  cursorLoggedAt?: string | Date;
  cursorNcode?: number;
  /** Prefetched CRM (ncode, office) pairs for Repair done filter (Postgres path). */
  repairCallKeys?: Array<{ ncode: number; officeId: number }>;
  sortBy?: RegisterSortBy;
  sortDir?: 'asc' | 'desc';
};

export type RegisterHotDateField = 'logged_at' | 'solved_at' | 'arcp_bm_approved_at';

export function resolveRegisterHotDateField(
  column?: string | null
): RegisterHotDateField {
  if (column === 'dsolvedatetime') return 'solved_at';
  if (column === 'bm_approved_at') return 'arcp_bm_approved_at';
  return 'logged_at';
}

export function registerHotDateSql(column?: string | null): `h.${RegisterHotDateField}` {
  return `h.${resolveRegisterHotDateField(column)}`;
}

export const REGISTER_HOT_ORDER_BY = 'h.logged_at DESC, h.ncode DESC';

export function registerHotOrderBy(column?: string | null): string {
  const field = resolveRegisterHotDateField(column);
  if (field === 'solved_at') return 'h.solved_at DESC NULLS LAST, h.ncode DESC';
  if (field === 'arcp_bm_approved_at') return 'h.arcp_bm_approved_at DESC NULLS LAST, h.ncode DESC';
  return REGISTER_HOT_ORDER_BY;
}

export function parseRegisterSortBy(value?: string | null): RegisterSortBy | undefined {
  return value && Object.hasOwn(REGISTER_SORT_SQL, value)
    ? (value as RegisterSortBy)
    : undefined;
}

export function resolveRegisterHotOrderBy(
  dateFilterColumn?: string | null,
  sortBy?: string | null,
  sortDir?: string | null
): string {
  const column =
    sortBy && Object.hasOwn(REGISTER_SORT_SQL, sortBy)
      ? REGISTER_SORT_SQL[sortBy as RegisterSortBy]
      : undefined;
  if (!column) return registerHotOrderBy(dateFilterColumn);
  const direction = sortDir === 'asc' ? 'ASC' : 'DESC';
  return `${column} ${direction} NULLS LAST, h.ncode DESC`;
}

export function hasRegisterKeysetCursor(params: RegisterPostgresParams): boolean {
  return (
    !params.sortBy &&
    params.cursorNcode != null &&
    params.cursorNcode > 0 &&
    params.cursorLoggedAt != null &&
    String(params.cursorLoggedAt).trim() !== ''
  );
}

export function registerKeysetCursorFromRow(
  row: Record<string, unknown>,
  dateFilterColumn?: string | null
): { cursorLoggedAt: string; cursorNcode: number } | null {
  const field = resolveRegisterHotDateField(dateFilterColumn);
  const dateVal =
    field === 'solved_at'
      ? row.solved_at ?? row.callsolveddate
      : field === 'arcp_bm_approved_at'
        ? row.bm_approved_at ?? row.bm_approved_date
        : row.logged_at ?? row.callsdtrndate;
  const ncode = Number(row.ncode ?? row.id);
  if (dateVal == null || !Number.isFinite(ncode) || ncode <= 0) return null;
  const cursorLoggedAt =
    dateVal instanceof Date ? dateVal.toISOString() : String(dateVal);
  return { cursorLoggedAt, cursorNcode: ncode };
}

export function buildRegisterListQuery(
  columns: string,
  whereSql: string,
  values: unknown[],
  limit: number,
  offset?: number,
  orderBy = REGISTER_HOT_ORDER_BY
): { text: string; values: unknown[] } {
  if (offset != null && offset > 0) {
    return {
      text: `
    SELECT ${columns}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}`,
      values: [...values, limit, offset],
    };
  }
  return {
    text: `
    SELECT ${columns}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}`,
    values: [...values, limit],
  };
}

export function hotRowToRegisterRow(row: Record<string, unknown>): Record<string, unknown> {
  const cancelledByNcr = isRealCancelReasonCode(row.ncancelreason);
  const statusLabel = cancelledByNcr ? 'Cancelled' : row.status_label;
  return mapCachedRowToRegisterRow({
    ncode: row.ncode,
    id: row.ncode,
    vtrnno: row.vtrnno,
    UniqueCallNo: row.vtrnno,
    vcclid: row.vcclid,
    nofficeid: row.nofficeid,
    officeId: row.nofficeid,
    office_under: row.office_under,
    parentId: row.office_under,
    nengineer: row.nengineer ?? 0,
    Pincode: row.pincode,
    pincode: row.pincode,
    city: row.city,
    state: row.state,
    region: row.region,
    account: row.account,
    PartyName: row.party_name,
    party_name: row.party_name,
    office_name: row.branch_name,
    officename: row.branch_name,
    branch_office_name: row.branch_name,
    franchisee_name: row.franchisee_name,
    franchisee_code: row.franchisee_code,
    serviceman: row.engineer_name,
    technician_name: row.engineer_name,
    calltype: row.call_type,
    call_type: row.call_type,
    itemname: row.item_name,
    callsvserialno: row.serial,
    WCO: row.wco,
    vcomplaint: row.complaint,
    Status: statusLabel,
    callstatus: statusLabel,
    bsolved: row.bsolved,
    bfastclose: row.bfastclose,
    callsolved: row.bsolved,
    callsdtrndate: row.logged_at,
    callsolveddate: row.solved_at,
    bm_approved_at: row.bm_approved_at,
    bapproval: row.bapproval,
    vsolveremarks: row.solve_remarks,
    vpersoncalling: row.contact_person,
    vinsttel1: row.phone,
    vinstaddress: row.address,
    has_visit: row.has_visit ? 1 : 0,
    branch_headcount: row.branch_headcount,
    is_major_repair: row.is_major ? 'True' : 'False',
    ncancelreason: row.ncancelreason,
  });
}

export function buildWhere(params: RegisterPostgresParams): { sql: string; values: unknown[] } {
  const clauses: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;
  const dateSql = registerHotDateSql(params.dateFilterColumn);

  if (!params.isHod && params.assignedOffices.length > 0) {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.assignedOffices.map(Number));
    idx++;
  }

  if (params.officeId && params.officeId !== 'All') {
    const offices = params.officeId.split(',').map(Number);
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(offices);
    idx++;
  }

  if (params.startDate) {
    clauses.push(`${dateSql} >= $${idx}::timestamptz`);
    values.push(`${params.startDate}T00:00:00`);
    idx++;
  }
  if (params.endDate) {
    clauses.push(`${dateSql} <= $${idx}::timestamptz`);
    values.push(`${params.endDate}T23:59:59`);
    idx++;
  }

  if (params.callType && params.callType !== 'All') {
    const types = params.callType.split(',').map((t) => t.trim()).filter(Boolean);
    clauses.push(`upper(trim(h.call_type)) = ANY($${idx}::text[])`);
    values.push(types.map((t) => t.toUpperCase()));
    idx++;
  }

  if (params.account && params.account !== 'All') {
    const accounts = params.account.split(',').map((a) => a.trim()).filter(Boolean);
    if (accounts.length > 0) {
      clauses.push(`h.account = ANY($${idx}::text[])`);
      values.push(accounts);
      idx++;
    }
  }

  if (params.region && params.region !== 'All') {
    const regions = params.region.split(',').map((r) => r.trim().toUpperCase());
    clauses.push(`h.region = ANY($${idx}::text[])`);
    values.push(regions);
    idx++;
  }

  if (params.pincode) {
    clauses.push(`h.pincode ILIKE $${idx}`);
    values.push(`%${params.pincode}%`);
    idx++;
  }

  if (params.state && params.state !== 'All') {
    const states = params.state.split(',').map((s) => s.trim().toUpperCase());
    clauses.push(`h.state = ANY($${idx}::text[])`);
    values.push(states);
    idx++;
  }

  if (params.city && params.city !== 'All') {
    const cities = params.city.split(',').map((s) => s.trim().toUpperCase());
    clauses.push(`h.city = ANY($${idx}::text[])`);
    values.push(cities);
    idx++;
  }

  if (params.branch && params.branch !== 'All') {
    clauses.push(`h.nofficeid = ANY($${idx}::bigint[])`);
    values.push(params.branch.split(',').map(Number));
    idx++;
  }

  if (params.franchisee && params.franchisee !== 'All') {
    clauses.push(`h.franchisee_code = ANY($${idx}::text[])`);
    values.push(params.franchisee.split(',').map((s) => s.trim()));
    idx++;
  }

  if (params.technician && params.technician !== 'All') {
    clauses.push(`h.nengineer = ANY($${idx}::bigint[])`);
    values.push(params.technician.split(',').map(Number));
    idx++;
  }

  if (params.priority === 'major') {
    clauses.push('h.is_major = true');
  } else if (params.priority === 'minor') {
    clauses.push('h.is_major = false');
  }

  if (params.repairCallKeys) {
    if (params.repairCallKeys.length === 0) {
      clauses.push('1=0');
    } else {
      const ncodes = params.repairCallKeys.map((k) => k.ncode);
      const offices = params.repairCallKeys.map((k) => k.officeId);
      clauses.push(
        `EXISTS (
          SELECT 1 FROM unnest($${idx}::bigint[], $${idx + 1}::bigint[]) AS u(n, o)
          WHERE u.n = h.ncode AND u.o = h.nofficeid
        )`
      );
      values.push(ncodes, offices);
      idx += 2;
    }
  }

  if (params.cursorNcode != null && params.cursorNcode > 0 && params.cursorLoggedAt != null) {
    const cursorDate =
      params.cursorLoggedAt instanceof Date
        ? params.cursorLoggedAt.toISOString()
        : String(params.cursorLoggedAt);
    clauses.push(
      `(${dateSql} < $${idx}::timestamptz OR (${dateSql} = $${idx}::timestamptz AND h.ncode < $${idx + 1}))`
    );
    values.push(cursorDate, params.cursorNcode);
    idx += 2;
  }

  const statuses =
    params.status && params.status !== 'All'
      ? params.status.split(',').map((s) => s.trim()).filter(Boolean)
      : !params.isHod && params.visibleStatuses.length > 0
        ? params.visibleStatuses
        : [];

  if (statuses.length > 0) {
    const statusPredicates = statuses
      .map((s) => POSTGRES_REGISTER_STATUS_SQL[s])
      .filter(Boolean);
    if (statusPredicates.length === 0) {
      clauses.push('1=0');
    } else {
      clauses.push(`(${statusPredicates.join(' OR ')})`);
    }
  }

  if (params.search.trim()) {
    const exact = normalizeExactTrnSearch(params.search);
    if (exact) {
      clauses.push(
        `(h.vtrnno = $${idx} OR h.vcclid = $${idx} OR cast(h.ncode as text) = $${idx} OR h.serial = $${idx})`
      );
      values.push(exact);
      idx++;
    } else if (/^\d+$/.test(params.search.trim())) {
      clauses.push(`(cast(h.ncode as text) = $${idx} OR h.vtrnno ILIKE $${idx + 1})`);
      values.push(params.search.trim(), `%${params.search.trim()}%`);
      idx += 2;
    } else {
      clauses.push(
        `(h.vtrnno ILIKE $${idx} OR h.party_name ILIKE $${idx} OR h.serial ILIKE $${idx} OR h.pincode ILIKE $${idx} OR h.region ILIKE $${idx} OR h.account ILIKE $${idx})`
      );
      values.push(`%${params.search.trim()}%`);
      idx++;
    }
  }

  const portalSql = buildPortalFilterSqlForHot(params.portalFilter);
  if (portalSql) {
    clauses.push(portalSql);
  }

  // Align with Summary / Key Account MIS — exclude WinMax practice offices.
  clauses.push(REGISTER_EXCLUDE_PRACTICE_OFFICE_SQL.replace(/^AND /, ''));

  return { sql: clauses.join(' AND '), values };
}

type RegisterTotalsResult = {
  total: number;
  summary: {
    total: number;
    cancelled: number;
    solved: number;
    open: number;
    openUnallocated: number;
    assigned: number;
    techSolved: number;
    closed: number;
  };
};

type RegisterFilterOptionsResult = {
  statesList: ReturnType<typeof aggregateDistinct>;
  citiesList: ReturnType<typeof aggregateDistinct>;
  regionsList: Array<{ vname: string; call_count: number }>;
  accountsList: Array<{ vname: string; call_count: number }>;
  branchesList: Array<{ ncode: string; vcompanyname: string; call_count: number }>;
  franchiseesList: Array<{ ncode: string; vcompanyname: string; call_count: number }>;
  techniciansList: ReturnType<typeof aggregateDistinct>;
};

/** COUNT + status summary for register filters (deferred from page-1 list query). */
export async function queryRegisterTotalsFromPostgres(
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>
): Promise<RegisterTotalsResult> {
  const fullParams: RegisterPostgresParams = {
    ...params,
    page: 1,
    limit: 1,
    fetchTotals: false,
    fetchFilterOptions: false,
  };
  const { sql: whereSql, values } = buildWhere(fullParams);

  const summaryRows = await prisma.$queryRawUnsafe<
    Array<{
      total: number;
      cancelled: number;
      solved: number;
      open_calls: number;
      open_unallocated: number;
      assigned: number;
      tech_solved: number;
      closed: number;
    }>
  >(
    `
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE COALESCE(h.ncancelreason, 0) NOT IN (0, 2))::int AS cancelled,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND ${POSTGRES_SOLVED_STAGE_SQL}
      )::int AS solved,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND NOT ${POSTGRES_SOLVED_STAGE_SQL}
      )::int AS open_calls,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND NOT ${POSTGRES_SOLVED_STAGE_SQL}
          AND COALESCE(h.nengineer, 0) = 0
      )::int AS open_unallocated,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND NOT ${POSTGRES_SOLVED_STAGE_SQL}
          AND COALESCE(h.nengineer, 0) <> 0
      )::int AS assigned,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND ${POSTGRES_SOLVED_STAGE_SQL}
          AND COALESCE(h.bapproval, false) = false
      )::int AS tech_solved,
      count(*) FILTER (
        WHERE
          COALESCE(h.ncancelreason, 0) = 0
          AND ${POSTGRES_SOLVED_STAGE_SQL}
          AND COALESCE(h.bapproval, false) = true
      )::int AS closed
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    `,
    ...values
  );

  const summary = summaryRows[0] ?? {
    total: 0,
    cancelled: 0,
    solved: 0,
    open_calls: 0,
    open_unallocated: 0,
    assigned: 0,
    tech_solved: 0,
    closed: 0,
  };

  return {
    total: summary.total,
    summary: {
      total: summary.total,
      cancelled: summary.cancelled,
      solved: summary.solved,
      open: summary.open_calls,
      openUnallocated: summary.open_unallocated,
      assigned: summary.assigned,
      techSolved: summary.tech_solved,
      closed: summary.closed,
    },
  };
}

/** Row count for export validation — same filters as list, no pagination. */
export async function countRegisterRowsFromPostgres(
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>
): Promise<number> {
  const fullParams: RegisterPostgresParams = {
    ...params,
    page: 1,
    limit: 1,
    fetchTotals: false,
    fetchFilterOptions: false,
  };
  const { sql: whereSql, values } = buildWhere(fullParams);
  const rows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
    `
    SELECT count(*)::int AS total
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    `,
    ...values
  );
  return rows[0]?.total ?? 0;
}

/** Cascade dropdown options (lazy-loaded; expensive GROUP BY). */
export async function queryRegisterFilterOptionsFromPostgres(
  params: Omit<RegisterPostgresParams, 'page' | 'limit' | 'fetchTotals' | 'fetchFilterOptions'>
): Promise<RegisterFilterOptionsResult> {
  const fullParams: RegisterPostgresParams = {
    ...params,
    page: 1,
    limit: 1,
    fetchTotals: false,
    fetchFilterOptions: false,
  };
  const { sql: whereSql, values } = buildWhere(fullParams);

  const filterRows = await prisma.$queryRawUnsafe<
    Array<{
      nofficeid: number;
      branch_name: string | null;
      office_under: number | null;
      franchisee_code: string | null;
      franchisee_name: string | null;
      nengineer: number | null;
      engineer_name: string | null;
      pincode: string | null;
      city: string | null;
      state: string | null;
      call_count: number;
    }>
  >(
    `
    SELECT
      h.nofficeid,
      h.branch_name,
      h.office_under,
      h.franchisee_code,
      h.franchisee_name,
      h.nengineer,
      h.engineer_name,
      h.pincode,
      h.city,
      h.state,
      count(*)::int AS call_count
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    GROUP BY
      h.nofficeid, h.branch_name, h.office_under, h.franchisee_code,
      h.franchisee_name, h.nengineer, h.engineer_name, h.pincode, h.city, h.state
    `,
    ...values
  );

  const processedOptions = filterRows.map((row) =>
    mapCachedRowToRegisterRow({
      nofficeid: row.nofficeid,
      office_name: row.branch_name,
      office_under: row.office_under,
      franchisee_code: row.franchisee_code,
      franchisee_name: row.franchisee_name,
      nengineer: row.nengineer,
      technician_name: row.engineer_name,
      Pincode: row.pincode,
      city: row.city,
      state: row.state,
      call_count: row.call_count,
    })
  );

  return {
    statesList: aggregateDistinct(processedOptions, 'state'),
    citiesList: aggregateDistinct(processedOptions, 'city'),
    regionsList: (
      await prisma.$queryRawUnsafe<Array<{ vname: string; call_count: number }>>(
        `
        SELECT h.region AS vname, count(*)::int AS call_count
        FROM calls_latest_hot h
        ${HOT_OFFICE_JOINS_SQL}
        WHERE ${whereSql}
        GROUP BY h.region
        ORDER BY h.region
        `,
        ...values
      )
    ).filter((row) => row.vname),
    accountsList: (
      await prisma.$queryRawUnsafe<Array<{ vname: string; call_count: number }>>(
        `
        SELECT h.account AS vname, count(*)::int AS call_count
        FROM calls_latest_hot h
        ${HOT_OFFICE_JOINS_SQL}
        WHERE ${whereSql}
        GROUP BY h.account
        ORDER BY h.account
        `,
        ...values
      )
    ).filter((row) => row.vname),
    branchesList: aggregateDistinct(processedOptions, 'resolved_branch_code', 'officename').map(
      (row) => ({ ncode: row.ncode, vcompanyname: row.vname, call_count: row.call_count })
    ),
    franchiseesList: aggregateDistinct(processedOptions, 'franchisee_code', 'franchisee_name').map(
      (row) => ({ ncode: row.ncode, vcompanyname: row.vname, call_count: row.call_count })
    ),
    techniciansList: aggregateDistinct(processedOptions, 'nengineer', 'technician_name'),
  };
}

export async function queryRegisterFromPostgres(params: RegisterPostgresParams) {
  const { sql: whereSql, values } = buildWhere(params);
  const useKeyset = hasRegisterKeysetCursor(params);
  const orderBy = resolveRegisterHotOrderBy(
    params.dateFilterColumn,
    params.sortBy,
    params.sortDir
  );
  const { text, values: listValues } = buildRegisterListQuery(
    REGISTER_HOT_COLUMNS,
    whereSql,
    values,
    params.limit,
    useKeyset ? undefined : (params.page - 1) * params.limit,
    orderBy
  );

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(text, ...listValues);

  const mapped = (await mergeArcpApproveDatesFromHot(
    (await mergeAuditEnrichment(rows.map(hotRowToRegisterRow))) as Record<string, unknown>[]
  )) as Record<string, unknown>[];

  const withRepairs = await enrichRegisterRowsRepairDone(mapped);

  const syncMeta = await getSyncMeta();
  const response: Record<string, unknown> = {
    data: withRepairs,
    readSource: 'postgres',
    syncMeta,
  };

  if (params.fetchTotals) {
    const totals = await queryRegisterTotalsFromPostgres(params);
    response.total = totals.total;
    response.summary = totals.summary;

    if (params.fetchFilterOptions !== false) {
      const options = await queryRegisterFilterOptionsFromPostgres(params);
      response.statesList = options.statesList;
      response.citiesList = options.citiesList;
      response.regionsList = options.regionsList;
      response.accountsList = options.accountsList;
      response.branchesList = options.branchesList;
      response.franchiseesList = options.franchiseesList;
      response.techniciansList = options.techniciansList;
    }
  }

  return response;
}

/** One-shot preload for client-side register/distribution filtering (no OFFSET pagination). */
export async function queryRegisterBulkFromPostgres(
  params: Pick<
    RegisterPostgresParams,
    | 'officeId'
    | 'callType'
    | 'startDate'
    | 'endDate'
    | 'dateFilterColumn'
    | 'assignedOffices'
    | 'visibleStatuses'
    | 'isHod'
    | 'repairCallKeys'
  >
) {
  const bulkParams: RegisterPostgresParams = {
    page: 1,
    limit: REGISTER_BULK_MAX_ROWS,
    search: '',
    account: '',
    region: '',
    status: '',
    pincode: '',
    priority: '',
    portalFilter: '',
    state: '',
    city: '',
    branch: '',
    franchisee: '',
    technician: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    ...params,
  };

  const { sql: whereSql, values } = buildWhere(bulkParams);
  const orderBy = registerHotOrderBy(bulkParams.dateFilterColumn);

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
    `
    SELECT ${REGISTER_HOT_COLUMNS}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  const mapped = await mergeArcpApproveDatesFromHot(
    rows.map(hotRowToRegisterRow) as Record<string, unknown>[]
  );

  return {
    data: mapped,
    total: mapped.length,
    readSource: 'postgres' as const,
    bulk: true,
  };
}

/** All matching register rows for CSV export (server-side fallback). */
export async function queryRegisterExportFromPostgres(
  params: RegisterPostgresParams
): Promise<Record<string, unknown>[]> {
  const { sql: whereSql, values } = buildWhere(params);
  const orderBy = registerHotOrderBy(params.dateFilterColumn);

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
    `
    SELECT ${REGISTER_HOT_COLUMNS}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  return mergeArcpApproveDatesFromHot(rows.map(hotRowToRegisterRow) as Record<string, unknown>[]);
}

/** Fast breakdown register export for MIS email — slim columns, no ARCP enrichment. */
export async function queryDigestRegisterExportFromPostgres(
  params: RegisterPostgresParams
): Promise<Record<string, unknown>[]> {
  const { sql: whereSql, values } = buildWhere(params);
  const orderBy = registerHotOrderBy(params.dateFilterColumn);

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
    `
    SELECT ${REGISTER_EXPORT_HOT_COLUMNS}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  return rows.map((row) => hotRowToRegisterRow(row));
}

/** Compact call rows for distribution idle-assignee / map computations. */
export async function queryDistributionCompactFromPostgres(
  params: Pick<
    RegisterPostgresParams,
    | 'officeId'
    | 'callType'
    | 'startDate'
    | 'endDate'
    | 'status'
    | 'account'
    | 'region'
    | 'pincode'
    | 'priority'
    | 'portalFilter'
    | 'state'
    | 'city'
    | 'branch'
    | 'franchisee'
    | 'technician'
    | 'assignedOffices'
    | 'visibleStatuses'
    | 'isHod'
  >
): Promise<Record<string, unknown>[]> {
  const queryParams: RegisterPostgresParams = {
    page: 1,
    limit: REGISTER_BULK_MAX_ROWS,
    search: '',
    fetchTotals: false,
    fetchFilterOptions: false,
    ...params,
  };
  const { sql: whereSql, values } = buildWhere(queryParams);
  const orderBy = registerHotOrderBy(queryParams.dateFilterColumn);

  const rows = await prisma.$queryRawUnsafeBulk<Record<string, unknown>[]>(
    `
    SELECT ${DISTRIBUTION_COMPACT_COLUMNS}
    FROM calls_latest_hot h
    ${HOT_OFFICE_JOINS_SQL}
    WHERE ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length + 1}
    `,
    ...values,
    REGISTER_BULK_MAX_ROWS
  );

  return rows.map((row) => ({
    id: row.ncode,
    ncode: row.ncode,
    nengineer: row.nengineer ?? 0,
    serviceman: row.engineer_name,
    technician_name: row.engineer_name,
    engineer_name: row.engineer_name,
    franchisee_code: row.franchisee_code,
    franchisee_name: row.franchisee_name,
    officename: row.branch_name,
    branch_office_name: row.branch_name,
    office_name: row.branch_name,
    pincode: row.pincode,
    city: row.city,
    state: row.state,
    calltype: row.call_type,
    call_type: row.call_type,
    status_label: row.status_label,
    status_bucket: row.status_bucket,
    bsolved: row.bsolved,
    bfastclose: row.bfastclose,
    ncancelreason: row.ncancelreason,
    lat: row.lat,
    lng: row.lng,
    callsdtrndate: row.logged_at,
  }));
}

function aggregateDistinct(
  rows: Record<string, unknown>[],
  codeKey: string,
  nameKey?: string
) {
  const map = new Map<string, { ncode: string; vname: string; call_count: number }>();
  for (const row of rows) {
    const code = String(row[codeKey] ?? '');
    if (!code || code === 'UNKNOWN' || code === '0') continue;
    const name = String(row[nameKey ?? codeKey] ?? code);
    const existing = map.get(code) ?? { ncode: code, vname: name, call_count: 0 };
    existing.call_count += Number(row.call_count ?? 1);
    map.set(code, existing);
  }
  return Array.from(map.values()).sort((a, b) => a.vname.localeCompare(b.vname));
}
